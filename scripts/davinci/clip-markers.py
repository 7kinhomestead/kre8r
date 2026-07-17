"""
clip-markers.py — Kre8Ωr ClipsΩr → DaVinci Resolve

Creates a DaVinci project with the FULL source video on one timeline.
Each approved clip is marked with a colored duration-span marker.
Creator blades at marker boundaries in Resolve — no Whisper-timestamp
cutting errors, full context preserved, precise in/out points are manual.

Color coding:
  Green  — gold clips (top ranked)
  Blue   — social clips
  Cyan   — retention cuts
  Red    — off-script gold moments
  Purple — overview marker at frame 0

Usage:
    python clip-markers.py \\
        --project_name "Rock Rich Community" \\
        --source_path "C:/path/to/source.mp4" \\
        --clips_json '[{"rank":1,"start":42.5,"end":89.3,"hook":"...","clip_type":"gold","reasoning":"..."}]' \\
        --fps 29.97
"""

import sys
import os
import json
import argparse
import datetime
import traceback
import math


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
# Helpers
# ---------------------------------------------------------------------------

def seconds_to_frames(seconds, fps):
    return int(math.floor(float(seconds) * fps))


CLIP_COLORS = {
    "gold":           "Green",
    "social":         "Blue",
    "retention":      "Cyan",
    "off_script_gold":"Red",
    "CTA":            "Yellow",
}

def clip_color(clip_type):
    return CLIP_COLORS.get(clip_type, "Blue")


def safe_name(text, max_len=35):
    safe = "".join(c if c.isalnum() or c in " _-" else "" for c in (text or "")).strip()
    return safe[:max_len]


def add_marker(timeline, frame, color, name, note="", duration=1):
    try:
        ok = timeline.AddMarker(int(frame), color, name[:40], note[:4000], int(max(1, duration)))
        if not ok:
            print(f"[warn] AddMarker({frame}, {color!r}, {name!r}) returned False", file=sys.stderr)
        return bool(ok)
    except Exception as exc:
        print(f"[warn] AddMarker failed at frame {frame}: {exc}", file=sys.stderr)
        return False


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def run(args):
    fps = float(args.fps or 29.97)

    # ── Parse clips ──────────────────────────────────────────────────────────
    try:
        clips = json.loads(args.clips_json)
    except json.JSONDecodeError as exc:
        raise ValueError(f"Invalid --clips_json: {exc}") from exc

    if not clips:
        raise ValueError("No clips provided in --clips_json")

    # Sort by start time so markers appear in order on the timeline
    clips = sorted(clips, key=lambda c: float(c.get("start", 0)))

    # ── Connect to Resolve ────────────────────────────────────────────────────
    resolve = get_resolve()
    try:
        version = resolve.GetVersionString() or "unknown"
        product = resolve.GetProductName() or "unknown"
    except Exception:
        version, product = "unknown", "unknown"
    print(f"[resolve] {product} {version}", file=sys.stderr)

    project_manager = resolve.GetProjectManager()
    if project_manager is None:
        raise RuntimeError("Could not get ProjectManager from Resolve")

    # ── Use current open project (no CreateProject — avoids v21 API issues) ──
    project = project_manager.GetCurrentProject()
    if project is None:
        raise RuntimeError(
            "No project is currently open in DaVinci Resolve. "
            "Open any project and try again."
        )
    proj_name = project.GetName() if callable(project.GetName) else "CurrentProject"
    print(f"[resolve] Using current project: {proj_name}", file=sys.stderr)

    media_pool   = project.GetMediaPool()
    root_folder  = media_pool.GetRootFolder()

    # ── Verify source file ────────────────────────────────────────────────────
    if not os.path.isfile(args.source_path):
        raise FileNotFoundError(f"Source video not found: {args.source_path}")

    # ── Import source video ───────────────────────────────────────────────────
    print(f"[resolve] Source path: {args.source_path}", file=sys.stderr)
    print(f"[resolve] File exists: {os.path.isfile(args.source_path)}", file=sys.stderr)
    print(f"[resolve] File size:   {os.path.getsize(args.source_path) if os.path.isfile(args.source_path) else 'N/A'}", file=sys.stderr)
    media_pool.SetCurrentFolder(root_folder)
    imported = media_pool.ImportMedia([args.source_path])
    if not imported:
        raise RuntimeError(f"ImportMedia failed for: {args.source_path}")
    source_item = imported[0]
    try:
        item_name = source_item.GetName()
        item_fps  = source_item.GetClipProperty("Clip FPS")
        item_dur  = source_item.GetClipProperty("Duration")
        print(f"[resolve] Media item: {item_name} | FPS: {item_fps} | Duration: {item_dur}", file=sys.stderr)
    except Exception as e:
        print(f"[resolve] Could not read media item properties: {e}", file=sys.stderr)
    print(f"[resolve] Imported source: {os.path.basename(args.source_path)}", file=sys.stderr)

    # ── Lock project frame rate BEFORE creating any timelines ───────────────
    # SetSetting('timelineFrameRate') on individual timelines silently fails
    # once the project has a master rate locked.  Must set it at the project
    # level first so every timeline inherits the correct rate.  If the rate
    # doesn't match the source, AppendToTimeline's startFrame/endFrame get
    # conform-mapped and high frame numbers overshoot the source end —
    # producing a freeze frame for the full clip duration.
    fps_str = f"{float(fps):.3f}".rstrip("0").rstrip(".")
    ok1 = project.SetSetting("timelineFrameRate",         fps_str)
    ok2 = project.SetSetting("timelinePlaybackFrameRate", fps_str)
    actual_fps = project.GetSetting("timelineFrameRate")
    print(f"[resolve] SetProjectFps({fps_str}) → tl={ok1} pb={ok2} actual={actual_fps}", file=sys.stderr)
    try:
        if abs(float(actual_fps) - float(fps)) > 0.01:
            print(f"[warn] Project fps is {actual_fps}, expected {fps}. "
                  "startFrame/endFrame conform may be wrong. "
                  "Open Project Settings and set Master frame rate to match source.",
                  file=sys.stderr)
    except (TypeError, ValueError):
        pass

    # ── Create timeline (unique name so re-runs don't collide) ───────────────
    import time as _time
    safe_vid  = safe_name(args.project_name, 20).replace(" ", "_")
    _run_ts   = int(_time.time()) % 100000   # shared suffix — same for all timelines this run
    TIMELINE_NAME = f"CLIPSR_{safe_vid}_{_run_ts}"
    media_pool.SetCurrentFolder(root_folder)
    timeline = media_pool.CreateEmptyTimeline(TIMELINE_NAME)
    if timeline is None:
        raise RuntimeError(
            f"Could not create timeline '{TIMELINE_NAME}'. "
            "Make sure Resolve is on the Edit page."
        )
    print(f"[resolve] Created timeline: {TIMELINE_NAME}", file=sys.stderr)
    project.SetCurrentTimeline(timeline)

    # ── Extract each clip into its own timeline ───────────────────────────────
    # Uses AppendToTimeline with startFrame/endFrame — DaVinci places only the
    # clip segment on the timeline, making the actual cut for you.
    # No markers, no manual blading needed.
    # Max frame from known video duration — more reliable than querying Resolve API
    max_source_frame = seconds_to_frames(args.duration, fps) - 1 if args.duration > 0 else 0
    if max_source_frame > 0:
        print(f"[resolve] Max source frame: {max_source_frame} ({args.duration:.1f}s @ {fps}fps)", file=sys.stderr)

    clips_added = 0
    errors      = []
    clip_timelines = []

    for clip in clips:
        rank       = clip.get("rank", 0)
        start_s    = float(clip.get("start", 0))
        end_s      = float(clip.get("end", 0))
        hook       = clip.get("hook", "") or ""
        clip_type  = clip.get("clip_type", "social")
        duration_s = end_s - start_s

        if end_s <= start_s:
            errors.append(f"Clip {rank}: invalid timecodes ({start_s}→{end_s}), skipped")
            continue

        # Sanity check: clip must start within the first 24 hours of video
        # If start_s > 86400 something is very wrong with the timestamps
        if start_s > 86400:
            errors.append(f"Clip {rank}: start time {start_s}s looks wrong (>24h), skipped")
            print(f"[warn] Clip {rank} start={start_s}s is impossibly large — bad timestamps in DB", file=sys.stderr)
            continue

        start_frame = seconds_to_frames(start_s, fps)
        end_frame   = seconds_to_frames(end_s,   fps)

        # Clamp to known video length so we never request frames past the source end
        if max_source_frame > 0:
            start_frame = min(start_frame, max_source_frame)
            end_frame   = min(end_frame,   max_source_frame)
            if end_frame <= start_frame:
                errors.append(f"Clip {rank}: after clamping start={start_frame} >= end={end_frame}, skipped")
                continue

        type_label  = {"gold": "GOLD", "social": "CLIP", "retention": "RET",
                       "off_script_gold": "GOLD-OS", "CTA": "CTA"}.get(clip_type, "CLIP")
        hook_slug   = safe_name(" ".join(hook.split()[:5]), 25).replace(" ", "_")
        tl_name     = f"CLIP_{rank:02d}_{type_label}_{hook_slug}_{_run_ts}"

        # Create a dedicated timeline for this clip
        clip_tl = media_pool.CreateEmptyTimeline(tl_name)
        if clip_tl is None:
            errors.append(f"Clip {rank}: could not create timeline '{tl_name}'")
            print(f"[warn] Could not create timeline: {tl_name}", file=sys.stderr)
            continue

        # MUST set this timeline as current before AppendToTimeline
        # AppendToTimeline always targets the active timeline in the project
        project.SetCurrentTimeline(clip_tl)

        # Verify timeline inherited project fps
        tl_fps = clip_tl.GetSetting("timelineFrameRate")
        if tl_fps:
            try:
                if abs(float(tl_fps) - float(fps)) > 0.01:
                    print(f"[warn] Timeline '{tl_name}' fps={tl_fps}, expected {fps}", file=sys.stderr)
            except (TypeError, ValueError):
                pass

        # Append ONLY the clip segment — DaVinci makes the cut for you
        print(f"[clip] Appending rank {rank}: startFrame={start_frame} endFrame={end_frame} ({start_s:.1f}s–{end_s:.1f}s @ {fps}fps)", file=sys.stderr)
        result = media_pool.AppendToTimeline([{
            "mediaPoolItem": source_item,
            "startFrame":    start_frame,
            "endFrame":      end_frame,
        }])

        if not result:
            errors.append(f"Clip {rank}: AppendToTimeline failed for '{tl_name}'")
            print(f"[warn] AppendToTimeline failed for clip {rank}", file=sys.stderr)
            continue

        clips_added += 1
        clip_timelines.append(tl_name)
        print(f"[clip] #{rank:02d} {type_label} @ {start_s:.1f}s–{end_s:.1f}s → timeline '{tl_name}' ✓", file=sys.stderr)

    # Switch back to the overview timeline so Resolve lands there
    project.SetCurrentTimeline(timeline)

    # ── Save ──────────────────────────────────────────────────────────────────
    project_manager.SaveProject()
    print(f"[resolve] Project saved: {proj_name}", file=sys.stderr)
    print(f"[resolve] {clips_added} clip timelines created: {clip_timelines}", file=sys.stderr)

    return {
        "ok":             True,
        "project_name":   proj_name,
        "overview_timeline": TIMELINE_NAME,
        "clips_added":    clips_added,
        "clip_timelines": clip_timelines,
        "source":         os.path.basename(args.source_path),
        "errors":         errors,
        "instructions": (
            f"{clips_added} individual clip timelines created in DaVinci Resolve. "
            "Each CLIP_XX timeline contains only that clip's footage — already cut for you. "
            "Open each timeline, grade, and export."
        ),
    }


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def parse_args():
    p = argparse.ArgumentParser(description="Create ClipsΩr marker timeline in DaVinci Resolve")
    p.add_argument("--project_name", type=str, required=True)
    p.add_argument("--source_path",  type=str, required=True)
    p.add_argument("--clips_json",   type=str, required=True)
    p.add_argument("--fps",          type=float, default=29.97)
    p.add_argument("--duration",     type=float, default=0,
                   help="Source video duration in seconds (used to clamp clip end frames)")
    return p.parse_args()


if __name__ == "__main__":
    try:
        args   = parse_args()
        result = run(args)
        print(json.dumps(result))
    except Exception as exc:
        traceback.print_exc(file=sys.stderr)
        print(json.dumps({"ok": False, "error": str(exc)}))
        sys.exit(1)
