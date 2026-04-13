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
    Build a dict: file_path (normalised, lowercase) → MediaPoolItem
    Walks the entire media pool tree.
    """
    index = {}
    root = media_pool.GetRootFolder()
    for _folder, clips in _walk_folder(root):
        for clip in clips:
            try:
                fp = clip.GetClipProperty("File Path") or ""
                if fp:
                    index[fp.lower().replace("\\", "/")] = clip
            except Exception:
                pass
    return index


def find_clip(path_index, file_path, media_pool, fps):
    """
    Look up a MediaPoolItem by file path.
    If not in the index, import the file from disk.
    Returns (MediaPoolItem, imported_flag) or (None, False).
    """
    if not file_path:
        return None, False

    norm = file_path.lower().replace("\\", "/")
    if norm in path_index:
        return path_index[norm], False

    # Not indexed — try to import
    if not os.path.isfile(file_path):
        print(f"[warn] File not found on disk: {file_path}", file=sys.stderr)
        return None, False

    items = media_pool.ImportMedia([file_path])
    if items:
        item = items[0]
        path_index[norm] = item
        print(f"[import] Imported: {os.path.basename(file_path)}", file=sys.stderr)
        return item, True

    print(f"[warn] ImportMedia failed for: {file_path}", file=sys.stderr)
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
    print("[resolve] Building media pool index…", file=sys.stderr)
    path_index = build_path_index(media_pool)
    print(f"[resolve] Indexed {len(path_index)} clips in media pool", file=sys.stderr)

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

    # Resolve API doesn't expose DeleteTimeline reliably — create with fresh name
    # if collision, append _v2, _v3, etc.
    final_name = TIMELINE_NAME
    if existing_timelines:
        count = len(existing_timelines)
        final_name = f"{TIMELINE_NAME}_v{count + 1}"
        warnings.append(
            f"02_SELECTS timeline already exists — creating '{final_name}'. "
            "Delete old ones manually to keep the project tidy."
        )

    media_pool.SetCurrentFolder(media_pool.GetRootFolder())
    timeline = media_pool.CreateEmptyTimeline(final_name)
    if timeline is None:
        raise RuntimeError(f"Could not create timeline '{final_name}'")

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
    current_frame = 0   # running head position in the timeline
    clips_placed  = 0
    clips_missing = 0

    # Sort sections by section_index
    sections_sorted = sorted(sections, key=lambda s: s.get("section_index", 0))

    for section in sections_sorted:
        label       = section.get("script_section") or f"Section {section.get('section_index', '?')}"
        is_gold     = bool(section.get("gold_nugget"))
        fire_note   = section.get("fire_suggestion") or ""
        winner_id   = section.get("winner_footage_id")

        # Gold nugget: add a gap before the section
        if is_gold:
            current_frame += GAP_GOLD_FRAMES

        # ── Place the winner clip ────────────────────────────────────────────
        winner_item = None
        start_ts = None
        end_ts   = None

        if winner_id and winner_id in footage_paths:
            file_path = footage_paths[winner_id]
            winner_item, _ = find_clip(path_index, file_path, media_pool, fps)

            # Find timestamps for the winner take.
            # Use selected_takes[0] as source of truth (has exact start/end for the chosen take).
            # Falls back to footage_id match for backward compatibility.
            selected_takes = section.get("selected_takes") or []
            winner_take    = selected_takes[0] if selected_takes else None
            if winner_take:
                start_ts = winner_take.get("start")
                end_ts   = winner_take.get("end")
            else:
                for take in (section.get("takes") or []):
                    if take.get("footage_id") == winner_id:
                        start_ts = take.get("start")
                        end_ts   = take.get("end")
                        break

        section_start_frame = current_frame

        if winner_item:
            sf, ef, dur_frames = clip_duration_frames(winner_item, start_ts, end_ts, fps)

            clip_dict = {
                "mediaPoolItem": winner_item,
                "startFrame":    sf,
                "endFrame":      ef,
                # mediaType intentionally omitted — specifying 1 adds video-only
                # and silences the audio track. Omitting includes all tracks (V+A).
                "trackIndex":    1
            }

            result = media_pool.AppendToTimeline([clip_dict])
            if result:
                clips_placed += 1
                current_frame += dur_frames
            else:
                errors.append(f"AppendToTimeline failed for section '{label}' (footage_id={winner_id})")
                current_frame += ts_to_frame(5, fps)  # placeholder gap
                clips_missing += 1
        else:
            # No winner — leave a placeholder gap
            gap_frames = ts_to_frame(5, fps)
            current_frame += gap_frames
            clips_missing += 1
            warnings.append(f"Section '{label}': no winner clip — placeholder gap inserted")

        # ── Add markers ─────────────────────────────────────────────────────

        # Blue: section header
        add_marker(
            timeline,
            max(0, section_start_frame),
            MARKER_COLORS["section"],
            label,
            f"Section {section.get('section_index', '?')}: {label}"
        )

        # Green: winner marker
        if winner_item:
            add_marker(
                timeline,
                max(0, section_start_frame),
                MARKER_COLORS["winner"],
                f"✓ {label}",
                f"Winner: footage_id={winner_id}" +
                (f" | {start_ts:.1f}s – {end_ts:.1f}s" if start_ts is not None and end_ts is not None else ""),
                duration=ts_to_frame(end_ts - start_ts, fps) if (start_ts is not None and end_ts is not None) else 1
            )

        # Red: gold nugget
        if is_gold:
            add_marker(
                timeline,
                max(0, section_start_frame - GAP_GOLD_FRAMES),
                MARKER_COLORS["gold"],
                f"GOLD: {label}",
                "Off-script moment with high authenticity — prioritise in final cut"
            )

        # Orange: fire suggestion
        if fire_note:
            is_broll_suggestion = any(kw in fire_note.lower() for kw in ("b-roll", "broll", "b roll", "cutaway"))
            color = MARKER_COLORS["broll"] if is_broll_suggestion else MARKER_COLORS["fire"]
            add_marker(
                timeline,
                max(0, section_start_frame),
                color,
                "FIRE" if not is_broll_suggestion else "B-ROLL",
                fire_note
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
    summary_note = (
        f"02_SELECTS — {clips_placed} clips placed, {clips_missing} missing. "
        f"Built by SelectsΩr from {len(sections_sorted)} script sections."
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
