"""
braw-proxy-export.py — Kre8Ωr DaVinci Resolve integration
Imports BRAW files and renders H.265 proxy MP4s, organized by shot type.

Called from Node.js via child_process.spawn.
Outputs a single JSON object to stdout. Tracebacks go to stderr only.

Usage:
    python braw-proxy-export.py \
        --braw_folder "D:/footage/raw" \
        --proxy_output "D:/footage/proxies" \
        [--project_name "My Project"] \
        [--shot_type_map '{"clip001.braw": "talking_head", "clip002.braw": "b_roll"}']
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
# Shot-type subfolder map
# ---------------------------------------------------------------------------

SHOT_TYPE_SUBFOLDER = {
    "talking_head": "talking_head",
    "b_roll": "b_roll",
    "b_roll_wide": "b_roll",
    "b_roll_medium": "b_roll",
    "b_roll_close": "b_roll",
    "b_roll_close_up": "b_roll",
    "b_roll_detail": "b_roll",
    "action": "action",
    "dialogue": "dialogue",
    "unusable": "unusable",
}

DEFAULT_SUBFOLDER = "other"


# ---------------------------------------------------------------------------
# Utility: scan folder for BRAW files
# ---------------------------------------------------------------------------

def find_braw_files(folder):
    """Return sorted list of absolute paths to all .braw files under folder."""
    results = []
    for dirpath, _dirnames, filenames in os.walk(folder):
        for fn in filenames:
            if fn.lower().endswith(".braw"):
                results.append(os.path.abspath(os.path.join(dirpath, fn)))
    return sorted(results)


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
# Wait for render to complete
# ---------------------------------------------------------------------------

def wait_for_render(project, max_wait_seconds=7200, poll_interval=5):
    """
    Poll project.IsRenderingInProgress() until done or timeout.
    Returns True if render completed, False if timed out.
    """
    elapsed = 0
    while elapsed < max_wait_seconds:
        if not project.IsRenderingInProgress():
            return True
        time.sleep(poll_interval)
        elapsed += poll_interval
        print(
            f"[render] waiting... {elapsed}s elapsed / {max_wait_seconds}s max",
            file=sys.stderr
        )
    return False


# ---------------------------------------------------------------------------
# Main logic
# ---------------------------------------------------------------------------

def run(args):
    errors = []
    output_paths = []

    # ---- Validate inputs ---------------------------------------------------
    if not os.path.isdir(args.braw_folder):
        raise ValueError(f"--braw_folder does not exist: {args.braw_folder}")

    os.makedirs(args.proxy_output, exist_ok=True)

    # ---- Parse shot_type_map -----------------------------------------------
    shot_type_map = {}
    if args.shot_type_map:
        try:
            raw_map = json.loads(args.shot_type_map)
            # Normalise keys to just the filename (basename)
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

    # ---- Connect to Resolve ------------------------------------------------
    resolve = get_resolve()
    project_manager = resolve.GetProjectManager()
    if project_manager is None:
        raise RuntimeError("Could not get ProjectManager from Resolve")

    # ---- Create or open proxy project --------------------------------------
    project_name = args.project_name or "BRAW_PROXY_EXPORT_TEMP"

    if args.project_name:
        project = project_manager.LoadProject(args.project_name)
        if project is None:
            print(
                f"[warn] Could not load project '{args.project_name}', creating new",
                file=sys.stderr
            )
            project = project_manager.CreateProject(project_name)
    else:
        # Try to load existing temp project first; create if absent
        project = project_manager.LoadProject(project_name)
        if project is None:
            project = project_manager.CreateProject(project_name)

    if project is None:
        raise RuntimeError(f"Could not create or open project '{project_name}'")

    # ---- Set color settings ------------------------------------------------
    color_settings = {
        "colorScienceMode": "davinciYRGB",
        "colorSpaceInput": "Blackmagic Design Film",
        "colorSpaceOutput": "Rec.709 Scene",
        "colorSpaceTimeline": "Rec.709 Scene",
    }
    for k, v in color_settings.items():
        if not project.SetSetting(k, v):
            errors.append(f"SetSetting({k}) returned False")

    # ---- Import BRAW files -------------------------------------------------
    media_pool = project.GetMediaPool()
    if media_pool is None:
        raise RuntimeError("Could not get MediaPool")

    print(f"[info] Importing {len(braw_paths)} BRAW files...", file=sys.stderr)
    imported_items = media_pool.ImportMedia(braw_paths)
    if not imported_items:
        errors.append("ImportMedia returned empty — files may already be in pool")
        imported_items = []

    # Build filename -> item map for render settings
    item_map = {}
    for item in imported_items:
        try:
            clip_name = item.GetName()
            item_map[clip_name.lower()] = item
        except Exception:
            pass

    # ---- Build render jobs per clip ----------------------------------------
    # Clear any stale render queue
    project.DeleteAllRenderJobs()

    render_job_ids = []
    render_output_paths = []

    for braw_path in braw_paths:
        base = os.path.basename(braw_path)
        stem = os.path.splitext(base)[0]
        shot_type = shot_type_map.get(base.lower(), DEFAULT_SUBFOLDER)
        subfolder = SHOT_TYPE_SUBFOLDER.get(shot_type, DEFAULT_SUBFOLDER)

        out_dir = os.path.join(args.proxy_output, subfolder)
        os.makedirs(out_dir, exist_ok=True)

        output_file = f"{stem}_proxy.mp4"
        output_full = os.path.join(out_dir, output_file)

        render_settings = {
            "SelectAllFrames": True,
            "TargetDir": out_dir,
            "CustomName": output_file,
            "UniqueFilenameStyle": 0,
            "ExportVideo": True,
            "ExportAudio": True,
            "FormatWidth": 3840,
            "FormatHeight": 2160,
            "VideoQuality": 0,           # best quality for H.265
            "ColorSpaceTag": "Rec.709",
            "GammaTag": "Rec.709",
            "EncodingProfile": "Main",
            "MultiPassEncode": False,
            "VideoCodec": "H265_HEVC",
            "VideoBitDepth": 10,
            "VideoMaxBitrate": 80,       # Mbps
            "VideoMinBitrate": 40,
            "AudioCodec": "aac",
            "AudioBitDepth": 16,
            "AudioSampleRate": 48000,
            "AudioBitrate": 320,
            "SeparateVideoAndAudio": False,
        }

        # Create a minimal timeline for this clip if needed
        # (Resolve render requires an active timeline)
        # We rely on the media pool item being importable as a timeline clip
        try:
            project.SetRenderSettings(render_settings)
            job_id = project.AddRenderJob()
            if job_id:
                render_job_ids.append(job_id)
                render_output_paths.append(output_full)
            else:
                errors.append(f"AddRenderJob returned falsy for {base}")
        except Exception as exc:
            errors.append(f"Render job setup failed for {base}: {exc}")

    if not render_job_ids:
        raise RuntimeError(
            "No render jobs were created. Ensure clips are on a timeline in the project."
        )

    # ---- Start rendering ---------------------------------------------------
    print(f"[info] Starting {len(render_job_ids)} render jobs...", file=sys.stderr)
    render_started = project.StartRendering(render_job_ids)
    if not render_started:
        raise RuntimeError("project.StartRendering() returned False")

    # ---- Wait for render completion ----------------------------------------
    completed = wait_for_render(project, max_wait_seconds=7200, poll_interval=5)
    if not completed:
        errors.append("Render timed out after 2 hours")

    # ---- Collect render results --------------------------------------------
    render_jobs = project.GetRenderJobList()
    files_processed = 0

    for job in (render_jobs or []):
        job_status = job.get("JobStatus", "")
        job_name = job.get("OutputFilename", "")
        if job_status.lower() in ("complete", "completed"):
            files_processed += 1
            if job_name:
                output_paths.append(job_name)
        elif job_status.lower() == "failed":
            errors.append(f"Render job failed: {job_name or job.get('JobId', '?')}")

    # If Resolve didn't give us paths from job list, use our tracked list
    if not output_paths:
        output_paths = [p for p in render_output_paths if os.path.isfile(p)]
        files_processed = len(output_paths)

    proxy_size_gb = total_size_gb(output_paths)
    reduction_pct = 0.0
    if braw_size_gb > 0:
        reduction_pct = round((1.0 - proxy_size_gb / braw_size_gb) * 100, 1)

    # ---- Save project ------------------------------------------------------
    project_manager.SaveProject()

    return {
        "ok": True,
        "files_processed": files_processed,
        "braw_size_gb": braw_size_gb,
        "proxy_size_gb": proxy_size_gb,
        "reduction_pct": reduction_pct,
        "output_paths": output_paths,
        "errors": errors,
    }


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def parse_args():
    parser = argparse.ArgumentParser(
        description="Export BRAW proxies via DaVinci Resolve for Kre8\u03a9r"
    )
    parser.add_argument("--braw_folder", type=str, required=True,
                        help="Folder containing .braw files (searched recursively)")
    parser.add_argument("--proxy_output", type=str, required=True,
                        help="Output folder for proxy MP4s")
    parser.add_argument("--project_name", type=str, default=None,
                        help="DaVinci project to use (or creates BRAW_PROXY_EXPORT_TEMP)")
    parser.add_argument("--shot_type_map", type=str, default=None,
                        help='JSON mapping filename -> shot_type for subfolder organisation')
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
