# face_track — ShortΩr's auto-reframe camera operator (v2.6).
# Evolved through Jason's grading nights of Jul 23:
#   v2.1 seizure (sample-rate sendcmd steps)   -> per-frame path
#   v2.2 lag ("chases me")                     -> centered Gaussian (sees future)
#   v2.4 stray frames (noise splits)           -> confirmed-jump cuts only
#   v2.5 judder on slow pans (integer crop)    -> SUB-PIXEL warp render
#   v2.6 "opposite count of the cadence"       -> LEAD the move (path shifted early)
#        jump cuts glide across screen         -> face-teleport cut detection
#        "nose on the upper third"             -> punch-in zoom buys vertical play
# Design rules: dead-zone (ignore noise) · glide (small moves ease) · snap
# (cuts + confirmed teleports reframe instantly, face centered, nose upper
# third) · lead (camera lands WITH the subject, not after).
import cv2
from pathlib import Path

YUNET = Path(__file__).parent / "models" / "face_detection_yunet_2023mar.onnx"

def detect_track(video_path, src_w, src_h, sample_fps=6.0, zoom=0.90,
                 dead_zone=0.04, dz_y=0.05, smooth_s=0.6, lead_s=0.25,
                 jump_frac=0.12, confirm_frac=0.06, cut_thresh=0.5):
    """Track the face in 2D; plan a led, smoothed, cut-aware camera path.
    Returns (keys, crop_w, crop_h) where keys[f] = (t, crop_x, crop_y) floats
    per frame — or None when no face is ever seen."""
    import numpy as np
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        return None
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    n_total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 1
    step = max(1, int(round(fps / sample_fps)))
    det_w = 480
    detector = cv2.FaceDetectorYN_create(str(YUNET), "", (det_w, det_w),
                                         score_threshold=0.6)
    crop_h = int(src_h * zoom)
    crop_w = int(crop_h * 9 / 16)

    # ── Pass 1: sample detections + histogram scene cuts ──
    raw = []                    # (t, cx, cy, hist_cut)  cx/cy normalized
    prev_hist = None
    idx = 0
    while True:
        if not cap.grab():
            break
        if idx % step == 0:
            ok, frame = cap.retrieve()
            if not ok:
                break
            t = idx / fps
            small_h = det_w * frame.shape[0] // frame.shape[1]
            small = cv2.resize(frame, (det_w, small_h))
            detector.setInputSize((det_w, small_h))
            _, faces = detector.detect(small)
            cx = cy = None
            if faces is not None and len(faces):
                best = max(faces, key=lambda f: f[14])
                cx = (best[0] + best[2] / 2.0) / det_w
                cy = (best[1] + best[3] * 0.30) / small_h   # ~bridge of nose
            hist = cv2.calcHist([cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)],
                                [0], None, [32], [0, 256])
            cv2.normalize(hist, hist)
            hist_cut = (prev_hist is not None and
                        cv2.compareHist(prev_hist, hist,
                                        cv2.HISTCMP_BHATTACHARYYA) > cut_thresh)
            prev_hist = hist
            raw.append([t, cx, cy, hist_cut, idx])
        idx += 1
    cap.release()
    if not raw or all(r[1] is None for r in raw):
        return None

    # ── Pass 1.5 helper: frame-accurate cut localization (v2.7). Detection
    # runs at sample rate, so a cut lands up to ~5 frames late and the
    # reframe hits AFTER the edit ("cuts a little abrupt", Jul 24). This
    # re-reads just the frames inside each cut window and finds the exact
    # edit frame so the snap hides inside the cut itself.
    def _refine_cuts(windows):
        found = {}
        if not windows:
            return found
        cap2 = cv2.VideoCapture(str(video_path))
        if not cap2.isOpened():
            return found
        for (f0, f1) in windows:
            cap2.set(cv2.CAP_PROP_POS_FRAMES, max(0, f0))
            prev_h = None
            best_f, best_d = f1, -1.0
            for f in range(max(0, f0), f1 + 1):
                ok, fr = cap2.read()
                if not ok:
                    break
                small2 = cv2.resize(fr, (160, 90))
                h = cv2.calcHist([cv2.cvtColor(small2, cv2.COLOR_BGR2GRAY)],
                                 [0], None, [32], [0, 256])
                cv2.normalize(h, h)
                if prev_h is not None:
                    d = cv2.compareHist(prev_h, h, cv2.HISTCMP_BHATTACHARYYA)
                    if d > best_d:
                        best_d, best_f = d, f
                prev_h = h
            found[f1] = best_f
        cap2.release()
        return found

    # ── Pass 2: face-teleport cut detection (jump cuts share a background —
    # histograms miss them; a face that MOVES > jump_frac in one sample and
    # STAYS at the new spot next sample is a cut, not noise; an unconfirmed
    # teleport is noise and the sample is dropped — the v2.4 stray-frame fix).
    last = None                 # last accepted cx
    det_idx = [i for i, r in enumerate(raw) if r[1] is not None]
    for k, i in enumerate(det_idx):
        cx = raw[i][1]
        if last is not None and abs(cx - last) > jump_frac and not raw[i][3]:
            nxt = det_idx[k + 1] if k + 1 < len(det_idx) else None
            if nxt is not None and abs(raw[nxt][1] - cx) < confirm_frac:
                raw[i][3] = True            # confirmed teleport -> cut
            else:
                raw[i][1] = raw[i][2] = None  # lone blip -> drop as noise
                continue
        last = raw[i][1] if raw[i][1] is not None else last

    # ── Pass 2.5: refine every flagged cut to its exact frame.
    windows = []
    for i, r in enumerate(raw):
        if r[3]:
            prev_fidx = raw[i - 1][4] if i > 0 else max(0, r[4] - step)
            windows.append((prev_fidx, r[4]))
    exact = _refine_cuts(windows)
    refined_t = {}
    for i, r in enumerate(raw):
        if r[3] and r[4] in exact:
            refined_t[i] = exact[r[4]] / fps
    if windows:
        print(f"  reframe: {len(windows)} cut(s) refined to exact frames")

    # ── Pass 3: dead-zoned target paths, segmented at cuts. On every cut the
    # target RESETS to the face — dead center, nose at upper third — at the
    # EXACT cut frame, not the late sample.
    half_w = (crop_w / 2.0) / src_w
    segments = []               # list of [(t, tx, ty)]
    cur = []
    tx = ty = None
    for si, (t, cx, cy, is_cut, fidx) in enumerate(raw):
        if is_cut and cur:
            segments.append(cur)
            cur = []
            tx = ty = None
            t = refined_t.get(si, t)
        if cx is not None:
            cx = min(1.0 - half_w, max(half_w, cx))
            if tx is None or abs(cx - tx) > dead_zone:
                tx = cx
            if ty is None or abs(cy - ty) > dz_y:
                ty = cy
        if tx is not None:
            cur.append((t, tx, ty))
    if cur:
        segments.append(cur)
    if not segments:
        return None

    # ── Pass 4: per-frame smoothing per segment + LEAD (shift early so the
    # camera lands on the subject's count, not one behind it).
    sigma = max(1, int(round(smooth_s * fps)))
    kern = np.exp(-0.5 * (np.arange(-3 * sigma, 3 * sigma + 1) / sigma) ** 2)
    kern /= kern.sum()
    lead = int(round(lead_s * fps))
    xs = np.full(n_total, -1.0)
    ys = np.full(n_total, -1.0)

    def smooth_arr(a):
        p = np.concatenate([np.full(3 * sigma, a[0]), a,
                            np.full(3 * sigma, a[-1])])
        return np.convolve(p, kern, mode="same")[3 * sigma:3 * sigma + len(a)]

    for seg in segments:
        f0 = int(round(seg[0][0] * fps))
        f1 = min(n_total - 1, int(round(seg[-1][0] * fps)))
        n = f1 - f0 + 1
        ax = np.empty(n)
        ay = np.empty(n)
        si = 0
        for f in range(n):
            t = (f0 + f) / fps
            while si + 1 < len(seg) and seg[si + 1][0] <= t + 1e-6:
                si += 1
            ax[f] = seg[si][1]
            ay[f] = seg[si][2]
        ax, ay = smooth_arr(ax), smooth_arr(ay)
        if lead and n > lead:                 # shift early; hold the tail
            ax = np.concatenate([ax[lead:], np.full(lead, ax[-1])])
            ay = np.concatenate([ay[lead:], np.full(lead, ay[-1])])
        xs[f0:f1 + 1] = ax
        ys[f0:f1 + 1] = ay

    # Fill gaps (pre-first-face, between segments): hold neighbors.
    first_ok = int(np.argmax(xs >= 0))
    xs[:first_ok] = xs[first_ok]
    ys[:first_ok] = ys[first_ok]
    for f in range(1, n_total):
        if xs[f] < 0:
            xs[f] = xs[f - 1]
            ys[f] = ys[f - 1]

    # Face path -> crop origin: x centers the face; y puts the nose at 1/3.
    keys = []
    max_x = float(src_w - crop_w)
    max_y = float(src_h - crop_h)
    for f in range(n_total):
        cx_px = xs[f] * src_w - crop_w / 2.0
        cy_px = ys[f] * src_h - crop_h / 3.0
        keys.append((round(f / fps, 4),
                     max(0.0, min(max_x, cx_px)),
                     max(0.0, min(max_y, cy_px))))
    return keys, crop_w, crop_h, len(segments)

def render_subpixel(video_path, keys, crop_w, crop_h, out_w, out_h,
                    ffmpeg_stdin):
    """Warp each frame with SUB-PIXEL crop x/y (frame 2 sits at A+0.03px —
    slow pans glide instead of stepping) and stream bgr24 to ffmpeg."""
    import numpy as np
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        return 0
    sx = out_w / crop_w
    sy = out_h / crop_h
    n_written = 0
    f = 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        (_, x, y) = keys[min(f, len(keys) - 1)]
        M = np.array([[sx, 0.0, -x * sx], [0.0, sy, -y * sy]],
                     dtype=np.float64)
        out = cv2.warpAffine(frame, M, (out_w, out_h),
                             flags=cv2.INTER_LINEAR,
                             borderMode=cv2.BORDER_REPLICATE)
        ffmpeg_stdin.write(out.tobytes())
        n_written += 1
        f += 1
    cap.release()
    return n_written
