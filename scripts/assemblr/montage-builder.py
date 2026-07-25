# MontagΩr — build a work-montage pick list from a b-roll bin under the
# montage laws (binder 25 / montage-rules.json):
#   duration band per act profile · varied not metronomic · accelerating
#   (2nd half shorter) · ≤2 windows per clip · capped total.
# Deterministic (no randomness — reproducible builds). Emits a job-fragment
# JSON: {"picks":[{path,start_s,end_s,label}]}
#
# Usage:
#   python montage-builder.py --bin <dir> --band 2 4 --total-s 45
#       --label "DUMP-GRIND" --out <fragment.json>
import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

def find_ffprobe():
    p = shutil.which("ffprobe")
    if p:
        return p
    out = subprocess.run(
        ["node", "-e", "const m=require('ffprobe-static');console.log(m.path)"],
        capture_output=True, text=True, cwd=r"C:\Users\18054\kre8r", timeout=30)
    return out.stdout.strip()

FFPROBE = find_ffprobe()
EXTS = {".mov", ".mp4", ".mxf", ".avi"}

def duration(path):
    out = subprocess.run([FFPROBE, "-v", "error", "-show_entries",
                          "format=duration", "-of", "csv=p=0", str(path)],
                         capture_output=True, text=True)
    try:
        return float(out.stdout.strip())
    except Exception:
        return 0.0

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--bin", dest="bin_dir", required=True)
    ap.add_argument("--band", nargs=2, type=float, default=[2.0, 4.0])
    ap.add_argument("--total-s", type=float, default=45.0)
    ap.add_argument("--label", default="MONTAGE")
    ap.add_argument("--out", required=True)
    ap.add_argument("--max-per-clip", type=int, default=2)
    ap.add_argument("--tx-dir", action="append", default=[],
                    help="transcript dirs; windows overlapping speech are avoided")
    ap.add_argument("--duck", action="store_true",
                    help="mark picks duck:true (renderer lowers audio)")
    args = ap.parse_args()

    import re as _re
    def speech_map(clip):
        cands = [clip.stem]
        m = _re.match(r"^\d{4}_(.+)$", clip.stem)
        if m: cands.append(m.group(1))
        for c in list(cands):
            if c.startswith("PROXY_"): cands.append(c[6:])
        for d in args.tx_dir:
            for c in cands:
                f = Path(d) / (c + ".json")
                if f.exists():
                    segs = json.loads(f.read_text(encoding="utf-8"))["segments"]
                    return [(float(x["start"]), float(x["end"])) for x in segs]
        return None

    lo, hi = sorted(args.band)
    clips = sorted(p for p in Path(args.bin_dir).iterdir()
                   if p.suffix.lower() in EXTS)
    if not clips:
        sys.exit("empty bin: " + args.bin_dir)
    durs = {c: duration(c) for c in clips}
    clips = [c for c in clips if durs[c] >= lo + 0.5]

    mean = (lo + hi) / 2.0
    n = max(4, round(args.total_s / mean))
    # Accelerating envelope hi->lo with alternating ±15% jitter (law: varied,
    # never metronomic; 2nd-half mean < 1st-half mean).
    shot_durs = []
    for i in range(n):
        base = hi - (hi - lo) * (i / max(1, n - 1))
        jit = 0.15 * base * (1 if i % 2 == 0 else -1) * (0.5 + (i % 3) / 4)
        d = min(hi, max(lo, base + jit))
        shot_durs.append(round(d, 2))

    picks = []
    use_count = {c: 0 for c in clips}
    ci = 0
    for i, d in enumerate(shot_durs):
        # next clip with quota left; skip the clip just used (variety law)
        tries = 0
        while tries <= len(clips):
            c = clips[ci % len(clips)]
            ci += 1
            if use_count[c] < args.max_per_clip and (
                    not picks or Path(picks[-1]["path"]) != c):
                break
            tries += 1
        else:
            break
        use_count[c] += 1
        # window placement: 1st use at 1/3 of clip, 2nd at 2/3 (spread, avoids
        # slates at heads and tails) — then slide to a SILENT window if the
        # clip has a transcript (montage speech law)
        frac = 1 / 3 if use_count[c] == 1 else 2 / 3
        start = max(0.0, min(durs[c] - d - 0.5, durs[c] * frac))
        sm = speech_map(c)
        if sm:
            def overlaps(a, b):
                return any(not (b <= s0 or a >= e0) for (s0, e0) in sm)
            if overlaps(start, start + d):
                step_scan = max(0.5, d / 2)
                t = 0.5
                best = None
                while t + d < durs[c] - 0.5:
                    if not overlaps(t, t + d):
                        if best is None or abs(t - start) < abs(best - start):
                            best = t
                    t += step_scan
                if best is not None:
                    start = best
        pk = {"path": str(c), "start_s": round(start, 2),
              "end_s": round(start + d, 2),
              "label": f"{args.label} #{i+1} ({d}s)"}
        if args.duck:
            pk["duck"] = True
        picks.append(pk)

    total = sum(p["end_s"] - p["start_s"] for p in picks)
    first = [p["end_s"] - p["start_s"] for p in picks[: len(picks) // 2]]
    second = [p["end_s"] - p["start_s"] for p in picks[len(picks) // 2:]]
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text(json.dumps({"picks": picks}, indent=1))
    print(f"{args.label}: {len(picks)} shots · {total:.0f}s · "
          f"ASL {total/len(picks):.1f}s · "
          f"halves {sum(first)/len(first):.1f}s -> "
          f"{sum(second)/len(second):.1f}s (accelerating: "
          f"{sum(second)/len(second) < sum(first)/len(first)}) -> {args.out}")

if __name__ == "__main__":
    main()
