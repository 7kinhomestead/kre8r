import { Composition, registerRoot } from 'remotion';
import { BarChart }  from './compositions/BarChart';
import { CountUp }   from './compositions/CountUp';
import { StatCard }  from './compositions/StatCard';
import { Stomper }   from './compositions/Stomper';

const RemotionRoot = () => {
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
          prefix: '',
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
      <Composition
        id="Stomper"
        component={Stomper}
        durationInFrames={210}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{
          smallValue:  15000,
          bigValue:    140000000,
          smallLabel:  'Acres taken by eminent domain last year',
          bigLabel:    'Acres of privately owned land in the U.S.',
          accentSmall: '#14b8a6',
          accentBig:   '#ef4444',
          bgColor:     '#0a0a0a',
        }}
      />
    </>
  );
};

registerRoot(RemotionRoot);
