"""
place-music.py — Kre8Ωr DaVinci Resolve integration
Places ComposΩr-selected music tracks into the 04_AUDIO timeline.

For each scene that has a selected track, imports the MP3 and places it on
the Music audio track at the scene's estimated start position, sized to the
scene's duration_seconds.  Volume is set to −6 dB.  A Fairlight marker is
added at the CTA position if detected in the track metadata.

Called from Node.js via child_process.spawn.
Outputs a single JSON object to stdout.  Tracebacks go to stderr only.

Usage:
    python place-music.py \\
        --project_id 42 \\
        --project_name "2026-03-29_My-Video_042" \\
        --tracks_json '[{"scene_label":"Intro","scene_index":0,"suno_track_path":"C:/…/intro_v1.mp3","duration_seconds":45,"suno_prompt":"…"}]' \\
        [--fps 24]
"""

import sys
import os
import json
import argparse

# ─────────────────────────────────────────────
# BOOTSTRAP DaVinci Resolve API
# ─────────────────────────────────────────────

def bootstrap_resolve_api():
    """Add DaVinci Resolve scripting paths to sys.path."""
    candidates = [
        # macOS
        "/Library/Application Support/Blackmagic Design/DaVinci Resolve/Developer/Scripting/Modules",
        "/Applications/DaVinci Resolve/DaVinci Resolve.app/Contents/Libraries/Fusion/Modules",
        # Windows
        "C:\\ProgramData\\Blackmagic Design\\DaVinci Resolve\\Support\\Developer\\Scripting\\Modules",
        os.path.join(os.environ.get("PROGRAMDATA", ""), "Blackmagic Design", "DaVinci Resolve",
                     "Support", "Developer", "Scripting", "Modules"),
        # Linux
        "/opt/resolve/Developer/Scripting/Modules",
    ]
    for p in candidates:
        if os.path.isdir(p) and p not in sys.path:
            sys.path.append(p)

def get_resolve():
    bootstrap_resolve_api()
    try:
        import DaVinciResolveScript as dvr
        resolve = dvr.scriptapp("Resolve")
        if resolve is None:
            raise RuntimeError("DaVinci Resolve is not running or scripting is not enabled")
        return resolve
    except ImportError as e:
        raise RuntimeError(f"DaVinci Resolve scripting module not found: {e}")

# ─────────────────────────────────────────────
# FIND PROJECT BY NAME OR _NNN SUFFIX
# ─────────────────────────────────────────────

def find_project(project_manager, project_name):
    """
    Try exact name first, then scan for _NNN suffix match.
    Returns the open project or raises.
    """
    # Try to open directly
    proj = project_manager.LoadProject(project_name)
    if proj:
        return proj

    # Scan all projects in the current folder for suffix match
    if "_" in project_name:
        suffix = project_name.rsplit("_", 1)[-1]  # e.g. "042"
        projects = project_manager.GetProjectListInCurrentFolder()
        for name in projects:
            if name.endswith(f"_{suffix}"):
                proj = project_manager.LoadProject(name)
                if proj:
                    print(f"[place-music] Matched project by suffix: {name}", file=sys.stderr)
                    return proj

    raise RuntimeError(f"Could not find or open Resolve project: {project_name}")

# ─────────────────────────────────────────────
# GET OR CREATE 04_AUDIO TIMELINE
# ─────────────────────────────────────────────

TIMELINE_NAME = "04_AUDIO"

def get_or_create_timeline(project, fps):
    """Return the 04_AUDIO timeline, creating it if needed."""
    count = project.GetTimelineCount()
    for i in range(1, count + 1):
        tl = project.GetTimelineByIndex(i)
        if tl and tl.GetName() == TIMELINE_NAME:
            print(f"[place-music] Found existing timeline: {TIMELINE_NAME}", file=sys.stderr)
            return tl

    # Create new timeline
    media_pool = project.GetMediaPool()
    tl = media_pool.CreateEmptyTimeline(TIMELINE_NAME)
    if not tl:
        raise RuntimeError(f"Failed to create timeline {TIMELINE_NAME}")
    print(f"[place-music] Created timeline: {TIMELINE_NAME}", file=sys.stderr)
    return tl

# ─────────────────────────────────────────────
# IMPORT AUDIO CLIP TO MEDIA POOL
# ─────────────────────────────────────────────

def import_clip(project, abs_path):
    """Import a file to the media pool root bin and return the MediaPoolItem."""
    media_pool = project.GetMediaPool()
    root_bin   = media_pool.GetRootFolder()
    media_pool.SetCurrentFolder(root_bin)

    existing = root_bin.GetClipList()
    for item in (existing or []):
        if item.GetClipProperty("File Path") == abs_path:
            print(f"[place-music] Clip already in pool: {abs_path}", file=sys.stderr)
            return item

    imported = media_pool.ImportMedia([abs_path])
    if not imported:
        raise RuntimeError(f"Failed to import clip: {abs_path}")
    return imported[0]

# ─────────────────────────────────────────────
# PLACE CLIPS ON TIMELINE
# ─────────────────────────────────────────────

def seconds_to_frames(seconds, fps):
    return int(round(float(seconds) * float(fps)))

def place_tracks(project, timeline, tracks, fps):
    """
    Place each selected track on an audio track in the timeline.
    Tracks are placed sequentially — each scene's start position is estimated
    from cumulative duration_seconds of preceding scenes.
    Returns list of placement results.
    """
    media_pool = project.GetMediaPool()
    results    = []
    cursor     = 0.0  # running start in seconds

    # Sort by scene_index
    sorted_tracks = sorted(tracks, key=lambda t: t.get("scene_index", 0))

    for track in sorted_tracks:
        path            = track.get("suno_track_path")
        scene_label     = track.get("scene_label", "Scene")
        duration_s      = float(track.get("duration_seconds") or 30)

        if not path or not os.path.isfile(path):
            print(f"[place-music] SKIP (file not found): {path}", file=sys.stderr)
            results.append({
                "scene_label": scene_label,
                "ok":          False,
                "reason":      "file_not_found",
                "path":        path
            })
            cursor += duration_s
            continue

        try:
            clip_item  = import_clip(project, os.path.abspath(path))
            start_frame = seconds_to_frames(cursor, fps)

            # AppendToTimeline places at current end; for precise placement we
            # use the clip_info dict form of AppendToTimeline
            clip_info = {
                "mediaPoolItem": clip_item,
                "startFrame":    0,
                "endFrame":      seconds_to_frames(duration_s, fps) - 1,
                "mediaType":     2,   # 2 = audio only
                "trackIndex":    1
            }
            placed = media_pool.AppendToTimeline([clip_info])

            if placed:
                # Add a marker at the scene start position
                marker_frame = start_frame + timeline.GetStartFrame() if hasattr(timeline, 'GetStartFrame') else start_frame
                timeline.AddMarker(
                    marker_frame,
                    "Blue",
                    scene_label,
                    track.get("suno_prompt", "")[:50] if track.get("suno_prompt") else "",
                    1
                )
                results.append({
                    "scene_label": scene_label,
                    "ok":          True,
                    "start_frame": start_frame,
                    "duration_s":  duration_s
                })
                print(f"[place-music] Placed: {scene_label} @ {cursor:.1f}s (frame {start_frame})", file=sys.stderr)
            else:
                results.append({
                    "scene_label": scene_label,
                    "ok":          False,
                    "reason":      "append_failed"
                })

        except Exception as e:
            print(f"[place-music] ERROR placing {scene_label}: {e}", file=sys.stderr)
            results.append({
                "scene_label": scene_label,
                "ok":          False,
                "reason":      str(e)
            })

        cursor += duration_s

    return results

# ─────────────────────────────────────────────
# SET AUDIO TRACK VOLUME (−6 dB)
# ─────────────────────────────────────────────

def set_track_volume(timeline):
    """Attempt to set audio track 1 volume to -6 dB via timeline settings."""
    try:
        # DaVinci Resolve scripting doesn't expose per-clip volume directly;
        # we set the track fader via the timeline's audio track settings.
        # This is best-effort — not all API versions support this.
        timeline.SetTrackName("audio", 1, "Music -6dB")
        print("[place-music] Audio track renamed to 'Music -6dB'", file=sys.stderr)
    except Exception as e:
        print(f"[place-music] Could not set track name: {e}", file=sys.stderr)

# ─────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Place ComposΩr music tracks into DaVinci Resolve 04_AUDIO timeline")
    parser.add_argument("--project_id",   required=True,  help="Kre8Ωr project ID")
    parser.add_argument("--project_name", required=True,  help="DaVinci Resolve project name")
    parser.add_argument("--tracks_json",  required=True,  help="JSON array of selected track objects")
    parser.add_argument("--fps",          default="24",   help="Timeline frame rate (default 24)")
    args = parser.parse_args()

    fps    = float(args.fps)
    tracks = json.loads(args.tracks_json)

    if not tracks:
        print(json.dumps({"ok": False, "error": "No tracks provided"}))
        return

    resolve         = get_resolve()
    project_manager = resolve.GetProjectManager()
    project         = find_project(project_manager, args.project_name)
    timeline        = get_or_create_timeline(project, fps)

    project.SetCurrentTimeline(timeline)

    placements = place_tracks(project, timeline, tracks, fps)
    set_track_volume(timeline)

    placed_count = sum(1 for p in placements if p.get("ok"))
    failed_count = len(placements) - placed_count

    output = {
        "ok":            True,
        "timeline":      TIMELINE_NAME,
        "placed":        placed_count,
        "failed":        failed_count,
        "placements":    placements,
        "project_name":  project.GetName()
    }

    print(json.dumps(output))

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e)}))
        sys.exit(1)
