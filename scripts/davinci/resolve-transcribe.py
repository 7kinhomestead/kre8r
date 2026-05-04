"""
resolve-transcribe.py — Kre8Ωr DaVinci Resolve transcription bridge

Uses DaVinci Resolve's built-in AI transcription (Whisper-based, frame-accurate
against the clip's actual timecodes) instead of running Whisper externally.

Advantages over external Whisper:
  - Timestamps are anchored to Resolve's internal timecode — zero drift
  - Operates directly on the MediaPoolItem so BRAW proxies work correctly
  - Resolve's model handles audio EQ/noise better than raw Whisper on proxy H.264

Cari voice filter:
  Cari feeds Jason lines at low volume while standing off-camera.
  Two filters applied before output:
    1. Dominant speaker filter — if Resolve provides speaker labels (Resolve 19+),
       keep only the speaker with the most total spoken time (that's Jason).
    2. Short isolated segment filter — segments shorter than MIN_SEG_SEC that appear
       after a gap longer than ISOLATION_GAP_SEC are likely line-feed whispers.
       Jason's natural speech never starts that way.

Output: single JSON object to stdout (Whisper-compatible schema), logs to stderr.

Called from Node.js via child_process.spawn.
Usage:
    python resolve-transcribe.py \\
        --file_path "D:/kre8r/vault/clip.mp4" \\
        [--footage_id 42] \\
        [--min_seg_sec 1.2] \\
        [--isolation_gap_sec 1.5]
"""

import sys
import os
import json
import time
import argparse
import traceback

# ─── Cari filter constants (can be overridden by CLI args) ───────────────────
DEFAULT_MIN_SEG_SEC       = 1.2    # discard segments shorter than this
DEFAULT_ISOLATION_GAP_SEC = 1.5    # after silence this long → likely Cari feed
TRANSCRIPTION_TIMEOUT_SEC = 300    # 5 min max wait for Resolve transcription
POLL_INTERVAL_SEC         = 2      # how often to check transcription status

# ─── Resolve API bootstrap (identical to all other Kre8Ωr Resolve scripts) ───

def bootstrap_resolve_api():
    api_path = os.environ.get(
        "RESOLVE_SCRIPT_API",
        r"C:\ProgramData\Blackmagic Design\DaVinci Resolve\Support\Developer\Scripting"
    )
    lib_path = os.environ.get(
        "RESOLVE_SCRIPT_LIB",
        r"C:\Program Files\Blackmagic Design\DaVinci Resolve\fusionscript.dll"
    )
    modules_path = os.path.join(api_path, "Modules")
    if modules_path not in sys.path:
        sys.path.insert(0, modules_path)
    if api_path not in sys.path:
        sys.path.insert(0, api_path)
    if sys.platform == "win32":
        lib_dir = os.path.dirname(lib_path)
        if hasattr(os, "add_dll_directory"):
            try:
                os.add_dll_directory(lib_dir)
            except Exception:
                pass
        os.environ["PATH"] = lib_dir + os.pathsep + os.environ.get("PATH", "")


def get_resolve():
    bootstrap_resolve_api()
    try:
        import DaVinciResolveScript as dvr_script
        resolve = dvr_script.scriptapp("Resolve")
        if resolve is None:
            raise RuntimeError("DaVinci Resolve returned None — is it running?")
        return resolve
    except ImportError as exc:
        raise RuntimeError(
            f"Cannot import DaVinciResolveScript: {exc}. "
            "Check RESOLVE_SCRIPT_API / RESOLVE_SCRIPT_LIB env vars."
        ) from exc


# ─── Media pool helpers ───────────────────────────────────────────────────────

def _walk_folder(folder):
    yield folder, folder.GetClipList() or []
    for sub in (folder.GetSubFolderList() or []):
        yield from _walk_folder(sub)


def find_or_import_clip(media_pool, file_path):
    """Return a MediaPoolItem for file_path, importing if not already in pool."""
    norm = file_path.lower().replace("\\", "/")
    root = media_pool.GetRootFolder()

    for _folder, clips in _walk_folder(root):
        for clip in clips:
            try:
                fp = clip.GetClipProperty("File Path") or ""
                if fp.lower().replace("\\", "/") == norm:
                    print(f"[resolve] Found in media pool: {os.path.basename(file_path)}", file=sys.stderr)
                    return clip
            except Exception:
                pass

    # Not in pool — import it
    if not os.path.isfile(file_path):
        raise FileNotFoundError(f"File not found on disk: {file_path}")

    items = media_pool.ImportMedia([file_path])
    if not items:
        raise RuntimeError(f"Resolve ImportMedia failed for: {file_path}")

    print(f"[resolve] Imported: {os.path.basename(file_path)}", file=sys.stderr)
    return items[0]


# ─── Transcription trigger + poll ────────────────────────────────────────────

def trigger_and_wait(item):
    """
    Trigger Resolve's built-in transcription and wait for completion.
    Returns True on success, raises on timeout/failure.
    """
    # Check if already transcribed (avoid re-running if Resolve cached it)
    status = _safe_call(item.GetTranscriptionStatus)
    if status == "Completed":
        print("[resolve] Transcript already present — reusing.", file=sys.stderr)
        return True

    print("[resolve] Triggering transcription…", file=sys.stderr)
    ok = _safe_call(item.TranscribeAudio)
    if ok is False:
        # Some versions return False when transcription is already queued — that's OK
        print("[resolve] TranscribeAudio returned False — may already be queued.", file=sys.stderr)

    deadline = time.time() + TRANSCRIPTION_TIMEOUT_SEC
    dots = 0
    while time.time() < deadline:
        status = _safe_call(item.GetTranscriptionStatus)
        print(f"[resolve] Transcription status: {status}", file=sys.stderr)

        if status == "Completed":
            return True
        if status == "Failed":
            raise RuntimeError("DaVinci Resolve transcription returned status: Failed")

        # Provide progress dots every 10s so Node.js SSE caller knows we're alive
        dots += 1
        if dots % 5 == 0:
            elapsed = int(time.time() - (deadline - TRANSCRIPTION_TIMEOUT_SEC))
            print(f"[progress] Waiting for Resolve transcription… {elapsed}s", file=sys.stderr)

        time.sleep(POLL_INTERVAL_SEC)

    raise TimeoutError(
        f"Resolve transcription did not complete within {TRANSCRIPTION_TIMEOUT_SEC}s. "
        "Try transcribing this clip manually in Resolve first."
    )


def _safe_call(method, *args):
    """Call a Resolve API method, returning None if it throws or doesn't exist."""
    try:
        if callable(method):
            return method(*args)
    except Exception as exc:
        print(f"[warn] API call {method} raised: {exc}", file=sys.stderr)
    return None


# ─── Transcript extraction ────────────────────────────────────────────────────

def extract_transcript(item):
    """
    Extract transcript from the MediaPoolItem after transcription completes.

    DaVinci exposes GetTranscription() in Resolve 18+.
    The return format varies:
      Resolve 18: {"words": [{"text": "word", "start": 0.0, "end": 0.4}, ...]}
      Resolve 19: as above + optional "speaker" int per word
      Some builds: list of dicts directly

    Returns a list of word dicts: [{"text", "start", "end", "speaker"(opt)}, ...]
    """
    raw = _safe_call(item.GetTranscription)

    if raw is None:
        raise RuntimeError(
            "GetTranscription() returned None. "
            "This may mean the Resolve build doesn't expose this API method, "
            "or the transcript wasn't saved. "
            "Try opening the Transcription panel in Resolve and transcribing manually first."
        )

    print(f"[resolve] GetTranscription() raw type: {type(raw).__name__}", file=sys.stderr)

    # ── Normalise to flat word list ──────────────────────────────────────────
    words = []

    if isinstance(raw, dict):
        # {"words": [...]} format
        if "words" in raw:
            words = raw["words"]
        # {"transcription": [...]} format (some versions)
        elif "transcription" in raw:
            words = raw["transcription"]
        else:
            # Unexpected dict shape — log and try to iterate values
            print(f"[warn] Unexpected dict shape: {list(raw.keys())[:10]}", file=sys.stderr)
            for v in raw.values():
                if isinstance(v, list) and len(v) > 0:
                    words = v
                    break

    elif isinstance(raw, list):
        words = raw

    else:
        raise RuntimeError(f"GetTranscription() returned unexpected type: {type(raw).__name__}")

    if not words:
        raise RuntimeError("GetTranscription() returned empty word list. "
                           "Clip may have no speech, or transcription failed silently.")

    # ── Normalise each word entry ────────────────────────────────────────────
    # Keys vary: "text"/"word"/"content", "start"/"startTime", "end"/"endTime"
    normalised = []
    for w in words:
        if not isinstance(w, dict):
            continue
        text  = (w.get("text") or w.get("word") or w.get("content") or "").strip()
        start = float(w.get("start") or w.get("startTime") or w.get("startFrame", 0) or 0)
        end   = float(w.get("end")   or w.get("endTime")   or w.get("endFrame",   0) or 0)
        spkr  = w.get("speaker")  # int or None depending on Resolve version
        if text:
            normalised.append({"text": text, "start": start, "end": end, "speaker": spkr})

    print(f"[resolve] Extracted {len(normalised)} words from transcript.", file=sys.stderr)
    return normalised


# ─── Cari voice filter ────────────────────────────────────────────────────────

def filter_cari_voice(words, min_seg_sec, isolation_gap_sec):
    """
    Two-pass filter to remove Cari's off-camera line-feeds.

    Pass 1 — Dominant speaker filter (Resolve 19+ speaker diarization):
      If any word has a speaker label, compute total speech time per speaker.
      Keep only the dominant speaker (Jason — most words / most total time).
      Cari's line-feeds will be a small fraction of total speaking time.

    Pass 2 — Short isolated segment filter (works even without speaker labels):
      Group words into utterance segments (gap > isolation_gap_sec → new segment).
      Discard segments shorter than min_seg_sec total duration.
      Rationale: Cari says ~3 words to cue Jason. Jason's natural replies run 2–15s.
      A segment that appears after silence and lasts < 1.2s is almost certainly Cari.

    Returns filtered word list.
    """
    if not words:
        return words

    # ── Pass 1: dominant speaker ─────────────────────────────────────────────
    speakers_present = set(w["speaker"] for w in words if w["speaker"] is not None)

    if len(speakers_present) > 1:
        print(f"[filter] Speaker diarization found: {sorted(speakers_present)}", file=sys.stderr)

        # Compute total spoken duration per speaker
        speaker_time = {}
        for w in words:
            s = w["speaker"]
            if s is None:
                continue
            dur = max(0.0, w["end"] - w["start"])
            speaker_time[s] = speaker_time.get(s, 0.0) + dur

        dominant = max(speaker_time, key=speaker_time.get)
        print(
            f"[filter] Speaker times: { {k: round(v,1) for k,v in speaker_time.items()} }",
            file=sys.stderr
        )
        print(f"[filter] Dominant speaker: {dominant} (Jason) — filtering others.", file=sys.stderr)

        before = len(words)
        words  = [w for w in words if w["speaker"] is None or w["speaker"] == dominant]
        print(f"[filter] Pass 1: removed {before - len(words)} words from non-dominant speakers.", file=sys.stderr)
    else:
        print("[filter] Pass 1: no speaker diarization — skipping dominant speaker filter.", file=sys.stderr)

    # ── Pass 2: short isolated segment filter ────────────────────────────────
    # Group words into utterances (gap > isolation_gap_sec = new utterance)
    utterances = []
    current    = []
    for w in words:
        if current and (w["start"] - current[-1]["end"]) > isolation_gap_sec:
            utterances.append(current)
            current = []
        current.append(w)
    if current:
        utterances.append(current)

    print(f"[filter] Pass 2: {len(utterances)} utterance segments found.", file=sys.stderr)

    kept_words = []
    dropped_segs = 0
    for utt in utterances:
        duration = utt[-1]["end"] - utt[0]["start"]
        if duration < min_seg_sec:
            # Only drop if it follows a meaningful gap (isolation pattern)
            dropped_segs += 1
            print(
                f"[filter] Dropped {len(utt)}-word utterance at {utt[0]['start']:.2f}s "
                f"({duration:.2f}s): '{' '.join(w['text'] for w in utt[:5])}'",
                file=sys.stderr
            )
        else:
            kept_words.extend(utt)

    print(f"[filter] Pass 2: removed {dropped_segs} short isolated utterances.", file=sys.stderr)
    return kept_words


# ─── Words → segments ────────────────────────────────────────────────────────

def words_to_segments(words, gap_threshold=0.8):
    """
    Group word list into sentence-like segments (gap > gap_threshold → new segment).
    Returns segments in the Whisper output schema:
      [{ id, start, end, text, words: [{word, start, end, probability}] }]
    """
    if not words:
        return []

    segments = []
    current  = []

    for w in words:
        if current and (w["start"] - current[-1]["end"]) > gap_threshold:
            segments.append(current)
            current = []
        current.append(w)
    if current:
        segments.append(current)

    result = []
    for i, seg_words in enumerate(segments):
        text  = " ".join(w["text"] for w in seg_words).strip()
        start = round(seg_words[0]["start"],  3)
        end   = round(seg_words[-1]["end"],   3)
        result.append({
            "id":    i,
            "start": start,
            "end":   end,
            "text":  text,
            "words": [
                {
                    "word":        w["text"],
                    "start":       round(w["start"], 3),
                    "end":         round(w["end"],   3),
                    "probability": 1.0  # Resolve doesn't expose confidence per word
                }
                for w in seg_words
            ]
        })

    return result


# ─── Text fixes specific to 7 Kin Homestead ─────────────────────────────────

def fix_transcript_text(t):
    """Correct known Resolve mis-transcriptions for this creator."""
    replacements = [
        ("Rockridge",   "Rock Rich"),
        ("rock ridge",  "Rock Rich"),
        ("rock-ridge",  "Rock Rich"),
        ("Rock Reach",  "Rock Rich"),
    ]
    for wrong, right in replacements:
        t = t.replace(wrong, right)
    return t


# ─── Main ─────────────────────────────────────────────────────────────────────

def run(args):
    file_path    = os.path.normpath(args.file_path)
    footage_id   = args.footage_id
    min_seg_sec  = args.min_seg_sec
    iso_gap_sec  = args.isolation_gap_sec

    print(f"[resolve-transcribe] file: {file_path}", file=sys.stderr)
    print(f"[resolve-transcribe] footage_id: {footage_id}", file=sys.stderr)

    # Connect to Resolve
    resolve         = get_resolve()
    project_manager = resolve.GetProjectManager()
    if not project_manager:
        raise RuntimeError("Could not get ProjectManager from Resolve.")

    project = project_manager.GetCurrentProject()
    if not project:
        raise RuntimeError("No project is open in DaVinci Resolve. Open a project and try again.")

    media_pool = project.GetMediaPool()
    if not media_pool:
        raise RuntimeError("Could not get MediaPool from project.")

    # Find / import the clip
    item = find_or_import_clip(media_pool, file_path)

    # Trigger transcription and wait
    trigger_and_wait(item)

    # Extract word-level data
    words = extract_transcript(item)

    # Apply Cari voice filter
    words = filter_cari_voice(words, min_seg_sec, iso_gap_sec)

    if not words:
        raise RuntimeError(
            "No words remain after filtering. "
            "The clip may contain only Cari's voice, or transcription returned empty results."
        )

    # Group into segments
    segments = words_to_segments(words)

    # Apply text fixes
    full_text = fix_transcript_text(" ".join(s["text"] for s in segments).strip())
    for seg in segments:
        seg["text"] = fix_transcript_text(seg["text"])
        for w in seg.get("words", []):
            w["word"] = fix_transcript_text(w["word"])

    duration = round(segments[-1]["end"], 3) if segments else 0.0

    result = {
        "ok":         True,
        "footage_id": footage_id,
        "file_path":  file_path,
        "language":   "en",
        "text":       full_text,
        "duration":   duration,
        "segments":   segments,
        "_source":    "resolve",
    }

    print(
        f"[resolve-transcribe] Done. {len(segments)} segments, "
        f"{len(words)} words, {duration:.1f}s",
        file=sys.stderr
    )

    # Single JSON object to stdout — Node.js reads this
    print(json.dumps(result))
    return result


# ─── Entry point ──────────────────────────────────────────────────────────────

def parse_args():
    p = argparse.ArgumentParser(description="Transcribe a clip via DaVinci Resolve's built-in AI")
    p.add_argument("--file_path",         type=str,   required=True,
                   help="Absolute path to the video file (proxy or original)")
    p.add_argument("--footage_id",        type=int,   default=None,
                   help="VaultΩr footage_id (included in output JSON for DB write)")
    p.add_argument("--min_seg_sec",       type=float, default=DEFAULT_MIN_SEG_SEC,
                   help="Minimum utterance duration in seconds (shorter = likely Cari)")
    p.add_argument("--isolation_gap_sec", type=float, default=DEFAULT_ISOLATION_GAP_SEC,
                   help="Gap before a segment that makes it a candidate for Cari filtering")
    return p.parse_args()


if __name__ == "__main__":
    try:
        args   = parse_args()
        result = run(args)
    except Exception as exc:
        traceback.print_exc(file=sys.stderr)
        print(json.dumps({"ok": False, "error": str(exc)}))
        sys.exit(1)
