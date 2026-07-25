# AutoShortΩr — AssemblΩr Tier 4 pilot: the self-directed short.
# The machine CHOOSES a segment from the transcript, renders it via ShortΩr,
# JUDGES its own output with critics, and REVISES until the critics plateau.
#   choose -> make -> judge -> fix -> stop when nothing improves.
# Output is a DRAFT + a scorecard. The machine never posts.
#
# Usage:
#   python autoshort.py --source <video> --transcript <whisper.json>
#       --out-dir <dir> [--min 25] [--max 60] [--rounds 3]
#       [--avoid "0-100,139-203,329-358"]   (ranges already used as shorts)
import argparse
import json
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

HERE = Path(__file__).parent
MAKE_SHORT = HERE / "make-short.py"
YUNET = HERE / "models" / "face_detection_yunet_2023mar.onnx"

def find_bin(name):
    p = shutil.which(name)
    if p:
        return p
    pkg = {"ffmpeg": "ffmpeg-static", "ffprobe": "ffprobe-static"}[name]
    out = subprocess.run(
        ["node", "-e", f"const m=require('{pkg}');console.log(m.path||m)"],
        capture_output=True, text=True, cwd=r"C:\Users\18054\kre8r", timeout=30)
    return out.stdout.strip()

FFMPEG, FFPROBE = find_bin("ffmpeg"), find_bin("ffprobe")

# ── CHOOSE: hook-score transcript windows ────────────────────────────────
HOOK_PATTERNS = [
    (r"\$?\d[\d,]*", 2.0),                     # numbers and money
    (r"\byou\b|\byour\b", 1.0),                # second person
    (r"\?", 1.5),                              # questions
    (r"\bnever\b|\bevery\b|\bonly\b|\bnobody\b|\bmost\b", 1.0),
    (r"\bsecret\b|\bnobody saw\b|\bhere's what\b|\bturns out\b", 1.5),
    (r"\bcrazy\b|\bamazed\b|\bfoolish\b|\bpucker\b|\bfailed\b", 1.2),
]

def seg_score(text):
    s = 0.0
    for (pat, w) in HOOK_PATTERNS:
        s += w * len(re.findall(pat, text, re.I))
    return s

def parse_ranges(spec):
    out = []
    for part in (spec or "").split(","):
        part = part.strip()
        if "-" in part:
            a, b = part.split("-")
            out.append((float(a), float(b)))
    return out

def overlaps(a0, a1, ranges):
    return any(not (a1 <= r0 or a0 >= r1) for (r0, r1) in ranges)

def choose_window(segments, min_s, max_s, avoid):
    best = None
    for i in range(len(segments)):
        t0 = segments[i]["start"]
        j = i
        while j < len(segments) and segments[j]["end"] - t0 <= max_s:
            t1 = segments[j]["end"]
            if t1 - t0 >= min_s and re.search(r"[.!?]\s*$",
                                              segments[j]["text"].strip() + " "):
                if not overlaps(t0, t1, avoid):
                    score = sum(seg_score(s["text"])
                                for s in segments[i:j + 1])
                    # favor strong FIRST line — the hook is the opener
                    score += 1.5 * seg_score(segments[i]["text"])
                    if best is None or score > best[0]:
                        best = (score, t0, t1,
                                segments[i]["text"].strip()[:80])
            j += 1
    return best

# ── JUDGE: critics on a rendered short ───────────────────────────────────
def measure_loudness(path):
    out = subprocess.run(
        [FFMPEG, "-hide_banner", "-nostats", "-i", str(path), "-af",
         "loudnorm=I=-14:TP=-2:LRA=11:print_format=json", "-f", "null", "-"],
        capture_output=True, text=True)
    s = out.stderr.rfind("{")
    e = out.stderr.find("}", s)
    try:
        return float(json.loads(out.stderr[s:e + 1])["input_i"])
    except Exception:
        return None

def whisper_words(video, model="small"):
    wdir = Path(tempfile.mkdtemp(prefix="ashort_"))
    wav = wdir / "a.wav"
    subprocess.run([FFMPEG, "-y", "-hide_banner", "-nostats", "-i",
                    str(video), "-vn", "-ac", "1", "-ar", "16000", str(wav)],
                   capture_output=True)
    r = subprocess.run(["whisper", str(wav), "--model", model, "--language",
                        "en", "--word_timestamps", "True", "--output_format",
                        "json", "--output_dir", str(wdir), "--fp16", "True"],
                       capture_output=True, text=True)
    jf = list(wdir.glob("*.json"))
    if r.returncode != 0 or not jf:
        return []
    data = json.loads(jf[0].read_text(encoding="utf-8"))
    words = []
    for seg in data.get("segments", []):
        for w in seg.get("words", []):
            if w.get("word", "").strip():
                words.append((float(w["start"]), float(w["end"])))
    return words

def video_duration(path):
    out = subprocess.run([FFPROBE, "-v", "error", "-show_entries",
                          "format=duration", "-of", "csv=p=0", str(path)],
                         capture_output=True, text=True)
    try:
        return float(out.stdout.strip())
    except Exception:
        return 0.0

def framing_score(path):
    import cv2
    cap = cv2.VideoCapture(str(path))
    if not cap.isOpened():
        return None
    n = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 1
    det = cv2.FaceDetectorYN_create(str(YUNET), "", (270, 480),
                                    score_threshold=0.6)
    hits, offs = 0, []
    samples = 8
    for k in range(samples):
        cap.set(cv2.CAP_PROP_POS_FRAMES, int(n * (k + 0.5) / samples))
        ok, fr = cap.read()
        if not ok:
            continue
        small = cv2.resize(fr, (270, 480))
        det.setInputSize((270, 480))
        _, faces = det.detect(small)
        if faces is not None and len(faces):
            best = max(faces, key=lambda f: f[14])
            cx = float(best[0] + best[2] / 2.0) / 270.0
            cy = float(best[1] + best[3] * 0.3) / 480.0
            offs.append(abs(cx - 0.5) + abs(cy - 1.0 / 3.0))
            hits += 1
    cap.release()
    # plain floats only — numpy float32 is not JSON serializable
    return {"face_pct": round(hits / samples, 2),
            "mean_off": (round(float(sum(offs) / len(offs)), 3)
                         if offs else None)}

def judge(path):
    dur = video_duration(path)
    words = whisper_words(path)
    card = {"duration": round(dur, 1), "lufs": measure_loudness(path)}
    if words:
        card["hook_onset"] = round(words[0][0], 2)
        card["tail_gap"] = round(dur - words[-1][1], 2)
        gaps = [round(words[i + 1][0] - words[i][1], 2)
                for i in range(len(words) - 1)]
        card["longest_gap"] = max(gaps) if gaps else 0.0
    else:
        card["hook_onset"] = card["tail_gap"] = card["longest_gap"] = None
    fr = framing_score(path)
    if fr:
        card.update(fr)
    # verdicts
    v = {}
    v["hook"] = "PASS" if (card["hook_onset"] is not None
                           and card["hook_onset"] <= 1.0) else "FIX"
    v["tail"] = "PASS" if (card["tail_gap"] is not None
                           and card["tail_gap"] <= 1.5) else "FIX"
    v["loudness"] = "PASS" if (card["lufs"] is not None
                               and abs(card["lufs"] + 14.0) <= 1.0) else "FIX"
    v["framing"] = "PASS" if (card.get("mean_off") is None
                              or card["mean_off"] <= 0.16) else "WARN"
    card["verdicts"] = v
    return card

# ── LOOP ─────────────────────────────────────────────────────────────────
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", required=True)
    ap.add_argument("--transcript", required=True)
    ap.add_argument("--out-dir", required=True)
    ap.add_argument("--min", dest="min_s", type=float, default=25.0)
    ap.add_argument("--max", dest="max_s", type=float, default=60.0)
    ap.add_argument("--rounds", type=int, default=3)
    ap.add_argument("--avoid", default="")
    args = ap.parse_args()

    segs = json.loads(Path(args.transcript).read_text(
        encoding="utf-8"))["segments"]
    pick = choose_window(segs, args.min_s, args.max_s,
                         parse_ranges(args.avoid))
    if not pick:
        sys.exit("no viable window found")
    (score, t0, t1, opener) = pick
    print(f"CHOSE [{t0:.1f}s → {t1:.1f}s] score {score:.1f}")
    print(f'  opener: "{opener}…"')

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    history = []
    for rnd in range(1, args.rounds + 1):
        out = out_dir / f"AUTOSHORT-r{rnd}.mp4"
        print(f"\nROUND {rnd}: render [{t0:.1f} → {t1:.1f}]")
        r = subprocess.run([sys.executable, str(MAKE_SHORT), "--in",
                            args.source, "--start", str(t0), "--end",
                            str(t1), "--reframe", "auto", "--out", str(out)],
                           capture_output=True, text=True)
        if r.returncode != 0:
            sys.exit("render failed: " + r.stdout[-300:] + r.stderr[-300:])
        card = judge(out)
        history.append({"round": rnd, "start": round(t0, 2),
                        "end": round(t1, 2), "card": card})
        v = card["verdicts"]
        print("  judge:", " ".join(f"{k}={x}" for k, x in v.items()),
              f"| onset {card['hook_onset']}s · tail {card['tail_gap']}s · "
              f"{card['lufs']} LUFS · face {card.get('face_pct')}")
        fixes = 0
        if v["hook"] == "FIX" and card["hook_onset"]:
            t0 += max(0.0, card["hook_onset"] - 0.4)
            fixes += 1
        if v["tail"] == "FIX" and card["tail_gap"]:
            t1 -= max(0.0, card["tail_gap"] - 0.8)
            fixes += 1
        if fixes == 0:
            print(f"\nCRITICS SATISFIED after round {rnd}")
            break
        print(f"  revise: {fixes} note(s) → new window "
              f"[{t0:.1f} → {t1:.1f}]")
    (out_dir / "autoshort-scorecard.json").write_text(
        json.dumps(history, indent=1))
    print(f"\nDRAFT + scorecard → {out_dir}")
    print("Human approval required before this goes anywhere. "
          "The machine never posts.")

if __name__ == "__main__":
    main()
