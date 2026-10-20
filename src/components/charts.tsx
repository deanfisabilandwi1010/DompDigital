// Grafik SVG ringan + tabel alternatif. Satu sumbu, mark tipis, tooltip hover & fokus keyboard.
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useStore } from '../app/store';
import { formatCompact } from '../domain/money';
import type { SeriesBucket } from '../domain/ledger';
import type { Money } from '../domain/types';

export function AccessibleDataTable({ caption, headers, rows, alignRight = [] }: { caption: string; headers: string[]; rows: ReactNode[][]; alignRight?: number[] }) {
  return (
    <div className="table-wrap" role="region" aria-label={caption} tabIndex={0}>
      <table className="table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>{headers.map((h, i) => <th key={i} scope="col" className={alignRight.includes(i) ? 'r' : ''}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>{r.map((c, j) => <td key={j} className={alignRight.includes(j) ? 'r' : ''}>{c}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Lebar kontainer nyata agar 1 unit SVG = 1px (teks grafik tidak ikut membesar/mengecil). */
function useWidth<T extends HTMLElement>(fallback: number) {
  const ref = useRef<T>(null);
  const [w, setW] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((e) => setW(Math.max(240, Math.round(e[0].contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

/** Batang berkelompok: pemasukan vs pengeluaran bersih per bucket. */
export function FlowChart({ data, onSelect, description }: { data: SeriesBucket[]; onSelect?: (b: SeriesBucket) => void; description: string }) {
  const { fmt, hidden } = useStore();
  const [active, setActive] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);
  const descId = useId();
  const [wrapRef, W] = useWidth<HTMLDivElement>(640);
  const H = W < 480 ? 200 : 250;
  const pad = { l: 48, r: 8, t: 12, b: 28 };
  const minV = Math.min(0, ...data.map((d) => d.netExpense));
  const maxV = niceMax(Math.max(1, ...data.map((d) => Math.max(d.income, d.netExpense))));
  const lo = minV < 0 ? -niceMax(-minV) : 0;
  const y = (v: number) => pad.t + ((maxV - v) / (maxV - lo)) * (H - pad.t - pad.b);
  const bw = (W - pad.l - pad.r) / Math.max(1, data.length);
  const barW = Math.max(2, Math.min(18, bw * 0.34));
  // Tick di kelipatan rapi dari nol; tick negatif hanya bila tidak bertabrakan dengan nol.
  const ticks = [0, 1, 2, 3, 4].map((i) => (maxV / 4) * i);
  if (lo < 0 && y(lo) - y(0) >= 14) ticks.unshift(lo);
  const labelEvery = Math.ceil(data.length / Math.max(3, Math.floor((W - pad.l) / 64)));

  const act = active != null ? data[active] : null;
  return (
    <figure className="stack" style={{ margin: 0 }}>
      <div className="spread">
        <div className="legend" aria-hidden="true">
          <span className="legend__item"><span className="legend__swatch" style={{ background: 'var(--chart-income)' }} />Pemasukan</span>
          <span className="legend__item"><span className="legend__swatch" style={{ background: 'var(--chart-expense)' }} />Pengeluaran bersih</span>
        </div>
        <button type="button" className="link-btn small" onClick={() => setShowTable((s) => !s)} aria-expanded={showTable}>
          {showTable ? 'Lihat grafik' : 'Lihat tabel'}
        </button>
      </div>
      <figcaption id={descId} className="chart-desc">{description}</figcaption>
      {showTable ? (
        <AccessibleDataTable
          caption="Tabel arus pemasukan dan pengeluaran"
          headers={['Periode', 'Pemasukan', 'Pengeluaran bersih']}
          alignRight={[1, 2]}
          rows={data.map((d) => [d.label, fmt(d.income), fmt(d.netExpense)])}
        />
      ) : (
        <div className="chart-wrap" ref={wrapRef} onMouseLeave={() => setActive(null)}>
          <svg className="chart" width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="group" aria-describedby={descId}>
            <g className="grid">
              {ticks.map((t, i) => (
                <g key={i}>
                  <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} />
                  <text x={pad.l - 6} y={y(t) + 4} textAnchor="end">{hidden ? '•••' : formatCompact(t)}</text>
                </g>
              ))}
            </g>
            <line className="zero" x1={pad.l} x2={W - pad.r} y1={y(0)} y2={y(0)} />
            {data.map((d, i) => {
              const cx = pad.l + bw * i + bw / 2;
              const yi = y(d.income);
              const ye = y(Math.max(0, d.netExpense));
              const yen = y(Math.min(0, d.netExpense));
              return (
                <g key={d.key} className={active === i ? 'is-active' : ''}>
                  {d.income > 0 && <rect className="bar" x={cx - barW - 1} y={yi} width={barW} height={Math.max(1, y(0) - yi)} rx={3} fill="var(--chart-income)" />}
                  {d.netExpense !== 0 && (
                    <rect className="bar" x={cx + 1} y={d.netExpense > 0 ? ye : y(0)} width={barW} height={Math.max(1, d.netExpense > 0 ? y(0) - ye : yen - y(0))} rx={3} fill="var(--chart-expense)" />
                  )}
                  {i % labelEvery === 0 && (
                    <text x={cx} y={H - 8} textAnchor="middle">{d.label}</text>
                  )}
                  <rect
                    className="hit"
                    x={pad.l + bw * i}
                    y={pad.t}
                    width={bw}
                    height={H - pad.t - pad.b}
                    tabIndex={0}
                    role="button"
                    aria-label={`${d.label}: pemasukan ${fmt(d.income)}, pengeluaran bersih ${fmt(d.netExpense)}${onSelect ? '. Tekan Enter untuk melihat transaksi.' : ''}`}
                    onMouseEnter={() => setActive(i)}
                    onFocus={() => setActive(i)}
                    onBlur={() => setActive(null)}
                    onClick={() => onSelect?.(d)}
                    onKeyDown={(e) => {
                      if ((e.key === 'Enter' || e.key === ' ') && onSelect) {
                        e.preventDefault();
                        onSelect(d);
                      }
                    }}
                  />
                  <rect className="focus-ring" x={pad.l + bw * i + 1} y={pad.t} width={bw - 2} height={H - pad.t - pad.b} fill="none" rx={4} />
                </g>
              );
            })}
          </svg>
          {act && (
            <div className="chart-tip" style={{ left: `${((pad.l + bw * (active! + 0.5)) / W) * 100}%`, top: `${(pad.t / H) * 100 + 8}%` }}>
              <strong>{act.label}</strong>
              <div><span className="sw" style={{ background: 'var(--chart-income)' }} />Pemasukan {fmt(act.income)}</div>
              <div><span className="sw" style={{ background: 'var(--chart-expense)' }} />Pengeluaran {fmt(act.netExpense)}</div>
            </div>
          )}
        </div>
      )}
    </figure>
  );
}

export interface BarItem {
  key: string;
  label: string;
  value: Money;
  icon?: string;
  hint?: string;
}

/**
 * Batang horizontal untuk distribusi kategori. Nilai negatif (refund lintas periode)
 * digambar ke kiri sumbu nol — diagram batang divergen, bukan donut.
 */
export function CategoryBars({ items, onSelect, description, emptyText, total }: { items: BarItem[]; onSelect?: (i: BarItem) => void; description: string; emptyText: string; total?: Money }) {
  const { fmt } = useStore();
  const [showTable, setShowTable] = useState(false);
  const descId = useId();
  if (items.length === 0) return <p className="muted">{emptyText}</p>;
  const maxPos = Math.max(0, ...items.map((i) => i.value));
  const maxNeg = Math.max(0, ...items.map((i) => -i.value));
  const span = maxPos + maxNeg || 1;
  const zero = (maxNeg / span) * 100;
  const share = (v: Money) => (total && total > 0 && v > 0 ? `${Math.round((v / total) * 100)}%` : '');
  return (
    <figure className="stack" style={{ margin: 0 }}>
      <div className="spread">
        <figcaption id={descId} className="chart-desc">{description}</figcaption>
        <button type="button" className="link-btn small" onClick={() => setShowTable((s) => !s)} aria-expanded={showTable}>
          {showTable ? 'Lihat grafik' : 'Lihat tabel'}
        </button>
      </div>
      {showTable ? (
        <AccessibleDataTable
          caption={description}
          headers={['Kategori', 'Nominal bersih', 'Porsi']}
          alignRight={[1, 2]}
          rows={items.map((i) => [i.label, fmt(i.value), share(i.value) || '—'])}
        />
      ) : (
        <div className="hbars" aria-describedby={descId}>
          {items.map((i) => {
            const w = (Math.abs(i.value) / span) * 100;
            return (
              <button
                key={i.key}
                type="button"
                className="hbar"
                onClick={() => onSelect?.(i)}
                aria-label={`${i.label}: ${fmt(i.value)}${share(i.value) ? `, ${share(i.value)}` : ''}${i.value < 0 ? ' (pengembalian melebihi pengeluaran)' : ''}. Lihat transaksi.`}
              >
                <span className="hbar__top">
                  <span className="hbar__name">{i.icon} {i.label}</span>
                  <span className="hbar__val">{fmt(i.value)} {share(i.value) && <span className="muted">· {share(i.value)}</span>}</span>
                </span>
                <span className="hbar__track" aria-hidden="true">
                  {maxNeg > 0 && <span className="hbar__axis" style={{ left: `${zero}%` }} />}
                  <span
                    className={`hbar__fill ${i.value < 0 ? 'hbar__fill--neg' : ''}`}
                    style={i.value < 0 ? { left: `${zero - w}%`, width: `${w}%` } : { left: `${zero}%`, width: `${Math.max(w, 0.8)}%` }}
                  />
                </span>
              </button>
            );
          })}
        </div>
      )}
    </figure>
  );
}
