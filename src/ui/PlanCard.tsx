import { useHR } from '../app/state';
import { ALL_FEATURES, countedEmployees, FEATURE_LABEL, featureOn, limitsOf, planState, PLANS, effectivePlan } from '../domain/company';
import { ymd } from './format';

const STATE_LABEL = { active: 'ໃຊ້ງານໄດ້', grace: 'ເກີນກຳນົດ (ຍັງໃຊ້ໄດ້ຊົ່ວຄາວ)', expired: 'ໝົດອາຍຸ' } as const;

/** The company's own view of its plan: what it has, how much of it is used, and until when. Read-only: changes go through the service provider. */
export function PlanCard() {
  const hr = useHR();
  const c = hr.company;
  const today = ymd(new Date());
  const state = planState(c, today);
  const plan = PLANS[effectivePlan(c, today)];
  const lim = limitsOf(c, today);
  const used = countedEmployees(hr.employees, today);
  return (
    <div className="card col">
      <div className="row wrap"><h2 className="grow">ແພັກເກັດ</h2><span className={`pill ${state === 'active' ? 'ok' : state === 'grace' ? 'warn' : 'bad'}`}>{STATE_LABEL[state]}</span></div>
      <div className="row wrap"><span className="grow"><b>{c.name}</b> · {PLANS[c.plan].label}{c.trial ? ' (ທົດລອງ)' : ''}</span>
        <span className="muted small">{c.validUntil ? `ຮອດວັນທີ ${c.validUntil.split('-').reverse().join('/')}` : 'ບໍ່ມີກຳນົດໝົດອາຍຸ'}</span></div>
      {state === 'expired' && <span className="small" style={{ color: 'var(--bad, #c0392b)' }}>ໝົດອາຍຸແລ້ວ: ໃຊ້ແພັກເກັດ Free ({plan.maxEmployees} ຄົນ, {plan.maxBranches} ສາຂາ) ຈົນກວ່າຈະຕໍ່ອາຍຸ. ຂໍ້ມູນທັງໝົດຍັງຢູ່ຄົບ.</span>}
      <div className="row wrap small"><span>ພະນັກງານ <b>{used} / {lim.maxEmployees}</b></span><span>ສາຂາ <b>{hr.branches.length} / {lim.maxBranches}</b></span></div>
      <div className="col small" style={{ gap: 2 }}>{ALL_FEATURES.map(f => <span key={f}>{featureOn(c, f, today) ? '✓' : '✗'} {FEATURE_LABEL[f]}</span>)}</div>
    </div>
  );
}
