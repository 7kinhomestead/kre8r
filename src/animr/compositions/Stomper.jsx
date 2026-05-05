/**
 * Stomper — Two-act number reveal for eminent domain video.
 *
 * Act 1 (0–90):   15,000 counts up, settles, sits proud
 * Act 2 (91–210): 140,000,000 slams in from above, physically stomps 15K down
 *                 and shrinks it into the corner like it's nothing
 *
 * Timeline (30fps):
 *   0–60    small number counts up
 *   61–90   small number sits, label fades in
 *   91–100  screen shakes, big number drops from top
 *   101–150 big number counts up fast and hard
 *   151–180 big number glows, small number shrinks to corner
 *   181–210 hold — both visible, scale contrast obvious
 */
import {
  useCurrentFrame, useVideoConfig,
  interpolate, spring, Easing,
} from 'remotion';

function useSpring(frame, { delay = 0, damping = 40, stiffness = 60 } = {}) {
  return spring({ frame: Math.max(0, frame - delay), fps: 30, config: { damping, stiffness } });
}

function formatBig(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1_000)     return Math.floor(n).toLocaleString();
  return String(Math.floor(n));
}

export const Stomper = ({
  smallValue    = 15000,
  bigValue      = 140000000,
  smallLabel    = 'Acres taken by eminent domain last year',
  bigLabel      = 'Acres of privately owned land in the U.S.',
  accentSmall   = '#14b8a6',
  accentBig     = '#ef4444',
  bgColor       = '#0a0a0a',
  fx            = { glow: true, shadow: false, scanlines: false, vignette: false },
}) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();

  // ── Act 1: small number ────────────────────────────────────────────────────
  const smallProgress  = useSpring(frame, { delay: 0,  damping: 50, stiffness: 40 });
  const smallLabelOpacity = interpolate(frame, [50, 70], [0, 1], { extrapolateRight: 'clamp' });
  const smallCurrent   = Math.floor(smallProgress * smallValue);

  // ── Act 2 trigger: frame 91 ───────────────────────────────────────────────
  const ACT2 = 91;

  // Big number drops from above (translateY: -300 → 0)
  const bigDropProgress = useSpring(frame, { delay: ACT2, damping: 22, stiffness: 120 });
  const bigY = interpolate(bigDropProgress, [0, 1], [-320, 0]);

  // Big number count-up starts at ACT2+5
  const bigProgress = useSpring(frame, { delay: ACT2 + 5, damping: 60, stiffness: 30 });
  const bigCurrent  = Math.floor(bigProgress * bigValue);

  // Screen shake on ACT2 impact (frames 91–100)
  const shakeAmt = interpolate(frame, [ACT2, ACT2 + 3, ACT2 + 6, ACT2 + 9, ACT2 + 12], [0, 14, -10, 6, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
    easing: Easing.linear,
  });

  // Small number shrinks to corner after ACT2+40
  const shrinkProgress = interpolate(frame, [ACT2 + 40, ACT2 + 80], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
    easing: Easing.inOut(Easing.ease),
  });
  const smallScale    = interpolate(shrinkProgress, [0, 1], [1,    0.28]);
  const smallX        = interpolate(shrinkProgress, [0, 1], [0,    width * 0.3]);
  const smallY_shift  = interpolate(shrinkProgress, [0, 1], [0,    height * 0.28]);
  const smallOpacity  = interpolate(shrinkProgress, [0.7, 1], [1,  0.45]);

  // Big number glow pulses once it settles
  const bigGlow = interpolate(
    frame, [ACT2 + 50, ACT2 + 80, ACT2 + 110],
    [0, 1, 0.4],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );

  const bigLabelOpacity = interpolate(frame, [ACT2 + 55, ACT2 + 75], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  const containerStyle = {
    width: '100%', height: '100%',
    background: bgColor,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontFamily: "'DM Sans', 'Arial Black', sans-serif",
    overflow: 'hidden',
    transform: `translateX(${shakeAmt}px)`,
  };

  const smallWrapStyle = {
    position: 'absolute',
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    transform: `translate(${smallX}px, ${smallY_shift}px) scale(${smallScale})`,
    opacity: smallOpacity,
    transition: 'none',
  };

  const bigWrapStyle = {
    position: 'absolute',
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    transform: `translateY(${bigY}px)`,
    opacity: frame < ACT2 ? 0 : 1,
  };

  return (
    <div style={containerStyle}>

      {/* ── Small number ── */}
      <div style={smallWrapStyle}>
        <div style={{
          fontSize: 160, fontWeight: 900, lineHeight: 1,
          color: accentSmall,
          fontVariantNumeric: 'tabular-nums',
          letterSpacing: '-0.02em',
          textShadow: [
            fx.glow   ? `0 0 40px ${accentSmall}88` : '',
            fx.shadow ? '4px 6px 20px rgba(0,0,0,0.8)' : '',
          ].filter(Boolean).join(', ') || 'none',
        }}>
          {smallCurrent.toLocaleString()}
        </div>
        <div style={{
          fontSize: 28, fontWeight: 500,
          color: 'rgba(255,255,255,.55)',
          letterSpacing: '0.08em', textTransform: 'uppercase',
          marginTop: 20, textAlign: 'center', maxWidth: 640,
          opacity: smallLabelOpacity,
        }}>
          {smallLabel}
        </div>
      </div>

      {/* ── Big number ── */}
      <div style={bigWrapStyle}>
        <div style={{
          fontSize: 200, fontWeight: 900, lineHeight: 1,
          color: accentBig,
          fontVariantNumeric: 'tabular-nums',
          letterSpacing: '-0.03em',
          textShadow: [
            fx.glow   ? `0 0 ${120 * bigGlow}px ${accentBig}` : '',
            fx.shadow ? '4px 6px 20px rgba(0,0,0,0.8)' : '',
          ].filter(Boolean).join(', ') || 'none',
        }}>
          {formatBig(bigCurrent)}
        </div>
        <div style={{
          fontSize: 32, fontWeight: 600,
          color: 'rgba(255,255,255,.6)',
          letterSpacing: '0.08em', textTransform: 'uppercase',
          marginTop: 24, textAlign: 'center', maxWidth: 800,
          opacity: bigLabelOpacity,
        }}>
          {bigLabel}
        </div>
      </div>

      {fx.scanlines && (
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          backgroundImage: 'repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,0,0,0.18) 2px,rgba(0,0,0,0.18) 4px)',
          zIndex: 10,
        }} />
      )}
      {fx.vignette && (
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          background: 'radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.75) 100%)',
          zIndex: 11,
        }} />
      )}

    </div>
  );
};
