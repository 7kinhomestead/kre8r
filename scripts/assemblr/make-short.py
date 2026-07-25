# ShortΩr — AssemblΩr 2.0, organ #2 (Tier 1 shorts autopilot).
# Approved long-form in -> finished vertical short out:
#   cut segment -> 9:16 center crop (pan-able) -> whisper word timestamps ->
#   burned caption cards (ASS) -> two-pass loudnorm to DELIVERY target ->
#   NVENC encode -> QC re-measure. Output is a DRAFT for human approval —
#   the machine never posts.
#
# Usage:
#   python make-short.py --in <video> --start 0:00 --end 0:50 --out <file.mp4>
#     [--pan 0.5]           horizontal crop center, 0=left 1=right (default 0.5)
#     [--target-lufs -14] [--tp -2]      delivery loudness (shorts = final)
#     [--words-per-card 3] [--font "Arial Black"] [--font-size 84]
#     [--no-captions] [--whisper-model small] [--transcript <whisper.json>]
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

def find_bin(name):
    p = shutil.which(name)
    if p:
        return p
    pkg = {"ffmpeg": "ffmpeg-static", "ffprobe": "ffprobe-static"}.get(name)
    if pkg:
        try:
            out = subprocess.run(
                ["node", "-e", f"const m=require('{pkg}');console.log(m.path||m)"],
                capture_output=True, text=True, cwd=r"C:\Users\18054\kre8r",
                timeout=30)
            q = out.stdout.strip()
            if q and Path(q).exists():
                return q
        except Exception:
            pass
    return None

FFMPEG = find_bin("ffmpeg")
FFPROBE = find_bin("ffprobe")
if not (FFMPEG and FFPROBE):
    sys.exit("ffmpeg/ffprobe not found")

def hms_to_s(v):
    parts = [float(p) for p in str(v).split(":")]
    s = 0.0
    for p in parts:
        s = s * 60 + p
    return s

def loudnorm_measure(path):
    out = subprocess.run(
        [FFMPEG, "-hide_banner", "-nostats", "-i", str(path),
         "-af", "loudnorm=I=-14:TP=-2:LRA=11:print_format=json",
         "-f", "null", "-"], capture_output=True, text=True)
    start = out.stderr.rfind("{")
    end = out.stderr.find("}", start)
    if start < 0 or end < 0:
        return None
    try:
        return json.loads(out.stderr[start:end + 1])
    except Exception:
        return None

def whisper_words(wav, model):
    """Run whisper CLI with word timestamps; return [(start, end, word), ...]."""
    wdir = Path(tempfile.mkdtemp(prefix="shortr_wh_"))
    cmd = ["whisper", str(wav), "--model", model, "--language", "en",
           "--word_timestamps", "True", "--output_format", "json",
           "--output_dir", str(wdir), "--fp16", "True"]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        return None, f"whisper failed: {r.stderr[-300:]}"
    jfiles = list(wdir.glob("*.json"))
    if not jfiles:
        return None, "whisper produced no json"
    data = json.loads(jfiles[0].read_text(encoding="utf-8"))
    words = []
    for seg in data.get("segments", []):
        for w in seg.get("words", []):
            token = w.get("word", "").strip()
            if token:
                words.append((float(w["start"]), float(w["end"]), token))
    return words, None

def words_from_json(path, seg_start, seg_end):
    """Word (or segment) timings from an existing whisper json, re-zeroed."""
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    words = []
    for seg in data.get("segments", []):
        if seg.get("end", 0) < seg_start or seg.get("start", 0) > seg_end:
            continue
        wlist = seg.get("words") or []
        if wlist:
            for w in wlist:
                if seg_start <= float(w["start"]) <= seg_end and w.get("word", "").strip():
                    words.append((float(w["start"]) - seg_start,
                                  float(w["end"]) - seg_start, w["word"].strip()))
        else:
            # segment-level fallback: spread words evenly across the segment
            toks = [t for t in re.split(r"\s+", seg.get("text", "").strip()) if t]
            if not toks:
                continue
            s0 = max(float(seg["start"]), seg_start) - seg_start
            s1 = min(float(seg["end"]), seg_end) - seg_start
            dt = (s1 - s0) / len(toks)
            for i, t in enumerate(toks):
                words.append((s0 + i * dt, s0 + (i + 1) * dt, t))
    return words

def ass_time(t):
    cs = int(round(t * 100))
    return f"{cs // 360000}:{(cs // 6000) % 60:02d}:{(cs // 100) % 60:02d}.{cs % 100:02d}"

def build_ass(words, out_path, font, size, per_card):
    """Caption cards: N words per card, uppercase, outlined, lower third."""
    header = f"""[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 2

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Card,{font},{size},&H00FFFFFF,&H00FFFFFF,&H00000000,&H88000000,-1,0,0,0,100,100,1,0,1,7,3,2,60,60,420,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    lines = []
    card = []
    for (s, e, w) in words:
        card.append((s, e, w))
        boundary = w.rstrip().endswith((".", "!", "?", ","))
        if len(card) >= per_card or boundary:
            text = " ".join(x[2] for x in card).upper()
            text = re.sub(r"\s+", " ", text).replace("{", "").replace("}", "")
            lines.append(f"Dialogue: 0,{ass_time(card[0][0])},"
                         f"{ass_time(card[-1][1])},Card,,0,0,0,,{text}")
            card = []
    if card:
        text = " ".join(x[2] for x in card).upper()
        lines.append(f"Dialogue: 0,{ass_time(card[0][0])},"
                     f"{ass_time(card[-1][1])},Card,,0,0,0,,{text}")
    Path(out_path).write_text(header + "\n".join(lines) + "\n", encoding="utf-8")
    return len(lines)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="src", required=True)
    ap.add_argument("--start", default="0")
    ap.add_argument("--end", required=True)
    ap.add_argument("--out", dest="out", required=True)
    ap.add_argument("--pan", type=float, default=0.5)
    ap.add_argument("--reframe", choices=["static", "auto"], default="static",
                    help="auto = face-tracked camera path (dead-zone + glide "
                         "+ snap-on-cut); falls back to static pan if no face")
    ap.add_argument("--target-lufs", type=float, default=-14.0)
    ap.add_argument("--tp", type=float, default=-2.0)
    ap.add_argument("--words-per-card", type=int, default=3)
    ap.add_argument("--font", default="Arial Black")
    ap.add_argument("--font-size", type=int, default=84)
    ap.add_argument("--no-captions", action="store_true")
    ap.add_argument("--whisper-model", default="small")
    ap.add_argument("--transcript", help="existing whisper json for the FULL "
                    "source (timestamps in source time)")
    args = ap.parse_args()

    src = Path(args.src)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    t0, t1 = hms_to_s(args.start), hms_to_s(args.end)
    dur = t1 - t0
    if dur <= 0:
        sys.exit("end must be after start")
    work = Path(tempfile.mkdtemp(prefix="shortr_"))
    print(f"ShortΩr: {src.name} [{t0:.1f}s → {t1:.1f}s] → {out.name}")

    # 1. Cut the segment once (re-encode-free intermediate for measure/whisper).
    seg = work / "seg.mp4"
    subprocess.run([FFMPEG, "-y", "-hide_banner", "-nostats",
                    "-ss", str(t0), "-t", str(dur), "-i", str(src),
                    "-c:v", "copy", "-c:a", "aac", "-b:a", "320k", str(seg)],
                   capture_output=True, text=True)
    if not seg.exists() or seg.stat().st_size == 0:
        sys.exit("segment cut failed")

    # 2. Captions.
    ass_path = None
    if not args.no_captions:
        words = None
        if args.transcript:
            words = words_from_json(args.transcript, t0, t1)
            print(f"  captions: {len(words)} words from provided transcript")
        else:
            wav = work / "seg.wav"
            subprocess.run([FFMPEG, "-y", "-hide_banner", "-nostats",
                            "-i", str(seg), "-vn", "-ac", "1", "-ar", "16000",
                            str(wav)], capture_output=True, text=True)
            words, err = whisper_words(wav, args.whisper_model)
            if err:
                print(f"  captions: SKIPPED ({err.splitlines()[-1] if err else '?'})")
            else:
                print(f"  captions: {len(words)} words via whisper ({args.whisper_model})")
        if words:
            ass_path = work / "caps.ass"
            n = build_ass(words, ass_path, args.font, args.font_size,
                          args.words_per_card)
            print(f"  captions: {n} cards burned-in style ready")

    # 3. Measure loudness of the segment.
    meas = loudnorm_measure(seg)
    if not meas:
        sys.exit("loudness measure failed")
    print(f"  audio: {float(meas['input_i']):.1f} LUFS → target {args.target_lufs}")

    # 4. Final encode: crop 9:16 -> 1080x1920, captions, loudnorm linear, NVENC.
    pan = min(1.0, max(0.0, args.pan))
    vf = (f"crop=ih*9/16:ih:(iw-ih*9/16)*{pan}:0,scale=1080:1920,"
          f"setsar=1")
    subpix_keys = None
    crop_w = 0
    seg_fps = 30.0
    if args.reframe == "auto":
        vprobe = subprocess.run(
            [FFPROBE, "-v", "error", "-select_streams", "v:0",
             "-show_entries", "stream=width,height,r_frame_rate",
             "-of", "csv=p=0", str(seg)], capture_output=True, text=True)
        try:
            w_s, h_s, fr = vprobe.stdout.strip().split(",")
            src_w, src_h = int(w_s), int(h_s)
            num, den = fr.split("/")
            seg_fps = float(num) / float(den or 1)
        except Exception:
            src_w = src_h = 0
        crop_h = 0
        if src_w:
            sys.path.insert(0, str(Path(__file__).parent))
            from face_track import detect_track
            print("  reframe: tracking face…")
            res = detect_track(seg, src_w, src_h)
            if res:
                subpix_keys, crop_w, crop_h, n_shots = res
        if subpix_keys:
            print(f"  reframe: {len(subpix_keys)} sub-pixel frames · "
                  f"{n_shots} shot(s) detected · led 0.25s · nose upper third")
        else:
            print("  reframe: no face found — static pan fallback")
    if ass_path:
        ass_ff = str(ass_path).replace("\\", "/").replace(":", "\\:")
        vf += f",subtitles='{ass_ff}'"
    ln = (f"loudnorm=I={args.target_lufs}:TP={args.tp}:LRA=11:linear=true:"
          f"measured_I={meas['input_i']}:measured_TP={meas['input_tp']}:"
          f"measured_LRA={meas['input_lra']}:"
          f"measured_thresh={meas['input_thresh']}:"
          f"offset={meas['target_offset']}")
    if subpix_keys:
        # Sub-pixel path: Python warps every frame (float crop x) and pipes
        # raw video to the encoder; audio rides in from the segment file.
        from face_track import render_subpixel
        pvf = "setsar=1"
        if ass_path:
            ass_ff = str(ass_path).replace("\\", "/").replace(":", "\\:")
            pvf += f",subtitles='{ass_ff}'"
        # bgr24 in -> NVENC picks High 4:4:4 gbrp, which consumer players
        # can't decode (the Jul 23 "can't open the file"). Force 4:2:0.
        pvf += ",format=yuv420p"
        cmd = [FFMPEG, "-y", "-hide_banner", "-nostats",
               "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", "1080x1920",
               "-r", f"{seg_fps:.6f}", "-i", "pipe:0", "-i", str(seg),
               "-map", "0:v", "-map", "1:a",
               "-vf", pvf, "-af", ln, "-ar", "48000",
               "-c:v", "h264_nvenc", "-preset", "p5", "-b:v", "12M",
               "-c:a", "aac", "-b:a", "320k", "-movflags", "+faststart",
               "-shortest", str(out)]
        proc = subprocess.Popen(cmd, stdin=subprocess.PIPE,
                                stdout=subprocess.DEVNULL,
                                stderr=subprocess.PIPE)
        n = render_subpixel(seg, subpix_keys, crop_w, crop_h, 1080, 1920,
                            proc.stdin)
        proc.stdin.close()
        err = proc.stderr.read().decode(errors="replace")
        proc.wait()
        if proc.returncode != 0 or n == 0:
            sys.exit("subpixel encode failed: " + err[-400:])
        print(f"  reframe: {n} frames rendered sub-pixel")
    else:
        cmd = [FFMPEG, "-y", "-hide_banner", "-nostats", "-i", str(seg),
               "-vf", vf, "-af", ln, "-ar", "48000",
               "-c:v", "h264_nvenc", "-preset", "p5", "-b:v", "12M",
               "-c:a", "aac", "-b:a", "320k", "-movflags", "+faststart",
               str(out)]
        r = subprocess.run(cmd, capture_output=True, text=True)
        if r.returncode != 0:
            cmd = [c if c != "h264_nvenc" else "libx264" for c in cmd]
            i = cmd.index("-preset")
            cmd[i + 1] = "fast"
            cmd[cmd.index("-b:v")] = "-crf"
            cmd[cmd.index("12M")] = "19"
            r = subprocess.run(cmd, capture_output=True, text=True)
            if r.returncode != 0:
                sys.exit("encode failed: " + r.stderr[-400:])

    # 5. QC verify: trust meters, not intentions.
    check = loudnorm_measure(out)
    probe = subprocess.run(
        [FFPROBE, "-v", "error", "-select_streams", "v:0",
         "-show_entries", "stream=width,height,r_frame_rate",
         "-of", "csv=p=0", str(out)], capture_output=True, text=True)
    pixp = subprocess.run(
        [FFPROBE, "-v", "error", "-select_streams", "v:0",
         "-show_entries", "stream=pix_fmt", "-of", "csv=p=0", str(out)],
        capture_output=True, text=True).stdout.strip()
    if pixp != "yuv420p":
        print(f"  ⚠ COMPAT: pix_fmt={pixp} — consumer players may refuse "
              f"this file (want yuv420p)")
    out_lufs = float(check["input_i"]) if check else None
    mb = out.stat().st_size / 1e6
    print(f"  verify: {probe.stdout.strip()} · {out_lufs:.1f} LUFS "
          f"(target {args.target_lufs}) · {mb:.0f}MB")
    drift = abs(out_lufs - args.target_lufs) if out_lufs is not None else 99
    print(f"\n{'DRAFT READY' if drift <= 1.0 else 'DRAFT READY (loudness drift '
          + f'{drift:.1f} — check by ear)'} → {out}")
    print("Human approval required before this goes anywhere. The machine "
          "never posts.")

if __name__ == "__main__":
    main()
