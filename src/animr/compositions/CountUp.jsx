import { useCurrentFrame, useVideoConfig, interpolate, spring } from 'remotion';

export const CountUp = ({
  targetValue = 24000,
  prefix = '$',
  suffix = '',
  label = '',
  decimals = 0,
  accentColor = '#14b8a6',
  bgColor = '#0a0a0a',
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const progress = spring({
    frame,
    fps,
    config: { damping: 40, stiffness: 60 },
    durationRestThresholdInFrames: 5,
  });

  const currentValue = progress * targetValue;
  const formatted = decimals > 0
    ? currentValue.toFixed(decimals)
    : Math.floor(currentValue).toLocaleString();

  const labelOpacity = interpolate(frame, [0, 20], [0, 1], { extrapolateRight: 'clamp' });
  const containerOpacity = interpolate(frame, [0, 10], [0, 1], { extrapolateRight: 'clamp' });

  // Pulse glow on the number as it counts
  const glowIntensity = interpolate(progress, [0, 0.5, 1], [0, 1, 0.3]);

  return (
    <div style={{
      width: '100%', height: '100%', background: bgColor,
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      fontFamily: "'DM Sans', sans-serif",
      opacity: containerOpacity,
    }}>
      {label && (
        <div style={{
          fontSize: 32, fontWeight: 600,
          color: 'rgba(255,255,255,.5)',
          letterSpacing: '0.14em', textTransform: 'uppercase',
          opacity: labelOpacity, marginBottom: 32,
        }}>{label}</div>
      )}
      <div style={{
        fontSize: 160, fontWeight: 900,
        lineHeight: 1,
        color: accentColor,
        textShadow: `0 0 ${80 * glowIntensity}px ${accentColor}`,
        fontVariantNumeric: 'tabular-nums',
      }}>
        <span style={{ fontSize: 80, fontWeight: 600, verticalAlign: 'top', marginTop: 28, display: 'inline-block' }}>
          {prefix}
        </span>
        {formatted}
        {suffix && (
          <span style={{ fontSize: 60, fontWeight: 400, color: 'rgba(255,255,255,.4)', marginLeft: 8 }}>
            {suffix}
          </span>
        )}
      </div>
    </div>
  );
};
