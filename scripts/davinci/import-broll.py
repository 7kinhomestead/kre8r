"""
import-broll.py — Kre8Ωr DaVinci Resolve integration
Imports approved b-roll clips onto Video Track 2 of the 02_SELECTS timeline,
placed opposite the matching talking-head section via Orange markers.

Called from Node.js via child_process.spawn.
Outputs a single JSON object to stdout. Tracebacks go to stderr only.

Usage:
    python import-broll.py \\
        --project_id 42 \\
        --project_name "2026-03-29_My-Video_042" \\
        --assignments_json '[{"section_id":1,"section_index":0,"script_section":"Intro","footage_id":9,"file_path":"C:/proxies/broll1.mp4"}]' \\
        [--fps 24]
"""

import sys
import os
import json
import argparse
import traceback


# ---------------------------------------------------------------------------
# DaVinci Resolve scripting API bootstrap (shared pattern)
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
# Project + timeline finder
# ---------------------------------------------------------------------------

def find_project(project_manager, project_name, project_id):
    p = project_manager.LoadProject(project_name)
    if p:
        print(f"[resolve] Opened project: {project_name}", file=sys.stderr)
        return p

    suffix = f"_{project_id:03d}"
    projects = project_manager.GetProjectListInCurrentFolder() or []
    for name in projects:
        if name.endswith(suffix):
            p = project_manager.LoadProject(name)
            if p:
                print(f"[resolve] Opened project by suffix: {name}", file=sys.stderr)
                return p

    raise RuntimeError(
        f"Could not find Resolve project for project_id={project_id}. "
        f"Available: {projects}"
    )


def find_selects_timeline(project):
    """Find 02_SELECTS (or 02_SELECTS_v2 etc.) — return the most recent."""
    tl_count = project.GetTimelineCount()
    matches = []
    for i in range(1, tl_count + 1):
        tl = project.GetTimelineByIndex(i)
        if tl:
            name = tl.GetName() or ""
            if name.startswith("02_SELECTS"):
                matches.append((i, tl, name))

    if not matches:
        raise RuntimeError(
            "02_SELECTS timeline not found in this project. "
            "Run 'Build Selects' from EditΩr first."
        )

    # Return the highest-indexed match (most recently created)
    matches.sort(key=lambda x: x[0], reverse=True)
    _, tl, name = matches[0]
    print(f"[resolve] Using timeline: {name}", file=sys.stderr)
    return tl


# ---------------------------------------------------------------------------
# Media pool helpers
# ---------------------------------------------------------------------------

def _walk_folder(folder):
    yield folder, folder.GetClipList() or []
    for sub in (folder.GetSubFolderList() or []):
        yield from _walk_folder(sub)


def build_path_index(media_pool):
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


def find_or_import(path_index, file_path, media_pool):
    if not file_path:
        return None
    norm = file_path.lower().replace("\\", "/")
    if norm in path_index:
        return path_index[norm]
    if not os.path.isfile(file_path):
        print(f"[warn] File not found: {file_path}", file=sys.stderr)
        return None
    items = media_pool.ImportMedia([file_path])
    if items:
        item = items[0]
        path_index[norm] = item
        print(f"[import] Imported b-roll: {os.path.basename(file_path)}", file=sys.stderr)
        return item
    print(f"[warn] ImportMedia failed: {file_path}", file=sys.stderr)
    return None


# ---------------------------------------------------------------------------
# Timeline position helpers
# ---------------------------------------------------------------------------

def find_section_frame(timeline, section_index, fps):
    """
    Find the start frame of a section on timeline track 1 by reading Blue markers.
    Falls back to rough estimation if markers can't be read.
    """
    try:
        markers = timeline.GetMarkers() or {}
        # Markers keyed by frame number, value is dict with Color/Name/Note
        blue_markers = sorted(
            [frame for frame, m in markers.items() if m.get("color") == "Blue"],
        )
        if section_index < len(blue_markers):
            return blue_markers[section_index]
    except Exception as exc:
        print(f"[warn] GetMarkers failed: {exc}", file=sys.stderr)

    # Rough fallback: 5-second sections
    return int(section_index * 5 * fps)


def clip_duration_frames(item, fps):
    """Return full clip duration in frames."""
    try:
        dur_str = item.GetClipProperty("Duration") or ""
        if ":" in dur_str:
            parts = dur_str.split(":")
            h, m, s, f = (int(x) for x in parts)
            return ((h * 3600 + m * 60 + s) * fps) + f
        elif dur_str:
            return int(dur_str)
    except Exception:
        pass
    return int(10 * fps)  # fallback: 10 seconds


# ---------------------------------------------------------------------------
# Main logic
# ---------------------------------------------------------------------------

def run(args):
    errors   = []
    warnings = []
    fps      = int(args.fps)

    try:
        assignments = json.loads(args.assignments_json)
    except json.JSONDecodeError as exc:
        raise ValueError(f"Invalid --assignments_json: {exc}") from exc

    # ---- Connect to Resolve -------------------------------------------------
    resolve         = get_resolve()
    project_manager = resolve.GetProjectManager()
    if project_manager is None:
        raise RuntimeError("Could not get ProjectManager from Resolve")

    project    = find_project(project_manager, args.project_name, args.project_id)
    timeline   = find_selects_timeline(project)
    media_pool = project.GetMediaPool()
    if media_pool is None:
        raise RuntimeError("Could not get MediaPool from project")

    project.SetCurrentTimeline(timeline)

    # Ensure track 2 exists
    try:
        track_count = timeline.GetTrackCount("video") or 1
        while track_count < 2:
            timeline.AddTrack("video")
            track_count += 1
    except Exception as exc:
        print(f"[warn] Track setup: {exc}", file=sys.stderr)

    # ---- Build media pool index ---------------------------------------------
    path_index = build_path_index(media_pool)
    print(f"[resolve] Indexed {len(path_index)} clips", file=sys.stderr)

    # ---- Sort assignments by section_index ----------------------------------
    assignments_sorted = sorted(assignments, key=lambda a: a.get("section_index", 0))

    clips_placed  = 0
    clips_missing = 0

    for assignment in assignments_sorted:
        section_index  = assignment.get("section_index", 0)
        script_section = assignment.get("script_section", f"Section {section_index}")
        footage_id     = assignment.get("footage_id")
        file_path      = assignment.get("file_path")

        item = find_or_import(path_index, file_path, media_pool)
        if not item:
            errors.append(f"Could not load b-roll for section '{script_section}' (footage_id={footage_id})")
            clips_missing += 1
            continue

        # Find the frame position of this section on the timeline
        section_frame = find_section_frame(timeline, section_index, fps)
        dur_frames    = clip_duration_frames(item, fps)

        clip_dict = {
            "mediaPoolItem": item,
            "startFrame":    0,
            "endFrame":      dur_frames,
            "mediaType":     1,
            "trackIndex":    2,
            "recordFrame":   section_frame
        }

        result = media_pool.AppendToTimeline([clip_dict])
        if result:
            clips_placed += 1
            print(f"[broll] Placed '{script_section}' b-roll at frame {section_frame}", file=sys.stderr)

            # Add Orange marker at the placement point
            try:
                timeline.AddMarker(
                    section_frame,
                    "Orange",
                    f"B-ROLL: {script_section}"[:40],
                    f"footage_id={footage_id} | {os.path.basename(file_path or '')}",
                    dur_frames
                )
            except Exception as exc:
                print(f"[warn] Marker failed: {exc}", file=sys.stderr)
        else:
            errors.append(f"AppendToTimeline failed for b-roll section '{script_section}'")
            clips_missing += 1

    # ---- Save ---------------------------------------------------------------
    project_manager.SaveProject()

    return {
        "ok":           True,
        "clips_placed": clips_placed,
        "clips_missing": clips_missing,
        "warnings":     warnings,
        "errors":       errors
    }


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def parse_args():
    parser = argparse.ArgumentParser(
        description="Import b-roll onto Track 2 of 02_SELECTS timeline"
    )
    parser.add_argument("--project_id",       type=int,   required=True)
    parser.add_argument("--project_name",     type=str,   required=True)
    parser.add_argument("--assignments_json", type=str,   required=True)
    parser.add_argument("--fps",              type=float, default=24.0)
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
