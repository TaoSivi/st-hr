import { useEffect, useState } from 'react';
import { daysText } from '../domain/leavePart';
import { reducedMotion, useCountUp } from './motion';

export interface Tile {
  key: string;
  label: string;
  /** Days left, or null when there is no limit. */
  left: number | null;
  /** The yearly allowance (what the ring is measured against); null when there is none. */
  total: number | null;
  used: number;
}

const reduced = reducedMotion;

const R = 21, C = 2 * Math.PI * R;
const fmt = (n: number) => (Math.round(n * 10) / 10).toString();

function BalanceTile({ t, index, paidHours }: { t: Tile; index: number; paidHours: number }) {
  const unlimited = t.left === null;
  const share = unlimited || !t.total ? 1 : Math.max(0, Math.min(1, t.left! / t.total));
  const shown = useCountUp(unlimited ? 0 : t.left!);
  const [armed, setArmed] = useState(reduced()); // the ring fills a moment after the tile appears
  useEffect(() => { const id = requestAnimationFrame(() => setArmed(true)); return () => cancelAnimationFrame(id); }, []);
  const tone = unlimited ? 'free' : share <= 0.15 ? 'low' : share <= 0.4 ? 'mid' : 'ok';
  return (
    <div className={`lb-tile ${tone}${t.key === 'annual' ? ' main' : ''}`} style={{ animationDelay: `${index * 70}ms` }}
      role="group" aria-label={unlimited ? `${t.label} ໃຊ້ແລ້ວ ${fmt(t.used)} ມື້ ບໍ່ຈຳກັດ` : `${t.label} ເຫຼືອ ${fmt(t.left!)} ມື້`}>
      <span className="lb-ring">
        <svg viewBox="0 0 50 50" width="52" height="52" aria-hidden="true">
          <circle cx="25" cy="25" r={R} className="lb-track" />
          <circle cx="25" cy="25" r={R} className="lb-arc" strokeDasharray={C} strokeDashoffset={armed ? C * (1 - share) : C} transform="rotate(-90 25 25)" />
        </svg>
        <b className="lb-num">{unlimited ? '∞' : fmt(shown)}</b>
      </span>
      <span className="lb-text">
        <b>{t.label}</b>
        <span className="muted small">{unlimited ? `ໃຊ້ແລ້ວ ${daysText(t.used, paidHours)} · ບໍ່ຈຳກັດ` : `ເຫຼືອ ${daysText(t.left!, paidHours)}`}</span>
        <span className="muted small">{unlimited ? null : t.total ? `ໃຊ້ ${daysText(t.used, paidHours)} / ${daysText(t.total, paidHours)}` : null}</span>
      </span>
    </div>
  );
}

/** All the kinds of leave a person has, as small tiles that fit on one screen: a ring for what is left of the year's allowance. */
export default function LeaveBalances({ tiles, year, paidHours = 8 }: { tiles: Tile[]; year: number; paidHours?: number }) {
  return (
    <section className="lb" aria-label={`ມື້ລາຄົງເຫຼືອ ປີ ${year}`}>
      <div className="lb-head"><b>ມື້ລາຄົງເຫຼືອ</b><span className="muted small">ປີ {year}</span></div>
      <div className="lb-grid">{tiles.map((t, i) => <BalanceTile key={t.key} t={t} index={i} paidHours={paidHours} />)}</div>
    </section>
  );
}
