import React, { useId } from 'react';
import type { ReplayResult } from '../../../shared/replay.js';
import { formatClock, plural, spansDays, summarizeReplay } from '../../../shared/replay-summary.js';
import type { CircuitState } from '../../../shared/types.js';

const WIDTH = 960;
const LEFT = 56;
const RIGHT = 12;
const BAND_TOP = 8;
const BAND_HEIGHT = 34;
const BARS_TOP = 56;
const BARS_BOTTOM = 196;
const AXIS_Y = 218;
const HEIGHT = 232;

const STATE_NAME: Record<CircuitState, string> = { CLOSED: 'Closed', OPEN: 'Open', HALF_OPEN: 'Half-open' };

interface ReplayChartProps {
  result: ReplayResult;
  /** Name of the settings set, used in the chart's description. */
  label: string;
}

/**
 * Time on the horizontal axis. The top band shows the breaker state (closed
 * is plain, open is solid ink, half-open is hatched). Below it, each time
 * slice stacks the calls that passed, were slow, failed and reached users,
 * and were blocked by the breaker. The same figures are in the tables below.
 */
export const ReplayChart: React.FC<ReplayChartProps> = ({ result, label }) => {
  const uid = useId().replace(/:/g, '');
  const plotWidth = WIDTH - LEFT - RIGHT;
  const slices = result.buckets;
  const drawnSpan = Math.max(1, result.bucketWidthMs * slices.length);
  const x = (ms: number) => LEFT + ((ms - result.startMs) / drawnSpan) * plotWidth;
  const sliceWidth = plotWidth / Math.max(1, slices.length);
  const peak = Math.max(1, ...slices.map((slice) => slice.passed + slice.slow + slice.errors + slice.blocked));
  const scale = (BARS_BOTTOM - BARS_TOP) / peak;
  const withDate = spansDays(result);

  // State segments from the recorded changes.
  const segments: Array<{ state: CircuitState; from: number; to: number }> = [];
  let state: CircuitState = 'CLOSED';
  let cursor = result.startMs;
  for (const transition of result.transitions) {
    segments.push({ state, from: cursor, to: transition.atMs });
    state = transition.to;
    cursor = transition.atMs;
  }
  segments.push({ state, from: cursor, to: result.endMs });

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((fraction) => result.startMs + fraction * result.spanMs);
  const description = `${summarizeReplay(result)} The same figures are in the table of state changes and the data table below the chart.`;

  return (
    <figure className="replay-figure">
      <figcaption className="replay-caption">
        Breaker state and calls over time for {label}. Time is UTC. Each bar is one slice of the timeline.
      </figcaption>
      <div className="chart-scroll" role="region" aria-label={`Chart for ${label}, scrolls sideways on narrow screens`} tabIndex={0}>
        <svg
          className="replay-chart"
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          role="img"
          aria-labelledby={`${uid}-title ${uid}-desc`}
        >
          <title id={`${uid}-title`}>{`Breaker state and calls over time, ${label}`}</title>
          <desc id={`${uid}-desc`}>{description}</desc>
          <defs>
            <pattern id={`${uid}-half`} width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="8" height="8" className="rc-surface" />
              <rect width="3" height="8" className="rc-ink" />
            </pattern>
            <pattern id={`${uid}-blocked`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="6" height="6" className="rc-surface" />
              <rect width="2" height="6" className="rc-ink-3" />
            </pattern>
          </defs>

          <rect x={LEFT} y={BAND_TOP} width={plotWidth} height={BAND_HEIGHT} className="rc-surface" />
          {segments.map((segment, index) => {
            const left = x(segment.from);
            const width = Math.max(1, x(segment.to) - left);
            if (segment.state === 'CLOSED') return null;
            return (
              <g key={`${segment.state}-${index}`}>
                <rect
                  x={left}
                  y={BAND_TOP}
                  width={width}
                  height={BAND_HEIGHT}
                  className={segment.state === 'OPEN' ? 'rc-ink' : undefined}
                  fill={segment.state === 'HALF_OPEN' ? `url(#${uid}-half)` : undefined}
                />
                {width > 64 && (
                  <text x={left + 6} y={BAND_TOP + 22} className={segment.state === 'OPEN' ? 'rc-label-on-ink' : 'rc-label'}>
                    {STATE_NAME[segment.state]}
                  </text>
                )}
              </g>
            );
          })}
          <rect x={LEFT} y={BAND_TOP} width={plotWidth} height={BAND_HEIGHT} className="rc-frame" />
          <text x={LEFT - 6} y={BAND_TOP + 22} textAnchor="end" className="rc-label">State</text>

          {slices.map((slice, index) => {
            let top = BARS_BOTTOM;
            const left = LEFT + index * sliceWidth + 0.5;
            const width = Math.max(1, sliceWidth - 1);
            const layers: Array<[number, string | undefined, string | undefined]> = [
              [slice.passed, 'rc-ok', undefined],
              [slice.slow, 'rc-warn', undefined],
              [slice.errors, 'rc-bad', undefined],
              [slice.blocked, undefined, `url(#${uid}-blocked)`],
            ];
            return (
              <g key={slice.startMs}>
                {layers.map(([count, className, fill], layer) => {
                  if (count === 0) return null;
                  const height = count * scale;
                  top -= height;
                  return <rect key={layer} x={left} y={top} width={width} height={height} className={className} fill={fill} />;
                })}
              </g>
            );
          })}
          <rect x={LEFT} y={BARS_TOP} width={plotWidth} height={BARS_BOTTOM - BARS_TOP} className="rc-frame" />
          <text x={LEFT - 6} y={BARS_TOP + 12} textAnchor="end" className="rc-label">{peak}</text>
          <text x={LEFT - 6} y={BARS_BOTTOM} textAnchor="end" className="rc-label">0</text>

          {ticks.map((tick, index) => (
            <g key={index}>
              <line x1={x(tick)} x2={x(tick)} y1={BARS_BOTTOM} y2={BARS_BOTTOM + 6} className="rc-tick" />
              <text
                x={Math.min(WIDTH - 2, Math.max(2, x(tick)))}
                y={AXIS_Y + 8}
                textAnchor={index === 0 ? 'start' : index === ticks.length - 1 ? 'end' : 'middle'}
                className="rc-label"
              >
                {formatClock(tick, withDate && (index === 0 || index === ticks.length - 1))}
              </text>
            </g>
          ))}
        </svg>
      </div>
      <ul className="chart-legend" aria-label="Chart key">
        <li><span className="swatch rc-ok" aria-hidden="true" />Passed</li>
        <li><span className="swatch rc-warn" aria-hidden="true" />Passed but slow</li>
        <li><span className="swatch rc-bad" aria-hidden="true" />Failed and reached users</li>
        <li>
          <svg className="swatch" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            <defs>
              <pattern id={`${uid}-key-blocked`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <rect width="6" height="6" className="rc-surface" />
                <rect width="2" height="6" className="rc-ink-3" />
              </pattern>
            </defs>
            <rect x="1" y="1" width="14" height="14" fill={`url(#${uid}-key-blocked)`} className="rc-frame" />
          </svg>
          Blocked by the breaker
        </li>
        <li><span className="swatch rc-ink" aria-hidden="true" />State: open</li>
        <li>
          <svg className="swatch" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            <defs>
              <pattern id={`${uid}-key-half`} width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <rect width="8" height="8" className="rc-surface" />
                <rect width="3" height="8" className="rc-ink" />
              </pattern>
            </defs>
            <rect x="1" y="1" width="14" height="14" fill={`url(#${uid}-key-half)`} className="rc-frame" />
          </svg>
          State: half-open
        </li>
      </ul>
      <details className="data-details">
        <summary>Data table: calls in each slice</summary>
        <div className="table-scroll" role="region" aria-label={`Calls in each slice for ${label}`} tabIndex={0}>
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Slice starts (UTC)</th>
                <th scope="col">Passed</th>
                <th scope="col">Slow</th>
                <th scope="col">Failed, reached users</th>
                <th scope="col">Blocked</th>
              </tr>
            </thead>
            <tbody>
              {slices.map((slice) => (
                <tr key={slice.startMs}>
                  <th scope="row" className="mono">{formatClock(slice.startMs, withDate)}</th>
                  <td className="mono">{slice.passed}</td>
                  <td className="mono">{slice.slow}</td>
                  <td className="mono">{slice.errors}</td>
                  <td className="mono">{slice.blocked}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="field-help">{plural(slices.length, 'slice')} of {Math.round(result.bucketWidthMs).toLocaleString('en-US')} ms.</p>
      </details>
    </figure>
  );
};
