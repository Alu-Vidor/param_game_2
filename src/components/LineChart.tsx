import { useEffect, useId, useRef, useState } from "react";
import { number } from "../lib/workspace";

export interface ChartPoint {
  t: number;
  value: number | null;
}
interface Props {
  title: string;
  samples: ChartPoint[];
  curve: ChartPoint[];
  selectedT: number;
  parameter: string;
  unit?: string;
}

function tick(value: number) {
  if (value !== 0 && (Math.abs(value) >= 1e6 || Math.abs(value) < 0.001))
    return value.toExponential(1);
  return number(value, Math.abs(value) < 1 ? 3 : 2);
}

export default function LineChart({
  title,
  samples,
  curve,
  selectedT,
  parameter,
  unit,
}: Props) {
  const id = useId();
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const resize = () =>
      setWidth(
        Math.max(240, Math.round(element.getBoundingClientRect().width)),
      );
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const all = [...samples, ...curve].filter(
    (p): p is { t: number; value: number } =>
      Number.isFinite(p.t) && p.value !== null && Number.isFinite(p.value),
  );
  if (!all.length)
    return <p className="help-text">Для этого графика нет численных данных.</p>;
  const left = 70,
    right = width - 16,
    top = 22,
    bottom = 224;
  const xTicks = width < 480 ? [0, 1, 2] : [0, 1, 2, 3, 4];
  const minT = Math.min(...all.map((p) => p.t)),
    maxT = Math.max(...all.map((p) => p.t));
  const low = Math.min(...all.map((p) => p.value)),
    high = Math.max(...all.map((p) => p.value));
  const spread = high - low || Math.max(Math.abs(high) * 0.1, 1);
  const minY = low - spread * 0.08,
    maxY = high + spread * 0.08;
  const x = (t: number) =>
    left + ((t - minT) / (maxT - minT || 1)) * (right - left);
  const y = (v: number) =>
    bottom - ((v - minY) / (maxY - minY)) * (bottom - top);
  let drawing = false;
  const path = curve
    .map((p) => {
      if (p.value === null || !Number.isFinite(p.value)) {
        drawing = false;
        return "";
      }
      const command = drawing ? "L" : "M";
      drawing = true;
      return `${command}${x(p.t).toFixed(2)},${y(p.value).toFixed(2)}`;
    })
    .join(" ");
  return (
    <figure className="line-chart">
      <figcaption>
        <h3>{title}</h3>
        {unit && <span className="help-text">{unit}</span>}
      </figcaption>
      <div
        ref={container}
        className="line-chart-scroll"
        role="region"
        tabIndex={0}
        aria-label={`График: ${title}`}
      >
        <svg
          className="chart-svg"
          viewBox={`0 0 ${width} 280`}
          role="img"
          aria-labelledby={`${id}-title ${id}-desc`}
        >
          <title id={`${id}-title`}>{title}</title>
          <desc id={`${id}-desc`}>
            Численные решения показаны точками, а приближение пунктирной линией.{" "}
            {parameter} меняется от {number(minT)} до {number(maxT)}.
            Вертикальная линия отмечает выбранную расчётную точку. Шкала
            значений подобрана по данным. Все значения доступны в таблице
            результатов.
          </desc>
          {[0, 1, 2, 3, 4].map((i) => {
            const value = minY + ((maxY - minY) * i) / 4;
            return (
              <g key={i}>
                <line
                  x1={left}
                  x2={right}
                  y1={y(value)}
                  y2={y(value)}
                  stroke="var(--color-rule)"
                />
                <text
                  x={left - 12}
                  y={y(value) + 4}
                  textAnchor="end"
                  className="chart-label"
                >
                  {tick(value)}
                </text>
              </g>
            );
          })}
          {xTicks.map((i, index) => {
            const value = minT + ((maxT - minT) * i) / (xTicks.length - 1);
            return (
              <text
                key={i}
                x={x(value)}
                y={bottom + 25}
                textAnchor={
                  index === xTicks.length - 1
                    ? "end"
                    : index === 0
                      ? "start"
                      : "middle"
                }
                className="chart-label"
              >
                {tick(value)}
              </text>
            );
          })}
          {selectedT >= minT && selectedT <= maxT && (
            <line
              x1={x(selectedT)}
              x2={x(selectedT)}
              y1={top}
              y2={bottom}
              stroke="var(--color-muted)"
              strokeDasharray="3 5"
              className="chart-selection"
            />
          )}
          {path && (
            <path
              d={path}
              fill="none"
              stroke="var(--color-muted)"
              strokeWidth={2}
              strokeDasharray="6 4"
            />
          )}
          {samples.map((p, i) =>
            p.value === null || !Number.isFinite(p.value) ? null : (
              <circle
                key={i}
                cx={x(p.t)}
                cy={y(p.value)}
                r={p.t === selectedT ? 4.5 : 3}
                fill="var(--color-accent)"
              >
                <title>
                  {parameter} = {number(p.t, 6)}: {number(p.value, 6)}
                </title>
              </circle>
            ),
          )}
          <text x={right} y={271} textAnchor="end" className="chart-label">
            {parameter}
          </text>
        </svg>
      </div>
    </figure>
  );
}
