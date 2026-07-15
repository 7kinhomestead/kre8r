# shotscan.py — VaultOr 2.0 detection + frame-sampling service.
# Called by src/vault/shot-worker.js. stdout = JSON ONLY, stderr = logs
# (same doctrine as scripts/davinci). Proven pipeline from shotlog2:
#   NVDEC 640p detection proxy -> AdaptiveDetector -> 60s slicing fallback
#   -> per segment: 5 frames from the ORIGINAL, Laplacian-ranked, top-N JPEGs.
#
# usage: python shotscan.py <video_path> <workdir> [--frames-per-seg 5] [--keep 3]
import argparse
import base64
import json
import subprocess
import sys
import tempfile
from pathlib import Path

import cv2

SLICE_S = 60.0

def log(m):
    print(m, file=sys.stderr, flush=True)

def ffprobe_dur(path):
    try:
        o = subprocess.check_output(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "csv=p=0", str(path)], text=True)
        return float(o.strip().rstrip(","))
    except Exception:
        return 0

def make_detect_proxy(src, dst):
    cmd = ["ffmpeg", "-y", "-v", "error", "-hwaccel", "cuda",
           "-i", str(src), "-vf", "scale=640:-2", "-an",
           "-c:v", "h264_nvenc", "-preset", "p1", "-cq", "34", str(dst)]
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=1800)
        return r.returncode == 0 and Path(dst).exists() and Path(dst).stat().st_size > 0
    except Exception:
        return False

def detect_segments(path, workdir):
    dur = ffprobe_dur(path)
    if dur <= 0:
        return [], "unreadable"
    detect_src, source = path, "original-cpu"
    proxy = Path(workdir) / (Path(path).stem + "_detect.mp4")
    if make_detect_proxy(path, proxy):
        detect_src, source = proxy, "nvdec-proxy"
    scenes = []
    try:
        from scenedetect import detect, AdaptiveDetector
        raw = detect(str(detect_src), AdaptiveDetector(), start_in_scene=True)
        scenes = [(s[0].get_seconds(), s[1].get_seconds()) for s in raw]
    except Exception as ex:
        log(f"detect error: {ex}")
    try:
        proxy.unlink(missing_ok=True)
    except Exception:
        pass
    if not scenes:
        scenes = [(0.0, dur)]
        source += "+slice-fallback"
    segs = []
    for s, e in scenes:
        if e - s <= SLICE_S * 1.5:
            segs.append((s, e))
        else:
            t = s
            while t < e:
                segs.append((t, min(t + SLICE_S, e)))
                t += SLICE_S
    return [(s, e) for s, e in segs if e - s >= 2], source

def grab_frames(path, start, end, n, keep):
    cap = cv2.VideoCapture(str(path))
    out = []
    dur = max(end - start, 0.1)
    for i in range(n):
        t = start + dur * (i + 0.5) / n
        cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000)
        ok, frame = cap.read()
        if not ok:
            continue
        sharp = cv2.Laplacian(cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY), cv2.CV_64F).var()
        out.append((sharp, t, frame))
    cap.release()
    out.sort(key=lambda x: -x[0])
    return out[:keep]

def to_jpeg_b64(frame):
    if frame.shape[1] > 896:
        h = int(frame.shape[0] * 896 / frame.shape[1])
        frame = cv2.resize(frame, (896, h))
    ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
    return base64.b64encode(buf.tobytes()).decode()

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("video")
    ap.add_argument("workdir", nargs="?", default=None)
    ap.add_argument("--frames-per-seg", type=int, default=5)
    ap.add_argument("--keep", type=int, default=3)
    args = ap.parse_args()

    workdir = args.workdir or tempfile.mkdtemp(prefix="shotscan_")
    video = Path(args.video)
    if not video.exists():
        print(json.dumps({"ok": False, "error": f"not found: {video}"}))
        sys.exit(1)

    segs, source = detect_segments(video, workdir)
    log(f"{video.name}: {len(segs)} segments via {source}")
    out_segs = []
    for idx, (s, e) in enumerate(segs):
        frames = grab_frames(video, s, e, args.frames_per_seg, args.keep)
        out_segs.append({
            "idx": idx,
            "start": round(s, 2),
            "end": round(e, 2),
            "best_sharpness": round(frames[0][0], 1) if frames else None,
            "best_frame_time": round(frames[0][1], 2) if frames else None,
            "frames_b64": [to_jpeg_b64(f) for _, _, f in frames],
        })
    print(json.dumps({"ok": True, "video": str(video), "detect_source": source,
                      "segments": out_segs}))

if __name__ == "__main__":
    main()
