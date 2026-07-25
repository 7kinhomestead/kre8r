# spine2otio — AssemblΩr's OTIO spine: turn a crew job JSON (the push-pipeline
# format: timelines[{name, picks[{path, start_s, end_s, label}]}]) into a
# standard .otio timeline file that Resolve imports directly
# (File > Import Timeline > Import AAF, EDL, XML, OTIO...).
#
# The conform superpower: --repath OLD=NEW [--strip-suffix _conformed]
# [--ext .braw] writes the SAME timeline pointing at the BRAW originals —
# import that copy at picture lock and the ReplaceClip ceremony is dead.
#
# Usage:
#   python spine2otio.py --job <job.json> --out <file.otio>
#       [--repath "H:\...\PTC-CONFORMED=D:\...\680_ptc-reshoot-jul15"]
#       [--strip-suffix _conformed] [--ext .braw] [--fps 30]
import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path

import opentimelineio as otio

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

def media_info(path):
    """(fps, duration_s) — best effort; BRAW is opaque to ffprobe (None)."""
    out = subprocess.run(
        [FFPROBE, "-v", "error", "-select_streams", "v:0", "-show_entries",
         "stream=r_frame_rate:format=duration", "-of", "json", str(path)],
        capture_output=True, text=True)
    try:
        d = json.loads(out.stdout)
        num, den = d["streams"][0]["r_frame_rate"].split("/")
        fps = float(num) / float(den or 1)
        dur = float(d["format"]["duration"])
        return fps, dur
    except Exception:
        return None, None

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--job", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--repath", default="",
                    help='OLD=NEW directory swap for the conform copy')
    ap.add_argument("--strip-suffix", default="",
                    help='remove this from filename stems (e.g. _conformed)')
    ap.add_argument("--ext", default="", help='swap extension (e.g. .braw)')
    ap.add_argument("--fps", type=float, default=30.0,
                    help="timeline rate + fallback when media is unprobeable")
    args = ap.parse_args()

    job = json.loads(Path(args.job).read_text(encoding="utf-8"))
    old_new = args.repath.split("=", 1) if "=" in args.repath else None

    def transform(p):
        p = Path(p)
        stem = p.stem
        if args.strip_suffix and stem.endswith(args.strip_suffix):
            stem = stem[: -len(args.strip_suffix)]
        name = stem + (args.ext if args.ext else p.suffix)
        if old_new:
            return Path(old_new[1]) / name
        return p.parent / name

    wrote = []
    for tl_spec in job["timelines"]:
        tl = otio.schema.Timeline(name=tl_spec["name"])
        track = otio.schema.Track(name="V1", kind=otio.schema.TrackKind.Video)
        tl.tracks.append(track)
        missing = []
        for pick in tl_spec["picks"]:
            src = transform(pick["path"])
            if not src.exists():
                missing.append(src.name)
            fps, dur = media_info(src) if src.exists() else (None, None)
            fps = fps or args.fps
            start = float(pick["start_s"])
            end = float(pick["end_s"])
            if dur:
                end = min(end, dur)
            frames = max(1, round((end - start) * fps))
            # available_range is REQUIRED: Resolve's OTIO reader and the
            # FCP7-XML builder both choke on refs without it (learned Jul 24).
            avail_dur = dur if dur else max(end, start) + 1.0
            ref = otio.schema.ExternalReference(
                target_url=str(src.resolve()) if src.exists() else str(src),
                available_range=otio.opentime.TimeRange(
                    start_time=otio.opentime.RationalTime(0, fps),
                    duration=otio.opentime.RationalTime(
                        round(avail_dur * fps), fps)))
            clip = otio.schema.Clip(
                name=pick.get("label", src.stem),
                media_reference=ref,
                source_range=otio.opentime.TimeRange(
                    start_time=otio.opentime.RationalTime(
                        round(start * fps), fps),
                    duration=otio.opentime.RationalTime(frames, fps)))
            track.append(clip)
        out_path = Path(args.out)
        if len(job["timelines"]) > 1:
            out_path = out_path.with_stem(
                out_path.stem + "-" + tl_spec["name"][:24].replace(" ", "_"))
        out_path.parent.mkdir(parents=True, exist_ok=True)
        # Write in the 0.15 schema dialect — Resolve's bundled OTIO reader
        # is older than pip's 0.18 and rejects newer schema versions.
        try:
            legacy = otio.versioning.fetch_map("OTIO_CORE", "0.15.0")
            otio.adapters.write_to_file(tl, str(out_path),
                                        target_schema_versions=legacy)
        except Exception:
            otio.adapters.write_to_file(tl, str(out_path))
        total = sum(c.source_range.duration.value / c.source_range.duration.rate
                    for c in track.find_clips())
        wrote.append(out_path)
        print(f"WROTE {out_path.name}: {len(tl_spec['picks'])} clips · "
              f"{total/60:.1f} min"
              + (f" · ⚠ {len(missing)} missing media: {missing}"
                 if missing else " · all media verified on disk"))
    return wrote

if __name__ == "__main__":
    main()
