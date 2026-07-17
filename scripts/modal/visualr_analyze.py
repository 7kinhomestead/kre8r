#!/usr/bin/env python3
"""
VisualΩr — Modal.com frame analysis script
Kre8Ωr visual intelligence engine.

Called by Node.js via subprocess:
  python -m modal run scripts/modal/visualr_analyze.py

Payload path passed via env var VISUALR_PAYLOAD_FILE (set by Node.js).

Payload JSON:
{
  "frames": [{ "b64": "<jpeg base64>", "timestamp_s": 12.5 }],
  "video_id": "footage_42",
  "title": "My Video Title"
}

Output (stdout): JSON with per-frame feature vectors + aggregate summary.
Stderr: human-readable progress logs (Node reads stdout only).
"""

import modal
import json
import sys

app = modal.App("kre8r-visualr")

# Container image — OpenCV + MediaPipe for face/scene detection
image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install([
        "opencv-python-headless==4.9.0.80",
        "mediapipe==0.10.11",
        "numpy>=1.24",
    ])
)


@app.function(image=image, timeout=600)
def analyze_frames(frames_data: list) -> dict:
    """
    Analyze a list of base64-encoded JPEG frames for visual intelligence signals.
    Entire body wrapped in try/except — returns {"error": ...} on failure instead of crashing.
    """
    import cv2
    import numpy as np
    import base64
    import sys
    import traceback

    try:
        # ── MediaPipe face detection ──────────────────────────────────────────
        try:
            import mediapipe as mp
            _mp_face      = mp.solutions.face_detection
            face_detector = _mp_face.FaceDetection(min_detection_confidence=0.4, model_selection=1)
            use_mediapipe = True
            print("[visualr] MediaPipe face detection loaded", file=sys.stderr)
        except Exception as e:
            use_mediapipe = False
            face_detector = None
            print(f"[visualr] MediaPipe unavailable ({e}) — skipping face detection", file=sys.stderr)

        frame_results = []

        for item in frames_data:
            try:
                b64_data  = item.get("b64", "")
                timestamp = item.get("timestamp_s", 0.0)

                # Decode JPEG frame
                img_bytes = base64.b64decode(b64_data)
                img_array = np.frombuffer(img_bytes, dtype=np.uint8)
                frame     = cv2.imdecode(img_array, cv2.IMREAD_COLOR)
                if frame is None:
                    continue

                h, w = frame.shape[:2]

                # ── Face detection ────────────────────────────────────────────
                has_face      = False
                face_count    = 0
                face_size     = 0.0
                face_center_x = 0.5
                face_in_upper = False

                if use_mediapipe and face_detector:
                    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                    det = face_detector.process(rgb)
                    if det.detections:
                        has_face   = True
                        face_count = len(det.detections)
                        for d in det.detections:
                            bb   = d.location_data.relative_bounding_box
                            area = float(bb.width) * float(bb.height)
                            if area > face_size:
                                face_size     = area
                                face_center_x = float(bb.xmin) + float(bb.width) / 2
                                face_center_y = float(bb.ymin) + float(bb.height) / 2
                                face_in_upper = bool(face_center_y < 0.5)

                # ── Color analysis ────────────────────────────────────────────
                hsv        = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
                brightness = float(np.mean(hsv[:, :, 2])) / 255.0
                saturation = float(np.mean(hsv[:, :, 1])) / 255.0

                b_ch, g_ch, r_ch = cv2.split(frame.astype(np.float32))
                warm_score = float((np.mean(r_ch) - np.mean(b_ch)) / 255.0)

                # ── Visual energy — edge density ──────────────────────────────
                gray         = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
                edges        = cv2.Canny(gray, 50, 150)
                edge_density = float(np.sum(edges > 0)) / float(h * w)

                # ── Outdoor heuristic — sky in upper third ────────────────────
                upper     = frame[:h // 3, :, :]
                upper_hsv = cv2.cvtColor(upper, cv2.COLOR_BGR2HSV)
                sky_mask  = cv2.inRange(upper_hsv,
                                        np.array([85, 20, 80]),
                                        np.array([145, 255, 255]))
                outdoor_score = float(np.sum(sky_mask > 0)) / float(max(1, upper.shape[0] * upper.shape[1]))

                # ── Green/nature coverage ─────────────────────────────────────
                green_mask  = cv2.inRange(hsv,
                                          np.array([35, 30, 30]),
                                          np.array([85, 255, 200]))
                green_score = float(np.sum(green_mask > 0)) / float(max(1, h * w))

                # ── Framing ───────────────────────────────────────────────────
                is_center_framed = bool(has_face and (0.28 < face_center_x < 0.72))

                frame_results.append({
                    "timestamp_s":      round(float(timestamp), 2),
                    "has_face":         bool(has_face),
                    "face_count":       int(face_count),
                    "face_size":        round(float(face_size), 4),
                    "face_in_upper":    bool(face_in_upper),
                    "is_center_framed": bool(is_center_framed),
                    "brightness":       round(brightness, 3),
                    "saturation":       round(saturation, 3),
                    "warm_score":       round(warm_score, 3),
                    "edge_density":     round(edge_density, 4),
                    "outdoor_score":    round(outdoor_score, 3),
                    "green_score":      round(green_score, 3),
                })

            except Exception as e:
                frame_results.append({
                    "timestamp_s": float(item.get("timestamp_s", 0)),
                    "error":       str(e),
                })

        if face_detector:
            try:
                face_detector.close()
            except Exception:
                pass

        # ── Aggregate summary ─────────────────────────────────────────────────
        valid = [f for f in frame_results if "error" not in f]

        def mean_field(key):
            vals = [f[key] for f in valid if key in f]
            return round(float(sum(vals) / len(vals)), 3) if vals else 0.0

        face_frames  = [f for f in valid if f.get("has_face")]
        face_pct     = float(len(face_frames)) / float(len(valid)) if valid else 0.0

        opening_n    = max(1, len(valid) // 10)
        opening      = valid[:opening_n]
        opening_face = float(sum(1 for f in opening if f.get("has_face"))) / float(len(opening)) if opening else 0.0
        opening_warm = float(sum(f.get("warm_score", 0) for f in opening)) / float(len(opening)) if opening else 0.0
        opening_out  = float(sum(f.get("outdoor_score", 0) for f in opening)) / float(len(opening)) if opening else 0.0

        summary = {
            "total_frames_analyzed": int(len(valid)),
            "face_presence_pct":     round(face_pct, 3),
            "opening_face_pct":      round(opening_face, 3),
            "opening_warm_score":    round(opening_warm, 3),
            "opening_outdoor_score": round(opening_out, 3),
            "avg_brightness":        mean_field("brightness"),
            "avg_saturation":        mean_field("saturation"),
            "avg_warm_score":        mean_field("warm_score"),
            "avg_edge_density":      mean_field("edge_density"),
            "avg_outdoor_score":     mean_field("outdoor_score"),
            "avg_green_score":       mean_field("green_score"),
            "center_framed_pct":     round(
                float(sum(1 for f in valid if f.get("is_center_framed"))) / float(len(valid)), 3
            ) if valid else 0.0,
        }

        print(f"[visualr] Analyzed {len(valid)} frames. Face present {face_pct:.0%} of video.", file=sys.stderr)
        return {"frames": frame_results, "summary": summary}

    except Exception as e:
        tb = traceback.format_exc()
        print(f"[visualr] FATAL: {e}\n{tb}", file=sys.stderr)
        return {"error": str(e), "traceback": tb[:2000], "frames": [], "summary": {}}


@app.local_entrypoint()
def main():
    """
    CLI entrypoint — reads payload path from VISUALR_PAYLOAD_FILE env var.
    Node.js sets this env var before spawning the subprocess.
    stdout = clean JSON for Node.js. stderr = progress logs.
    """
    import os

    payload_file = os.environ.get("VISUALR_PAYLOAD_FILE")
    if not payload_file:
        print(json.dumps({"error": "VISUALR_PAYLOAD_FILE env var not set"}))
        sys.exit(1)

    with open(payload_file, "r", encoding="utf-8") as f:
        payload = json.load(f)

    frames_data = payload.get("frames", [])
    if not frames_data:
        print(json.dumps({"error": "No frames in payload"}))
        sys.exit(1)

    print(f"[visualr] Sending {len(frames_data)} frames to Modal...", file=sys.stderr)
    result = analyze_frames.remote(frames_data)

    result["video_id"]   = payload.get("video_id", "")
    result["title"]      = payload.get("title", "")
    result["project_id"] = payload.get("project_id", None)

    # NumpyEncoder safety net — Modal deserialization can return numpy scalars
    class NumpyEncoder(json.JSONEncoder):
        def default(self, obj):
            try:
                import numpy as np
                if isinstance(obj, np.integer): return int(obj)
                if isinstance(obj, np.floating): return float(obj)
                if isinstance(obj, np.bool_):   return bool(obj)
                if isinstance(obj, np.ndarray):  return obj.tolist()
            except ImportError:
                pass
            return super().default(obj)

    # stdout = clean JSON for Node.js to parse
    print(json.dumps(result, cls=NumpyEncoder))
