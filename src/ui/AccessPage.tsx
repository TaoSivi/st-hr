import { useEffect, useState } from 'react';
import { useHR } from '../app/state';
import type { ApprovalKey, Employee, Role, SelfMenu, Settings } from '../domain/types';
import { actionRoles, canDo, canGrantRoles, roleChangeBlock, SELF_MENUS } from '../domain/permissions';
import { REQUEST_LABEL, requestApprovers, APPROVER_ROLES, type RequestKind } from '../domain/requests';
import { validateSettings } from '../domain/settingsCheck';
import { pinFields, tempPin } from '../domain/pin';
import { isActiveOn } from '../domain/hiring';
import { ROLE_NAMES, ymd } from './format';

/** Approval rows in the order people think of them. 'leave' is the leave approvers setting; the rest are request kinds or actions. */
const ROWS: [ApprovalKey | 'leave', string][] = [
  ['leave', 'ການລາ'], ['scan.review', 'ກວດການສະແກນທີ່ລໍກວດ'], ['clockFix', REQUEST_LABEL.clockFix], ['ot', REQUEST_LABEL.ot],
  ['shiftSwap', REQUEST_LABEL.shiftSwap], ['dayOffSwap', REQUEST_LABEL.dayOffSwap], ['schedule', REQUEST_LABEL.schedule],
  ['expense', REQUEST_LABEL.expense], ['advance.decide', 'ເບີກເງິນລ່ວງໜ້າ'], ['certificate', REQUEST_LABEL.certificate],
  ['leaveCancel', REQUEST_LABEL.leaveCancel], ['deviceChange', REQUEST_LABEL.deviceChange], ['faceReset', REQUEST_LABEL.faceReset]
];
const PICKABLE: Role[] = ['head', 'accountant']; // the owner always approves; the auditor and plain employees never do

const MENU_LABEL: Record<SelfMenu, string> = {
  directory: 'ລາຍຊື່ພະນັກງານ', reports: 'ລາຍງານຂອງຕົນເອງ', clockFix: 'ຂໍແກ້ເວລາເຂົ້າ-ອອກ', shift: 'ສະລັບກະ ແລະ ວັນພັກ', schedule: 'ຈັດຕາຕະລາງວຽກ',
  ot: 'ຂໍລ່ວງເວລາ (OT)', expense: 'ບັນທຶກຄ່າໃຊ້ຈ່າຍ', certificate: 'ຂໍໜັງສືຮັບຮອງ', pay: 'ເບິ່ງສະລິບເງິນເດືອນ', advance: 'ເບີກເງິນລ່ວງໜ້າ'
};

const isRequestKind = (k: string): k is RequestKind => k in APPROVER_ROLES;
const effective = (key: ApprovalKey | 'leave', s: Settings): Role[] =>
  key === 'leave' ? s.leaveApproverRoles : isRequestKind(key) ? requestApprovers(key, s) : actionRoles(key, s);
const defaultOf = (key: ApprovalKey): Role[] => (isRequestKind(key) ? APPROVER_ROLES[key] : actionRoles(key));
const sameRoles = (a: Role[], b: Role[]) => a.length === b.length && a.every(r => b.includes(r));

/** Who has which role, who approves what, and which self-service menus the company uses. The owner changes it; the auditor reads it. */
export default function AccessPage() {
  const hr = useHR();
  const me = hr.me!;
  const readOnly = !canDo(me.roles, 'settings.edit');
  const canRoles = canGrantRoles(me.roles);
  const isSuper = !!me.superAdmin;
  // an Admin's or the Super admin's account is the Super admin's to manage (the database refuses anyone else)
  const superOnly = (e: Employee) => !isSuper && e.id !== me.id && (!!e.superAdmin || e.roles.includes('owner')) && !!hr.employees.some(x => x.superAdmin);
  const today = ymd(new Date());
  const people = hr.employees.filter(e => isActiveOn(e, today));
  const depts = [...new Set(hr.employees.map(e => e.dept))];
  const [msg, setMsg] = useState('');
  const [editing, setEditing] = useState<{ id: string; roles: Role[]; headOf: string[] } | null>(null);
  const [issued, setIssued] = useState<{ code: string; name: string; pin: string }[]>([]);

  // approvals + menus are edited together and saved with one button
  const [draft, setDraft] = useState(() => ({ ...hr.settings }));
  const stored = JSON.stringify([hr.settings.leaveApproverRoles, hr.settings.approverRoles, hr.settings.employeeMenus, hr.settings.leaveApproversRequired, hr.settings.makerChecker]);
  useEffect(() => { setDraft({ ...hr.settings }); }, [stored]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = JSON.stringify([draft.leaveApproverRoles, draft.approverRoles, draft.employeeMenus, draft.leaveApproversRequired, draft.makerChecker]) !== stored;
  const errors = validateSettings(draft);

  const toggleApprover = (key: ApprovalKey | 'leave', role: Role) => setDraft(d => {
    const cur = effective(key, d);
    const next = cur.includes(role) ? cur.filter(r => r !== role) : [...cur, role];
    const withOwnerRole: Role[] = next.includes('owner') ? next : [...next, 'owner'];
    if (key === 'leave') return { ...d, leaveApproverRoles: withOwnerRole };
    const approverRoles = { ...d.approverRoles };
    // keep only real changes from the default, so a later change of the default still reaches companies that never touched it
    if (sameRoles(withOwnerRole, defaultOf(key))) delete approverRoles[key]; else approverRoles[key] = withOwnerRole;
    return { ...d, approverRoles };
  });
  const toggleMenu = (m: SelfMenu) => setDraft(d => {
    const employeeMenus = { ...d.employeeMenus };
    if (employeeMenus[m] === false) delete employeeMenus[m]; else employeeMenus[m] = false;
    return { ...d, employeeMenus };
  });
  const saveRules = async () => {
    if (readOnly || errors.length) return;
    await hr.save('settings', { ...hr.settings, leaveApproverRoles: draft.leaveApproverRoles, approverRoles: draft.approverRoles, employeeMenus: draft.employeeMenus, leaveApproversRequired: draft.leaveApproversRequired, makerChecker: draft.makerChecker, id: hr.settings.companyId }, 'settings-update');
    setMsg('ບັນທຶກສິດການອະນຸມັດ ແລະ ເມນູແລ້ວ');
  };

  const saveRoles = async () => {
    if (!editing) return;
    const e = hr.employees.find(x => x.id === editing.id)!;
    const block = roleChangeBlock(hr.employees, e.id, editing.roles, me.id);
    if (block) return setMsg(block);
    const headOf = editing.roles.includes('head') ? (editing.headOf.includes('*') ? ['*'] : editing.headOf.length ? editing.headOf : [e.dept]) : undefined;
    await hr.save('employees', { ...e, roles: editing.roles, headOf }, 'role-change');
    setMsg(`ປ່ຽນບົດບາດ ${e.name} ແລ້ວ`);
    setEditing(null);
  };
  const resetPins = async (list: Employee[]) => {
    const out: { code: string; name: string; pin: string }[] = [];
    setMsg('');
    try {
      for (const e of list) {
        const pin = tempPin();
        if (hr.online) {
          // an online login is made (or its PIN replaced) on the server; the flag makes the person choose their own PIN at first sign-in
          await (hr.online.logins.has(e.id) ? hr.online.resetPin(e, pin) : hr.online.createLogin(e, pin));
          await hr.save('employees', { ...e, pinMustChange: true }, 'pin-reset');
        } else await hr.save('employees', { ...e, ...(await pinFields(pin, true)) }, 'pin-reset');
        out.push({ code: e.code, name: e.name, pin });
      }
    } catch (e: any) {
      setIssued(out);
      return setMsg(`ອອກ PIN ໄດ້ ${out.length} ຄົນ ແລ້ວຢຸດ: ${e?.message || ''}`);
    }
    setIssued(out);
    setMsg(`ອອກ PIN ຊົ່ວຄາວ ${out.length} ຄົນ — ໃຫ້ແຕ່ລະຄົນ ແລ້ວເຂົາຕ້ອງຕັ້ງ PIN ເອງຕອນເຂົ້າເທື່ອທຳອິດ`);
  };
  const hasLogin = (e: Employee) => (hr.online ? hr.online.logins.has(e.id) : !!e.pinHash);
  const noPin = people.filter(e => !hasLogin(e) && e.id !== me.id && !superOnly(e));
  const pinState = (e: Employee) => (!hasLogin(e) ? <span className="pill warn">ຍັງບໍ່ມີ PIN</span> : e.pinMustChange ? <span className="pill info">PIN ຊົ່ວຄາວ</span> : <span className="pill ok">ມີ PIN</span>);

  return (
    <>
      <div className="col" style={{ gap: 0 }}><span className="muted">{readOnly ? 'ເບິ່ງໄດ້ຢ່າງດຽວ' : 'ສະເພາະເຈົ້າຂອງ ປ່ຽນໄດ້ · ທຸກການປ່ຽນມີບັນທຶກໃນ ບັນທຶກການແກ້ໄຂ'}</span><h1>ສິດ & ການອະນຸມັດ</h1></div>
      {msg && <div className="pill info" role="status" style={{ alignSelf: 'flex-start', height: 'auto', padding: '6px 12px', whiteSpace: 'normal' }}>{msg}</div>}

      {hr.online && canRoles && (
        <div className="card col">
          <h2>ລິ້ງຕັ້ງຄ່າມືຖືພະນັກງານ</h2>
          <span className="muted small">ສົ່ງລິ້ງນີ້ໃຫ້ພະນັກງານ (LINE / WhatsApp). ເປີດລິ້ງໃນມືຖືຂອງຕົນເອງ ແລ້ວເຂົ້າດ້ວຍລະຫັດພະນັກງານ + PIN. ລິ້ງບໍ່ມີຄວາມລັບ — PIN ເປັນຄວາມລັບ ຕ້ອງໃຫ້ແຕ່ລະຄົນແຍກ.</span>
          <input className="input" readOnly value={hr.online.joinLink()} onFocus={e => e.target.select()} aria-label="ລິ້ງຕັ້ງຄ່າມືຖື" />
          <div className="row wrap"><button className="btn" onClick={() => { navigator.clipboard?.writeText(hr.online!.joinLink()); setMsg('ຄັດລອກລິ້ງແລ້ວ'); }}>ຄັດລອກລິ້ງ</button><span className="muted small">ລະຫັດບໍລິສັດ: <b>{hr.companyId}</b></span></div>
        </div>)}

      {issued.length > 0 && (
        <div className="card col" style={{ borderColor: 'var(--warn)', background: 'var(--warn-bg)' }}>
          <div className="row wrap"><h2 className="grow">PIN ຊົ່ວຄາວ (ສະແດງເທື່ອດຽວ)</h2><button className="btn ghost no-print" onClick={() => window.print()}>ພິມ</button><button className="btn no-print" onClick={() => setIssued([])}>ແຈກແລ້ວ — ປິດ</button></div>
          <span className="small">ໃຫ້ແຕ່ລະຄົນເປັນສ່ວນຕົວ{hr.online ? ' (ພ້ອມລິ້ງຂ້າງເທິງ)' : ''}. ເຂົ້າເທື່ອທຳອິດດ້ວຍລະຫັດພະນັກງານ + PIN ນີ້ ແລ້ວລະບົບຈະໃຫ້ຕັ້ງ PIN ຂອງຕົນເອງ. ປິດກ່ອນຍ່າງໜີຈາກເຄື່ອງ.</span>
          <table className="t"><thead><tr><th>ລະຫັດ</th><th>ຊື່</th><th>PIN ຊົ່ວຄາວ</th></tr></thead><tbody>
            {issued.map(i => <tr key={i.code}><td>{i.code}</td><td>{i.name}</td><td><b style={{ fontSize: 18, letterSpacing: 3 }}>{i.pin}</b></td></tr>)}
          </tbody></table>
        </div>)}

      <div className="card col">
        <div className="row wrap"><h2 className="grow">ຄົນ ແລະ ບົດບາດ</h2>
          {canRoles && noPin.length > 0 && <button className="btn" onClick={() => resetPins(noPin)}>ອອກ PIN ໃຫ້ຄົນທີ່ຍັງບໍ່ມີ ({noPin.length})</button>}</div>
        <span className="muted small">ພະນັກງານທົ່ວໄປເຫັນແຕ່ເລື່ອງຂອງຕົນເອງ. ຫົວໜ້າອະນຸມັດໄດ້ສະເພາະພະແນກທີ່ດູແລ. ຜູ້ກວດສອບເບິ່ງໄດ້ຢ່າງດຽວ ແລະ ຮັບບົດບາດອື່ນພ້ອມກັນບໍ່ໄດ້.</span>
        <div className="scroll-x"><table className="t"><thead><tr><th>ລະຫັດ</th><th>ຊື່</th><th>ພະແນກ</th><th>ບົດບາດ</th><th>ຫົວໜ້າດູແລ</th><th>PIN</th><th /></tr></thead><tbody>
          {people.map(e => <tr key={e.id}>
            <td>{e.code}</td><td><b>{e.name}</b><br /><span className="muted small">{e.position}</span></td><td>{e.dept}</td>
            <td>{e.superAdmin && <span className="pill dark" style={{ marginRight: 4 }}>Super admin</span>}{e.roles.filter(r => r !== 'employee' && !(e.superAdmin && r === 'owner')).map(r => <span key={r} className="pill info" style={{ marginRight: 4 }}>{r === 'owner' ? 'Admin' : ROLE_NAMES[r]}</span>)}{e.roles.length === 1 && <span className="muted small">ພະນັກງານ</span>}</td>
            <td className="small">{e.roles.includes('head') ? ((e.headOf ?? [e.dept]).includes('*') ? 'ທຸກພະແນກ' : (e.headOf ?? [e.dept]).join(', ')) : '—'}</td>
            <td>{pinState(e)}</td>
            <td className="row" style={{ gap: 6 }}>{canRoles && superOnly(e) && <span className="muted small">ສະເພາະ Super admin</span>}{canRoles && e.id !== me.id && !superOnly(e) && <>
              <button className="btn ghost" onClick={() => setEditing({ id: e.id, roles: [...e.roles], headOf: e.headOf ?? [e.dept] })}>ບົດບາດ</button>
              <button className="btn ghost" onClick={() => { if (confirm(`ຕັ້ງ PIN ຊົ່ວຄາວໃໝ່ໃຫ້ ${e.name}? PIN ເກົ່າຈະໃຊ້ບໍ່ໄດ້.`)) resetPins([e]); }}>ຕັ້ງ PIN ໃໝ່</button></>}
              {e.id === me.id && <span className="muted small">ປ່ຽນ PIN ຂອງຕົນເອງໃນ ຕັ້ງຄ່າ</span>}</td>
          </tr>)}
        </tbody></table></div>
        {editing && (() => { const e = hr.employees.find(x => x.id === editing.id)!; return (
          <div className="col" style={{ border: '1.5px solid var(--line-2)', borderRadius: 14, padding: 12 }}>
            <b>ບົດບາດຂອງ {e.name}</b>
            <div className="row wrap">{(['head', 'accountant', 'owner', 'auditor'] as Role[]).map(r => <label key={r} className="row" style={{ minHeight: 40 }}>
              <input type="checkbox" disabled={r === 'owner' && !isSuper && hr.employees.some(x => x.superAdmin)} checked={editing.roles.includes(r)} onChange={() => setEditing({ ...editing, roles: editing.roles.includes(r) ? editing.roles.filter(x => x !== r) : [...editing.roles, r] })} />{ROLE_NAMES[r]}</label>)}</div>
            {editing.roles.includes('head') && <div className="row wrap"><span className="muted small">ຫົວໜ້າດູແລ:</span>
              <label className="row" style={{ minHeight: 40 }}><input type="checkbox" checked={editing.headOf.includes('*')} onChange={() => setEditing({ ...editing, headOf: editing.headOf.includes('*') ? [e.dept] : ['*'] })} />ທຸກພະແນກ</label>
              {depts.map(d => <label key={d} className="row" style={{ minHeight: 40 }}><input type="checkbox" disabled={editing.headOf.includes('*')} checked={editing.headOf.includes('*') || editing.headOf.includes(d)}
                onChange={() => setEditing({ ...editing, headOf: editing.headOf.includes(d) ? editing.headOf.filter(x => x !== d) : [...editing.headOf.filter(x => x !== '*'), d] })} />{d}</label>)}</div>}
            <div className="row"><button className="btn ghost" onClick={() => setEditing(null)}>ຍົກເລີກ</button><button className="btn" onClick={saveRoles}>ບັນທຶກບົດບາດ</button></div>
          </div>); })()}
      </div>

      <div className="card col">
        <h2>ໃຜອະນຸມັດຫຍັງ</h2>
        <span className="muted small">ໝາຍ ✓ ບົດບາດທີ່ອະນຸມັດເລື່ອງນັ້ນໄດ້. ເຈົ້າຂອງອະນຸມັດໄດ້ສະເໝີ. ຫົວໜ້າອະນຸມັດສະເພາະພະແນກທີ່ດູແລ. ບໍ່ມີໃຜອະນຸມັດເລື່ອງຂອງຕົນເອງໄດ້.</span>
        <div className="scroll-x"><table className="t"><thead><tr><th>ເລື່ອງ</th>{PICKABLE.map(r => <th key={r} style={{ textAlign: 'center' }}>{ROLE_NAMES[r]}</th>)}<th style={{ textAlign: 'center' }}>{ROLE_NAMES.owner}</th></tr></thead><tbody>
          {ROWS.map(([key, label]) => { const roles = effective(key, draft); return (
            <tr key={key}><td>{label}{key !== 'leave' && !sameRoles(roles, defaultOf(key)) && <span className="pill warn" style={{ marginLeft: 6 }}>ປ່ຽນແລ້ວ</span>}</td>
              {PICKABLE.map(r => <td key={r} style={{ textAlign: 'center' }}><input type="checkbox" aria-label={`${label} — ${ROLE_NAMES[r]}`} disabled={readOnly} checked={roles.includes(r)} onChange={() => toggleApprover(key, r)} /></td>)}
              <td style={{ textAlign: 'center' }}><input type="checkbox" checked disabled aria-label={`${label} — ເຈົ້າຂອງ (ສະເໝີ)`} /></td></tr>); })}
        </tbody></table></div>
        <label className="row" style={{ minHeight: 44 }}><input type="checkbox" disabled={readOnly} checked={draft.makerChecker} onChange={e => setDraft({ ...draft, makerChecker: e.target.checked })} />ການຈ້າງ, ປິດບັນຊີ, ປ່ຽນເງິນເດືອນ / ເລກບັນຊີ ຕ້ອງໃຫ້ອີກຄົນອະນຸມັດ (ກວດ 2 ຄົນ)</label>
        {!draft.makerChecker && <span className="small" style={{ color: 'var(--warn)' }}>ປິດຢູ່: ຄົນທີ່ແກ້ໄຂ ບັນທຶກໄດ້ເລີຍ ບໍ່ຕ້ອງລໍໃຜອະນຸມັດ (ຍັງມີບັນທຶກໃນ ບັນທຶກການແກ້ໄຂ). ເໝາະກັບຮ້ານທີ່ມີເຈົ້າຂອງຄົນດຽວ.</span>}
        <label className="field" style={{ maxWidth: 320 }}>ຕ້ອງອະນຸມັດຈັກຄົນ (ທຸກເລື່ອງ)
          <select className="input" disabled={readOnly} value={draft.leaveApproversRequired} onChange={e => setDraft({ ...draft, leaveApproversRequired: Number(e.target.value) as 1 | 2 })}><option value={1}>1 ຄົນ</option><option value={2}>2 ຄົນ</option></select></label>
      </div>

      <div className="card col">
        <h2>ເມນູຂອງພະນັກງານ</h2>
        <span className="muted small">ປິດເມນູທີ່ບໍລິສັດບໍ່ໃຊ້ — ຈະບໍ່ສະແດງໃຫ້ໃຜເຫັນ (ລວມທັງໃນປະຕິທິນ). ລົງເວລາ, ປະຕິທິນ, ການລາ, ໂປຣໄຟລ໌ ແລະ ແຈ້ງເຕືອນ ເປີດຢູ່ສະເໝີ.</span>
        <div className="grid">{SELF_MENUS.map(m => <label key={m} className="row" style={{ minHeight: 44 }}>
          <input type="checkbox" disabled={readOnly} checked={draft.employeeMenus?.[m] !== false} onChange={() => toggleMenu(m)} />{MENU_LABEL[m]}</label>)}</div>
      </div>

      {!readOnly && errors.length > 0 && <div className="error" role="alert">{errors.join(' · ')}</div>}
      {!readOnly && <div className="savebar"><button className="btn" disabled={!dirty || errors.length > 0} onClick={saveRules}>ບັນທຶກສິດ ແລະ ເມນູ</button>{dirty && <span className="pill warn">ມີການແກ້ໄຂທີ່ຍັງບໍ່ບັນທຶກ</span>}</div>}
    </>
  );
}
