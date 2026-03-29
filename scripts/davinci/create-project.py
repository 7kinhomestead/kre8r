"""
create-project.py — Kre8Ωr DaVinci Resolve integration
Creates a DaVinci Resolve project, bins, imports proxy footage, builds a grade timeline.

Called from Node.js via child_process.spawn.
Outputs a single JSON object to stdout. Tracebacks go to stderr only.

Usage:
    python create-project.py \
        --project_id 42 \
        --project_name "My Video" \
        --footage_json '{"talking_head": ["C:/proxies/th1.mp4"], "b_roll": ["C:/proxies/br1.mp4"]}' \
        [--script_text "..."] \
        [--content_angle "tutorial"] \
        [--creator_name "7 Kin Homestead"]
"""

import sys
import os
import json
import argparse
import datetime
import tempfile
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
    # Make the DLL findable on Windows
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


def check_studio(resolve):
    """
    Log Resolve version and confirm Studio license.
    Returns (version_string, is_studio).
    """
    version = "(unknown)"
    product = "(unknown)"
    try:
        version = resolve.GetVersionString() or "(unknown)"
    except Exception as exc:
        print(f"[warn] GetVersionString() failed: {exc}", file=sys.stderr)

    try:
        product = resolve.GetProductName() or "(unknown)"
    except Exception as exc:
        print(f"[warn] GetProductName() failed: {exc}", file=sys.stderr)

    is_studio = "Studio" in product
    print(
        f"[resolve] Product: {product} | Version: {version} | Studio: {is_studio}",
        file=sys.stderr
    )
    if not is_studio:
        print(
            "[warn] DaVinci Resolve Studio not detected. "
            "Some features (noise reduction, certain render formats) require Studio.",
            file=sys.stderr
        )
    return version, is_studio


# ---------------------------------------------------------------------------
# Bin structure helpers
# ---------------------------------------------------------------------------

BIN_TREE = {
    "00_PROJECT_DOCS": [],
    "01_RAW_SOURCES": ["BRAW_SOURCES"],
    "02_PROXIES": [
        "TALKING_HEAD",
        "B_ROLL/WIDE",
        "B_ROLL/MEDIUM",
        "B_ROLL/CLOSE_UP",
        "B_ROLL/DETAIL",
        "ACTION",
        "DIALOGUE",
        "UNUSABLE",
    ],
    "03_SELECTS": [],
    "04_AUDIO": ["DIALOGUE_CLEAN", "MUSIC", "SFX"],
    "05_GRAPHICS": ["LOWER_THIRDS", "TITLES", "INFOGRAPHICS"],
    "06_DELIVERABLES": ["YOUTUBE", "SHORTS", "SOCIAL_CLIPS"],
    "07_ARCHIVE": [],
}

# Map shot_type keys (from footage_json) → bin path inside 02_PROXIES
SHOT_TYPE_TO_BIN = {
    "talking_head": "TALKING_HEAD",
    "b_roll": "B_ROLL/WIDE",
    "b_roll_wide": "B_ROLL/WIDE",
    "b_roll_medium": "B_ROLL/MEDIUM",
    "b_roll_close": "B_ROLL/CLOSE_UP",
    "b_roll_close_up": "B_ROLL/CLOSE_UP",
    "b_roll_detail": "B_ROLL/DETAIL",
    "action": "ACTION",
    "dialogue": "DIALOGUE",
    "unusable": "UNUSABLE",
}


def _create_subfolder(media_pool, parent_folder, name):
    """Create a single subfolder under parent_folder, return the new folder."""
    return media_pool.AddSubFolder(parent_folder, name)


def build_bin_tree(media_pool, root_folder):
    """
    Create the full bin hierarchy under root_folder.
    Returns a dict mapping bin_path_string -> folder_object.
    """
    bins = {"": root_folder}

    for top_name, children in BIN_TREE.items():
        top = _create_subfolder(media_pool, root_folder, top_name)
        if top is None:
            print(f"[warn] could not create bin {top_name}", file=sys.stderr)
            continue
        bins[top_name] = top

        for child_path in children:
            parts = child_path.split("/")
            current_parent = top
            current_key = top_name
            for part in parts:
                full_key = f"{current_key}/{part}"
                folder = _create_subfolder(media_pool, current_parent, part)
                if folder is None:
                    print(f"[warn] could not create bin {full_key}", file=sys.stderr)
                    break
                bins[full_key] = folder
                current_parent = folder
                current_key = full_key

    return bins


# ---------------------------------------------------------------------------
# Main logic
# ---------------------------------------------------------------------------

def run(args):
    errors = []

    # ---- Connect to Resolve ------------------------------------------------
    resolve = get_resolve()
    version, is_studio = check_studio(resolve)

    project_manager = resolve.GetProjectManager()
    if project_manager is None:
        raise RuntimeError("Could not get ProjectManager from Resolve")

    # ---- Build full project name -------------------------------------------
    date_str = datetime.date.today().strftime("%Y-%m-%d")
    safe_name = args.project_name.replace(" ", "-")
    full_name = f"{date_str}_{safe_name}_{args.project_id:03d}"

    # ---- Create project ----------------------------------------------------
    project = project_manager.CreateProject(full_name)
    if project is None:
        raise RuntimeError(
            f"Could not create project '{full_name}'. "
            "A project with that name may already exist."
        )

    # ---- Color science settings --------------------------------------------
    # colorScienceMode MUST be set first. "davinciYRGBColorManaged" enables
    # Resolve Color Management (RCM) so input/output space settings are active.
    color_science_result = project.SetSetting("colorScienceMode", "davinciYRGBColorManaged")
    if not color_science_result:
        errors.append("SetSetting(colorScienceMode, davinciYRGBColorManaged) returned False")
    else:
        # Probe available settings — log so we can see what Resolve 20 exposes.
        # Key names changed between Resolve 18 and 20; this surfaces the real names.
        probe_keys = [
            "colorSpaceInput", "colorSpaceOutput", "colorSpaceTimeline",
            "inputColorSpace", "outputColorSpace", "timelineColorSpace",
            "colorSpaceInputGammaDrop", "colorSpaceOutputGammaDrop",
            "rcmPresetMode", "colorScienceMode",
            "videoMonitorColorSpace", "videoMonitorLUT",
        ]
        for pk in probe_keys:
            try:
                val = project.GetSetting(pk)
                if val not in (None, ""):
                    print(f"[probe] GetSetting({pk!r}) = {val!r}", file=sys.stderr)
            except Exception:
                pass

        # Try setting input color space — Resolve 18 keys first, then Resolve 20 variants.
        # Multiple string values tried because camera gen affects the exact name.
        def try_set_color_space(setting_keys, value_candidates, label):
            for key in setting_keys:
                for value in value_candidates:
                    try:
                        if project.SetSetting(key, value):
                            print(f"[color] {label}: SetSetting({key!r}, {value!r}) OK", file=sys.stderr)
                            return True
                    except Exception as exc:
                        print(f"[color] {label}: SetSetting({key!r}, {value!r}) raised {exc}", file=sys.stderr)
            errors.append(
                f"Could not set {label} — tried keys {setting_keys} with values {value_candidates}. "
                "Open Resolve → Project Settings → Color Management and set manually."
            )
            return False

        try_set_color_space(
            setting_keys=["colorSpaceInput", "inputColorSpace"],
            value_candidates=[
                "Blackmagic Design Film",
                "Blackmagic Design Film Gen 5",
                "Blackmagic Film Gen 5",
                "Blackmagic Design",
            ],
            label="colorSpaceInput",
        )
        try_set_color_space(
            setting_keys=["colorSpaceOutput", "outputColorSpace"],
            value_candidates=["Rec.709 Scene", "Rec.709 Gamma 2.4", "Rec.709"],
            label="colorSpaceOutput",
        )
        try_set_color_space(
            setting_keys=["colorSpaceTimeline", "timelineColorSpace"],
            value_candidates=["Rec.709 Scene", "Rec.709 Gamma 2.4", "Rec.709"],
            label="colorSpaceTimeline",
        )

    # ---- Parse footage_json ------------------------------------------------
    try:
        footage = json.loads(args.footage_json)
    except json.JSONDecodeError as exc:
        raise ValueError(f"Invalid --footage_json: {exc}") from exc

    # ---- Build bin structure -----------------------------------------------
    media_pool = project.GetMediaPool()
    if media_pool is None:
        raise RuntimeError("Could not get MediaPool from project")

    root_folder = media_pool.GetRootFolder()
    bins = build_bin_tree(media_pool, root_folder)

    # ---- Import proxy footage into bins ------------------------------------
    imported_items_by_type = {}   # shot_type -> [MediaPoolItem]
    clip_count = 0

    for shot_type, paths in footage.items():
        if not isinstance(paths, list):
            paths = [paths]

        bin_subpath = SHOT_TYPE_TO_BIN.get(shot_type.lower(), "B_ROLL/WIDE")
        bin_key = f"02_PROXIES/{bin_subpath}"
        target_bin = bins.get(bin_key) or bins.get("02_PROXIES")

        if target_bin is None:
            errors.append(f"Bin not found for shot_type '{shot_type}', skipping")
            continue

        media_pool.SetCurrentFolder(target_bin)

        valid_paths = [p for p in paths if os.path.isfile(p)]
        missing = [p for p in paths if not os.path.isfile(p)]
        if missing:
            errors.extend([f"File not found (skipped): {p}" for p in missing])

        if valid_paths:
            items = media_pool.ImportMedia(valid_paths)
            if items:
                imported_items_by_type.setdefault(shot_type, []).extend(items)
                clip_count += len(items)
            else:
                errors.append(
                    f"ImportMedia returned None/empty for shot_type '{shot_type}'"
                )

    # ---- Create metadata text file and import into 00_PROJECT_DOCS --------
    try:
        clip_counts_by_type = {k: len(v) for k, v in imported_items_by_type.items()}
        doc_lines = [
            f"Project ID: {args.project_id}",
            f"Project Name: {full_name}",
            f"Date: {datetime.date.today().isoformat()}",
            f"Creator: {args.creator_name}",
            f"Content Angle: {args.content_angle or '(not set)'}",
            "",
            "Script (first 500 chars):",
            (args.script_text[:500] if args.script_text else "(none)"),
            "",
            "Clip counts by type:",
        ]
        for t, n in clip_counts_by_type.items():
            doc_lines.append(f"  {t}: {n}")

        doc_content = "\n".join(doc_lines) + "\n"

        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".txt", delete=False,
            prefix=f"kre8r_{args.project_id}_docs_"
        ) as tmp:
            tmp.write(doc_content)
            tmp_path = tmp.name

        docs_bin = bins.get("00_PROJECT_DOCS")
        if docs_bin:
            media_pool.SetCurrentFolder(docs_bin)
            media_pool.ImportMedia([tmp_path])
        else:
            errors.append("00_PROJECT_DOCS bin not found; metadata file not imported")

        try:
            os.unlink(tmp_path)
        except OSError:
            pass

    except Exception as exc:
        errors.append(f"Metadata doc creation failed: {exc}")

    # ---- Create proxy grade timeline ---------------------------------------
    timeline_name = "01_PROXY_GRADE"
    media_pool.SetCurrentFolder(root_folder)
    timeline = media_pool.CreateEmptyTimeline(timeline_name)
    if timeline is None:
        raise RuntimeError(f"Could not create timeline '{timeline_name}'")

    # Set timeline settings
    timeline.SetSetting("timelineFrameRate", "24")
    timeline.SetSetting("timelineResolutionWidth", "3840")
    timeline.SetSetting("timelineResolutionHeight", "2160")

    project.SetCurrentTimeline(timeline)

    # ---- Add marker at frame 0 ---------------------------------------------
    try:
        timeline.AddMarker(
            0,
            "Orange",
            "CREATOR GRADE",
            "CREATOR GRADE STEP — Apply your personal look here before approving. "
            "When done, mark Grade Approved in Kre8\u03a9r to trigger rough cut assembly.",
            1
        )
    except Exception as exc:
        errors.append(f"AddMarker failed: {exc}")

    # ---- Populate timeline tracks -----------------------------------------
    # Collect talking-head + dialogue for track 1, b-roll for track 2
    track1_items = []
    track2_items = []

    for shot_type, items in imported_items_by_type.items():
        key = shot_type.lower()
        if key in ("talking_head", "dialogue"):
            track1_items.extend(items)
        elif "b_roll" in key or key in ("action", "wide", "medium", "close_up", "detail"):
            track2_items.extend(items)

    def make_clip_dicts(items):
        return [
            {"mediaPoolItem": item, "startFrame": 0, "endFrame": -1, "mediaType": 1}
            for item in items
        ]

    if track1_items:
        result = media_pool.AppendToTimeline(make_clip_dicts(track1_items))
        if not result:
            errors.append("AppendToTimeline (track 1) returned falsy")

    if track2_items:
        # Switch to video track 2 by adding a track if needed
        try:
            timeline.AddTrack("video")
        except Exception:
            pass  # track may already exist

        # AppendToTimeline with trackIndex for track 2
        clip_dicts_t2 = [
            {
                "mediaPoolItem": item,
                "startFrame": 0,
                "endFrame": -1,
                "mediaType": 1,
                "trackIndex": 2,
            }
            for item in track2_items
        ]
        result = media_pool.AppendToTimeline(clip_dicts_t2)
        if not result:
            errors.append("AppendToTimeline (track 2) returned falsy")

    # ---- Apply S-curve to track 1 clips ------------------------------------
    # "S-curve" here = lift blacks to 5%, hold mids, pull highlights to 95%.
    # Implemented via Lift (shadows) and Gain (highlights) master adjustments
    # using GetColorAdjustments / SetColorAdjustments — the reliable path in
    # Resolve 18+ scripting. Custom curve ControlPoints are not exposed via
    # the scripting API.
    #
    # GetColorAdjustments() returns a flat dict. Key names differ slightly
    # between Resolve versions, so we probe for both known formats.
    scurve_applied = 0
    try:
        # Use callable() not hasattr() — in Resolve 20 some API attributes exist
        # as None on the object, making hasattr() return True but calls raise TypeError.
        get_track_item_count = getattr(timeline, "GetTrackItemCount", None)
        track1_count = 0
        if callable(get_track_item_count):
            track1_count = get_track_item_count("video", 1) or 0
        else:
            print("[scurve] GetTrackItemCount not callable — skipping S-curve", file=sys.stderr)

        if track1_count == 0:
            print(
                "[scurve] No clips in track 1 — S-curve skipped. "
                "It will be applied when proxy footage is added via the DaVinci panel in VaultΩr.",
                file=sys.stderr
            )

        for idx in range(1, track1_count + 1):
            try:
                get_item = getattr(timeline, "GetItemInTrack", None)
                ti = get_item("video", 1, idx) if callable(get_item) else None
                if ti is None:
                    continue

                get_adj = getattr(ti, "GetColorAdjustments", None)
                if not callable(get_adj):
                    errors.append(f"Clip {idx}: GetColorAdjustments not callable on this Resolve version")
                    break

                adj = get_adj()
                if adj is None or not isinstance(adj, dict):
                    errors.append(f"Clip {idx}: GetColorAdjustments returned {adj!r}")
                    continue

                # Log key set on first clip so we can debug format differences
                if idx == 1:
                    print(f"[resolve] colorAdj keys (first 12): {list(adj.keys())[:12]}", file=sys.stderr)

                updated = False

                # Format A: flat keys with "Master" suffix (Resolve 18.x)
                if "colorAdjLiftMaster" in adj:
                    adj["colorAdjLiftMaster"] = 0.05
                    adj["colorAdjGainMaster"] = 0.95
                    updated = True

                # Format B: flat keys with "master" suffix (some builds)
                elif "colorAdjLiftmaster" in adj:
                    adj["colorAdjLiftmaster"] = 0.05
                    adj["colorAdjGainmaster"] = 0.95
                    updated = True

                # Format C: nested dicts {lift: {master: ...}, gain: {master: ...}}
                elif "lift" in adj and isinstance(adj.get("lift"), dict):
                    adj["lift"]["master"] = 0.05
                    adj["gain"]["master"] = 0.95
                    updated = True

                if updated:
                    set_adj = getattr(ti, "SetColorAdjustments", None)
                    result = set_adj(adj) if callable(set_adj) else False
                    if result:
                        scurve_applied += 1
                    else:
                        errors.append(f"Clip {idx}: SetColorAdjustments returned False")
                else:
                    errors.append(
                        f"Clip {idx}: could not find lift/gain keys in colorAdj dict. "
                        f"Keys present: {list(adj.keys())}"
                    )

            except Exception as exc:
                errors.append(f"S-curve on clip {idx}: {exc}")

    except Exception as exc:
        errors.append(f"S-curve pass skipped: {exc}")

    # ---- Save project ------------------------------------------------------
    project_manager.SaveProject()

    return {
        "ok": True,
        "project_name": full_name,
        "timeline_name": timeline_name,
        "clip_count": clip_count,
        "scurve_clips": scurve_applied,
        "resolve_version": version,
        "resolve_studio": is_studio,
        "errors": errors,
    }


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def parse_args():
    parser = argparse.ArgumentParser(
        description="Create a DaVinci Resolve project for Kre8\u03a9r"
    )
    parser.add_argument("--project_id", type=int, required=True)
    parser.add_argument("--project_name", type=str, required=True)
    parser.add_argument("--footage_json", type=str, required=True)
    parser.add_argument("--script_text", type=str, default=None)
    parser.add_argument("--content_angle", type=str, default=None)
    parser.add_argument("--creator_name", type=str, default="7 Kin Homestead")
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
