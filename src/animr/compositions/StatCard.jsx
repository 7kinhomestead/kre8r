import { useCurrentFrame, useVideoConfig, interpolate, spring } from 'remotion';

export const StatCard = ({
  label = 'Annual Savings',
  value = '$4,800',
  subtitle = '',
  accentColor = '#14b8a6',
  bgColor = '#0a0a0a',
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const cardScale = spring({ frame, fps, config: { damping: 14, stiffness: 120 }, delay: 0 });
  const labelOpacity = interpolate(frame, [10, 30], [0, 1], { extrapolateRight: 'clamp' });
  const labelY = interpolate(frame, [10, 30], [20, 0], { extrapolateRight: 'clamp' });
  const valueOpacity = interpolate(frame, [20, 45], [0, 1], { extrapolateRight: 'clamp' });
  const valueScale = spring({ frame: frame - 20, fps, config: { damping: 12, stiffness: 100 } });
  const subtitleOpacity = interpolate(frame, [40, 60], [0, 1], { extrapolateRight: 'clamp' });
  const lineWidth = interpolate(frame, [15, 50], [0, 100], { extrapolateRight: 'clamp' });

  return (
    <div style={{
      width: '100%', height: '100%', background: bgColor,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: "'DM Sans', sans-serif",
    }}>
      <div style={{
        transform: `scale(${cardScale})`,
        background: 'rgba(255,255,255,.04)',
        border: `1px solid ${accentColor}33`,
        borderRadius: 20,
        padding: '60px 80px',
        textAlign: 'center',
        minWidth: 600,
      }}>
        {/* Accent line */}
        <div style={{
          height: 4, background: accentColor,
          borderRadius: 2, marginBottom: 40,
          width: `${lineWidth}%`, margin: '0 auto 40px',
        }} />
        {/* Label */}
        <div style={{
          fontSize: 28, fontWeight: 600,
          color: 'rgba(255,255,255,.55)',
          letterSpacing: '0.12em', textTransform: 'uppercase',
          opacity: labelOpacity, transform: `translateY(${labelY}px)`,
          marginBottom: 24,
        }}>{label}</div>
        {/* Value */}
        <div style={{
          fontSize: 120, fontWeight: 800,
          color: accentColor, lineHeight: 1,
          opacity: valueOpacity,
          transform: `scale(${valueScale})`,
          marginBottom: subtitle ? 24 : 0,
        }}>{value}</div>
        {/* Subtitle */}
        {subtitle && (
          <div style={{
            fontSize: 24, color: 'rgba(255,255,255,.4)',
            opacity: subtitleOpacity, marginTop: 16,
            letterSpacing: '0.06em',
          }}>{subtitle}</div>
        )}
        {/* Bottom accent line */}
        <div style={{
          height: 2, background: `${accentColor}44`,
          borderRadius: 1, marginTop: 40,
          width: `${lineWidth}%`, margin: '40px auto 0',
        }} />
      </div>
    </div>
  );
};
