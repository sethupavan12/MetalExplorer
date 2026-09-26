import { useId } from 'react';
import type { JSX } from 'react';

interface SparklineProps {
  values: number[];
  secondary?: number[];
  max?: number;
  height?: number;
  /** Number of slots the chart represents; short histories render right-aligned like Activity Monitor. */
  capacity?: number;
  tone?: 'accent' | 'good' | 'warning' | 'critical' | 'purple' | 'teal' | 'agent';
  secondaryTone?: 'accent' | 'good' | 'warning' | 'critical' | 'purple' | 'teal';
  className?: string;
  label?: string;
}

export function Sparkline({ values, secondary, max, height = 32, capacity, tone = 'accent', secondaryTone = 'purple', className = '', label }: SparklineProps): JSX.Element {
  const id = useId().replace(/:/g, '');
  // Right-aligned like Activity Monitor, but a short history spans at least a third of the chart so it reads as a trend.
  const slots = Math.max(values.length, 2, Math.min(capacity ?? values.length, Math.max(20, values.length * 3)));
  const peak = Math.max(max ?? 0, ...values, ...(secondary ?? []), 1e-9);
  const width = 100;

  const toPoints = (series: number[]): Array<[number, number]> => {
    const offset = slots - series.length;
    return series.map((value, index) => [((offset + index) / (slots - 1)) * width, height - (Math.max(0, value) / peak) * (height - 2) - 1]);
  };

  const line = (points: Array<[number, number]>): string => points.map(([x, y], index) => `${index ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
  const area = (points: Array<[number, number]>): string =>
    points.length ? `${line(points)} L${points.at(-1)?.[0].toFixed(2)},${height} L${points[0][0].toFixed(2)},${height} Z` : '';

  // A couple of samples draw a misleading spike; show a quiet baseline until there is a trend to see.
  if (values.length < 3) {
    return (
      <svg className={`sparkline sparkline-empty ${className}`} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ height }} role="img" aria-label={label ? `${label}: collecting` : undefined}>
        <line x1="0" x2={width} y1={height - 1} y2={height - 1} stroke="currentColor" strokeWidth="1" strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />
      </svg>
    );
  }

  const primary = toPoints(values);
  const second = secondary ? toPoints(secondary) : null;

  return (
    <svg className={`sparkline tone-${tone} ${className}`} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ height }} role="img" aria-label={label}>
      <defs>
        <linearGradient id={`fill-${id}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.28" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      {primary.length > 1 ? (
        <>
          <path d={area(primary)} fill={`url(#fill-${id})`} />
          <path d={line(primary)} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        </>
      ) : null}
      {second && second.length > 1 ? (
        <path className={`secondary tone-${secondaryTone}`} d={line(second)} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      ) : null}
    </svg>
  );
}
