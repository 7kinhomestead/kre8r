import { useCurrentFrame, useVideoConfig, interpolate, spring } from 'remotion';

export const BarChart = ({
  title = 'Cost Comparison',
  bars = [
    { label: 'Grid Power', value: 4800, color: '#ef4444' },
    { label: 'Solar', value: 800, color: '#14b8a6' },
  ],
  valuePrefix = '$',
  valueSuffix = '/yr',
  accentColor = '#14b8a6',
  bgColor = '#0a0a0a',
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const maxVal = Math.max(...bars.map(b => b.value));
  const titleOpacity = interpolate(frame, [0, 20], [0, 1], { extrapolateRight: 'clamp' });
  const titleY = interpolate(frame, [0, 20], [-20, 0], { extrapolateRight: 'clamp' });

  return (
    <div style={{
      width: '100%', height: '100%', background: bgColor,
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      fontFamily: "'DM Sans', sans-serif",
      padding: '60px 80px',
    }}>
      {/* Title */}
      <div style={{
        fontSize: 42, fontWeight: 700, color: 'rgba(255,255,255,.88)',
        letterSpacing: '-0.02em', marginBottom: 60,
        opacity: titleOpacity, transform: `translateY(${titleY}px)`,
        textAlign: 'center',
      }}>{title}</div>

      {/* Bars */}
      <div style={{
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
        gap: 40, width: '100%', maxWidth: 1200,
        height: 400,
      }}>
        {bars.map((bar, i) => {
          const delay = i * 12;
          const barHeight = spring({
            frame: frame - delay,
            fps,
            config: { damping: 18, stiffness: 80 },
          });
          const heightPct = (bar.value / maxVal) * 100;
          const labelOpacity = interpolate(frame - delay, [10, 30], [0, 1], { extrapolateRight: 'clamp' });
          const valueOpacity = interpolate(frame - delay, [20, 40], [0, 1], { extrapolateRight: 'clamp' });

          // Count up value
          const countProgress = spring({ frame: frame - delay - 10, fps, config: { damping: 30, stiffness: 50 } });
          const displayValue = Math.floor(countProgress * bar.value).toLocaleString();

          return (
            <div key={i} style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              flex: 1, maxWidth: 200,
            }}>
              {/* Value label above bar */}
              <div style={{
                fontSize: 28, fontWeight: 700, color: bar.color,
                marginBottom: 12, opacity: valueOpacity,
                fontVariantNumeric: 'tabular-nums',
              }}>
                {valuePrefix}{displayValue}{valueSuffix}
              </div>
              {/* Bar */}
              <div style={{
                width: '100%', position: 'relative',
                height: 400, display: 'flex', alignItems: 'flex-end',
              }}>
                <div style={{
                  width: '100%',
                  height: `${heightPct * barHeight}%`,
                  background: `linear-gradient(180deg, ${bar.color}, ${bar.color}88)`,
                  borderRadius: '6px 6px 0 0',
                  boxShadow: `0 0 30px ${bar.color}44`,
                  transition: 'none',
                }} />
              </div>
              {/* Label below */}
              <div style={{
                fontSize: 22, fontWeight: 500, color: 'rgba(255,255,255,.6)',
                marginTop: 16, opacity: labelOpacity, textAlign: 'center',
              }}>{bar.label}</div>
            </div>
          );
        })}
      </div>

      {/* Base line */}
      <div style={{
        width: '100%', maxWidth: 1200, height: 2,
        background: 'rgba(255,255,255,.12)', marginTop: 0,
        opacity: interpolate(frame, [5, 25], [0, 1], { extrapolateRight: 'clamp' }),
      }} />
    </div>
  );
};
