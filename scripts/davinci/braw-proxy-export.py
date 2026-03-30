"""
braw-proxy-export.py — Kre8Ωr DaVinci Resolve integration

Complete BRAW → H.265 proxy pipeline:
  1. Open existing DaVinci project by name (davinci_project_name from DB)
  2. Scan braw_folder for .braw files
  3. Import all BRAW files into the 01_RAW_SOURCES bin
  4. Create 00_PROXY_SOURCE timeline (deleted and recreated fresh each run)
  5. Add all clips to timeline in chronological (filename) order
  6. Queue one render job per clip — [original_name]_proxy.mp4
  7. Render H.265 MP4s to proxy_output (vault intake folder)
  8. VaultΩr watcher auto-ingests proxies and links them to existing BRAW records

Called from Node.js via child_process.spawn.
Outputs a single JSON object to stdout. Tracebacks go to stderr only.

Usage:
    python braw-proxy-export.py \
        --project_name "2026-03-29_My-Video_006" \
        --braw_folder "D:/footage/raw" \
        --proxy_output "C:/Users/18054/Videos/intake" \
        [--shot_type_map '{"clip001.braw": "talking_head"}']
"""

import sys
import os
import json
import argparse
import time
import traceback

# ---------------------------------------------------------------------------
# DaVinci Resolve scripting API bootstrap
# ---------------------------------------------------------------------------

def bootstrap_resolve_api():
    api_path = os.environ.get(
        "RESOLVE_SCRIPT_API",
        r"C:\ProgramData\Blackmagic Design\DaVinci Resolve\Support\Developer\Scripting"
    )
    lib_path = os.environ.get(
        "RESOLVE_SCRIPT_LIB",
        r"C:\Program Files\Blackmagic Design\DaVinci Resolve\fusionscript.dll"
    )
    modules_path = os.path.join(api_path, "Modules")
    if modules_path not in sys.path:
        sys.path.insert(0, modules_path)
    if api_path not in sys.path:
        sys.path.insert(0, api_path)
    if sys.platform == "win32":
        lib_dir = os.path.dirname(lib_path)
        if hasattr(os, "add_dll_directory"):
            try:
                os.add_dll_directory(lib_dir)
            except Exception:
                pass
        os.environ["PATH"] = lib_dir + os.pathsep + os.environ.get("PATH", "")


def get_resolve():
    bootstrap_resolve_api()
    try:
        import DaVinciResolveScript as dvr_script
        resolve = dvr_script.scriptapp("Resolve")
        if resolve is None:
            raise RuntimeError("DaVinci Resolve returned None — is it running?")
        return resolve
    except ImportError as exc:
        raise RuntimeError(
            f"Cannot import DaVinciResolveScript: {exc}. "
            "Check RESOLVE_SCRIPT_API / RESOLVE_SCRIPT_LIB env vars."
        ) from exc


# ---------------------------------------------------------------------------
# Utility: scan folder for BRAW files
# ---------------------------------------------------------------------------

def find_braw_files(folder):
    """Return sorted list of absolute paths to all .braw files under folder."""
    results = []
    for dirpath, _dirnames, filenames in os.walk(folder):
        for fn in sorted(filenames):
            if fn.lower().endswith(".braw"):
                results.append(os.path.abspath(os.path.join(dirpath, fn)))
    return results


# ---------------------------------------------------------------------------
# Utility: total file size in GB
# ---------------------------------------------------------------------------

def total_size_gb(paths):
    total = 0
    for p in paths:
        try:
            total += os.path.getsize(p)
        except OSError:
            pass
    return round(total / (1024 ** 3), 3)


# ---------------------------------------------------------------------------
# Utility: find or create a direct child bin by name
# ---------------------------------------------------------------------------

def find_or_create_bin(media_pool, parent_folder, bin_name):
    """Return existing child bin named bin_name, or create it."""
    get_subs = getattr(parent_folder, "GetSubFolderList", None)
    if callable(get_subs):
        for subfolder in (get_subs() or []):
            get_name = getattr(subfolder, "GetName", None)
            if callable(get_name) and get_name() == bin_name:
                return subfolder
    created = media_pool.AddSubFolder(parent_folder, bin_name)
    if created is None:
        print(f"[warn] Could not create bin '{bin_name}'", file=sys.stderr)
    return created


# ---------------------------------------------------------------------------
# Utility: create (or recreate) the 00_PROXY_SOURCE timeline
# ---------------------------------------------------------------------------

def create_proxy_source_timeline(project, media_pool, root_folder,
                                  timeline_name="00_PROXY_SOURCE"):
    """
    Delete any existing 00_PROXY_SOURCE timeline and create a fresh one.
    Returns the new Timeline object.
    """
    get_count = getattr(project, "GetTimelineCount", None)
    get_by_idx = getattr(project, "GetTimelineByIndex", None)
    delete_tls = getattr(project, "DeleteTimelines", None)

    if callable(get_count) and callable(get_by_idx) and callable(delete_tls):
        count = get_count() or 0
        for i in range(1, count + 1):
            tl = get_by_idx(i)
            get_name = getattr(tl, "GetName", None) if tl else None
            if callable(get_name) and get_name() == timeline_name:
                delete_tls([tl])
                print(f"[timeline] Deleted existing '{timeline_name}'", file=sys.stderr)
                break

    media_pool.SetCurrentFolder(root_folder)
    timeline = media_pool.CreateEmptyTimeline(timeline_name)
    if timeline is None:
        raise RuntimeError(f"Could not create timeline '{timeline_name}'")
    print(f"[timeline] Created '{timeline_name}'", file=sys.stderr)
    return timeline


# ---------------------------------------------------------------------------
# Utility: get source resolution from first imported item
# ---------------------------------------------------------------------------

def get_source_resolution(items):
    """
    Try to read resolution from the first MediaPoolItem.
    Returns (width, height) — defaults to (3840, 2160) if not readable.
    """
    for item in items:
        get_prop = getattr(item, "GetClipProperty", None)
        if not callable(get_prop):
            continue
        res_str = get_prop("Resolution") or ""
        if "x" in str(res_str):
            try:
                parts = str(res_str).split("x")
                return int(parts[0].strip()), int(parts[1].strip())
            except (ValueError, IndexError):
                pass
    # Default: Blackmagic 4K
    return 3840, 2160


# ---------------------------------------------------------------------------
# Probe available render formats, codecs, and presets — log to stderr
# ---------------------------------------------------------------------------

def probe_render_options(project):
    """
    Call GetRenderFormats(), GetRenderCodecs('mp4'), and GetRenderPresets().
    Log everything to stderr so we can see exactly what Resolve 20 exposes.
    Returns (formats_dict, codecs_dict, presets_list).
    """
    formats = {}
    codecs  = {}
    presets = []

    get_formats = getattr(project, "GetRenderFormats", None)
    if callable(get_formats):
        try:
            formats = get_formats() or {}
            print(f"[probe] GetRenderFormats() = {formats}", file=sys.stderr)
        except Exception as exc:
            print(f"[probe] GetRenderFormats() raised: {exc}", file=sys.stderr)
    else:
        print("[probe] GetRenderFormats not callable", file=sys.stderr)

    get_codecs = getattr(project, "GetRenderCodecs", None)
    if callable(get_codecs):
        for fmt_key in (["mp4", "MP4"] + list(formats.keys()))[:6]:
            try:
                result = get_codecs(fmt_key) or {}
                if result:
                    codecs[fmt_key] = result
                    print(f"[probe] GetRenderCodecs({fmt_key!r}) = {result}", file=sys.stderr)
                    break
            except Exception as exc:
                print(f"[probe] GetRenderCodecs({fmt_key!r}) raised: {exc}", file=sys.stderr)
    else:
        print("[probe] GetRenderCodecs not callable", file=sys.stderr)

    get_presets = getattr(project, "GetRenderPresets", None)
    if callable(get_presets):
        try:
            presets = get_presets() or []
            print(f"[probe] GetRenderPresets() = {presets}", file=sys.stderr)
        except Exception as exc:
            print(f"[probe] GetRenderPresets() raised: {exc}", file=sys.stderr)
    else:
        print("[probe] GetRenderPresets not callable", file=sys.stderr)

    return formats, codecs, presets


def set_render_format_and_codec(project):
    """
    Try codec name variants until one succeeds for mp4/H265.
    Falls back to H264 if no H265 variant works.
    Returns (format_str, codec_str) that succeeded, or (None, None).
    """
    set_fmt = getattr(project, "SetCurrentRenderFormatAndCodec", None)
    if not callable(set_fmt):
        print("[render] SetCurrentRenderFormatAndCodec not callable", file=sys.stderr)
        return None, None

    # H265 candidates — Resolve 20 may use any of these
    h265_candidates = [
        ("mp4", "H265_HEVC"),
        ("mp4", "H.265"),
        ("mp4", "HEVC"),
        ("mp4", "H265"),
        ("mp4", "h265"),
        ("MP4", "H265_HEVC"),
        ("MP4", "H.265"),
    ]
    # H264 fallback candidates
    h264_candidates = [
        ("mp4", "H264"),
        ("mp4", "H.264"),
        ("mp4", "AVC"),
        ("MP4", "H264"),
    ]

    for fmt, codec in h265_candidates + h264_candidates:
        try:
            ok = set_fmt(fmt, codec)
            print(f"[render] SetCurrentRenderFormatAndCodec({fmt!r}, {codec!r}) = {ok}", file=sys.stderr)
            if ok:
                return fmt, codec
        except Exception as exc:
            print(f"[render] SetCurrentRenderFormatAndCodec({fmt!r}, {codec!r}) raised: {exc}", file=sys.stderr)

    return None, None


def try_load_render_preset(project, presets):
    """
    If a high-quality H265/H264 preset exists, load it.
    Returns the preset name used, or None.
    """
    load_preset = getattr(project, "LoadRenderPreset", None)
    if not callable(load_preset):
        return None

    preferred_keywords = ["h.265", "h265", "hevc", "4k", "master", "youtube"]
    fallback_keywords  = ["h.264", "h264", "avc", "high quality"]

    def score(name):
        low = name.lower()
        for i, kw in enumerate(preferred_keywords):
            if kw in low:
                return (0, i)
        for i, kw in enumerate(fallback_keywords):
            if kw in low:
                return (1, i)
        return (2, 0)

    if not presets:
        return None

    sorted_presets = sorted(presets, key=lambda p: score(p if isinstance(p, str) else str(p)))
    best = sorted_presets[0] if sorted_presets else None
    if best is None:
        return None

    preset_name = best if isinstance(best, str) else str(best)
    try:
        ok = load_preset(preset_name)
        print(f"[render] LoadRenderPreset({preset_name!r}) = {ok}", file=sys.stderr)
        return preset_name if ok else None
    except Exception as exc:
        print(f"[render] LoadRenderPreset({preset_name!r}) raised: {exc}", file=sys.stderr)
        return None


# ---------------------------------------------------------------------------
# Wait for render to complete — per-job status polling
# ---------------------------------------------------------------------------

def wait_for_render(project, job_ids, per_job_timeout=1800, poll_interval=5):
    """
    Poll GetRenderJobStatus() for each job_id until all are Complete or Failed
    (or per_job_timeout seconds have elapsed for any single job).

    Returns dict: { job_id -> status_string }
    """
    get_status = getattr(project, "GetRenderJobStatus", None)
    is_rendering = getattr(project, "IsRenderingInProgress", None)

    if not callable(get_status):
        # Fallback: blind poll on IsRenderingInProgress
        print("[wait] GetRenderJobStatus not callable — using IsRenderingInProgress fallback", file=sys.stderr)
        if callable(is_rendering):
            elapsed = 0
            while elapsed < per_job_timeout * len(job_ids):
                if not is_rendering():
                    break
                time.sleep(poll_interval)
                elapsed += poll_interval
                if elapsed % 60 == 0:
                    print(f"[wait] {elapsed}s elapsed (blind poll)...", file=sys.stderr)
        return {jid: "unknown" for jid in job_ids}

    # Per-job tracking
    job_start   = {jid: time.time() for jid in job_ids}
    job_done    = {}   # jid -> final status string
    pending     = list(job_ids)

    while pending:
        still_pending = []
        for jid in pending:
            try:
                info   = get_status(jid) or {}
                status = str(info.get("JobStatus", "")).lower()
            except Exception as exc:
                print(f"[wait] GetRenderJobStatus({jid}) raised: {exc}", file=sys.stderr)
                status = "error"

            if status in ("complete", "completed"):
                job_done[jid] = "complete"
                print(f"[wait] Job {jid} complete", file=sys.stderr)
            elif status in ("failed", "cancelled", "error"):
                job_done[jid] = status
                print(f"[wait] Job {jid} {status}", file=sys.stderr)
            else:
                # Check per-job timeout
                elapsed = time.time() - job_start[jid]
                if elapsed > per_job_timeout:
                    job_done[jid] = "timeout"
                    print(f"[wait] Job {jid} timed out after {int(elapsed)}s", file=sys.stderr)
                else:
                    still_pending.append(jid)

        pending = still_pending
        if pending:
            completed_count = len(job_done)
            total = len(job_ids)
            if completed_count > 0 and completed_count % 5 == 0:
                print(f"[wait] {completed_count}/{total} jobs done, {len(pending)} pending...", file=sys.stderr)
            time.sleep(poll_interval)

    return job_done


# ---------------------------------------------------------------------------
# Main logic
# ---------------------------------------------------------------------------

def run(args):
    errors = []
    render_output_paths = []

    # ---- Validate inputs ---------------------------------------------------
    if not os.path.isdir(args.braw_folder):
        raise ValueError(f"--braw_folder does not exist: {args.braw_folder}")

    # Confirm proxy_output matches vault.intake_folder from creator-profile.json.
    # Warn loudly if it doesn't — proxies sent elsewhere won't be auto-ingested.
    try:
        profile_path = os.path.join(os.path.dirname(__file__), '..', '..', 'creator-profile.json')
        profile_path = os.path.normpath(profile_path)
        with open(profile_path, 'r', encoding='utf-8') as f:
            profile = json.load(f)
        intake_folder = profile.get('vault', {}).get('intake_folder', None)
        if intake_folder:
            intake_norm  = os.path.normcase(os.path.normpath(intake_folder))
            output_norm  = os.path.normcase(os.path.normpath(args.proxy_output))
            if intake_norm != output_norm:
                print(
                    f"[WARNING] proxy_output ({args.proxy_output}) does not match "
                    f"vault.intake_folder ({intake_folder}). "
                    "Proxies will NOT be auto-ingested by VaultΩr watcher.",
                    file=sys.stderr
                )
            else:
                print(f"[info] Proxy output matches vault intake folder ✓", file=sys.stderr)
    except Exception as exc:
        print(f"[warn] Could not verify proxy_output against creator-profile.json: {exc}", file=sys.stderr)

    os.makedirs(args.proxy_output, exist_ok=True)
    print(f"[info] Proxy output: {args.proxy_output}", file=sys.stderr)

    # ---- Parse shot_type_map -----------------------------------------------
    shot_type_map = {}
    if args.shot_type_map:
        try:
            raw_map = json.loads(args.shot_type_map)
            for k, v in raw_map.items():
                shot_type_map[os.path.basename(k).lower()] = v.lower()
        except json.JSONDecodeError as exc:
            raise ValueError(f"Invalid --shot_type_map: {exc}") from exc

    # ---- Find BRAW files ---------------------------------------------------
    braw_paths = find_braw_files(args.braw_folder)
    if not braw_paths:
        return {
            "ok": True,
            "files_processed": 0,
            "braw_size_gb": 0.0,
            "proxy_size_gb": 0.0,
            "reduction_pct": 0.0,
            "output_paths": [],
            "errors": ["No .braw files found in folder"],
        }

    braw_size_gb = total_size_gb(braw_paths)
    print(f"[info] Found {len(braw_paths)} BRAW files ({braw_size_gb} GB)", file=sys.stderr)

    # Build stem -> braw_path lookup for matching timeline items after import
    name_to_braw = {}
    for bp in braw_paths:
        stem = os.path.splitext(os.path.basename(bp))[0]
        name_to_braw[stem.lower()] = bp

    # ---- Connect to Resolve ------------------------------------------------
    resolve = get_resolve()
    project_manager = resolve.GetProjectManager()
    if project_manager is None:
        raise RuntimeError("Could not get ProjectManager from Resolve")

    version = "(unknown)"
    try:
        version = resolve.GetVersionString() or "(unknown)"
    except Exception:
        pass
    print(f"[resolve] Version: {version}", file=sys.stderr)

    # ---- Open the project --------------------------------------------------
    # Try current project first (may already be open), then LoadProject.
    project = None
    try:
        current = project_manager.GetCurrentProject()
        get_name = getattr(current, "GetName", None) if current else None
        if callable(get_name) and get_name() == args.project_name:
            project = current
            print(f"[project] Already open: '{args.project_name}'", file=sys.stderr)
    except Exception:
        pass

    if project is None:
        project = project_manager.LoadProject(args.project_name)
        if project is None:
            raise RuntimeError(
                f"Could not open project '{args.project_name}'. "
                "Confirm the project exists in DaVinci Resolve and matches the name exactly."
            )
        print(f"[project] Opened: '{args.project_name}'", file=sys.stderr)

    # ---- Get media pool and root folder ------------------------------------
    media_pool = project.GetMediaPool()
    if media_pool is None:
        raise RuntimeError("Could not get MediaPool from project")

    root_folder = media_pool.GetRootFolder()
    if root_folder is None:
        raise RuntimeError("Could not get root folder from MediaPool")

    # ---- Find or create 01_RAW_SOURCES bin ---------------------------------
    raw_sources_bin = find_or_create_bin(media_pool, root_folder, "01_RAW_SOURCES")
    if raw_sources_bin is None:
        # Fall back to root if bin creation failed
        raw_sources_bin = root_folder
        errors.append("Could not find/create 01_RAW_SOURCES bin — importing to root")

    # ---- Import BRAW files into 01_RAW_SOURCES -----------------------------
    media_pool.SetCurrentFolder(raw_sources_bin)
    print(f"[import] Importing {len(braw_paths)} BRAW files into 01_RAW_SOURCES...", file=sys.stderr)

    imported_items = media_pool.ImportMedia(braw_paths)
    if not imported_items:
        # Clips may already be in the pool — try fetching existing items
        errors.append("ImportMedia returned empty — clips may already be in media pool")
        imported_items = []

    print(f"[import] {len(imported_items)} items imported", file=sys.stderr)

    # Build item lookup by name (stem, lowercased)
    item_by_name = {}
    for item in imported_items:
        get_name = getattr(item, "GetName", None)
        if callable(get_name):
            item_name = (get_name() or "").lower()
            # GetName() may return "clip001.braw" or just "clip001"
            stem = os.path.splitext(item_name)[0]
            item_by_name[stem] = item

    if not item_by_name:
        raise RuntimeError(
            "No items available in media pool after import. "
            "Check that the BRAW files are accessible from this machine."
        )

    # Order items to match braw_paths sort order
    ordered_items = []
    for bp in braw_paths:
        stem = os.path.splitext(os.path.basename(bp))[0].lower()
        item = item_by_name.get(stem)
        if item:
            ordered_items.append((stem, bp, item))
        else:
            errors.append(f"Could not find imported item for {os.path.basename(bp)} — skipping")

    if not ordered_items:
        raise RuntimeError("No BRAW clips could be matched to media pool items.")

    # ---- Detect source resolution ------------------------------------------
    all_items = [t[2] for t in ordered_items]
    src_width, src_height = get_source_resolution(all_items)
    print(f"[info] Source resolution: {src_width}x{src_height}", file=sys.stderr)

    # ---- Create 00_PROXY_SOURCE timeline -----------------------------------
    timeline = create_proxy_source_timeline(project, media_pool, root_folder)

    # Set timeline resolution and frame rate to match source
    timeline.SetSetting("timelineResolutionWidth",  str(src_width))
    timeline.SetSetting("timelineResolutionHeight", str(src_height))
    timeline.SetSetting("timelineFrameRate", "25")   # adjust if shooting at different fps

    project.SetCurrentTimeline(timeline)

    # ---- Add all BRAW clips to timeline ------------------------------------
    clip_dicts = [
        {"mediaPoolItem": item, "startFrame": 0, "endFrame": -1, "mediaType": 1}
        for (_, _, item) in ordered_items
    ]
    result = media_pool.AppendToTimeline(clip_dicts)
    if not result:
        errors.append("AppendToTimeline returned falsy — timeline may be empty")

    # ---- Retrieve timeline items in track order ----------------------------
    get_items = getattr(timeline, "GetItemListInTrack", None)
    if not callable(get_items):
        raise RuntimeError("GetItemListInTrack not callable on this Resolve version")

    timeline_items = get_items("video", 1) or []
    print(f"[timeline] {len(timeline_items)} clips on track 1", file=sys.stderr)

    if not timeline_items:
        raise RuntimeError(
            "Timeline has no clips after AppendToTimeline. "
            "BRAW files may not be readable by this version of DaVinci Resolve."
        )

    # ---- Probe render options and set format/codec -------------------------
    formats, codecs, presets = probe_render_options(project)

    # Try loading a preset first (most reliable in Resolve 20)
    preset_used = try_load_render_preset(project, presets)
    if preset_used:
        print(f"[render] Using preset: {preset_used!r}", file=sys.stderr)
    else:
        # No usable preset — set format + codec manually
        fmt_used, codec_used = set_render_format_and_codec(project)
        if fmt_used:
            print(f"[render] Format set: {fmt_used!r} / {codec_used!r}", file=sys.stderr)
        else:
            errors.append(
                "Could not set render format/codec — tried all H265 and H264 variants. "
                "Render jobs will use whatever format Resolve currently has selected."
            )
            print("[render] WARNING: format/codec set failed — using Resolve default", file=sys.stderr)

    # ---- Clear any stale render queue --------------------------------------
    delete_jobs = getattr(project, "DeleteAllRenderJobs", None)
    if callable(delete_jobs):
        delete_jobs()

    # ---- Queue one render job per clip -------------------------------------
    render_job_ids = []

    for ti in timeline_items:
        # Get clip name from timeline item to look up original braw path
        get_ti_name = getattr(ti, "GetName", None)
        ti_name_raw = get_ti_name() if callable(get_ti_name) else ""
        ti_stem = os.path.splitext(str(ti_name_raw or "").lower())[0]

        # Look up original BRAW path
        braw_path = name_to_braw.get(ti_stem)
        if not braw_path:
            # Partial match fallback (Resolve may truncate long names)
            braw_path = next(
                (v for k, v in name_to_braw.items() if k.startswith(ti_stem[:8])),
                None
            )
        if not braw_path:
            errors.append(f"Could not map timeline item '{ti_name_raw}' to a BRAW file — skipping")
            continue

        orig_stem = os.path.splitext(os.path.basename(braw_path))[0]
        proxy_name = f"{orig_stem}_proxy"   # Resolve appends .mp4 from format
        expected_output = os.path.join(args.proxy_output, f"{proxy_name}.mp4")

        # Get clip start/end frame positions on timeline
        get_start    = getattr(ti, "GetStart",    None)
        get_duration = getattr(ti, "GetDuration", None)

        start = get_start()    if callable(get_start)    else 0
        dur   = get_duration() if callable(get_duration) else 0
        end   = (start + dur - 1) if dur > 0 else start

        print(f"[job] {orig_stem}: frames {start}–{end} → {proxy_name}.mp4", file=sys.stderr)

        set_render = getattr(project, "SetRenderSettings", None)
        add_job    = getattr(project, "AddRenderJob",       None)

        if not callable(set_render) or not callable(add_job):
            errors.append("SetRenderSettings or AddRenderJob not callable")
            break

        set_render({
            "SelectAllFrames":      False,
            "MarkIn":               start,
            "MarkOut":              end,
            "TargetDir":            args.proxy_output,
            "CustomName":           proxy_name,
            "UniqueFilenameStyle":  0,
            "ExportVideo":          True,
            "ExportAudio":          True,
            "FormatWidth":          src_width,
            "FormatHeight":         src_height,
            "VideoMaxBitrate":      80,
            "VideoMinBitrate":      40,
            "VideoBitDepth":        10,
            "AudioCodec":           "aac",
            "AudioSampleRate":      48000,
            "SeparateVideoAndAudio": False,
        })

        job_id = add_job()
        if job_id:
            render_job_ids.append(job_id)
            render_output_paths.append(expected_output)
            print(f"[job] Queued job {job_id}", file=sys.stderr)
        else:
            errors.append(f"AddRenderJob returned falsy for {orig_stem}")

    if not render_job_ids:
        raise RuntimeError(
            f"No render jobs were created. {len(errors)} error(s): {'; '.join(errors[:3])}"
        )

    print(f"[render] Starting {len(render_job_ids)} render jobs...", file=sys.stderr)

    # ---- Start rendering ---------------------------------------------------
    start_render = getattr(project, "StartRendering", None)
    if not callable(start_render):
        raise RuntimeError("StartRendering not callable on this Resolve version")

    render_started = start_render(render_job_ids)
    if not render_started:
        raise RuntimeError("project.StartRendering() returned False")

    # ---- Wait for per-job completion (30 min per job timeout) --------------
    # GetRenderJobStatus() is polled per job — exits as soon as all are done.
    job_results = wait_for_render(
        project, render_job_ids,
        per_job_timeout=1800,   # 30 min per job
        poll_interval=5
    )

    timed_out = [jid for jid, st in job_results.items() if st == "timeout"]
    failed    = [jid for jid, st in job_results.items() if st in ("failed", "cancelled", "error")]
    if timed_out:
        errors.append(f"{len(timed_out)} job(s) timed out after 30 min: {timed_out}")
    if failed:
        errors.append(f"{len(failed)} job(s) failed: {failed}")

    # ---- Collect results ---------------------------------------------------
    output_paths = []
    files_processed = 0

    # Primary: ask Resolve for final job list with status + output filename
    get_job_list = getattr(project, "GetRenderJobList", None)
    render_jobs  = get_job_list() if callable(get_job_list) else []

    for job in (render_jobs or []):
        status   = str(job.get("JobStatus", "")).lower()
        job_file = job.get("OutputFilename", "")
        if status in ("complete", "completed"):
            files_processed += 1
            if job_file:
                output_paths.append(job_file)
        elif status in ("failed", "cancelled"):
            errors.append(f"Render job failed: {job_file or job.get('JobId', '?')}")

    # Fallback: use our tracked expected paths for files that exist on disk
    if not output_paths:
        output_paths = [p for p in render_output_paths if os.path.isfile(p)]
        files_processed = len(output_paths)
        if output_paths:
            print(f"[collect] Resolve job list gave no paths — found {len(output_paths)} files on disk", file=sys.stderr)

    proxy_size_gb = total_size_gb(output_paths)
    reduction_pct = 0.0
    if braw_size_gb > 0:
        reduction_pct = round((1.0 - proxy_size_gb / braw_size_gb) * 100, 1)

    print(
        f"[done] {files_processed} proxies rendered, "
        f"{braw_size_gb} GB → {proxy_size_gb} GB ({reduction_pct}% reduction)",
        file=sys.stderr
    )

    # ---- Save project ------------------------------------------------------
    save = getattr(project_manager, "SaveProject", None)
    if callable(save):
        save()

    return {
        "ok":              True,
        "files_processed": files_processed,
        "braw_size_gb":    braw_size_gb,
        "proxy_size_gb":   proxy_size_gb,
        "reduction_pct":   reduction_pct,
        "output_paths":    output_paths,
        "errors":          errors,
    }


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def parse_args():
    parser = argparse.ArgumentParser(
        description="Export BRAW proxies via DaVinci Resolve for Kre8\u03a9r"
    )
    parser.add_argument("--project_name", type=str, required=True,
                        help="DaVinci project name (davinci_project_name from DB)")
    parser.add_argument("--braw_folder", type=str, required=True,
                        help="Folder containing .braw files (searched recursively)")
    parser.add_argument("--proxy_output", type=str, required=True,
                        help="Output folder for proxy MP4s (use vault intake folder)")
    parser.add_argument("--shot_type_map", type=str, default=None,
                        help='JSON mapping filename -> shot_type')
    return parser.parse_args()


if __name__ == "__main__":
    try:
        args = parse_args()
        result = run(args)
        print(json.dumps(result))
    except Exception as exc:
        traceback.print_exc(file=sys.stderr)
        print(json.dumps({"ok": False, "error": str(exc)}))
        sys.exit(1)
