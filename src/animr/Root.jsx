import { Composition } from 'remotion';
import { BarChart }  from './compositions/BarChart';
import { CountUp }   from './compositions/CountUp';
import { StatCard }  from './compositions/StatCard';

export const RemotionRoot = () => {
  return (
    <>
      <Composition
        id="BarChart"
        component={BarChart}
        durationInFrames={120}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{
          title: 'Cost Comparison',
          bars: [
            { label: 'Grid Power', value: 4800, color: '#ef4444' },
            { label: 'Solar',      value:  800, color: '#14b8a6' },
          ],
          valuePrefix: '$',
          valueSuffix: '/yr',
          accentColor: '#14b8a6',
          bgColor: '#0a0a0a',
        }}
      />
      <Composition
        id="CountUp"
        component={CountUp}
        durationInFrames={90}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{
          targetValue: 24000,
          prefix: '$',
          suffix: '',
          label: 'Annual Savings',
          decimals: 0,
          accentColor: '#14b8a6',
          bgColor: '#0a0a0a',
        }}
      />
      <Composition
        id="StatCard"
        component={StatCard}
        durationInFrames={90}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{
          label: 'Annual Savings',
          value: '$4,800',
          subtitle: 'vs grid power',
          accentColor: '#14b8a6',
          bgColor: '#0a0a0a',
        }}
      />
    </>
  );
};
