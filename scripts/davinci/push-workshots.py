"""
push-workshots.py — Kre8Ωr DaVinci Resolve integration
Pushes a set of (file, start_s, end_s, label) windows into the OPEN project:
imports media into a bin, creates a timeline, appends each window as a clip.
EP0-style delivery — no import dialogs, no relinking. The push law.

Usage:
    python push-workshots.py --json path\to\windows.json --timeline "WORK SHOTS" [--bin "exhibits"]

windows.json: [{"path": "...", "start_s": 12.5, "end_s": 24.0, "label": "..."} , ...]
stdout = JSON report; logs to stderr.
"""

import argparse
import json
import os
import sys
from pathlib import Path

def log(*a):
    print(*a, file=sys.stderr)

def bootstrap_resolve_api():
    api_path = os.environ.get(
        "RESOLVE_SCRIPT_API",
        r"C:\ProgramData\Blackmagic Design\DaVinci Resolve\Support\Developer\Scripting")
    lib_path = os.environ.get(
        "RESOLVE_SCRIPT_LIB",
        r"C:\Program Files\Blackmagic Design\DaVinci Resolve\fusionscript.dll")
    for p in (os.path.join(api_path, "Modules"), api_path):
        if p not in sys.path:
            sys.path.insert(0, p)
    os.environ.setdefault("RESOLVE_SCRIPT_LIB", lib_path)
    import DaVinciResolveScript as dvr
    return dvr.scriptapp("Resolve")

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", required=True)
    ap.add_argument("--timeline", required=True)
    ap.add_argument("--append", action="store_true",
                    help="append to the timeline if it already exists (instead of failing)")
    ap.add_argument("--bin", default="machine-pushed")
    args = ap.parse_args()

    wins = json.loads(Path(args.json).read_text(encoding="utf-8"))
    resolve = bootstrap_resolve_api()
    if not resolve:
        print(json.dumps({"ok": False, "error": "Resolve not reachable"})); return
    proj = resolve.GetProjectManager().GetCurrentProject()
    if not proj:
        print(json.dumps({"ok": False, "error": "no project open"})); return
    fps = float(proj.GetSetting("timelineFrameRate") or 30)
    mp = proj.GetMediaPool()
    root = mp.GetRootFolder()
    target = None
    for f in root.GetSubFolderList() or []:
        if f.GetName() == args.bin:
            target = f; break
    if target is None:
        target = mp.AddSubFolder(root, args.bin)
    mp.SetCurrentFolder(target)

    paths = sorted({w["path"] for w in wins})
    existing = {}
    for it in target.GetClipList() or []:
        try:
            existing[it.GetClipProperty("File Path")] = it
        except Exception:
            pass
    to_import = [p for p in paths if p not in existing]
    if to_import:
        imported = mp.ImportMedia(to_import) or []
        for it in imported:
            try:
                existing[it.GetClipProperty("File Path")] = it
            except Exception:
                pass
    log(f"media in bin: {len(existing)}")

    tl = mp.CreateEmptyTimeline(args.timeline)
    if not tl and args.append:
        for i in range(1, int(proj.GetTimelineCount()) + 1):
            t = proj.GetTimelineByIndex(i)
            if t and t.GetName() == args.timeline:
                tl = t
                log(f"appending to existing timeline: {args.timeline}")
                break
    if not tl:
        print(json.dumps({"ok": False, "error": f"timeline '{args.timeline}' exists or failed"})); return
    proj.SetCurrentTimeline(tl)

    appended, failed = 0, []
    for w in wins:
        item = existing.get(w["path"])
        if item is None:
            # fallback: match by basename
            for k, v in existing.items():
                if Path(k).name == Path(w["path"]).name:
                    item = v; break
        if item is None:
            failed.append(w.get("label", w["path"])); continue
        try:
            clip_fps = float(item.GetClipProperty("FPS") or fps)
        except Exception:
            clip_fps = fps
        ok = mp.AppendToTimeline([{
            "mediaPoolItem": item,
            "startFrame": int(w["start_s"] * clip_fps),
            "endFrame": int(w["end_s"] * clip_fps),
        }])
        if ok:
            appended += 1
        else:
            failed.append(w.get("label", w["path"]))
    print(json.dumps({"ok": True, "timeline": args.timeline, "appended": appended,
                      "failed": failed[:20], "media": len(existing)}, indent=1))

if __name__ == "__main__":
    main()
