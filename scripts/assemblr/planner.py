# PlanΩr — AssemblΩr Tier 2: brief + transcript corpus -> paper edit.
# Each beat in the brief gets matched to its best take-window in the corpus:
#   score = idf-weighted keyword overlap (description) + phrase-hint bonus
#           + a late-take tiebreak (keeper rule: false starts come first).
# Output: a job JSON (push-pipeline / spine2otio compatible) + a plan report
# with per-beat confidence — LOW beats are flagged for the human pass.
#
# Usage:
#   python planner.py --brief <beats.json> --corpus <transcripts_dir>
#       --media-dir <dir> [--media-suffix _conformed.mov]
#       [--timeline-name "EP1 SPINE (planned)"] [--out-dir <dir>]
#
# beats.json: [{"beat": "B2-LEDGER", "speaker": "jason",
#               "description": "opening promise ledger ...",
#               "hints": ["I have made a lot of promises"],   # optional
#               "mode": "take_end" | "window"}, ...]
import argparse
import json
import math
import re
import sys
from collections import Counter
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

STOP = set("""a an and are as at be but by for from had has have he her his i
if in is it its me my not of on or our so that the their them they this to
was we were what when where which who will with you your""".split())

def toks(text):
    return [t for t in re.findall(r"[a-z0-9']+", text.lower())
            if t not in STOP and len(t) > 2]

def norm(text):
    return re.sub(r"[^a-z0-9 ]", "", text.lower())

def load_corpus(cdir):
    corpus = {}
    for j in sorted(Path(cdir).glob("*.json")):
        try:
            segs = json.loads(j.read_text(encoding="utf-8"))["segments"]
        except Exception:
            continue
        corpus[j.stem] = [(float(s["start"]), float(s["end"]),
                           s["text"].strip()) for s in segs
                          if s.get("text", "").strip()]
    return corpus

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--brief", required=True)
    ap.add_argument("--corpus", required=True)
    ap.add_argument("--media-dir", required=True)
    ap.add_argument("--media-suffix", default="_conformed.mov")
    ap.add_argument("--timeline-name", default="PLANNED SPINE v1")
    ap.add_argument("--out-dir", default=".")
    ap.add_argument("--window-s", type=float, default=45.0)
    ap.add_argument("--preroll", type=float, default=1.5)
    ap.add_argument("--postroll", type=float, default=2.0)
    args = ap.parse_args()

    beats = json.loads(Path(args.brief).read_text(encoding="utf-8"))
    corpus = load_corpus(args.corpus)
    if not corpus:
        sys.exit("empty corpus")

    # document frequency for idf weighting (rare words carry the match)
    df = Counter()
    n_docs = 0
    for segs in corpus.values():
        for (_, _, text) in segs:
            n_docs += 1
            df.update(set(toks(text)))
    def idf(t):
        return math.log(1 + n_docs / (1 + df[t]))

    picks, report = [], []
    for beat in beats:
        want = Counter(toks(beat.get("description", "")))
        hints = [norm(h) for h in beat.get("hints", [])]
        best = None    # (score, clip, w_start, w_end, quote, seg_idx)
        for clip, segs in corpus.items():
            for i in range(len(segs)):
                w_start = segs[i][0]
                j = i
                score = 0.0
                text_all = []
                while j < len(segs) and segs[j][1] - w_start <= args.window_s:
                    text_all.append(segs[j][2])
                    j += 1
                window_text = " ".join(text_all)
                wt = Counter(toks(window_text))
                for t, c in want.items():
                    if t in wt:
                        score += idf(t) * min(c, wt[t])
                nw = norm(window_text)
                for h in hints:
                    head = " ".join(h.split()[:6])
                    if head and head in nw:
                        score += 25.0                     # hint = strong pull
                # keeper rule: later windows edge out earlier ties
                score += segs[i][0] * 0.005
                if best is None or score > best[0]:
                    best = (score, clip, w_start,
                            segs[min(j, len(segs)) - 1][1],
                            segs[i][2][:70], i)
        (score, clip, w_start, w_end, quote, _) = best
        media = Path(args.media_dir) / (clip + args.media_suffix)
        mode = beat.get("mode", "take_end")
        end_s = (corpus[clip][-1][1] + 0.5 if mode == "take_end"
                 else w_end + args.postroll)
        conf = ("HIGH" if score >= 25 else
                "MED" if score >= 8 else "LOW")
        picks.append({"path": str(media),
                      "start_s": round(max(0.0, w_start - args.preroll), 2),
                      "end_s": round(end_s, 2),
                      "label": f"{beat['beat']}: {beat.get('description','')[:60]}"})
        report.append({"beat": beat["beat"], "clip": clip,
                       "at_s": round(w_start, 1), "score": round(score, 1),
                       "confidence": conf, "opens_with": quote})
        flag = "" if conf == "HIGH" else f"  ⚠ {conf} CONFIDENCE"
        print(f"  {beat['beat']:<16} -> {clip} @ {w_start:6.1f}s "
              f"(score {score:5.1f}){flag}")
        print(f"                    \"{quote}…\"")

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    job = {"timelines": [{"name": args.timeline_name, "picks": picks}]}
    (out_dir / "planned-job.json").write_text(json.dumps(job, indent=1))
    (out_dir / "plan-report.json").write_text(json.dumps(report, indent=1))
    lows = sum(1 for r in report if r["confidence"] != "HIGH")
    print(f"\n{len(picks)} beats planned · {lows} need human review · "
          f"job + report -> {out_dir}")
    print("Next: spine2otio --job planned-job.json to make the timeline.")

if __name__ == "__main__":
    main()
