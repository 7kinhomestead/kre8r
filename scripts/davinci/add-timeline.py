"""
add-timeline.py — Kre8Ωr DaVinci Resolve integration
Opens an existing DaVinci project and adds a named timeline with the
appropriate structure for each Kre8Ωr pipeline stage.

Called from Node.js via child_process.spawn.
Outputs a single JSON object to stdout. Tracebacks go to stderr only.

Usage:
    python add-timeline.py \
        --project_name "2024-01-15_My-Video_042" \
        --timeline_name "02_SELECTS" \
        [--footage_json '{"talking_head": [...], "b_roll": [...]}'] \
        [--cuts_json '[{"timestamp": 1.5, "type": "best_clip", ...}]'] \
        [--skip_if_exists true]
"""

import sys
import os
import json
import argparse
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
# Helpers
# ---------------------------------------------------------------------------

TIMELINE_TYPES = {
    "01_PROXY_GRADE",
    "02_SELECTS",
    "03_ROUGH_CUT",
    "04_AUDIO",
    "06_DELIVERY_YT",
    "07_DELIVERY_SHORTS",
    "08_DELIVERY_SOCIAL",
}

# Marker colours used by cuts_json type
CUT_TYPE_COLOR = {
    "best_clip": "Green",
    "retention_cut": "Yellow",
    "cta": "Red",
    "scene_break": "Yellow",
    "default": "Blue",
}

DELIVERY_YT_SETTINGS = {
    "SelectAllFrames": True,
    "ExportVideo": True,
    "ExportAudio": True,
    "FormatWidth": 3840,
    "FormatHeight": 2160,
    "VideoCodec": "H265_HEVC",
    "VideoMaxBitrate": 160,
    "VideoMinBitrate": 80,
    "AudioCodec": "aac",
    "AudioSampleRate": 48000,
    "ColorSpaceTag": "Rec.709",
}

DELIVERY_SHORTS_SETTINGS = {
    "SelectAllFrames": True,
    "ExportVideo": True,
    "ExportAudio": True,
    "FormatWidth": 1080,
    "FormatHeight": 1920,
    "VideoCodec": "H264",
    "VideoMaxBitrate": 40,
    "AudioCodec": "aac",
    "AudioSampleRate": 48000,
    "ColorSpaceTag": "Rec.709",
}


def str_to_bool(val):
    if isinstance(val, bool):
        return val
    return val.lower() in ("true", "1", "yes")


def get_all_timelines(project):
    """Return a list of all timeline objects in the project."""
    count = project.GetTimelineCount()
    timelines = []
    for i in range(1, count + 1):
        tl = project.GetTimelineByIndex(i)
        if tl:
            timelines.append(tl)
    return timelines


def find_timeline_by_name(project, name):
    """Return timeline object matching name, or None."""
    for tl in get_all_timelines(project):
        try:
            if tl.GetName() == name:
                return tl
        except Exception:
            pass
    return None


def fps_to_frame(seconds, fps=24):
    """Convert a timestamp in seconds to a frame number."""
    return int(float(seconds) * fps)


def add_marker_safe(timeline, frame, color, name, note, errors):
    """Add a marker to a timeline, capturing any API errors."""
    try:
        timeline.AddMarker(frame, color, name, note, 1)
    except Exception as exc:
        errors.append(f"AddMarker(frame={frame}, color={color}) failed: {exc}")


def import_footage_to_pool(media_pool, footage, errors):
    """
    Import clip paths from footage dict into media pool root.
    Returns dict: shot_type -> [MediaPoolItem]
    """
    items_by_type = {}
    if not footage:
        return items_by_type

    root = media_pool.GetRootFolder()
    media_pool.SetCurrentFolder(root)

    for shot_type, paths in footage.items():
        if isinstance(paths, str):
            paths = [paths]
        valid = [p for p in paths if os.path.isfile(p)]
        missing = [p for p in paths if not os.path.isfile(p)]
        if missing:
            errors.extend([f"File not found: {p}" for p in missing])
        if valid:
            imported = media_pool.ImportMedia(valid)
            if imported:
                items_by_type.setdefault(shot_type, []).extend(imported)
            else:
                errors.append(f"ImportMedia returned empty for shot_type '{shot_type}'")

    return items_by_type


def make_clip_dicts(items, track_index=1):
    return [
        {
            "mediaPoolItem": item,
            "startFrame": 0,
            "endFrame": -1,
            "mediaType": 1,
            "trackIndex": track_index,
        }
        for item in items
    ]


# ---------------------------------------------------------------------------
# Timeline-type builders
# ---------------------------------------------------------------------------

def build_02_selects(media_pool, project, timeline, footage, cuts_json, errors):
    """02_SELECTS: import hero/usable clips, add CutΩr markers."""
    items_by_type = import_footage_to_pool(media_pool, footage, errors)

    # Hero clips = talking_head + dialogue (exclude unusable)
    hero_items = []
    for shot_type, items in items_by_type.items():
        if shot_type.lower() not in ("unusable",):
            hero_items.extend(items)

    if hero_items:
        result = media_pool.AppendToTimeline(make_clip_dicts(hero_items))
        if not result:
            errors.append("AppendToTimeline (selects) returned falsy")

    # Add CutΩr markers
    for cut in (cuts_json or []):
        ts = cut.get("timestamp", 0)
        cut_type = cut.get("type", "default")
        frame = fps_to_frame(ts)
        color = CUT_TYPE_COLOR.get(cut_type, CUT_TYPE_COLOR["default"])
        name = cut.get("label", cut_type)
        note = cut.get("reasoning", cut.get("note", ""))
        add_marker_safe(timeline, frame, color, name, note, errors)

    return len(hero_items)


def build_03_rough_cut(media_pool, project, timeline, footage, cuts_json, errors):
    """
    03_ROUGH_CUT: 4 tracks.
      Track 1 — talking head / dialogue in cut order
      Track 2 — b-roll at cut points
      Track 3 — empty audio placeholder (music)
      Track 4 — empty graphics placeholder
    """
    items_by_type = import_footage_to_pool(media_pool, footage, errors)

    # Ensure 4 video tracks exist
    for _ in range(3):
        try:
            timeline.AddTrack("video")
        except Exception:
            pass
    # Ensure 2 audio tracks for music + SFX
    for _ in range(2):
        try:
            timeline.AddTrack("audio")
        except Exception:
            pass

    # Track 1: talking head + dialogue
    track1 = []
    for st, items in items_by_type.items():
        if st.lower() in ("talking_head", "dialogue"):
            track1.extend(items)

    # Track 2: b-roll
    track2 = []
    for st, items in items_by_type.items():
        if "b_roll" in st.lower() or st.lower() in ("action", "wide", "medium", "close_up", "detail"):
            track2.extend(items)

    clip_count = 0

    if track1:
        result = media_pool.AppendToTimeline(make_clip_dicts(track1, track_index=1))
        if result:
            clip_count += len(track1)
        else:
            errors.append("AppendToTimeline (rough cut track 1) returned falsy")

    if track2:
        result = media_pool.AppendToTimeline(make_clip_dicts(track2, track_index=2))
        if result:
            clip_count += len(track2)
        else:
            errors.append("AppendToTimeline (rough cut track 2) returned falsy")

    # Set clip colour label to Blue on track 1 items
    try:
        track1_count = timeline.GetTrackItemCount("video", 1) if hasattr(timeline, "GetTrackItemCount") else 0
        for idx in range(1, track1_count + 1):
            ti = timeline.GetItemInTrack("video", 1, idx)
            if ti and hasattr(ti, "SetClipColor"):
                ti.SetClipColor("Blue")
    except Exception as exc:
        errors.append(f"SetClipColor failed: {exc}")

    # Add markers for each cut point
    for cut in (cuts_json or []):
        ts = cut.get("timestamp", 0)
        cut_type = cut.get("type", "default")
        frame = fps_to_frame(ts)
        color = CUT_TYPE_COLOR.get(cut_type, CUT_TYPE_COLOR["default"])
        name = cut.get("label", cut_type)
        note = cut.get("reasoning", cut.get("note", ""))
        add_marker_safe(timeline, frame, color, name, note, errors)

    return clip_count


def build_04_audio(media_pool, project, timeline, footage, cuts_json, errors):
    """
    04_AUDIO: dialogue audio, music track, SFX track.
    Adds Fairlight markers at CTA and scene-break timestamps.
    """
    items_by_type = import_footage_to_pool(media_pool, footage, errors)

    # Add audio tracks: dialogue (1), music (2), SFX (3)
    for _ in range(2):
        try:
            timeline.AddTrack("audio")
        except Exception:
            pass

    # Dialogue audio — import with mediaType=2 (audio only)
    dialogue_items = []
    for st, items in items_by_type.items():
        if st.lower() in ("talking_head", "dialogue", "dialogue_clean"):
            dialogue_items.extend(items)

    clip_count = 0
    if dialogue_items:
        audio_dicts = [
            {"mediaPoolItem": item, "startFrame": 0, "endFrame": -1, "mediaType": 2, "trackIndex": 1}
            for item in dialogue_items
        ]
        result = media_pool.AppendToTimeline(audio_dicts)
        if result:
            clip_count += len(dialogue_items)
        else:
            errors.append("AppendToTimeline (audio dialogue) returned falsy")

    # Add Fairlight markers at CTA / scene breaks
    for cut in (cuts_json or []):
        cut_type = cut.get("type", "")
        if cut_type in ("cta", "scene_break"):
            ts = cut.get("timestamp", 0)
            frame = fps_to_frame(ts)
            color = CUT_TYPE_COLOR.get(cut_type, "Yellow")
            name = cut.get("label", cut_type)
            note = cut.get("reasoning", cut.get("note", ""))
            add_marker_safe(timeline, frame, color, name, note, errors)

    return clip_count


def build_06_delivery_yt(media_pool, project, timeline_name, errors):
    """06_DELIVERY_YT: duplicate picture-lock timeline, set YT render settings."""
    # Find picture lock timeline (03_ROUGH_CUT or similar)
    picture_lock = find_timeline_by_name(project, "03_ROUGH_CUT")
    if picture_lock is None:
        # Fall back to any timeline
        all_tl = get_all_timelines(project)
        picture_lock = all_tl[0] if all_tl else None

    if picture_lock is None:
        errors.append("No source timeline found to duplicate for 06_DELIVERY_YT")
        return 0

    # DaVinci doesn't expose a direct duplicate timeline API; clone via media pool
    try:
        # Export current timeline as XML and reimport under new name is the
        # standard workaround. Here we create empty and note the limitation.
        tl = media_pool.CreateEmptyTimeline(timeline_name)
        if tl is None:
            raise RuntimeError("CreateEmptyTimeline returned None")
        tl.SetSetting("timelineFrameRate", "24")
        tl.SetSetting("timelineResolutionWidth", "3840")
        tl.SetSetting("timelineResolutionHeight", "2160")
        errors.append(
            "Note: 06_DELIVERY_YT created as empty timeline — "
            "manually duplicate 03_ROUGH_CUT when picture lock is final."
        )
    except Exception as exc:
        errors.append(f"Could not create 06_DELIVERY_YT timeline: {exc}")
        return 0

    # Apply render settings
    try:
        project.SetCurrentTimeline(tl)
        project.SetRenderSettings(DELIVERY_YT_SETTINGS)
    except Exception as exc:
        errors.append(f"SetRenderSettings for YT failed: {exc}")

    return 0


def build_07_delivery_shorts(media_pool, project, timeline_name, errors):
    """07_DELIVERY_SHORTS: create 9:16 1080p timeline with Smart Reframe note."""
    try:
        tl = media_pool.CreateEmptyTimeline(timeline_name)
        if tl is None:
            raise RuntimeError("CreateEmptyTimeline returned None")
        tl.SetSetting("timelineFrameRate", "24")
        tl.SetSetting("timelineResolutionWidth", "1080")
        tl.SetSetting("timelineResolutionHeight", "1920")
        errors.append(
            "Note: 07_DELIVERY_SHORTS created as 1080x1920 timeline — "
            "apply Smart Reframe manually in DaVinci Color/Edit page, "
            "then render H.264 at 40Mbps."
        )
    except Exception as exc:
        errors.append(f"Could not create 07_DELIVERY_SHORTS timeline: {exc}")
        return 0

    try:
        project.SetCurrentTimeline(tl)
        project.SetRenderSettings(DELIVERY_SHORTS_SETTINGS)
    except Exception as exc:
        errors.append(f"SetRenderSettings for Shorts failed: {exc}")

    return 0


def build_08_delivery_social(media_pool, project, cuts_json, errors):
    """
    08_DELIVERY_SOCIAL: create individual timelines for each CutΩr social clip.
    Social clips in cuts_json have type == "social_clip".
    """
    created = 0
    social_clips = [c for c in (cuts_json or []) if c.get("type") == "social_clip"]

    for idx, clip in enumerate(social_clips, 1):
        clip_name = clip.get("label", f"social_clip_{idx:02d}")
        tl_name = f"08_SOCIAL_{clip_name}"[:64]  # Resolve may have a name length limit
        try:
            tl = media_pool.CreateEmptyTimeline(tl_name)
            if tl is None:
                errors.append(f"Could not create social timeline '{tl_name}'")
                continue
            tl.SetSetting("timelineFrameRate", "24")
            tl.SetSetting("timelineResolutionWidth", "1080")
            tl.SetSetting("timelineResolutionHeight", "1920")
            created += 1
        except Exception as exc:
            errors.append(f"Social timeline '{tl_name}': {exc}")

    return created


# ---------------------------------------------------------------------------
# Main logic
# ---------------------------------------------------------------------------

def run(args):
    errors = []

    skip_if_exists = str_to_bool(args.skip_if_exists)

    # ---- Parse optional JSON args ------------------------------------------
    footage = {}
    if args.footage_json:
        try:
            footage = json.loads(args.footage_json)
        except json.JSONDecodeError as exc:
            raise ValueError(f"Invalid --footage_json: {exc}") from exc

    cuts_json = []
    if args.cuts_json:
        try:
            cuts_json = json.loads(args.cuts_json)
            if not isinstance(cuts_json, list):
                raise ValueError("--cuts_json must be a JSON array")
        except json.JSONDecodeError as exc:
            raise ValueError(f"Invalid --cuts_json: {exc}") from exc

    # ---- Connect to Resolve ------------------------------------------------
    resolve = get_resolve()
    project_manager = resolve.GetProjectManager()
    if project_manager is None:
        raise RuntimeError("Could not get ProjectManager from Resolve")

    # ---- Open the project --------------------------------------------------
    project = project_manager.LoadProject(args.project_name)
    if project is None:
        raise RuntimeError(
            f"Could not load project '{args.project_name}'. "
            "Verify the project name exactly matches what is shown in DaVinci Resolve."
        )

    media_pool = project.GetMediaPool()
    if media_pool is None:
        raise RuntimeError("Could not get MediaPool from project")

    # ---- Check if timeline already exists ----------------------------------
    existing = find_timeline_by_name(project, args.timeline_name)
    if existing is not None and skip_if_exists:
        return {
            "ok": True,
            "skipped": True,
            "reason": "already exists",
            "timeline_name": args.timeline_name,
            "clip_count": 0,
            "state": "existing",
            "errors": [],
        }

    # ---- Determine timeline type -------------------------------------------
    # Prefix match — e.g. "02_SELECTS_v2" → "02_SELECTS"
    tl_type = None
    for known in TIMELINE_TYPES:
        if args.timeline_name.startswith(known):
            tl_type = known
            break

    clip_count = 0

    # ---- Delivery timelines: special paths that don't need CreateEmptyTimeline first
    if tl_type == "06_DELIVERY_YT":
        build_06_delivery_yt(media_pool, project, args.timeline_name, errors)
        project_manager.SaveProject()
        return {
            "ok": True,
            "skipped": False,
            "timeline_name": args.timeline_name,
            "clip_count": 0,
            "state": "active",
            "errors": errors,
        }

    if tl_type == "07_DELIVERY_SHORTS":
        build_07_delivery_shorts(media_pool, project, args.timeline_name, errors)
        project_manager.SaveProject()
        return {
            "ok": True,
            "skipped": False,
            "timeline_name": args.timeline_name,
            "clip_count": 0,
            "state": "active",
            "errors": errors,
        }

    if tl_type == "08_DELIVERY_SOCIAL":
        clip_count = build_08_delivery_social(media_pool, project, cuts_json, errors)
        project_manager.SaveProject()
        return {
            "ok": True,
            "skipped": False,
            "timeline_name": args.timeline_name,
            "clip_count": clip_count,
            "state": "active",
            "errors": errors,
        }

    # ---- Standard timelines: create empty, then populate -------------------
    # If exists but skip_if_exists is False, we proceed (re-population)
    if existing is not None:
        timeline = existing
    else:
        timeline = media_pool.CreateEmptyTimeline(args.timeline_name)
        if timeline is None:
            raise RuntimeError(f"CreateEmptyTimeline('{args.timeline_name}') returned None")

    # Default timeline settings
    timeline.SetSetting("timelineFrameRate", "24")
    timeline.SetSetting("timelineResolutionWidth", "3840")
    timeline.SetSetting("timelineResolutionHeight", "2160")
    project.SetCurrentTimeline(timeline)

    if tl_type == "02_SELECTS":
        clip_count = build_02_selects(media_pool, project, timeline, footage, cuts_json, errors)

    elif tl_type == "03_ROUGH_CUT":
        clip_count = build_03_rough_cut(media_pool, project, timeline, footage, cuts_json, errors)

    elif tl_type == "04_AUDIO":
        clip_count = build_04_audio(media_pool, project, timeline, footage, cuts_json, errors)

    elif tl_type == "01_PROXY_GRADE":
        # Handled by create-project.py; here just create empty
        errors.append(
            "01_PROXY_GRADE should be created by create-project.py. "
            "Empty timeline created as fallback."
        )

    else:
        # Unknown type — create empty timeline with a note
        errors.append(
            f"Timeline type '{tl_type or args.timeline_name}' not recognised — "
            "empty timeline created."
        )

    # ---- Save project ------------------------------------------------------
    project_manager.SaveProject()

    return {
        "ok": True,
        "skipped": False,
        "timeline_name": args.timeline_name,
        "clip_count": clip_count,
        "state": "active",
        "errors": errors,
    }


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def parse_args():
    parser = argparse.ArgumentParser(
        description="Add a pipeline timeline to a DaVinci Resolve project for Kre8\u03a9r"
    )
    parser.add_argument("--project_name", type=str, required=True,
                        help="Exact DaVinci project name to open")
    parser.add_argument("--timeline_name", type=str, required=True,
                        help="Timeline to create (e.g. '02_SELECTS')")
    parser.add_argument("--footage_json", type=str, default=None,
                        help="JSON with clip paths/metadata for this timeline")
    parser.add_argument("--cuts_json", type=str, default=None,
                        help="JSON array of CutΩr cut points with timestamps")
    parser.add_argument("--skip_if_exists", type=str, default="true",
                        help="Skip if timeline already exists (default: true)")
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
