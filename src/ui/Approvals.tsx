import { useState } from 'react';
import { useHR } from '../app/state';
import { decideAndApply } from '../app/workflow';
import { requestBlock, requestEscalated, REQUEST_LABEL, type HRRequest, type RequestPayloads } from '../domain/requests';
import { actionRoles, APPROVAL_SECTIONS, approvalAccess, canDoIn, scopeBlock, SECTION_KINDS, sectionActRoles, type ApprovalSection } from '../domain/permissions';
import { deptOf, inMyScope } from '../app/scope';
import { approvalBlock, decide, isEscalated } from '../domain/leave';
import type { LeaveRequest, ScanRecord } from '../domain/types';
import { describeRequest, statusPill } from './RequestsUI';
import { KIND_LABEL } from './labels';
import { hhmm, initials, LEAVE_TYPES, laoDate } from './format';
import { leaveSpan } from '../domain/leavePart';

export type { ApprovalSection };

export const SECTION_LABEL: Record<ApprovalSection, string> = {
  scan: 'ອະນຸມັດລົງເວລາ', leave: 'ອະນຸມັດການລາ', shift: 'ອະນຸມັດສະລັບກະ ແລະ ວັນພັກ', schedule: 'ອະນຸມັດຕາຕະລາງວຽກ',
  ot: 'ອະນຸມັດລ່ວງເວລາ', expense: 'ອະນຸມັດຄ່າໃຊ້ຈ່າຍ', certificate: 'ອະນຸມັດໜັງສືຮັບຮອງ', leaveCancel: 'ອະນຸມັດຍົກເລີກການລາ', device: 'ອະນຸມັດປ່ຽນເຄື່ອງ', face: 'ອະນຸມັດຖ່າຍໃບໜ້າໃໝ່'
};

/** Items in a section that this user can act on right now (used for menu badges). */
export function actionableCount(hr: ReturnType<typeof useHR>, section: ApprovalSection): number {
  const me = hr.me!;
  const ap = hr.approver!;
  if (approvalAccess(me.roles, section, hr.settings) !== 'act') return 0;
  const now = new Date();
  const reqs = hr.requests.filter(r => SECTION_KINDS[section].includes(r.kind) && !requestBlock(r, ap, hr.settings, now, deptOf(hr.employees, r.employeeId))).length;
  if (section === 'leave') return hr.leaves.filter(l => !approvalBlock(l, ap, hr.settings, now, deptOf(hr.employees, l.employeeId))).length;
  if (section === 'scan' && canDoIn(me, 'scan.review', hr.settings)) return reqs + hr.scans.filter(s => s.status === 'pending' && (s.employeeId !== me.id || ap.selfOk) && inMyScope(me, hr.employees, s.employeeId, actionRoles('scan.review', hr.settings))).length;
  return reqs;
}

/** Sections this user may open, as act or view. */
export function visibleSections(hr: ReturnType<typeof useHR>): ApprovalSection[] {
  return APPROVAL_SECTIONS.filter(s => approvalAccess(hr.me!.roles, s, hr.settings) !== 'none');
}

export function NoAccess() {
  return <div className="screen"><div className="card empty" role="alert"><b style={{ color: 'var(--ink)' }}>ບໍ່ມີສິດເຂົ້າເຖິງໜ້ານີ້</b><br /><span className="small">ຕິດຕໍ່ HR ຖ້າຕ້ອງການສິດເພີ່ມ</span></div></div>;
}

export default function Approvals({ section, readOnly: forcedReadOnly = false }: { section: ApprovalSection; readOnly?: boolean }) {
  const hr = useHR();
  const me = hr.me!;
  const ap = hr.approver!;
  const now = new Date();
  const access = approvalAccess(me.roles, section, hr.settings);
  const readOnly = forcedReadOnly || access !== 'act';
  const [tab, setTab] = useState<'pending' | 'done'>('pending');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [err, setErr] = useState('');
  const nameOf = (id: string) => hr.employees.find(e => e.id === id)?.name ?? id;

  const run = async (fn: () => Promise<void>) => {
    setErr('');
    try { await fn(); } catch (e: any) { setErr(e.message); }
  };
  const actions = (id: string, block: string | null, onApprove: () => Promise<void>, onReject: (note: string) => Promise<void>) => {
    if (readOnly) return null;
    if (block) return <span className="muted small">{block}</span>;
    return (
      <div className="col" style={{ gap: 8, width: '100%' }}>
        <input className="input" placeholder="ເຫດຜົນ (ຕ້ອງໃສ່ຖ້າບໍ່ອະນຸມັດ)" value={notes[id] ?? ''} onChange={e => setNotes({ ...notes, [id]: e.target.value })} aria-label="ເຫດຜົນ" />
        <div className="row">
          <button className="btn danger grow" onClick={() => run(() => onReject(notes[id] ?? ''))}>ບໍ່ອະນຸມັດ</button>
          <button className="btn grow" onClick={() => run(onApprove)}>ອະນຸມັດ</button>
        </div>
      </div>
    );
  };
  const head = (employeeId: string, title: string, sub: string, right: React.ReactNode) => (
    <div className="row" style={{ alignItems: 'flex-start' }}>
      <span className="avatar big">{initials(nameOf(employeeId))}</span>
      <div className="col grow" style={{ gap: 2 }}><b>{nameOf(employeeId)}</b><span>{title}</span><span className="muted small">{sub}</span></div>
      {right}
    </div>
  );

  const visible = (employeeId: string) => inMyScope(me, hr.employees, employeeId, sectionActRoles(section, hr.settings)); // a head sees only their departments
  const reqs = hr.requests.filter(r => visible(r.employeeId) && SECTION_KINDS[section].includes(r.kind) && (tab === 'pending' ? r.status === 'pending' : r.status !== 'pending'))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const scans: ScanRecord[] = section === 'scan' ? hr.scans.filter(s => visible(s.employeeId) && (tab === 'pending' ? s.status === 'pending' : s.status === 'approved' || s.status === 'rejected')).slice(-30).reverse() : [];
  const leaves: LeaveRequest[] = section === 'leave' ? hr.leaves.filter(l => visible(l.employeeId) && (tab === 'pending' ? l.status === 'pending' : l.status !== 'pending')).reverse() : [];
  const empty = reqs.length + scans.length + leaves.length === 0;

  if (access === 'none') return <NoAccess />;
  return (
    <div className="screen">
      <div className="tabs" role="tablist" style={{ alignSelf: 'flex-start' }}>
        <button role="tab" aria-selected={tab === 'pending'} onClick={() => setTab('pending')}>ລໍອະນຸມັດ</button>
        <button role="tab" aria-selected={tab === 'done'} onClick={() => setTab('done')}>ຕັດສິນແລ້ວ</button>
      </div>
      {err && <div className="error" role="alert">{err}</div>}
      {empty && <div className="empty">ບໍ່ມີລາຍການ</div>}

      {scans.map(s => (
        <div key={s.id} className="card col">
          {head(s.employeeId, `${KIND_LABEL[s.kind]} · ${hhmm(s.deviceTime)}`, laoDate(new Date(s.deviceTime)), s.status === 'pending' ? null : statusPill(s.status === 'approved' ? 'approved' : 'rejected'))}
          {s.photo && <img src={s.photo} alt="ຮູບຕອນສະແກນ" style={{ width: 120, borderRadius: 12 }} />}
          <div className="row wrap">{s.reasons.map(r => <span key={r} className="pill warn">{r}</span>)}</div>
          {s.status === 'pending' && actions(s.id, s.employeeId === me.id && !ap.selfOk ? 'ກວດການລົງເວລາຂອງຕົນເອງບໍ່ໄດ້' : !canDoIn(me, 'scan.review', hr.settings) ? 'ບໍ່ມີສິດ' : scopeBlock(me, deptOf(hr.employees, s.employeeId), actionRoles('scan.review', hr.settings)),
            () => hr.save('scans', { ...s, status: 'approved', reviewedBy: me.id }, 'scan-approve'),
            async note => { if (!note.trim()) throw new Error('ຕ້ອງໃສ່ເຫດຜົນເມື່ອບໍ່ອະນຸມັດ'); await hr.save('scans', { ...s, status: 'rejected', reviewedBy: me.id, reviewNote: note }, 'scan-reject'); })}
        </div>
      ))}

      {leaves.map(l => (
        <div key={l.id} className="card col">
          {head(l.employeeId, `${LEAVE_TYPES[l.type]} · ${leaveSpan(l)}`, `${l.from} → ${l.to} · “${l.reason}”`, l.status === 'pending' ? (isEscalated(l, hr.settings, now) ? <span className="pill bad">ເກີນ {hr.settings.escalateAfterHours} ຊມ</span> : null) : statusPill(l.status))}
          {l.status === 'pending' && actions(l.id, approvalBlock(l, ap, hr.settings, now, deptOf(hr.employees, l.employeeId)),
            async () => { const n = decide(l, ap, 'approve', hr.settings, now, undefined, deptOf(hr.employees, l.employeeId)); await hr.save('leaves', n, 'leave-approve'); if (n.status === 'approved') await hr.notify([l.employeeId], 'ການລາ — ອະນຸມັດແລ້ວ', 'leave'); },
            async note => { await hr.save('leaves', decide(l, ap, 'reject', hr.settings, now, note, deptOf(hr.employees, l.employeeId)), 'leave-reject'); await hr.notify([l.employeeId], `ການລາ — ບໍ່ອະນຸມັດ: ${note}`, 'leave'); })}
        </div>
      ))}

      {reqs.map(r => (
        <div key={r.id} className="card col">
          {head(r.employeeId, REQUEST_LABEL[r.kind], describeRequest(r as HRRequest, nameOf), r.status === 'pending' ? (requestEscalated(r, hr.settings, now) ? <span className="pill bad">ເກີນ {hr.settings.escalateAfterHours} ຊມ</span> : null) : statusPill(r.status))}
          {r.reason && r.kind !== 'certificate' && <span className="muted small">“{r.reason}”</span>}
          {r.kind === 'expense' && (r.payload as RequestPayloads['expense']).receipt && <img src={(r.payload as RequestPayloads['expense']).receipt} alt="ໃບບິນ" style={{ maxWidth: 200, borderRadius: 12 }} />}
          <span className="muted small">ອະນຸມັດແລ້ວ {r.approvals.filter(a => a.decision === 'approve').length}/{hr.settings.leaveApproversRequired}{r.approvals.length ? ' · ' + r.approvals.map(a => nameOf(a.by)).join(', ') : ''}</span>
          {r.status === 'pending' && actions(r.id, requestBlock(r, ap, hr.settings, now, deptOf(hr.employees, r.employeeId)), () => decideAndApply(hr, r, 'approve'), note => decideAndApply(hr, r, 'reject', note))}
        </div>
      ))}
    </div>
  );
}
