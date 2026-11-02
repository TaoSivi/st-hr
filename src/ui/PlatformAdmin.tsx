import { useEffect, useState } from 'react';
import { LocalStore } from '../data/store';
import { DEMO_COMPANY_ID, deleteCompany, listCompanies, listPayments, recordPayment, saveCompany, storePrefix } from '../data/companies';
import {
  ALL_FEATURES, countedEmployees, FEATURE_LABEL, limitsOf, PLAN_ORDER, PLANS, planState, priceFor, validatePayment, type Company, type Feature, type PlanId
} from '../domain/company';
import type { Employee } from '../domain/types';
import { money, ymd } from './format';

const STATE_LABEL = { active: 'ໃຊ້ງານໄດ້', grace: 'ເກີນກຳນົດ', expired: 'ໝົດອາຍຸ' } as const;

/**
 * The service provider's console: companies, plans, payments and per-company feature switches.
 * DEMO ONLY — it has no login. A real deployment needs a separate platform-admin account on the server.
 */
export default function PlatformAdmin({ onClose, onOpen }: { onClose: () => void; onOpen: (companyId: string) => void }) {
  const [companies, setCompanies] = useState<Company[]>(() => listCompanies());
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [paying, setPaying] = useState<string | null>(null);
  const [form, setForm] = useState<{ plan: PlanId; months: string; amount: string; note: string }>({ plan: 'basic', months: '1', amount: String(priceFor('basic', 1)), note: '' });
  const [msg, setMsg] = useState('');
  const today = ymd(new Date());
  const refresh = () => setCompanies(listCompanies());

  useEffect(() => {
    Promise.all(companies.map(async c => [c.id, countedEmployees(await new LocalStore(c.id, storePrefix(c.id)).list<Employee>('employees'), today)] as const))
      .then(rows => setCounts(Object.fromEntries(rows)));
  }, [companies]); // eslint-disable-line react-hooks/exhaustive-deps

  const pay = (c: Company) => {
    const p = { plan: form.plan, months: Number(form.months), amount: Number(form.amount.replace(/\D/g, '')) };
    const errs = validatePayment(p);
    if (errs.length) return setMsg(errs.join(' · '));
    recordPayment(c, { ...p, note: form.note.trim() || undefined }, 'platform', today);
    setMsg(`ບັນທຶກການຊຳລະ ${c.name}: ${PLANS[p.plan].label} ${p.months} ເດືອນ · ${money(p.amount)} ₭`);
    setPaying(null);
    refresh();
  };
  const setOverride = (c: Company, f: Feature, v: string) => {
    const o = { ...(c.featureOverrides ?? {}) };
    if (v === 'plan') delete o[f]; else o[f] = v === 'on';
    saveCompany({ ...c, featureOverrides: o });
    refresh();
  };
  const setLimit = (c: Company, k: 'maxEmployees' | 'maxBranches', v: string) => {
    const n = Number(v);
    const o = { ...(c.limitOverrides ?? {}) };
    if (v === '') delete o[k]; else if (Number.isInteger(n) && n >= 1) o[k] = n; else return;
    saveCompany({ ...c, limitOverrides: o });
    refresh();
  };

  return (
    <div className="phone"><div className="screen">
      <div className="row"><button className="btn ghost" onClick={onClose}>‹ ກັບ</button><h1 className="grow">ຈັດການບໍລິສັດ & ແພັກເກັດ</h1></div>
      <div className="pill warn" style={{ height: 'auto', padding: '8px 12px', whiteSpace: 'normal' }}>ໂໝດສາທິດ: ໜ້ານີ້ບໍ່ມີລະຫັດຜ່ານ. ລະບົບຈິງຕ້ອງມີບັນຊີຜູ້ໃຫ້ບໍລິການແຍກ ແລະ ຮັບຊຳລະຜ່ານທະນາຄານ / ໃບແຈ້ງໜີ້. ຕອນນີ້ບັນທຶກການຊຳລະດ້ວຍມື.</div>
      {msg && <div className="pill info" role="status" style={{ height: 'auto', padding: '6px 12px', alignSelf: 'flex-start' }}>{msg}</div>}

      <div className="card scroll-x"><b>ແພັກເກັດ (ລາຄາ ແລະ ຂີດຈຳກັດເປັນຕົວຢ່າງ — ຕັ້ງກ່ອນຂາຍຈິງ)</b>
        <table className="t"><thead><tr><th>ແພັກເກັດ</th><th className="num">ກີບ/ເດືອນ</th><th className="num">ຄົນສູງສຸດ</th><th className="num">ສາຂາສູງສຸດ</th><th>ຟີເຈີ</th></tr></thead><tbody>
          {PLAN_ORDER.map(p => <tr key={p}><td><b>{PLANS[p].label}</b></td><td className="num">{money(PLANS[p].priceLakPerMonth)}</td><td className="num">{PLANS[p].maxEmployees}</td><td className="num">{PLANS[p].maxBranches}</td><td className="small">{PLANS[p].features.map(f => FEATURE_LABEL[f]).join(', ') || '—'}</td></tr>)}
        </tbody></table></div>

      {companies.map(c => {
        const state = planState(c, today);
        const lim = limitsOf(c, today);
        const history = listPayments(c.id);
        return (
          <div key={c.id} className="card col">
            <div className="row wrap"><b className="grow" style={{ fontSize: 18 }}>{c.name}</b>
              <span className={`pill ${state === 'active' ? 'ok' : state === 'grace' ? 'warn' : 'bad'}`}>{STATE_LABEL[state]}</span></div>
            <span className="muted small">{PLANS[c.plan].label}{c.trial ? ' (ທົດລອງ)' : ''} · {c.validUntil ? `ຮອດ ${c.validUntil}` : 'ບໍ່ມີກຳນົດ'} · ພະນັກງານ {counts[c.id] ?? '…'} / {lim.maxEmployees}</span>
            <div className="row wrap">
              <button className="btn" onClick={() => onOpen(c.id)}>ເປີດບໍລິສັດນີ້</button>
              {c.id !== DEMO_COMPANY_ID && <button className="btn ghost" onClick={() => { setPaying(paying === c.id ? null : c.id); setForm(f => ({ ...f, amount: String(priceFor(f.plan, Number(f.months) || 1)) })); }}>ບັນທຶກການຊຳລະ</button>}
              {c.id !== DEMO_COMPANY_ID && <button className="btn danger" onClick={() => { if (confirm(`ລຶບ "${c.name}" ແລະ ຂໍ້ມູນທັງໝົດຂອງບໍລິສັດນີ້?`)) { deleteCompany(c.id); refresh(); } }}>ລຶບ</button>}
            </div>
            {paying === c.id && (
              <div className="col" style={{ border: '1.5px solid var(--line-2)', borderRadius: 14, padding: 12 }}>
                <div className="row wrap">{(['basic', 'pro'] as PlanId[]).map(p => <button key={p} className={`btn ${form.plan === p ? '' : 'ghost'}`} aria-pressed={form.plan === p} onClick={() => setForm({ ...form, plan: p, amount: String(priceFor(p, Number(form.months) || 1)) })}>{PLANS[p].label}</button>)}</div>
                <div className="row wrap">
                  <label className="field" style={{ width: 110 }}>ເດືອນ<input className="input" inputMode="numeric" value={form.months} onChange={e => { const m = e.target.value.replace(/\D/g, ''); setForm({ ...form, months: m, amount: String(priceFor(form.plan, Number(m) || 0)) }); }} /></label>
                  <label className="field grow">ຈຳນວນເງິນທີ່ຮັບ (ກີບ)<input className="input" inputMode="numeric" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value.replace(/\D/g, '') })} /></label></div>
                <label className="field">ໝາຍເຫດ (ເລກໃບໂອນ / ໃບຮັບເງິນ)<input className="input" value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} /></label>
                <button className="btn" onClick={() => pay(c)}>ບັນທຶກ ແລະ ຕໍ່ອາຍຸ</button>
              </div>)}
            <fieldset style={{ border: '1.5px solid var(--line-2)', borderRadius: 14, padding: '6px 12px' }}><legend className="small muted">ເປີດ / ປິດຟີເຈີ ສະເພາະບໍລິສັດນີ້</legend>
              {ALL_FEATURES.map(f => (
                <label key={f} className="row" style={{ minHeight: 44 }}><span className="grow small">{FEATURE_LABEL[f]}</span>
                  <select className="input" style={{ width: 130 }} value={c.featureOverrides?.[f] === undefined ? 'plan' : c.featureOverrides[f] ? 'on' : 'off'} onChange={e => setOverride(c, f, e.target.value)} aria-label={FEATURE_LABEL[f]}>
                    <option value="plan">ຕາມແພັກເກັດ</option><option value="on">ເປີດ</option><option value="off">ປິດ</option></select></label>))}
              <div className="row wrap">
                <label className="field grow">ຄົນສູງສຸດ (ວ່າງ = ຕາມແພັກເກັດ)<input className="input" inputMode="numeric" defaultValue={c.limitOverrides?.maxEmployees ?? ''} onBlur={e => setLimit(c, 'maxEmployees', e.target.value)} /></label>
                <label className="field grow">ສາຂາສູງສຸດ<input className="input" inputMode="numeric" defaultValue={c.limitOverrides?.maxBranches ?? ''} onBlur={e => setLimit(c, 'maxBranches', e.target.value)} /></label></div>
            </fieldset>
            {history.length > 0 && <div className="col small" style={{ gap: 2 }}><b>ປະຫວັດການຊຳລະ</b>{history.map(p => <span key={p.id}>{p.paidAt} · {PLANS[p.plan].label} {p.months} ເດືອນ · {money(p.amount)} ₭{p.note ? ` · ${p.note}` : ''}</span>)}</div>}
          </div>);
      })}
    </div></div>
  );
}
