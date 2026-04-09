"""
youtube_transcript.py — fetch timestamped transcript from a YouTube video.
Used by ClipsΩr when no local file is available but the video is on YouTube.

Usage:
  python youtube_transcript.py <video_id>

Output: JSON to stdout
  { "ok": true, "transcript": "full text", "segments": [{ "text": "...", "start": 0.0, "duration": 1.5 }] }
  { "ok": false, "error": "..." }
"""

import sys
import json

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"ok": False, "error": "video_id required"}))
        sys.exit(1)

    video_id = sys.argv[1].strip()

    try:
        from youtube_transcript_api import YouTubeTranscriptApi
        from youtube_transcript_api._errors import TranscriptsDisabled, NoTranscriptFound

        try:
            segments = YouTubeTranscriptApi.get_transcript(video_id, languages=['en', 'en-US', 'en-GB'])
        except NoTranscriptFound:
            # Try auto-generated
            transcript_list = YouTubeTranscriptApi.list_transcripts(video_id)
            transcript = transcript_list.find_generated_transcript(['en', 'en-US', 'en-GB'])
            segments = transcript.fetch()

        full_text = " ".join(s["text"] for s in segments)

        print(json.dumps({
            "ok": True,
            "transcript": full_text,
            "segments": segments
        }))

    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e)}))
        sys.exit(1)

if __name__ == "__main__":
    main()
