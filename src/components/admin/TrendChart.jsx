// src/components/admin/TrendChart.jsx
// Dependency-free trend chart (area/line or column) built directly against
// the project's dataviz guidance: 2px line / round join, 4px rounded bar
// tops squared at the baseline, hairline recessive gridlines, a hover
// crosshair + tooltip, and an accessible <table> fallback so every value
// is reachable without hovering. No charting library added — this is
// plain SVG, consistent with the rest of this codebase.
import { useState, useRef, useEffect } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { niceMax } from '../../utils/trendAggregation';

const PADDING = { top: 16, right: 12, bottom: 28, left: 56 };
const HEIGHT = 200;

const formatDayTick = (dateStr) =>
  new Date(`${dateStr}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

/**
 * @param {Object} props
 * @param {string} props.title
 * @param {Array<{date: string, value: number}>} props.data - one entry per day, oldest first
 * @param {'area'|'bar'} [props.type]
 * @param {string} props.colorLight - hex, used in light mode
 * @param {string} props.colorDark - hex, used in dark mode
 * @param {(n: number) => string} [props.formatValue]
 * @param {string} [props.emptyMessage]
 * @param {boolean} [props.loading] - keeps the previous render at reduced opacity instead of unmounting
 */
function TrendChart({ title, data, type = 'area', colorLight, colorDark, formatValue = String, emptyMessage = 'No data in this range.', loading = false }) {
  const { isDark } = useTheme();
  const color = isDark ? colorDark : colorLight;
  const gridColor = isDark ? '#374151' : '#e5e7eb'; // matches this app's existing border-gray-700 / border-gray-200
  const axisTextColor = isDark ? '#9ca3af' : '#6b7280'; // gray-400 / gray-500, matches existing muted text

  const containerRef = useRef(null);
  const [width, setWidth] = useState(560);
  const [hoverIndex, setHoverIndex] = useState(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect?.width;
      if (w) setWidth(w);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const hasData = Array.isArray(data) && data.length > 0 && data.some((d) => d.value > 0);
  const n = data?.length || 0;
  const maxValue = n > 0 ? Math.max(...data.map((d) => d.value)) : 0;
  const axisMax = niceMax(maxValue);

  const plotWidth = Math.max(width - PADDING.left - PADDING.right, 10);
  const plotHeight = HEIGHT - PADDING.top - PADDING.bottom;

  const xFor = (i) => {
    if (type === 'bar') {
      const band = plotWidth / n;
      return PADDING.left + band * i + band / 2;
    }
    return n <= 1 ? PADDING.left + plotWidth / 2 : PADDING.left + (plotWidth * i) / (n - 1);
  };
  const yFor = (v) => PADDING.top + plotHeight - (axisMax === 0 ? 0 : (v / axisMax) * plotHeight);

  const linePath = n > 0 ? data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${xFor(i)},${yFor(d.value)}`).join(' ') : '';
  const areaPath = n > 0 ? `${linePath} L ${xFor(n - 1)},${yFor(0)} L ${xFor(0)},${yFor(0)} Z` : '';

  const bandWidth = n > 0 ? plotWidth / n : 0;
  const barWidth = Math.max(Math.min(24, bandWidth - 4), 2);

  const tickEvery = n <= 8 ? 1 : Math.ceil(n / 6);
  const yTicks = [0, axisMax / 2, axisMax];

  const handlePointerMove = (e) => {
    if (n === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const approxX = ((e.clientX - rect.left) / rect.width) * width;
    let nearest = 0;
    let nearestDist = Infinity;
    for (let i = 0; i < n; i++) {
      const dist = Math.abs(xFor(i) - approxX);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = i;
      }
    }
    setHoverIndex(nearest);
  };

  const hovered = hoverIndex !== null ? data[hoverIndex] : null;
  const tooltipLeft = hoverIndex !== null ? xFor(hoverIndex) : 0;
  const tooltipOnRight = tooltipLeft < width - 140;

  return (
    <div className="card p-4 sm:p-6">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">{title}</h3>
        </div>
        {hasData && (
          <span className="text-xs text-gray-400 dark:text-gray-500 font-mono">
            latest: {formatValue(data[n - 1]?.value ?? 0)}
          </span>
        )}
      </div>

      {!hasData ? (
        <div className="h-[200px] flex items-center justify-center text-sm text-gray-400 dark:text-gray-500">
          {emptyMessage}
        </div>
      ) : (
        <div
          ref={containerRef}
          className="relative transition-opacity"
          style={{ opacity: loading ? 0.5 : 1 }}
        >
          <svg
            width="100%"
            height={HEIGHT}
            viewBox={`0 0 ${width} ${HEIGHT}`}
            onPointerMove={handlePointerMove}
            onPointerLeave={() => setHoverIndex(null)}
            role="img"
            aria-label={`${title} chart, ${n} days`}
          >
            {/* Gridlines */}
            {yTicks.map((t) => (
              <line
                key={t}
                x1={PADDING.left}
                x2={width - PADDING.right}
                y1={yFor(t)}
                y2={yFor(t)}
                stroke={gridColor}
                strokeWidth="1"
              />
            ))}
            {/* Y-axis labels */}
            {yTicks.map((t) => (
              <text key={t} x={PADDING.left - 8} y={yFor(t) + 3} textAnchor="end" fontSize="10" fill={axisTextColor}>
                {formatValue(t)}
              </text>
            ))}

            {/* X-axis labels (thinned) */}
            {data.map((d, i) =>
              i % tickEvery === 0 ? (
                <text key={d.date} x={xFor(i)} y={HEIGHT - 8} textAnchor="middle" fontSize="10" fill={axisTextColor}>
                  {formatDayTick(d.date)}
                </text>
              ) : null
            )}

            {type === 'area' ? (
              <>
                <path d={areaPath} fill={color} opacity="0.1" stroke="none" />
                <path d={linePath} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
                {/* End marker */}
                <circle cx={xFor(n - 1)} cy={yFor(data[n - 1].value)} r="4" fill={color} stroke={isDark ? '#1f2937' : '#ffffff'} strokeWidth="2" />
                {hoverIndex !== null && (
                  <circle cx={xFor(hoverIndex)} cy={yFor(data[hoverIndex].value)} r="4" fill={color} stroke={isDark ? '#1f2937' : '#ffffff'} strokeWidth="2" />
                )}
              </>
            ) : (
              data.map((d, i) => (
                <rect
                  key={d.date}
                  x={xFor(i) - barWidth / 2}
                  y={yFor(d.value)}
                  width={barWidth}
                  height={Math.max(yFor(0) - yFor(d.value), 0)}
                  rx="4"
                  fill={color}
                  opacity={hoverIndex === null || hoverIndex === i ? 1 : 0.55}
                  onPointerEnter={() => setHoverIndex(i)}
                />
              ))
            )}

            {/* Crosshair */}
            {hoverIndex !== null && (
              <line
                x1={xFor(hoverIndex)}
                x2={xFor(hoverIndex)}
                y1={PADDING.top}
                y2={yFor(0)}
                stroke={axisTextColor}
                strokeWidth="1"
                strokeDasharray="2,2"
                opacity="0.6"
              />
            )}
          </svg>

          {/* Tooltip */}
          {hovered && (
            <div
              className="absolute top-1 pointer-events-none bg-gray-900 dark:bg-gray-950 text-white text-xs rounded-lg px-3 py-2 shadow-lg whitespace-nowrap"
              style={{
                left: tooltipOnRight ? `${tooltipLeft + 10}px` : undefined,
                right: tooltipOnRight ? undefined : `${width - tooltipLeft + 10}px`,
              }}
            >
              <p className="font-semibold">{formatValue(hovered.value)}</p>
              <p className="text-gray-300 dark:text-gray-400">{formatDayTick(hovered.date)}</p>
            </div>
          )}
        </div>
      )}

      {hasData && (
        <details className="mt-2">
          <summary className="text-xs text-gray-400 dark:text-gray-500 cursor-pointer hover:text-gray-600 dark:hover:text-gray-300 select-none">
            View as table
          </summary>
          <div className="mt-2 max-h-40 overflow-y-auto border border-gray-100 dark:border-gray-700 rounded-lg">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 dark:bg-gray-900/50 sticky top-0">
                <tr className="text-left text-gray-500 dark:text-gray-400">
                  <th className="px-3 py-1.5 font-medium">Date</th>
                  <th className="px-3 py-1.5 font-medium text-right">Value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {data.map((d) => (
                  <tr key={d.date}>
                    <td className="px-3 py-1.5 text-gray-700 dark:text-gray-300">{formatDayTick(d.date)}</td>
                    <td className="px-3 py-1.5 text-right font-mono text-gray-900 dark:text-white">{formatValue(d.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}

export default TrendChart;
