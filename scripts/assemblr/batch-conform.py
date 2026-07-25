# ConformΩr — AssemblΩr 2.0, organ #1 (batch-conform).
# Point it at a folder of parts -> every clip comes out on ONE standard so they
# intercut clean: target fps, 48kHz audio, dialogue normalized to one loudness
# target (two-pass loudnorm, linear gain — same chain that mastered EP0).
# Video is stream-copied when already on standard (free, lossless); off-standard
# clips (phone cam2 etc.) get re-encoded to match. Matching transcripts ride
# along. Ends with a QC verify pass that re-measures every output — the report
# says PASS only when the meters agree.
#
# Usage:
#   python batch-conform.py --in <folder> --out <folder> [--target-lufs -16]
#       [--tp -3] [--fps 30] [--ar 48000] [--ext .mov,.mp4] [--dry]
#
# Parts target defaults to -16 LUFS / -3 dBTP: parts sit consistent with
# headroom; the EPISODE master (-14/-2) happens once on the full timeline —
# never master parts to the delivery target or the final pass has no room.
import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path

# Windows console defaults to cp1252 — the Ω in our own name crashes prints.
# Same charmap fix as the DaVinci scripts.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

def find_ffmpeg():
    for name in ("ffmpeg", "ffprobe"):
        pass
    ff = shutil.which("ffmpeg")
    fp = shutil.which("ffprobe")
    if ff and fp:
        return ff, fp
    # Fall back to kre8r's bundled static binaries.
    for pkg, var in (("ffmpeg-static", "ff"), ("ffprobe-static", "fp")):
        try:
            out = subprocess.run(
                ["node", "-e",
                 f"const m=require('{pkg}');console.log(m.path||m)"],
                capture_output=True, text=True, cwd=r"C:\Users\18054\kre8r",
                timeout=30)
            p = out.stdout.strip()
            if p and Path(p).exists():
                if var == "ff":
                    ff = ff or p
                else:
                    fp = fp or p
        except Exception:
            pass
    if not (ff and fp):
        sys.exit("ffmpeg/ffprobe not found (PATH or kre8r ffmpeg-static)")
    return ff, fp

FFMPEG, FFPROBE = find_ffmpeg()

def probe(path):
    out = subprocess.run(
        [FFPROBE, "-v", "error", "-show_streams", "-show_format",
         "-of", "json", str(path)],
        capture_output=True, text=True)
    info = json.loads(out.stdout or "{}")
    v = next((s for s in info.get("streams", []) if s["codec_type"] == "video"), None)
    a = next((s for s in info.get("streams", []) if s["codec_type"] == "audio"), None)
    return v, a

def measure_loudness(path):
    # loudnorm pass 1: measured values arrive as JSON on stderr.
    out = subprocess.run(
        [FFMPEG, "-hide_banner", "-nostats", "-i", str(path),
         "-af", "loudnorm=I=-16:TP=-3:LRA=11:print_format=json",
         "-f", "null", "-"],
        capture_output=True, text=True)
    # Newer ffmpeg builds print mux-summary lines AFTER the JSON block, so
    # slice the braces exactly (the loudnorm JSON is flat — no nested braces).
    start = out.stderr.rfind("{")
    end = out.stderr.find("}", start)
    if start < 0 or end < 0:
        return None
    try:
        return json.loads(out.stderr[start:end + 1])
    except Exception:
        return None

def conform(src, dst, meas, args, v):
    fps = v.get("r_frame_rate", "")
    on_std_fps = fps in (f"{args.fps}/1", str(args.fps))
    h264ish = v.get("codec_name") in ("h264", "hevc")
    copy_video = on_std_fps and h264ish
    ln = (f"loudnorm=I={args.target_lufs}:TP={args.tp}:LRA=11:linear=true:"
          f"measured_I={meas['input_i']}:measured_TP={meas['input_tp']}:"
          f"measured_LRA={meas['input_lra']}:measured_thresh={meas['input_thresh']}:"
          f"offset={meas['target_offset']}")
    cmd = [FFMPEG, "-y", "-hide_banner", "-nostats", "-i", str(src)]
    if copy_video:
        cmd += ["-c:v", "copy"]
    else:
        cmd += ["-r", str(args.fps), "-c:v", "h264_nvenc", "-preset", "p5",
                "-b:v", "10M"]
    cmd += ["-af", ln, "-ar", str(args.ar), "-c:a", "aac", "-b:a", "256k",
            str(dst)]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        # NVENC unavailable or codec refuses copy — one retry on CPU x264.
        if not copy_video or " -c:v copy" in " ".join(cmd):
            cmd2 = [c if c != "h264_nvenc" else "libx264" for c in cmd]
            if "-c:v" in cmd2 and cmd2[cmd2.index("-c:v") + 1] == "copy":
                i = cmd2.index("-c:v")
                cmd2[i + 1] = "libx264"
                cmd2[i + 2:i + 2] = ["-r", str(args.fps), "-crf", "18",
                                     "-preset", "fast"]
            r = subprocess.run(cmd2, capture_output=True, text=True)
        if r.returncode != 0:
            return False, r.stderr[-400:], copy_video
    return True, None, copy_video

def find_transcripts(src):
    hits = []
    for tdir in (src.parent / "transcripts_x", src.parent / "transcripts",
                 src.parent.parent / "transcripts_x",
                 src.parent.parent / "transcripts"):
        if tdir.is_dir():
            for ext in (".srt", ".txt"):
                t = tdir / (src.stem + ext)
                if t.exists():
                    hits.append(t)
            if hits:
                break
    return hits

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="src", required=True)
    ap.add_argument("--out", dest="out", required=True)
    ap.add_argument("--target-lufs", type=float, default=-16.0)
    ap.add_argument("--tp", type=float, default=-3.0)
    ap.add_argument("--fps", type=int, default=30)
    ap.add_argument("--ar", type=int, default=48000)
    ap.add_argument("--ext", default=".mov,.mp4,.mp3,.wav")
    ap.add_argument("--tolerance", type=float, default=1.0,
                    help="max |LUFS - target| on verify (loudnorm linear mode "
                         "trades precision for untouched dynamics)")
    ap.add_argument("--dry", action="store_true")
    args = ap.parse_args()

    src_dir, out_dir = Path(args.src), Path(args.out)
    exts = {e.strip().lower() for e in args.ext.split(",")}
    clips = sorted(p for p in src_dir.iterdir()
                   if p.is_file() and p.suffix.lower() in exts)
    if not clips:
        sys.exit(f"no clips matching {exts} in {src_dir}")
    out_dir.mkdir(parents=True, exist_ok=True)

    manifest = {"target": {"lufs": args.target_lufs, "tp": args.tp,
                           "fps": args.fps, "ar": args.ar},
                "source": str(src_dir), "clips": []}
    print(f"ConformΩr: {len(clips)} parts -> {out_dir}")
    print(f"standard: {args.fps}fps · {args.ar}Hz · {args.target_lufs} LUFS "
          f"/ {args.tp} dBTP\n")

    for src in clips:
        v, a = probe(src)
        if not v or not a:
            print(f"  SKIP {src.name}: missing {'video' if not v else 'audio'} stream")
            manifest["clips"].append({"name": src.name, "status": "skipped"})
            continue
        meas = measure_loudness(src)
        if not meas:
            print(f"  SKIP {src.name}: loudness measure failed")
            manifest["clips"].append({"name": src.name, "status": "measure-failed"})
            continue
        fps_in = v.get("r_frame_rate")
        row = {"name": src.name, "in_lufs": float(meas["input_i"]),
               "in_tp": float(meas["input_tp"]), "fps_in": fps_in,
               "ar_in": a.get("sample_rate")}
        if args.dry:
            row["status"] = "dry"
            print(f"  DRY  {src.name}: {row['in_lufs']:.1f} LUFS, {fps_in}, "
                  f"{row['ar_in']}Hz")
            manifest["clips"].append(row)
            continue
        dst = out_dir / (src.stem + "_conformed" + src.suffix)
        ok, err, copied = conform(src, dst, meas, args, v)
        if not ok:
            row["status"] = "encode-failed"
            row["error"] = err
            print(f"  FAIL {src.name}: {err.splitlines()[-1] if err else '?'}")
            manifest["clips"].append(row)
            continue
        # QC verify: re-measure the output — trust meters, not intentions.
        check = measure_loudness(dst)
        out_lufs = float(check["input_i"]) if check else None
        drift = abs(out_lufs - args.target_lufs) if out_lufs is not None else 99
        row.update({"status": "ok" if drift <= args.tolerance else "verify-drift",
                    "out": dst.name, "out_lufs": out_lufs,
                    "out_tp": float(check["input_tp"]) if check else None,
                    "video": "copied" if copied else "re-encoded"})
        for t in find_transcripts(src):
            shutil.copy2(t, out_dir / t.name)
            row.setdefault("transcripts", []).append(t.name)
        mark = "OK  " if row["status"] == "ok" else "WARN"
        print(f"  {mark} {src.name}: {row['in_lufs']:.1f} -> "
              f"{out_lufs:.1f} LUFS · video {row['video']}"
              + (f" · +{len(row.get('transcripts', []))} transcripts"
                 if row.get("transcripts") else ""))
        manifest["clips"].append(row)

    mpath = out_dir / "conform-manifest.json"
    mpath.write_text(json.dumps(manifest, indent=2))
    done = [c for c in manifest["clips"] if c.get("status") == "ok"]
    warn = [c for c in manifest["clips"] if c.get("status") == "verify-drift"]
    bad = [c for c in manifest["clips"]
           if c.get("status") in ("encode-failed", "measure-failed")]
    print(f"\n{len(done)} conformed · {len(warn)} drifted past tolerance · "
          f"{len(bad)} failed · manifest -> {mpath}")
    sys.exit(1 if bad else 0)

if __name__ == "__main__":
    main()
