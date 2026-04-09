"""
create-social-clips.py — Kre8Ωr ClipsΩr → DaVinci Resolve

Takes approved viral clip candidates (start/end timecodes) and creates
a DaVinci Resolve project with one 9:16 vertical timeline per clip,
each pre-trimmed to the exact in/out points. Creator opens Resolve,
selects each clip, hits Smart Reframe → Analyze, and exports.

Usage:
    python create-social-clips.py \
        --project_name "Rock Rich Community Launch" \
        --source_path "C:/path/to/finished_video.mp4" \
        --clips_json '[{"rank":1,"start":42.5,"end":89.3,"hook":"...","clip_type":"gold"}]' \
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
# Helpers
# ---------------------------------------------------------------------------

def safe_timeline_name(rank, clip_type, hook, max_len=40):
    """Build a safe DaVinci timeline name from clip metadata."""
    type_prefix = {"gold": "GOLD", "social": "CLIP", "retention": "RET"}.get(clip_type, "CLIP")
    # Truncate hook to first 5 words
    words = (hook or "").split()[:5]
    hook_short = " ".join(words)
    # Sanitize — Resolve doesn't like special chars in timeline names
    safe = "".join(c if c.isalnum() or c in " _-" else "" for c in hook_short).strip()
    name = f"{rank:02d}_{type_prefix}_{safe}"
    return name[:max_len]


def seconds_to_frames(seconds, fps):
    """Convert seconds to integer frame count."""
    return int(math.floor(seconds * fps))


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def run(args):
    errors  = []
    results = []

    # ── Connect ──────────────────────────────────────────────────────────────
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

    # ── Parse clips ──────────────────────────────────────────────────────────
    try:
        clips = json.loads(args.clips_json)
    except json.JSONDecodeError as exc:
        raise ValueError(f"Invalid --clips_json: {exc}") from exc

    if not clips:
        raise ValueError("No clips provided in --clips_json")

    fps = float(args.fps or 29.97)

    # ── Build project name ───────────────────────────────────────────────────
    date_str  = datetime.date.today().strftime("%Y-%m-%d")
    safe_name = args.project_name.replace(" ", "-")[:40]
    proj_name = f"{date_str}_SocialClips_{safe_name}"

    # ── Create DaVinci project ───────────────────────────────────────────────
    project = project_manager.CreateProject(proj_name)
    if project is None:
        raise RuntimeError(
            f"Could not create project '{proj_name}'. "
            "A project with that name may already exist in Resolve."
        )
    print(f"[resolve] Created project: {proj_name}", file=sys.stderr)

    media_pool = project.GetMediaPool()
    root_folder = media_pool.GetRootFolder()

    # ── Import source video once into Media Pool ──────────────────────────────
    if not os.path.isfile(args.source_path):
        raise FileNotFoundError(f"Source video not found: {args.source_path}")

    media_pool.SetCurrentFolder(root_folder)
    imported = media_pool.ImportMedia([args.source_path])
    if not imported:
        raise RuntimeError(f"ImportMedia failed for: {args.source_path}")
    source_item = imported[0]
    print(f"[resolve] Imported source: {os.path.basename(args.source_path)}", file=sys.stderr)

    # ── One timeline per clip ─────────────────────────────────────────────────
    for clip in clips:
        rank      = clip.get("rank", 1)
        start_s   = float(clip.get("start", 0))
        end_s     = float(clip.get("end", 0))
        hook      = clip.get("hook", "")
        caption   = clip.get("caption", "")
        clip_type = clip.get("clip_type", "social")

        if end_s <= start_s:
            errors.append(f"Clip {rank}: invalid timecodes ({start_s}→{end_s}), skipped")
            continue

        tl_name     = safe_timeline_name(rank, clip_type, hook)
        start_frame = seconds_to_frames(start_s, fps)
        # Add 1.5s buffer: Whisper timestamps end at the last phoneme.
        # Without buffer, DaVinci cuts on the final syllable. 1.5s gives
        # the sentence room to land before the cut.
        end_frame   = seconds_to_frames(end_s + 1.5, fps)

        print(f"[resolve] Creating timeline: {tl_name} [{start_frame}→{end_frame}]", file=sys.stderr)

        # Create empty timeline
        media_pool.SetCurrentFolder(root_folder)
        timeline = media_pool.CreateEmptyTimeline(tl_name)
        if timeline is None:
            errors.append(f"Clip {rank}: CreateEmptyTimeline returned None, skipped")
            continue

        # Set 9:16 vertical format with custom settings
        timeline.SetSetting("useCustomSettings", "1")
        timeline.SetSetting("timelineResolutionWidth",  "1080")
        timeline.SetSetting("timelineResolutionHeight", "1920")
        timeline.SetSetting("timelineFrameRate",        str(fps))

        project.SetCurrentTimeline(timeline)

        # Append clip with in/out points
        # NOTE: omitting mediaType gives both video + audio (the default).
        #       mediaType=1 = video only, mediaType=2 = audio only — do NOT set it.
        append_result = media_pool.AppendToTimeline([{
            "mediaPoolItem": source_item,
            "startFrame":    start_frame,
            "endFrame":      end_frame,
        }])

        if not append_result:
            errors.append(f"Clip {rank}: AppendToTimeline failed")
            continue

        # Add marker at frame 0 with hook + caption for reference
        marker_note = f"HOOK: {hook}"
        if caption:
            marker_note += f"\n\nCAPTION: {caption[:200]}"
        try:
            marker_color = "Green" if clip_type == "gold" else "Blue"
            timeline.AddMarker(0, marker_color, f"Clip {rank}", marker_note, 1)
        except Exception as exc:
            print(f"[warn] AddMarker failed for clip {rank}: {exc}", file=sys.stderr)

        # Attempt Smart Reframe via property (Resolve 18+ — may not be available)
        reframe_applied = False
        try:
            get_items = getattr(timeline, "GetItemListInTrack", None)
            if callable(get_items):
                tl_items = get_items("video", 1) or []
                for tl_item in tl_items:
                    set_prop = getattr(tl_item, "SetProperty", None)
                    if callable(set_prop):
                        # Attempt to set Smart Reframe — Resolve 18.5+ property
                        r = set_prop("SmartReframe", "1")
                        if r:
                            reframe_applied = True
                            print(f"[resolve] Smart Reframe applied via SetProperty for clip {rank}", file=sys.stderr)
        except Exception as exc:
            print(f"[warn] Smart Reframe SetProperty failed for clip {rank}: {exc}", file=sys.stderr)

        results.append({
            "rank":            rank,
            "timeline_name":   tl_name,
            "start":           start_s,
            "end":             end_s,
            "duration":        round(end_s - start_s, 2),
            "clip_type":       clip_type,
            "reframe_applied": reframe_applied,
        })

    # ── Save project ─────────────────────────────────────────────────────────
    project_manager.SaveProject()
    print(f"[resolve] Project saved: {proj_name}", file=sys.stderr)

    # ── Auto Reframe note ────────────────────────────────────────────────────
    reframe_count = sum(1 for r in results if r["reframe_applied"])
    reframe_note  = None
    if reframe_count < len(results):
        reframe_note = (
            "Smart Reframe needs to be applied manually in Resolve: "
            "open each timeline → select the clip → Inspector → Smart Reframe → Analyze. "
            "Takes about 5 seconds per clip."
        )

    return {
        "ok":           True,
        "project_name": proj_name,
        "timelines":    results,
        "timeline_count": len(results),
        "reframe_applied_count": reframe_count,
        "reframe_note": reframe_note,
        "errors":       errors,
    }


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def parse_args():
    p = argparse.ArgumentParser(description="Create Resolve social clip timelines from ClipsΩr candidates")
    p.add_argument("--project_name", type=str, required=True)
    p.add_argument("--source_path",  type=str, required=True)
    p.add_argument("--clips_json",   type=str, required=True)
    p.add_argument("--fps",          type=float, default=29.97)
    return p.parse_args()


if __name__ == "__main__":
    try:
        args  = parse_args()
        result = run(args)
        print(json.dumps(result))
    except Exception as exc:
        traceback.print_exc(file=sys.stderr)
        print(json.dumps({"ok": False, "error": str(exc)}))
        sys.exit(1)
