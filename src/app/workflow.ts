import type { useHR } from './state';
import { uid } from '../data/store';
import { inMyScope } from './scope';
import { requestApprovers, decideRequest, overridesFor, REQUEST_LABEL, type HRRequest, type RequestKind, type RequestPayloads } from '../domain/requests';
import type { ScanRecord } from '../domain/types';

type HR = ReturnType<typeof useHR>;

// only people who could actually decide it: right role, and (for heads) the requester's department
const approversOf = (hr: HR, kind: RequestKind, requesterId: string) =>
  hr.employees.filter(e => !e.endDate && e.id !== requesterId && e.roles.some(r => requestApprovers(kind, hr.settings).includes(r)) && inMyScope(e, hr.employees, requesterId, requestApprovers(kind, hr.settings))).map(e => e.id);

export async function submitRequest<K extends RequestKind>(hr: HR, kind: K, payload: RequestPayloads[K], reason: string) {
  const me = hr.me!;
  const r: HRRequest<K> = { id: uid(), companyId: me.companyId, kind, employeeId: me.id, payload, reason: reason.trim(), createdAt: new Date().toISOString(), approvals: [], status: 'pending' };
  await hr.save('requests', r, `request-${kind}`);
  await hr.notify(approversOf(hr, kind, me.id), `${me.name} ສົ່ງຄຳຂໍ: ${REQUEST_LABEL[kind]}`, 'approvals');
}

/** Record the decision; when the request becomes approved, apply its effect exactly once. */
export async function decideAndApply(hr: HR, r: HRRequest, decision: 'approve' | 'reject', note?: string) {
  const me = hr.me!;
  const now = new Date();
  const next = decideRequest(r, me, decision, hr.settings, now, note, hr.employees.find(e => e.id === r.employeeId)?.dept);
  if (next.status === 'approved' && !next.appliedAt) {
    await applyEffect(hr, next);
    next.appliedAt = now.toISOString();
  }
  await hr.save('requests', next, `request-${decision}`);
  if (next.status !== 'pending') {
    const word = next.status === 'approved' ? 'ອະນຸມັດແລ້ວ' : `ບໍ່ອະນຸມັດ: ${note ?? ''}`;
    await hr.notify([r.employeeId], `${REQUEST_LABEL[r.kind]} — ${word}`, 'requests');
  }
}

async function applyEffect(hr: HR, r: HRRequest) {
  const me = hr.me!;
  switch (r.kind) {
    case 'clockFix': {
      const p = r.payload as RequestPayloads['clockFix'];
      const at = new Date(`${p.date}T${p.time}:00`).toISOString();
      const scan: ScanRecord = { id: uid(), companyId: r.companyId, employeeId: r.employeeId, kind: p.kind, deviceTime: at, serverTime: new Date().toISOString(),
        status: 'approved', reasons: ['ຂໍລົງເວລາຍ້ອນຫຼັງ'], reviewedBy: me.id, reviewNote: r.reason };
      await hr.save('scans', scan, 'clock-fix-apply');
      break;
    }
    case 'ot': {
      const p = r.payload as RequestPayloads['ot'];
      await hr.save('ots', { id: uid(), companyId: r.companyId, employeeId: r.employeeId, date: p.date, minutes: p.minutes, status: 'approved', reviewedBy: me.id }, 'ot-apply');
      break;
    }
    case 'schedule': case 'dayOffSwap': case 'shiftSwap': {
      for (const o of overridesFor(r, hr.employees, hr.overrides)) await hr.save('overrides', o, 'shift-override');
      if (r.kind === 'shiftSwap') {
        const p = r.payload as RequestPayloads['shiftSwap'];
        await hr.notify([p.withEmployeeId], `ກະຂອງທ່ານວັນທີ ${p.date} ຖືກສະລັບ (ອະນຸມັດແລ້ວ)`, 'calendar');
      }
      break;
    }
    case 'leaveCancel': {
      const p = r.payload as RequestPayloads['leaveCancel'];
      const l = hr.leaves.find(x => x.id === p.leaveId);
      if (l) await hr.save('leaves', { ...l, status: 'cancelled' }, 'leave-cancel-apply');
      break;
    }
    case 'deviceChange': {
      const p = r.payload as RequestPayloads['deviceChange'];
      const e = hr.employees.find(x => x.id === r.employeeId);
      // the face is enrolled again on the new phone, so the move is checked against the person, not just the phone
      if (e) await hr.save('employees', { ...e, deviceId: p.newDeviceId, deviceBoundAt: new Date().toISOString(), faceEnrolled: undefined, facePoses: undefined, faceReenroll: undefined }, 'device-change-apply');
      break;
    }
    case 'faceReset': {
      // the old face stays until the new one is saved, so clocking in keeps working in the meantime
      const e = hr.employees.find(x => x.id === r.employeeId);
      if (e) await hr.save('employees', { ...e, faceReenroll: true }, 'face-reset-apply');
      break;
    }
    case 'expense': case 'certificate':
      break; // expenses are read by payroll; certificates become printable
  }
}
