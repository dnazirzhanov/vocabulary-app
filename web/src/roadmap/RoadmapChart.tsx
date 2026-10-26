import { useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { Roadmap } from '../lib/roadmap.ts';
import { wordsLabel } from '../lib/pace.ts';
import styles from './RoadmapChart.module.css';

const tick = new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'short' });
const full = new Intl.DateTimeFormat('ru', { weekday: 'short', day: 'numeric', month: 'long' });
const HEIGHT = 220;
const PAD = { top: 16, right: 20, bottom: 30, left: 40 };
const MIN_TICK_GAP = 64;

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

/**
 * Words over calendar time, one axis: words met, and words expected to be well remembered (which
 * lags behind). Two series, so a legend plus direct labels; a crosshair and tooltip on hover or
 * with the arrow keys; the exact numbers are also in the weekly table beside it.
 */
export function RoadmapChart({ roadmap, total }: { roadmap: Roadmap; total: number }) {
  const { ref, width } = useWidth();
  const [active, setActive] = useState<number | null>(null);
  const days = roadmap.days;
  const last = Math.max(1, days.length - 1);
  const plotWidth = Math.max(0, width - PAD.left - PAD.right);
  const plotHeight = HEIGHT - PAD.top - PAD.bottom;
  const x = (index: number) => PAD.left + (index / last) * plotWidth;
  const y = (words: number) => PAD.top + plotHeight - (words / Math.max(1, total)) * plotHeight;
  const path = (value: (index: number) => number) =>
    days.map((_, index) => `${index === 0 ? 'M' : 'L'}${x(index).toFixed(1)},${y(value(index)).toFixed(1)}`).join('');

  // Ticks: Mondays for short plans, the 1st of each month for long ones; thinned to stay readable.
  const long = days.length > 45;
  const ticks: number[] = [0];
  days.forEach((day, index) => {
    const candidate = long ? day.date.getDate() === 1 : day.date.getDay() === 1;
    if (candidate && x(index) - x(ticks[ticks.length - 1]) >= MIN_TICK_GAP && x(last) - x(index) >= 24)
      ticks.push(index);
  });
  const finishIndex = roadmap.finish ? days.findIndex((day) => day.date.getTime() === roadmap.finish!.getTime()) : -1;

  const move = (event: PointerEvent<SVGRectElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const index = Math.round(((event.clientX - box.left) / Math.max(1, box.width)) * last);
    setActive(Math.min(last, Math.max(0, index)));
  };
  const key = (event: KeyboardEvent) => {
    const step = { ArrowRight: 1, ArrowLeft: -1, Home: -Infinity, End: Infinity }[event.key];
    if (step === undefined) return;
    event.preventDefault();
    setActive((current) => Math.min(last, Math.max(0, (current ?? (step > 0 ? -1 : last + 1)) + step)));
  };

  const shown = active === null ? null : days[active];
  // Direct labels sit where each line crosses half the deck: the met line rises first (label above,
  // to its left), the remembered line later (label below, to its right), so they never collide.
  const crossing = (value: (index: number) => number) =>
    Math.max(
      0,
      days.findIndex((_, index) => value(index) >= total / 2),
    );
  const metLabelAt = crossing((index) => days[index].met);
  const firmLabelAt = crossing((index) => days[index].firm);
  // Labels flip to the other side of their line when the preferred side would leave the chart.
  const labelWidth = (text: string) => text.length * 7.2;
  const placeLabel = (index: number, value: number, text: string, prefer: 'left' | 'right') => {
    const px = x(index);
    const fitsLeft = px - 8 - labelWidth(text) >= 0;
    const fitsRight = px + 8 + labelWidth(text) <= width;
    const side = prefer === 'left' ? (fitsLeft ? 'left' : 'right') : fitsRight ? 'right' : 'left';
    return side === 'left'
      ? { x: px - 8, y: y(value) - 6, anchor: 'end' as const, text }
      : { x: px + 8, y: y(value) + 16, anchor: 'start' as const, text };
  };
  const labels =
    last >= 4
      ? [
          placeLabel(metLabelAt, days[metLabelAt].met, 'познакомитесь', 'left'),
          placeLabel(firmLabelAt, days[firmLabelAt].firm, 'хорошо помните', 'right'),
        ]
      : [];
  return (
    <figure className={styles.figure}>
      <figcaption className={styles.legend}>
        <span>
          <i className={styles.swatchMet} aria-hidden="true" /> Познакомитесь
        </span>
        <span>
          <i className={styles.swatchFirm} aria-hidden="true" /> Хорошо помните
        </span>
      </figcaption>
      <div
        ref={ref}
        className={styles.plot}
        tabIndex={0}
        role="img"
        aria-label={`План: ${wordsLabel(total)}${roadmap.finish ? `, последнее новое слово — ${full.format(roadmap.finish)}` : ''}. Стрелки показывают дни.`}
        onKeyDown={key}
        onBlur={() => setActive(null)}
      >
        {width > 0 && (
          <svg width={width} height={HEIGHT} aria-hidden="true">
            {[0, Math.round(total / 2), total].map((value) => (
              <g key={value}>
                <line className={styles.grid} x1={PAD.left} x2={width - PAD.right} y1={y(value)} y2={y(value)} />
                <text className={styles.axis} x={PAD.left - 8} y={y(value)} dy="0.35em" textAnchor="end">
                  {value}
                </text>
              </g>
            ))}
            {ticks.map((index) => (
              <text
                key={index}
                className={styles.axis}
                x={x(index)}
                y={HEIGHT - 8}
                textAnchor={index === 0 ? 'start' : 'middle'}
              >
                {index === 0 ? 'сегодня' : tick.format(days[index].date)}
              </text>
            ))}
            {finishIndex > 0 && (
              <g>
                <line
                  className={styles.finish}
                  x1={x(finishIndex)}
                  x2={x(finishIndex)}
                  y1={PAD.top}
                  y2={PAD.top + plotHeight}
                />
              </g>
            )}
            <path className={styles.firm} d={path((index) => days[index].firm)} />
            <path className={styles.met} d={path((index) => days[index].met)} />
            {labels.map((label) => (
              <text key={label.text} className={styles.direct} x={label.x} y={label.y} textAnchor={label.anchor}>
                {label.text}
              </text>
            ))}
            {shown && active !== null && (
              <g>
                <line
                  className={styles.crosshair}
                  x1={x(active)}
                  x2={x(active)}
                  y1={PAD.top}
                  y2={PAD.top + plotHeight}
                />
                <circle className={styles.dotFirm} cx={x(active)} cy={y(shown.firm)} r={5} />
                <circle className={styles.dotMet} cx={x(active)} cy={y(shown.met)} r={5} />
              </g>
            )}
            <rect
              className={styles.hit}
              x={PAD.left}
              y={0}
              width={plotWidth}
              height={HEIGHT}
              onPointerMove={move}
              onPointerDown={move}
              onPointerLeave={() => setActive(null)}
            />
          </svg>
        )}
        {shown && active !== null && (
          <div
            className={styles.tooltip}
            style={{ left: Math.min(Math.max(x(active), 90), Math.max(90, width - 90)) }}
            aria-hidden="true"
          >
            <strong>{full.format(shown.date)}</strong>
            <span>Познакомитесь: {shown.met}</span>
            <span>Хорошо помните: {shown.firm}</span>
            {!shown.study && <span className={styles.rest}>выходной</span>}
          </div>
        )}
      </div>
    </figure>
  );
}
