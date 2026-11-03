import type { Employee, Role, ScanKind, Settings } from './types';

/** The owner is always among the approvers: escalations and a one-person shop depend on it. */
export const withOwner = (roles: Role[]): Role[] => (roles.includes('owner') ? roles : [...roles, 'owner']);
import { scopeBlock } from './scope';

/** Every "ask a manager" flow except leave shares this shape and the same approval rules. */
export type RequestKind = 'clockFix' | 'ot' | 'shiftSwap' | 'dayOffSwap' | 'schedule' | 'expense' | 'certificate' | 'leaveCancel' | 'deviceChange' | 'faceReset';

export interface RequestPayloads {
  clockFix: { date: string; kind: ScanKind; time: string };
  ot: { date: string; minutes: number };
  shiftSwap: { date: string; withEmployeeId: string };
  dayOffSwap: { fromDate: string; toDate: string }; // work on fromDate (normally off), rest on toDate instead
  schedule: { dates: string[]; shiftId: string | 'off' };
  expense: { date: string; category: string; amount: number; receipt?: string };
  certificate: { type: 'salary' | 'employment'; purpose: string };
  leaveCancel: { leaveId: string };
  deviceChange: { newDeviceId: string; label: string }; // the phone being asked for, and a readable description of it
  faceReset: Record<string, never>; // nothing to say beyond the reason: take the face again, all poses
}

export interface HRRequest<K extends RequestKind = RequestKind> {
  id: string;
  companyId: string;
  kind: K;
  employeeId: string;
  payload: RequestPayloads[K];
  reason: string;
  createdAt: string;
  approvals: { by: string; at: string; decision: 'approve' | 'reject'; note?: string }[];
  status: 'pending' | 'approved' | 'rejected';
  appliedAt?: string;
}

/** Who may approve each kind before escalation; owner always may after the escalation window. */
export const APPROVER_ROLES: Record<RequestKind, Role[]> = {
  clockFix: ['head', 'owner'],
  ot: ['head', 'owner'],
  shiftSwap: ['head', 'owner'],
  dayOffSwap: ['head', 'owner'],
  schedule: ['head', 'owner'],
  expense: ['head', 'accountant', 'owner'],
  certificate: ['owner'],
  leaveCancel: ['head', 'owner'],
  deviceChange: ['owner'], // moving an account to another phone is an identity decision: HR / owner only
  faceReset: ['head', 'owner'] // the head of the department can see the person has changed (weight, glasses, beard)
};

/** Who may approve a kind of request: the company's choice if it made one, else the default above. */
export function requestApprovers(kind: RequestKind, s?: Partial<Pick<Settings, 'approverRoles'>>): Role[] {
  const o = s?.approverRoles?.[kind];
  return o && o.length ? withOwner(o) : APPROVER_ROLES[kind];
}

export const REQUEST_LABEL: Record<RequestKind, string> = {
  clockFix: 'ຂໍລົງເວລາ', ot: 'ຂໍລ່ວງເວລາ (OT)', shiftSwap: 'ສະລັບກະ', dayOffSwap: 'ສະລັບວັນພັກ', schedule: 'ຕາຕະລາງວຽກ',
  expense: 'ຄ່າໃຊ້ຈ່າຍ', certificate: 'ໜັງສືຮັບຮອງ', leaveCancel: 'ຍົກເລີກການລາ', deviceChange: 'ປ່ຽນເຄື່ອງ', faceReset: 'ລົງທະບຽນໃບໜ້າໃໝ່'
};

export function requestEscalated(r: HRRequest, s: Settings, now: Date): boolean {
  return now.getTime() - new Date(r.createdAt).getTime() >= s.escalateAfterHours * 3600000;
}

export function requestBlock(r: HRRequest, approver: Pick<Employee, 'id' | 'roles'> & Partial<Pick<Employee, 'dept' | 'headOf'>>, s: Settings, now: Date, targetDept?: string): string | null {
  if (r.status !== 'pending') return 'ຄຳຂໍນີ້ຕັດສິນແລ້ວ';
  if (r.employeeId === approver.id) return 'ອະນຸມັດຄຳຂໍຂອງຕົນເອງບໍ່ໄດ້';
  if (r.kind === 'shiftSwap' && (r.payload as RequestPayloads['shiftSwap']).withEmployeeId === approver.id) return 'ທ່ານເປັນຄູ່ສະລັບ ອະນຸມັດບໍ່ໄດ້';
  if (r.approvals.some(a => a.by === approver.id)) return 'ທ່ານອະນຸມັດຄຳຂໍນີ້ແລ້ວ';
  const roles: Role[] = requestEscalated(r, s, now) ? withOwner(requestApprovers(r.kind, s)) : requestApprovers(r.kind, s);
  if (!approver.roles.some(x => roles.includes(x))) return 'ບໍ່ມີສິດອະນຸມັດ';
  if (approver.dept !== undefined) return scopeBlock({ roles: approver.roles, dept: approver.dept, headOf: approver.headOf }, targetDept, roles);
  return null;
}

export function decideRequest<K extends RequestKind>(r: HRRequest<K>, approver: Pick<Employee, 'id' | 'roles'> & Partial<Pick<Employee, 'dept' | 'headOf'>>, decision: 'approve' | 'reject', s: Settings, now: Date, note?: string, targetDept?: string): HRRequest<K> {
  const block = requestBlock(r, approver, s, now, targetDept);
  if (block) throw new Error(block);
  if (decision === 'reject' && !note?.trim()) throw new Error('ຕ້ອງໃສ່ເຫດຜົນເມື່ອປະຕິເສດ');
  const approvals = [...r.approvals, { by: approver.id, at: now.toISOString(), decision, note: note?.trim() || undefined }];
  const yes = approvals.filter(a => a.decision === 'approve').length;
  return { ...r, approvals, status: decision === 'reject' ? 'rejected' : yes >= s.leaveApproversRequired ? 'approved' : 'pending' };
}

/** Validation shared by every form; returns an error message or null. */
export function validateRequest(kind: RequestKind, p: any, today: string): string | null {
  switch (kind) {
    case 'clockFix': return !p.date || !p.time ? 'ໃສ່ວັນທີ ແລະ ເວລາ' : p.date > today ? 'ຂໍລົງເວລາລ່ວງໜ້າບໍ່ໄດ້' : null;
    case 'ot': return !p.date ? 'ໃສ່ວັນທີ' : !(p.minutes > 0 && p.minutes <= 720) ? 'ນາທີ OT ຕ້ອງຢູ່ລະຫວ່າງ 1–720' : null;
    case 'shiftSwap': return !p.date || !p.withEmployeeId ? 'ເລືອກວັນທີ ແລະ ຄົນທີ່ຈະສະລັບ' : null;
    case 'dayOffSwap': return !p.fromDate || !p.toDate ? 'ໃສ່ວັນທີທັງສອງ' : p.fromDate === p.toDate ? 'ວັນທີຕ້ອງຕ່າງກັນ' : null;
    case 'schedule': return !p.dates?.length ? 'ເລືອກຢ່າງໜ້ອຍ 1 ມື້' : !p.shiftId ? 'ເລືອກກະ' : null;
    case 'expense': return !(p.amount > 0) ? 'ໃສ່ຈຳນວນເງິນ' : !p.category ? 'ເລືອກປະເພດ' : !p.date ? 'ໃສ່ວັນທີ' : null;
    case 'certificate': return !p.purpose?.trim() ? 'ໃສ່ຈຸດປະສົງ' : null;
    case 'leaveCancel': return !p.leaveId ? 'ເລືອກການລາ' : null;
    case 'deviceChange': return !p.newDeviceId ? 'ອ່ານລະຫັດເຄື່ອງບໍ່ໄດ້' : null;
    case 'faceReset': return null;
  }
}

export interface ShiftOverride {
  id: string; // `${employeeId}:${date}`
  companyId: string;
  employeeId: string;
  date: string;
  shiftId: string | 'off';
  source: string; // request id that created it
}

/** The shift someone works on a date after approved swaps and schedule changes; null = day off. */
export function effectiveShift(e: Pick<Employee, 'id' | 'shiftId' | 'dayOff'>, date: string, overrides: ShiftOverride[]): string | null {
  const o = overrides.filter(x => x.employeeId === e.id && x.date === date).pop();
  if (o) return o.shiftId === 'off' ? null : o.shiftId;
  const dow = new Date(date + 'T12:00:00').getDay();
  return (e.dayOff ?? [0]).includes(dow) ? null : e.shiftId;
}

/** Overrides an approved request creates; shift swaps exchange the two people's shifts for that day. */
export function overridesFor(r: HRRequest, employees: Pick<Employee, 'id' | 'shiftId' | 'dayOff'>[], existing: ShiftOverride[]): ShiftOverride[] {
  const me = employees.find(e => e.id === r.employeeId)!;
  const mk = (employeeId: string, date: string, shiftId: string | 'off'): ShiftOverride => ({ id: `${employeeId}:${date}`, companyId: r.companyId, employeeId, date, shiftId, source: r.id });
  if (r.kind === 'schedule') {
    const p = r.payload as RequestPayloads['schedule'];
    return p.dates.map(d => mk(me.id, d, p.shiftId));
  }
  if (r.kind === 'dayOffSwap') {
    const p = r.payload as RequestPayloads['dayOffSwap'];
    return [mk(me.id, p.fromDate, me.shiftId), mk(me.id, p.toDate, 'off')];
  }
  if (r.kind === 'shiftSwap') {
    const p = r.payload as RequestPayloads['shiftSwap'];
    const other = employees.find(e => e.id === p.withEmployeeId)!;
    const mine = effectiveShift(me, p.date, existing) ?? 'off';
    const theirs = effectiveShift(other, p.date, existing) ?? 'off';
    return [mk(me.id, p.date, theirs), mk(other.id, p.date, mine)];
  }
  return [];
}
