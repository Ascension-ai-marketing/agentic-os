#!/usr/bin/env python3
"""Print one YouTube video's transcript as JSON, using the public caption feed (no API quota).

Exit codes: 0 ok · 2 helper missing · 3 the video has no transcript · 4 other error (do not cache)."""
import json
import sys

video_id = sys.argv[1] if len(sys.argv) > 1 else ""
if not video_id:
    print(json.dumps({"error": "Missing video id.", "kind": "other"}))
    sys.exit(4)
try:
    from youtube_transcript_api import YouTubeTranscriptApi
    from youtube_transcript_api._errors import NoTranscriptFound, TranscriptsDisabled, VideoUnavailable
except ImportError:
    print(json.dumps({"error": "Install the transcript helper first: pip3 install youtube-transcript-api", "kind": "missing"}))
    sys.exit(2)
try:
    api = YouTubeTranscriptApi()
    try:
        fetched = api.fetch(video_id, languages=["en", "en-GB", "en-US"])
    except NoTranscriptFound:
        listing = api.list(video_id)
        fetched = next(iter(listing)).fetch()
    segments = [{"start": round(float(s.start), 2), "text": " ".join(str(s.text).split())} for s in fetched if str(s.text).strip()]
    print(json.dumps({
        "videoId": video_id,
        "language": getattr(fetched, "language_code", ""),
        "generated": bool(getattr(fetched, "is_generated", False)),
        "segments": segments,
        "text": " ".join(s["text"] for s in segments),
    }))
except (TranscriptsDisabled, NoTranscriptFound, VideoUnavailable):
    print(json.dumps({"error": "This video has no transcript.", "kind": "none"}))
    sys.exit(3)
except Exception as error:  # noqa: BLE001 - reported to the caller as text
    print(json.dumps({"error": f"{type(error).__name__}: {str(error)[:200]}", "kind": "other"}))
    sys.exit(4)
