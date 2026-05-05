"""
resolve-timeline-transcript.py — Kre8Ωr DaVinci Resolve integration

Reads the assembled edit timeline transcript directly from DaVinci Resolve.
Uses CreateSubtitlesFromAudio() to transcribe, then reads the subtitle track.

Modes:
  --list_timelines     Output JSON list of all timelines in the project (for UI dropdown)
  --read_only          Read existing subtitle track only — never call CreateSubtitlesFromAudio
  --force_retranscribe Always call CreateSubtitlesFromAudio even if subtitle track exists

Called from Node.js via child_process.spawn.
Outputs a single JSON object to stdout. Tracebacks go to stderr only.

Usage:
    python resolve-timeline-transcript.py \\
        --project_id 42 \\
        --project_name "2026-05-04_My-Video_042" \\
        [--timeline_name "02_SELECTS"] \\
        [--read_only] \\
        [--force_retranscribe] \\
        [--list_timelines]
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
# Project finder
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
                print(f"[resolve] Opened project by suffix match: {name}", file=sys.stderr)
                return p

    current = project_manager.GetCurrentProject()
    if current:
        current_name = current.GetName() if callable(current.GetName) else str(current)
        print(
            f"[resolve] No project matched '{project_name}' or suffix '{suffix}'. "
            f"Using currently open project: '{current_name}'",
            file=sys.stderr
        )
        return current

    raise RuntimeError(
        f"Could not find Resolve project for '{project_name}' (project_id={project_id}). "
        "Open the project in DaVinci Resolve and try again."
    )


# ---------------------------------------------------------------------------
# Timeline listing — used by UI dropdown
# ---------------------------------------------------------------------------

def list_timelines(project):
    """Return list of {name, index} for all timelines in the project."""
    count = project.GetTimelineCount()
    timelines = []
    for i in range(1, count + 1):
        tl = project.GetTimelineByIndex(i)
        if not tl:
            continue
        name = tl.GetName() if callable(tl.GetName) else f"Timeline {i}"
        timelines.append({"name": name, "index": i})
    return timelines


# ---------------------------------------------------------------------------
# Timeline finder
# ---------------------------------------------------------------------------

def find_timeline(project, timeline_name):
    count = project.GetTimelineCount()
    print(f"[resolve] Project has {count} timeline(s)", file=sys.stderr)

    for i in range(1, count + 1):
        tl = project.GetTimelineByIndex(i)
        if not tl:
            continue
        name = tl.GetName() if callable(tl.GetName) else str(tl)
        print(f"[resolve] Found timeline [{i}]: {name}", file=sys.stderr)
        if name == timeline_name:
            print(f"[resolve] Matched target timeline: {name}", file=sys.stderr)
            return tl

    current = project.GetCurrentTimeline()
    if current:
        current_name = current.GetName() if callable(current.GetName) else str(current)
        print(
            f"[resolve] Timeline '{timeline_name}' not found — "
            f"using current timeline: '{current_name}'",
            file=sys.stderr
        )
        return current

    raise RuntimeError(
        f"Timeline '{timeline_name}' not found and no timeline is currently active. "
        "Select a timeline in DaVinci Resolve and try again."
    )


# ---------------------------------------------------------------------------
# Subtitle helpers
# ---------------------------------------------------------------------------

def get_subtitle_count(timeline):
    try:
        return timeline.GetTrackCount("subtitle") or 0
    except Exception:
        return 0


def count_items_on_track(timeline, track_index):
    """Return number of items on a subtitle track, handling dict or list return."""
    try:
        items = timeline.GetItemsInTrack("subtitle", track_index)
        if not items:
            return 0
        if isinstance(items, dict):
            return len(items)
        return len(items)
    except Exception:
        return 0


def find_best_subtitle_track(timeline):
    """
    Scan ALL subtitle tracks (1..N) and return the index of the one
    with the most items. Returns None if no tracks have any content.
    """
    sub_count = get_subtitle_count(timeline)
    if sub_count == 0:
        return None

    print(f"[resolve] Scanning {sub_count} subtitle track(s) for content…", file=sys.stderr)
    best_index = None
    best_count = 0

    for i in range(1, sub_count + 1):
        n = count_items_on_track(timeline, i)
        print(f"[resolve]   Track {i}: {n} item(s)", file=sys.stderr)
        if n > best_count:
            best_count = n
            best_index = i

    if best_index is not None:
        print(f"[resolve] Best subtitle track: {best_index} ({best_count} items)", file=sys.stderr)
    return best_index


def read_subtitle_items(timeline, track_index, fps=24.0):
    """
    Read all subtitle track items. Returns list of {start, end, text}.
    """
    segments = []
    try:
        items = timeline.GetItemsInTrack("subtitle", track_index)
        if not items:
            print(f"[resolve] GetItemsInTrack returned empty for track {track_index}", file=sys.stderr)
            return segments

        item_list = list(items.values()) if isinstance(items, dict) else list(items)
        print(f"[resolve] Reading {len(item_list)} items from subtitle track {track_index}", file=sys.stderr)

        for item in item_list:
            try:
                start_frame    = item.GetStart()    if callable(item.GetStart)    else 0
                duration_frame = item.GetDuration() if callable(item.GetDuration) else 0
                text           = item.GetName()     if callable(item.GetName)     else ""

                # Some Resolve versions use a different property for subtitle text
                if not text:
                    try:
                        text = item.GetClipProperty("Subtitle Text") or ""
                    except Exception:
                        pass

                start_sec = float(start_frame) / fps
                end_sec   = start_sec + float(duration_frame) / fps

                if text.strip():
                    segments.append({
                        "start": round(start_sec, 3),
                        "end":   round(end_sec,   3),
                        "text":  text.strip()
                    })
            except Exception as e:
                print(f"[resolve] Warning: skipping item: {e}", file=sys.stderr)
                continue

    except Exception as e:
        print(f"[resolve] Error reading subtitle track {track_index}: {e}", file=sys.stderr)

    return segments


# ---------------------------------------------------------------------------
# Create subtitles + poll for completion
# ---------------------------------------------------------------------------

MAX_WAIT_SECONDS = 300
POLL_INTERVAL    = 3.0

def create_and_wait_subtitles(timeline, fps):
    """
    Call CreateSubtitlesFromAudio() then poll until items appear.
    Returns the track index that has content.
    Raises RuntimeError on timeout.
    """
    initial_sub_count = get_subtitle_count(timeline)
    print(f"[resolve] Subtitle tracks before trigger: {initial_sub_count}", file=sys.stderr)

    print(f"[resolve] Calling CreateSubtitlesFromAudio()…", file=sys.stderr)
    try:
        result = timeline.CreateSubtitlesFromAudio({"audioTrackIndex": 1})
        print(f"[resolve] CreateSubtitlesFromAudio() returned: {result}", file=sys.stderr)
    except Exception as e:
        print(f"[resolve] CreateSubtitlesFromAudio() raised: {e}", file=sys.stderr)

    deadline = time.time() + MAX_WAIT_SECONDS
    last_log  = 0

    while time.time() < deadline:
        time.sleep(POLL_INTERVAL)
        elapsed = int(time.time() - (deadline - MAX_WAIT_SECONDS))

        # Scan all tracks for content (new track may have appeared)
        best = find_best_subtitle_track(timeline)
        if best is not None:
            print(f"[resolve] Subtitle track {best} has content after {elapsed}s", file=sys.stderr)
            return best

        if elapsed - last_log >= 15:
            print(f"[resolve] Waiting for Resolve transcription… ({elapsed}s)", file=sys.stderr)
            last_log = elapsed

    raise RuntimeError(
        f"Timed out ({MAX_WAIT_SECONDS}s) waiting for Resolve to finish transcribing. "
        "Try creating subtitles manually in Resolve: Timeline → Transcribe Audio, "
        "then click '📄 Read Timeline Transcript' again — it will read the existing track."
    )


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--project_id",         type=int, required=True)
    parser.add_argument("--project_name",        type=str, required=True)
    parser.add_argument("--timeline_name",       type=str, default="02_SELECTS")
    parser.add_argument("--list_timelines",      action="store_true",
                        help="List all timelines in the project and exit")
    parser.add_argument("--read_only",           action="store_true",
                        help="Only read existing subtitle track — never call CreateSubtitlesFromAudio")
    parser.add_argument("--force_retranscribe",  action="store_true",
                        help="Always call CreateSubtitlesFromAudio even if subtitle track exists")
    args = parser.parse_args()

    try:
        resolve = get_resolve()
        project_manager = resolve.GetProjectManager()
        project = find_project(project_manager, args.project_name, args.project_id)

        # ── List timelines mode ───────────────────────────────────────────────
        if args.list_timelines:
            timelines = list_timelines(project)
            print(json.dumps({"ok": True, "timelines": timelines}))
            return

        # ── Find target timeline ──────────────────────────────────────────────
        timeline = find_timeline(project, args.timeline_name)
        project.SetCurrentTimeline(timeline)

        # ── Detect fps ────────────────────────────────────────────────────────
        try:
            fps = float(timeline.GetSetting("timelineFrameRate"))
        except Exception:
            fps = 24.0
        print(f"[resolve] Timeline fps: {fps}", file=sys.stderr)

        # ── Find subtitle track ───────────────────────────────────────────────
        track_index = None

        if not args.force_retranscribe:
            # Scan all existing tracks for content
            track_index = find_best_subtitle_track(timeline)
            if track_index is not None:
                print(f"[resolve] Using existing subtitle track {track_index}", file=sys.stderr)

        if track_index is None:
            if args.read_only:
                raise RuntimeError(
                    f"No subtitle track found on '{args.timeline_name}'. "
                    "In Resolve: select the timeline → Timeline menu → Transcribe Audio. "
                    "Then click Read Timeline Transcript again."
                )
            # Trigger transcription
            print(json.dumps({"stage": "transcribing",
                              "message": f"Transcribing '{args.timeline_name}' in Resolve… (1–3 min)"}),
                  flush=True)
            track_index = create_and_wait_subtitles(timeline, fps)

        # ── Read items ────────────────────────────────────────────────────────
        segments = read_subtitle_items(timeline, track_index, fps)

        if not segments:
            raise RuntimeError(
                f"Subtitle track {track_index} on '{args.timeline_name}' exists but has no text. "
                "Resolve may still be processing — wait a moment and try again. "
                "Or open Resolve and verify the subtitle track has content in the timeline."
            )

        full_text = " ".join(s["text"] for s in segments).strip()
        print(f"[resolve] Done: {len(segments)} segments, {len(full_text)} chars", file=sys.stderr)

        print(json.dumps({
            "ok":            True,
            "project_id":    args.project_id,
            "timeline_name": args.timeline_name,
            "fps":           fps,
            "text":          full_text,
            "segments":      segments,
            "_source":       "resolve_timeline",
            "_track_index":  track_index,
        }, ensure_ascii=False))

    except Exception as exc:
        print(traceback.format_exc(), file=sys.stderr)
        print(json.dumps({"ok": False, "error": str(exc)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
