"""
build-selects.py — Kre8Ωr DaVinci Resolve integration
Creates the 02_SELECTS timeline in an existing Resolve project.

Each script section becomes a labelled region on the timeline:
  Blue   marker  — section header (script_section label)
  Green  marker  — winner take chosen by SelectsΩr
  Orange marker  — fire suggestion note (editing direction from Claude)
  Red    marker  — gold nugget (off-script moment worth keeping)
                   preceded by a 20-frame gap so it stands out

B-roll suggestions (when fire_suggestion mentions "b-roll" or "broll") are
added as Orange markers on Video Track 2 opposite the matching section.

Called from Node.js via child_process.spawn.
Outputs a single JSON object to stdout. Tracebacks go to stderr only.

Usage:
    python build-selects.py \\
        --project_id 42 \\
        --project_name "2026-03-29_My-Video_042" \\
        --selects_json '[{"script_section":"Intro","section_index":0,...}]' \\
        --footage_paths_json '{"3": "C:/proxies/th1.mp4", "7": "C:/proxies/th2.mp4"}' \\
        [--fps 24]
"""

import sys
import os
import json
import argparse
import traceback

# ---------------------------------------------------------------------------
# DaVinci Resolve scripting API bootstrap (same pattern as create-project.py)
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
# Project finder — locate the existing Resolve project by project_id suffix
# ---------------------------------------------------------------------------

def find_project(project_manager, project_name, project_id):
    """
    1. Try exact name match.
    2. Try any project ending with the zero-padded project_id suffix.
    3. Fall back to the currently open project in Resolve — the natural creator
       workflow is to have the right project open in Resolve before pushing from Kre8r.
    """
    # 1. Try exact name
    p = project_manager.LoadProject(project_name)
    if p:
        print(f"[resolve] Opened project: {project_name}", file=sys.stderr)
        return p

    # 2. Scan for suffix match (_288, _022, etc.)
    suffix = f"_{project_id:03d}"
    projects = project_manager.GetProjectListInCurrentFolder() or []
    for name in projects:
        if name.endswith(suffix):
            p = project_manager.LoadProject(name)
            if p:
                print(f"[resolve] Opened project by suffix match: {name}", file=sys.stderr)
                return p

    # 3. Fall back to currently open project
    current = project_manager.GetCurrentProject()
    if current:
        current_name = current.GetName() if callable(current.GetName) else str(current)
        print(
            f"[resolve] No project matched name '{project_name}' or suffix '{suffix}'. "
            f"Using currently open project: '{current_name}'",
            file=sys.stderr
        )
        return current

    raise RuntimeError(
        f"Could not find a Resolve project for '{project_name}' (project_id={project_id}) "
        f"and no project is currently open in Resolve. "
        f"Open your project in DaVinci Resolve and try again."
    )


# ---------------------------------------------------------------------------
# Media pool helpers
# ---------------------------------------------------------------------------

def _walk_folder(folder, depth=0):
    """Yield (folder, [clip_items]) for folder and all subfolders recursively."""
    yield folder, folder.GetClipList() or []
    for sub in (folder.GetSubFolderList() or []):
        yield from _walk_folder(sub, depth + 1)


def build_path_index(media_pool):
    """
    Build a dict: normalised file path (lowercase) → MediaPoolItem.
    Used only to avoid re-importing a clip that's already in the media pool.
    VaultΩr is the source of truth for paths — this is just a cache.
    """
    path_index = {}
    root = media_pool.GetRootFolder()
    for _folder, clips in _walk_folder(root):
        for clip in clips:
            try:
                fp = clip.GetClipProperty("File Path") or ""
                if fp:
                    path_index[fp.lower().replace("\\", "/")] = clip
            except Exception:
                pass
    print(f"[resolve] Media pool has {len(path_index)} clip(s) already imported", file=sys.stderr)
    return path_index


def find_clip(path_index, file_path, media_pool):
    """
    Return a MediaPoolItem for file_path.
    Strategy:
      1. Already in media pool — return it immediately (no re-import).
      2. Not in pool — import from the VaultΩr-recorded path on disk.
    VaultΩr is the source of truth. We trust the path it recorded.
    """
    if not file_path:
        return None, False

    norm = file_path.lower().replace("\\", "/")

    # 1. Already in pool
    if norm in path_index:
        print(f"[resolve] Already in pool: {os.path.basename(file_path)}", file=sys.stderr)
        return path_index[norm], False

    # 2. Import from VaultΩr path
    if not os.path.isfile(file_path):
        print(f"[warn] VaultΩr path not found on disk: {file_path}", file=sys.stderr)
        print(f"[warn] Check VaultΩr — is proxy_path set and file accessible?", file=sys.stderr)
        return None, False

    items = media_pool.ImportMedia([file_path])
    if items:
        item = items[0]
        path_index[norm] = item
        print(f"[import] Imported from VaultΩr path: {os.path.basename(file_path)}", file=sys.stderr)
        return item, True

    print(f"[warn] Resolve ImportMedia failed for: {file_path}", file=sys.stderr)
    return None, False


# ---------------------------------------------------------------------------
# Timeline frame helpers
# ---------------------------------------------------------------------------

def ts_to_frame(seconds, fps):
    return int(round(float(seconds) * fps))


def clip_duration_frames(item, start_ts, end_ts, fps):
    """
    Return (start_frame_in_clip, end_frame_in_clip, duration_frames).
    Uses provided timestamps if available; falls back to full clip length.
    """
    if start_ts is not None and end_ts is not None:
        sf = ts_to_frame(start_ts, fps)
        ef = ts_to_frame(end_ts, fps)
        return sf, ef, ef - sf

    # Fall back to full clip duration via properties
    try:
        dur_str = item.GetClipProperty("Duration") or ""
        # Duration may be "HH:MM:SS:FF" or frame count string
        if ":" in dur_str:
            parts = dur_str.split(":")
            h, m, s, f = (int(x) for x in parts)
            total = ((h * 3600 + m * 60 + s) * fps) + f
            return 0, total, total
        else:
            total = int(dur_str)
            return 0, total, total
    except Exception:
        pass

    # Last resort: 10 seconds
    return 0, ts_to_frame(10, fps), ts_to_frame(10, fps)


# ---------------------------------------------------------------------------
# Marker helpers
# ---------------------------------------------------------------------------

MARKER_COLORS = {
    "section": "Blue",
    "winner":  "Green",
    "fire":    "Orange",
    "gold":    "Red",
    "broll":   "Orange",
}

GAP_GOLD_FRAMES = 20   # visual breathing room before gold nugget sections

BEAT_CRITICAL = {'All Is Lost', 'Break into Three', 'CTA', 'Hook', 'Catalyst', 'Finale'}


def load_project_config(project_id):
    """Load project-config.json from database/projects/<project_id>/ if it exists."""
    script_dir   = os.path.dirname(os.path.abspath(__file__))
    config_path  = os.path.normpath(
        os.path.join(script_dir, '..', '..', 'database', 'projects', str(project_id), 'project-config.json')
    )
    if not os.path.isfile(config_path):
        return None
    try:
        with open(config_path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception as exc:
        print(f"[warn] Could not load project-config.json: {exc}", file=sys.stderr)
        return None


def add_marker(timeline, frame, color, name, note="", duration=1):
    try:
        ok = timeline.AddMarker(frame, color, name[:40], note[:200], duration)
        if not ok:
            print(f"[warn] AddMarker({frame}, {color!r}, {name!r}) returned False", file=sys.stderr)
    except Exception as exc:
        print(f"[warn] AddMarker failed at frame {frame}: {exc}", file=sys.stderr)


# ---------------------------------------------------------------------------
# Main logic
# ---------------------------------------------------------------------------

def run(args):
    errors   = []
    warnings = []

    fps = args.fps

    # ---- Parse inputs -------------------------------------------------------
    try:
        sections = json.loads(args.selects_json)
    except json.JSONDecodeError as exc:
        raise ValueError(f"Invalid --selects_json: {exc}") from exc

    try:
        footage_paths = json.loads(args.footage_paths_json)
        # Normalise keys to int
        footage_paths = {int(k): v for k, v in footage_paths.items()}
    except (json.JSONDecodeError, ValueError) as exc:
        raise ValueError(f"Invalid --footage_paths_json: {exc}") from exc

    # ---- Connect to Resolve -------------------------------------------------
    resolve         = get_resolve()
    project_manager = resolve.GetProjectManager()
    if project_manager is None:
        raise RuntimeError("Could not get ProjectManager from Resolve")

    project = find_project(project_manager, args.project_name, args.project_id)
    media_pool = project.GetMediaPool()
    if media_pool is None:
        raise RuntimeError("Could not get MediaPool from project")

    # ---- Build media pool path index ----------------------------------------
    print("[resolve] Checking media pool for already-imported clips…", file=sys.stderr)
    path_index = build_path_index(media_pool)

    # ---- Create or replace 02_SELECTS timeline -------------------------------
    TIMELINE_NAME = "02_SELECTS"

    # Delete existing selects timeline if present
    existing_timelines = []
    try:
        tl_count = project.GetTimelineCount()
        for i in range(1, tl_count + 1):
            tl = project.GetTimelineByIndex(i)
            if tl and tl.GetName() == TIMELINE_NAME:
                existing_timelines.append(tl)
    except Exception as exc:
        print(f"[warn] Could not enumerate timelines: {exc}", file=sys.stderr)

    # Try to delete existing 02_SELECTS timelines so we can recreate clean.
    # Resolve 20 exposes DeleteTimeline on the project object.
    for tl in existing_timelines:
        try:
            ok = project.DeleteTimeline(tl)
            if ok:
                print(f"[resolve] Deleted existing {TIMELINE_NAME} timeline", file=sys.stderr)
            else:
                print(f"[warn] DeleteTimeline returned False — will create alongside existing", file=sys.stderr)
        except Exception as exc:
            print(f"[warn] DeleteTimeline failed: {exc} — will create alongside existing", file=sys.stderr)

    media_pool.SetCurrentFolder(media_pool.GetRootFolder())

    # Always create with the canonical name — Resolve allows duplicate timeline names
    # and the user can clean up old ones manually if needed.
    timeline = media_pool.CreateEmptyTimeline(TIMELINE_NAME)
    if timeline is None:
        # Last resort: try a timestamped name
        import time as _time
        fallback = f"{TIMELINE_NAME}_{int(_time.time())}"
        print(f"[warn] CreateEmptyTimeline('{TIMELINE_NAME}') returned None — trying '{fallback}'", file=sys.stderr)
        timeline = media_pool.CreateEmptyTimeline(fallback)
        if timeline is None:
            raise RuntimeError(
                f"Could not create timeline '{TIMELINE_NAME}'. "
                "Make sure DaVinci Resolve is on the Edit page and the project is open."
            )
        warnings.append(f"Could not create '{TIMELINE_NAME}' — created '{fallback}' instead.")

    final_name = timeline.GetName() if callable(timeline.GetName) else TIMELINE_NAME
    print(f"[resolve] Created timeline: {final_name}", file=sys.stderr)

    # Match frame rate of existing project timelines where possible
    try:
        timeline.SetSetting("timelineFrameRate", str(fps))
    except Exception as exc:
        print(f"[warn] SetSetting(timelineFrameRate) failed: {exc}", file=sys.stderr)

    project.SetCurrentTimeline(timeline)

    # Add a second video track for b-roll suggestion markers
    try:
        timeline.AddTrack("video")
    except Exception:
        pass  # may already exist

    # ---- Build the timeline -------------------------------------------------
    # APPROACH: full clip(s) placed once each, markers only for beats/quality/gold.
    # No subclipping. Every frame of every clip makes it to the timeline.
    #
    # Phase 1 — place each unique clip ONCE (full duration, no in/out points)
    # Phase 2 — add beat, quality, and gold markers using take timecodes

    clips_placed  = 0
    clips_missing = 0

    # Sort sections by section_index (gold nuggets last so markers go on top)
    sections_sorted = sorted(sections, key=lambda s: (1 if s.get("gold_nugget") else 0, s.get("section_index", 0)))

    # Diagnostic
    print(f"[diag] footage_paths keys: {sorted(footage_paths.keys())}", file=sys.stderr)
    for fid, fp in footage_paths.items():
        exists = os.path.isfile(fp) if fp else False
        print(f"[diag] footage {fid}: path={fp!r} exists={exists}", file=sys.stderr)

    # ── Phase 1: place each unique clip once, full extent ─────────────────────
    # clip_timeline_offset[footage_id] = frame where that clip starts on the timeline
    clip_timeline_offset = {}
    current_frame = 0

    # Collect unique footage_ids from non-gold sections (in order of first appearance)
    seen_fids = []
    for section in sections_sorted:
        if section.get("gold_nugget"):
            continue
        fid = section.get("winner_footage_id")
        if fid is not None and fid not in seen_fids:
            seen_fids.append(fid)

    for fid in seen_fids:
        if fid not in footage_paths:
            print(f"[warn] footage_id {fid} not in footage_paths — skipped", file=sys.stderr)
            clips_missing += 1
            continue

        file_path = footage_paths[fid]
        item, _   = find_clip(path_index, file_path, media_pool)

        if not item:
            print(f"[warn] could not resolve clip for footage_id {fid}", file=sys.stderr)
            clips_missing += 1
            continue

        # Place full clip — no startFrame/endFrame means use the whole thing
        result = media_pool.AppendToTimeline([{
            "mediaPoolItem": item,
            "trackIndex":    1,
        }])

        if result:
            clip_timeline_offset[fid] = current_frame
            # Get actual clip duration in frames to advance current_frame
            try:
                dur_str = item.GetClipProperty("Duration") or ""
                if ":" in dur_str:
                    parts = [int(x) for x in dur_str.split(":")]
                    dur_frames = ((parts[0] * 3600 + parts[1] * 60 + parts[2]) * fps) + parts[3]
                else:
                    dur_frames = int(dur_str) if dur_str else 0
            except Exception:
                dur_frames = 0
            current_frame += dur_frames
            clips_placed  += 1
            print(f"[placed] full clip footage_id={fid} ({dur_frames} frames) at frame {clip_timeline_offset[fid]}", file=sys.stderr)
        else:
            print(f"[warn] AppendToTimeline failed for footage_id={fid}", file=sys.stderr)
            clips_missing += 1

    # ── Phase 2: markers from beat sections ───────────────────────────────────
    # For each non-gold section: beat header marker + per-take quality markers
    # For gold sections: red marker at the gold moment timecode

    beat_sections   = [s for s in sections_sorted if not s.get("gold_nugget")]
    gold_sections   = [s for s in sections_sorted if s.get("gold_nugget")]

    # ── Phase 2a: beat + quality markers ─────────────────────────────────────
    # For each beat section, add a blue beat-header marker at the first take's
    # timecode, then per-take quality markers (orange=fumbled, green=strong, cyan=clean).
    # All frame positions are: clip_timeline_offset[footage_id] + ts_to_frame(take.start)

    for section in beat_sections:
        label     = section.get("script_section") or f"Section {section.get('section_index', '?')}"
        fire_note = section.get("fire_suggestion") or ""
        takes     = section.get("takes") or []
        fid       = section.get("winner_footage_id")

        if fid not in clip_timeline_offset:
            warnings.append(f"Section '{label}': footage_id {fid} not placed — markers skipped")
            continue

        clip_offset = clip_timeline_offset[fid]

        # Blue beat-header at the first take's start
        if takes:
            beat_frame = clip_offset + ts_to_frame(takes[0].get("start", 0), fps)
            add_marker(
                timeline,
                max(0, beat_frame),
                MARKER_COLORS["section"],
                label,
                f"{len(takes)} take(s) | {fire_note[:120]}"
            )

        # Per-take quality markers
        for t_idx, take in enumerate(takes):
            t_start  = take.get("start", 0)
            t_end    = take.get("end", t_start)
            quality  = take.get("quality", "clean")
            note     = take.get("note", "") or ""
            t_frame  = clip_offset + ts_to_frame(t_start, fps)
            dur_f    = max(1, ts_to_frame(t_end - t_start, fps))
            t_label  = f"Take {t_idx + 1}/{len(takes)}"

            if quality in ("fumbled", "partial"):
                add_marker(timeline, max(0, t_frame), "Orange",
                    f"⚠ REVIEW {t_label} [{quality}]",
                    note[:200] if note else f"{quality} — review and cut if needed",
                    duration=dur_f)
            elif quality == "strong":
                add_marker(timeline, max(0, t_frame), "Green",
                    f"✓ STRONG {t_label}",
                    note[:200] if note else "Strong take — likely keeper",
                    duration=dur_f)
            else:
                add_marker(timeline, max(0, t_frame), "Cyan",
                    f"○ CLEAN {t_label}",
                    note[:200] if note else "Clean take",
                    duration=dur_f)

    # ── Phase 2b: gold moment markers ────────────────────────────────────────
    for section in gold_sections:
        takes = section.get("takes") or []
        fid   = section.get("winner_footage_id")
        note  = section.get("fire_suggestion") or "Off-script gold moment"

        if fid not in clip_timeline_offset:
            warnings.append(f"Gold moment: footage_id {fid} not placed — marker skipped")
            continue

        clip_offset = clip_timeline_offset[fid]

        for take in takes:
            t_start = take.get("start", 0)
            t_end   = take.get("end", t_start)
            dur_f   = max(1, ts_to_frame(t_end - t_start, fps))
            add_marker(
                timeline,
                max(0, clip_offset + ts_to_frame(t_start, fps)),
                MARKER_COLORS["gold"],
                "🔴 GOLD — OFF-SCRIPT",
                note[:200],
                duration=dur_f
            )

    # ---- Beat markers from PipΩr project-config.json ----------------------
    config = load_project_config(args.project_id)
    beats_placed = 0
    if config and config.get('beats') and current_frame > 0:
        total_frames = current_frame
        beats = config['beats']
        structure = config.get('story_structure', 'unknown')
        print(f"[pipr] Adding {len(beats)} beat markers ({structure})", file=sys.stderr)

        for beat in beats:
            pct          = beat.get('target_pct', 0)
            beat_name    = beat.get('name', f"Beat {beat.get('index','?')}")
            covered      = bool(beat.get('covered', False))
            out_of_seq   = bool(beat.get('out_of_sequence', False))
            is_critical  = beat_name in BEAT_CRITICAL

            beat_frame   = max(0, int(round((pct / 100.0) * total_frames)))

            # Color logic: Green=covered, Orange=out-of-sequence, Red=critical missing, Cyan=missing
            if covered and not out_of_seq:
                color = "Green"
                status = "✓"
            elif out_of_seq:
                color = "Orange"
                status = "↕ OOS"
            elif is_critical:
                color = "Red"
                status = "✗ MISSING"
            else:
                color = "Cyan"
                status = "○ missing"

            em_note = beat.get('emotional_function', '')
            rn_note = beat.get('reality_note', '')
            note    = f"[{status}] {em_note}"
            if rn_note:
                note += f" | Q: {rn_note}"

            add_marker(
                timeline,
                beat_frame,
                color,
                f"BEAT: {beat_name}",
                note[:200],
                duration=max(1, ts_to_frame(3, fps))
            )
            beats_placed += 1

        print(f"[pipr] {beats_placed} beat markers placed", file=sys.stderr)
    elif config and config.get('beats'):
        print("[pipr] Project config found but timeline is empty — skipping beat markers", file=sys.stderr)
    else:
        print("[pipr] No project-config.json found — skipping beat markers", file=sys.stderr)

    # ---- Summary marker at head --------------------------------------------
    beat_marker_count  = sum(len(s.get("takes") or []) for s in beat_sections)
    gold_marker_count  = len(gold_sections)
    summary_note = (
        f"02_SELECTS — {clips_placed} full clip(s) placed, {clips_missing} missing. "
        f"{beat_marker_count} take markers, {gold_marker_count} gold markers."
        + (f" | {beats_placed} PipΩr beat markers." if beats_placed else "")
    )
    add_marker(timeline, 0, "Purple", "SELECTS OVERVIEW", summary_note)

    # ---- Save ---------------------------------------------------------------
    project_manager.SaveProject()

    return {
        "ok":             True,
        "timeline_name":  final_name,
        "sections":       len(sections_sorted),
        "clips_placed":   clips_placed,
        "clips_missing":  clips_missing,
        "warnings":       warnings,
        "errors":         errors
    }


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def parse_args():
    parser = argparse.ArgumentParser(
        description="Build 02_SELECTS timeline in an existing DaVinci Resolve project"
    )
    parser.add_argument("--project_id",          type=int,   required=True)
    parser.add_argument("--project_name",         type=str,   required=True)
    parser.add_argument("--selects_json",         type=str,   required=True)
    parser.add_argument("--footage_paths_json",   type=str,   required=True)
    parser.add_argument("--fps",                  type=float, default=24.0)
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
