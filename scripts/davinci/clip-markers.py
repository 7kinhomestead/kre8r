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
    except Exception as exc:
        print(f"[warn] AddMarker failed at frame {frame}: {exc}", file=sys.stderr)


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

    # ── Create project ────────────────────────────────────────────────────────
    date_str  = datetime.date.today().strftime("%Y-%m-%d")
    safe_proj = safe_name(args.project_name, 40).replace(" ", "-")
    proj_name = f"{date_str}_ClipMarkers_{safe_proj}"

    project = project_manager.CreateProject(proj_name)
    if project is None:
        # Try with timestamp suffix to avoid name collision
        import time as _time
        proj_name = f"{proj_name}_{int(_time.time()) % 10000}"
        project = project_manager.CreateProject(proj_name)
        if project is None:
            raise RuntimeError(
                f"Could not create Resolve project '{proj_name}'. "
                "A project with that name may already exist."
            )
    print(f"[resolve] Created project: {proj_name}", file=sys.stderr)

    media_pool   = project.GetMediaPool()
    root_folder  = media_pool.GetRootFolder()

    # ── Verify source file ────────────────────────────────────────────────────
    if not os.path.isfile(args.source_path):
        raise FileNotFoundError(f"Source video not found: {args.source_path}")

    # ── Import source video ───────────────────────────────────────────────────
    media_pool.SetCurrentFolder(root_folder)
    imported = media_pool.ImportMedia([args.source_path])
    if not imported:
        raise RuntimeError(f"ImportMedia failed for: {args.source_path}")
    source_item = imported[0]
    print(f"[resolve] Imported source: {os.path.basename(args.source_path)}", file=sys.stderr)

    # ── Create timeline ───────────────────────────────────────────────────────
    TIMELINE_NAME = "CLIP_MARKERS"
    media_pool.SetCurrentFolder(root_folder)
    timeline = media_pool.CreateEmptyTimeline(TIMELINE_NAME)
    if timeline is None:
        raise RuntimeError(
            f"Could not create timeline '{TIMELINE_NAME}'. "
            "Make sure Resolve is on the Edit page."
        )
    print(f"[resolve] Created timeline: {TIMELINE_NAME}", file=sys.stderr)

    # Match frame rate
    try:
        timeline.SetSetting("timelineFrameRate", str(fps))
    except Exception as exc:
        print(f"[warn] SetSetting(timelineFrameRate): {exc}", file=sys.stderr)

    project.SetCurrentTimeline(timeline)

    # ── Place full source clip on timeline ────────────────────────────────────
    append_result = media_pool.AppendToTimeline([{
        "mediaPoolItem": source_item,
        "trackIndex":    1,
    }])
    if not append_result:
        raise RuntimeError("AppendToTimeline failed — could not place source clip")
    print(f"[resolve] Full source placed on timeline", file=sys.stderr)

    # ── Overview marker at head ───────────────────────────────────────────────
    clip_count   = len(clips)
    type_counts  = {}
    for c in clips:
        t = c.get("clip_type", "social")
        type_counts[t] = type_counts.get(t, 0) + 1
    type_summary = ", ".join(f"{v} {k}" for k, v in type_counts.items())
    overview_note = (
        f"{clip_count} clip markers — {type_summary}. "
        f"Blade at each marker's IN and OUT point to isolate clips. "
        f"Green=gold, Blue=social, Cyan=retention, Red=off-script gold."
    )
    add_marker(timeline, 0, "Purple", f"CLIPSR: {clip_count} clips", overview_note, duration=1)

    # ── Add one duration-span marker per clip ─────────────────────────────────
    markers_added = 0
    errors        = []

    for clip in clips:
        rank        = clip.get("rank", 0)
        start_s     = float(clip.get("start", 0))
        end_s       = float(clip.get("end", 0))
        hook        = clip.get("hook", "") or ""
        reasoning   = clip.get("reasoning", "") or ""
        clip_type   = clip.get("clip_type", "social")
        transcript  = clip.get("transcript", "") or ""
        duration_s  = end_s - start_s

        if end_s <= start_s:
            errors.append(f"Clip {rank}: invalid timecodes ({start_s}→{end_s}), skipped")
            continue

        start_frame     = seconds_to_frames(start_s, fps)
        duration_frames = seconds_to_frames(duration_s, fps)

        color = clip_color(clip_type)

        # Short hook label (first 6 words) for the marker name
        hook_words = " ".join(hook.split()[:6])
        type_label = {"gold": "GOLD", "social": "CLIP", "retention": "RET",
                      "off_script_gold": "GOLD-OS", "CTA": "CTA"}.get(clip_type, "CLIP")
        marker_name = f"#{rank:02d} {type_label} — {hook_words}"

        # Full note: hook + timecodes + transcript + reasoning
        # DaVinci marker notes are visible in the Inspector panel — 512 char limit applied in add_marker()
        note_parts = []
        if hook:
            note_parts.append(f"HOOK: {hook}")
        note_parts.append(f"IN: {start_s:.1f}s  OUT: {end_s:.1f}s  ({duration_s:.1f}s)")
        if transcript:
            note_parts.append(f"TRANSCRIPT:\n{transcript}")
        if reasoning:
            note_parts.append(f"WHY: {reasoning[:300]}")
        marker_note = "\n\n".join(note_parts)

        add_marker(timeline, start_frame, color, marker_name, marker_note, duration=duration_frames)
        markers_added += 1
        print(f"[marker] #{rank:02d} {type_label} @ {start_s:.1f}s–{end_s:.1f}s ({color})", file=sys.stderr)

    # ── Save ──────────────────────────────────────────────────────────────────
    project_manager.SaveProject()
    print(f"[resolve] Project saved: {proj_name}", file=sys.stderr)

    return {
        "ok":             True,
        "project_name":   proj_name,
        "timeline_name":  TIMELINE_NAME,
        "markers_added":  markers_added,
        "clip_count":     clip_count,
        "source":         os.path.basename(args.source_path),
        "errors":         errors,
        "instructions": (
            "Full source is on the CLIP_MARKERS timeline. "
            "Each colored marker spans one clip. "
            "Blade at the IN (marker start) and OUT (marker end) of each colored region, "
            "then delete the unwanted sections."
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
