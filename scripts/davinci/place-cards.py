"""
place-cards.py — Kre8Ωr DaVinci Resolve integration
Places media files at specific record positions on a NEW timeline in the
OPEN project, so overlay cards land where their timestamps say.

Usage:
    python place-cards.py --json placements.json --timeline "CARDS-PLACEMENT" [--bin "CARDS"]

placements.json: [{"path": "...", "record_s": 35.0, "label": "..."}, ...]
Uses AppendToTimeline clipInfo recordFrame (Resolve 18+). stdout = JSON report.
"""
import argparse, json, os, sys
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
    ap.add_argument("--bin", default="CARDS")
    args = ap.parse_args()

    places = json.loads(Path(args.json).read_text(encoding="utf-8"))
    resolve = bootstrap_resolve_api()
    if not resolve:
        print(json.dumps({"ok": False, "error": "Resolve not reachable"}))
        return
    proj = resolve.GetProjectManager().GetCurrentProject()
    mp = proj.GetMediaPool()
    root = mp.GetRootFolder()

    # find or create the bin
    target = None
    for f in root.GetSubFolderList() or []:
        if callable(getattr(f, "GetName", None)) and f.GetName() == args.bin:
            target = f
            break
    if target is None:
        target = mp.AddSubFolder(root, args.bin)
    mp.SetCurrentFolder(target)

    # import (dedupe against what's already in the bin)
    existing = {}
    for c in target.GetClipList() or []:
        fp = c.GetClipProperty("File Path")
        if fp:
            existing[os.path.normcase(fp)] = c
    to_import = [p["path"] for p in places
                 if os.path.normcase(p["path"]) not in existing and os.path.exists(p["path"])]
    if to_import:
        for item in mp.ImportMedia(list(dict.fromkeys(to_import))) or []:
            fp = item.GetClipProperty("File Path")
            if fp:
                existing[os.path.normcase(fp)] = item
    log(f"media in bin: {len(existing)}")

    tl = mp.CreateEmptyTimeline(args.timeline)
    if not tl:
        print(json.dumps({"ok": False, "error": f"timeline '{args.timeline}' exists or create failed"}))
        return
    proj.SetCurrentTimeline(tl)
    fps = float(proj.GetSetting("timelineFrameRate") or 30)
    base = tl.GetStartFrame()

    placed, failed = 0, []
    for p in sorted(places, key=lambda x: x["record_s"]):
        item = existing.get(os.path.normcase(p["path"]))
        if not item:
            failed.append(p.get("label", p["path"]))
            continue
        rec = int(base + round(p["record_s"] * fps))
        ok = mp.AppendToTimeline([{"mediaPoolItem": item, "recordFrame": rec}])
        if ok:
            placed += 1
        else:
            failed.append(p.get("label", p["path"]))

    print(json.dumps({"ok": True, "timeline": args.timeline, "placed": placed,
                      "failed": failed, "fps": fps}, indent=1))

if __name__ == "__main__":
    main()
