# push-slots.py — append chosen SlotOr picks onto a video track of the
# CURRENT timeline in the CURRENT DaVinci project (the one being worked on).
# argv[1] = JSON file: { "picks": [{"path": str, "start_s": num, "end_s": num}],
#                        "track": int (default 2) }
# stdout = JSON only, stderr = logs (house convention). Resolve must be running.
import json
import sys
import time
import traceback

def log(msg):
    print(msg, file=sys.stderr, flush=True)

def out(obj):
    print(json.dumps(obj), flush=True)

def main():
    with open(sys.argv[1], encoding="utf-8") as f:
        job = json.load(f)
    picks = job.get("picks", [])
    track = int(job.get("track", 2))
    if not picks:
        out({"ok": False, "error": "no picks provided"})
        return

    try:
        import DaVinciResolveScript as dvr
    except ImportError:
        sys.path.append(r"C:\ProgramData\Blackmagic Design\DaVinci Resolve\Support\Developer\Scripting\Modules")
        import DaVinciResolveScript as dvr

    resolve = dvr.scriptapp("Resolve")
    if not resolve:
        out({"ok": False, "error": "Resolve not running (open DaVinci first)"})
        return
    pm = resolve.GetProjectManager()
    project = pm.GetCurrentProject()
    if not project:
        out({"ok": False, "error": "no current project open in Resolve"})
        return
    pool = project.GetMediaPool()

    timeline = project.GetCurrentTimeline()
    created = False
    if not timeline:
        timeline = pool.CreateEmptyTimeline("SLOTOR SELECTS") if callable(
            getattr(pool, "CreateEmptyTimeline", None)) else None
        created = timeline is not None
        if timeline and callable(getattr(project, "SetCurrentTimeline", None)):
            project.SetCurrentTimeline(timeline)
    if not timeline:
        out({"ok": False, "error": "no timeline open and could not create one"})
        return
    log(f"timeline: {timeline.GetName()} (created={created})")

    # Ensure the target video track exists
    try:
        while int(timeline.GetTrackCount("video")) < track:
            if not callable(getattr(timeline, "AddTrack", None)) or not timeline.AddTrack("video"):
                break
    except Exception as e:
        log(f"track ensure: {e}")

    # Map File Path -> media pool item (walk every folder, house pattern)
    def walk(folder, m):
        for c in folder.GetClipList() or []:
            try:
                p = c.GetClipProperty("File Path")
                if p:
                    m[p.lower()] = c
            except Exception:
                pass
        for sub in folder.GetSubFolderList() or []:
            walk(sub, m)

    items = {}
    walk(pool.GetRootFolder(), items)
    log(f"pool items mapped: {len(items)}")

    wanted = [p["path"] for p in picks]
    missing = [p for p in wanted if p.lower() not in items]
    if missing and callable(getattr(pool, "ImportMedia", None)):
        log(f"importing {len(missing)} missing files")
        try:
            pool.ImportMedia(missing)
            items = {}
            walk(pool.GetRootFolder(), items)
        except Exception as e:
            log(f"ImportMedia failed: {e}")
    still_missing = [p for p in wanted if p.lower() not in items]

    before = len(timeline.GetItemListInTrack("video", track) or [])
    appended, fell_back = 0, 0
    for p in picks:
        item = items.get(p["path"].lower())
        if not item:
            continue
        try:
            fps = float(item.GetClipProperty("FPS") or 29.97)
        except Exception:
            fps = 29.97
        try:
            total = int(float(item.GetClipProperty("Frames") or 0))
        except Exception:
            total = 0
        s = max(0, int(float(p.get("start_s", 0)) * fps))
        e = int(float(p.get("end_s", 0)) * fps) - 1
        if total:
            e = min(e, total - 1)
        if e <= s:
            e = s + int(fps)
        clip_info = {"mediaPoolItem": item, "startFrame": s, "endFrame": e,
                     "trackIndex": track, "mediaType": 1}
        res = None
        try:
            res = pool.AppendToTimeline([clip_info])
        except Exception as ex:
            log(f"append error: {ex}")
        if not res:
            # older API without trackIndex support — land on V1 rather than fail
            try:
                res = pool.AppendToTimeline([{"mediaPoolItem": item,
                                              "startFrame": s, "endFrame": e}])
                if res:
                    fell_back += 1
            except Exception as ex:
                log(f"fallback append error: {ex}")
        if res:
            appended += 1
            log(f"appended: {p['path']} [{s}-{e}]")
        time.sleep(0.25)

    after = len(timeline.GetItemListInTrack("video", track) or [])
    out({"ok": True, "timeline": timeline.GetName(), "track": track,
         "appended": appended, "verified_on_track": after - before,
         "fell_back_to_v1": fell_back, "missing": still_missing,
         "timeline_created": created})

if __name__ == "__main__":
    try:
        main()
    except Exception:
        log(traceback.format_exc())
        out({"ok": False, "error": "push-slots crashed — see stderr"})
