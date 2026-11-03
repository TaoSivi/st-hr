import { describe, expect, it } from 'vitest';
import { faceCountOf, RemoteStore, type Backend, type QueuedWrite, type Row } from './remote';
import type { AuditEntry, Employee } from '../domain/types';

/** An in-memory database. `hidden` collections read as empty, the way row level security hides rows from someone who may not read them. */
class Fake implements Backend {
  rows = new Map<string, any>();
  log: Omit<AuditEntry, 'id' | 'companyId' | 'at'>[] = [];
  writes: string[] = [];
  hidden = new Set<string>();
  down = false;
  refuse: string | null = null;
  private k = (c: string, col: string, id: string) => `${c}|${col}|${id}`;
  async list(c: string, col: string): Promise<Row[]> {
    if (this.down) throw new TypeError('Failed to fetch');
    if (this.hidden.has(col)) return [];
    return [...this.rows].filter(([k]) => k.startsWith(`${c}|${col}|`)).map(([k, data]) => ({ id: k.split('|')[2], data }));
  }
  async get(c: string, col: string, id: string) { return (await this.list(c, col)).find(r => r.id === id); }
  async upsert(c: string, col: string, id: string, data: unknown) {
    if (this.down) throw new TypeError('Failed to fetch');
    if (this.refuse === col) throw new Error('row-level security');
    this.writes.push(`${col}/${id}`);
    this.rows.set(this.k(c, col, id), JSON.parse(JSON.stringify(data)));
  }
  async del(c: string, col: string, id: string) { this.writes.push(`del ${col}/${id}`); this.rows.delete(this.k(c, col, id)); }
  async addAudit(_c: string, e: Omit<AuditEntry, 'id' | 'companyId' | 'at'>) { this.log.push(e); }
  async listAudit() { return this.log as AuditEntry[]; }
}

const emp = (over: Partial<Employee> = {}): Employee => ({
  id: 'e1', companyId: 'c', code: 'ST-001', name: 'ສົມ', dept: 'ຄົວ', position: 'ພໍ່ຄົວ', roles: ['employee'], homeBranchId: 'b', shiftId: 's', startDate: '2026-01-01',
  baseSalary: 5_000_000, allowance: 300_000, payMethod: 'bank', bankName: 'LDB', bankAccount: '0123456789', ...over
});

describe('pay and face data are kept apart so the database can hide them', () => {
  it('writes an employee as three records: who they are, what they earn, their face', async () => {
    const be = new Fake(), store = new RemoteStore(be, 'c');
    await store.put('employees', emp({ faceEnrolled: [0.1, 0.2], facePoses: [[0.3]], pinHash: 'h', pinSalt: 's' }), 'o', 'seed');
    const pub = be.rows.get('c|employees|e1');
    expect(pub).toMatchObject({ name: 'ສົມ', dept: 'ຄົວ', faceCount: 2 });
    for (const k of ['baseSalary', 'allowance', 'payMethod', 'bankName', 'bankAccount', 'faceEnrolled', 'facePoses', 'pinHash', 'pinSalt']) expect(pub, k).not.toHaveProperty(k);
    expect(be.rows.get('c|employeePay|e1')).toEqual({ baseSalary: 5_000_000, allowance: 300_000, payMethod: 'bank', bankName: 'LDB', bankAccount: '0123456789' });
    expect(be.rows.get('c|employeeSecret|e1')).toEqual({ faceEnrolled: [0.1, 0.2], facePoses: [[0.3]] });
  });

  it('joins them back into the one Employee the app expects', async () => {
    const be = new Fake(), store = new RemoteStore(be, 'c');
    await store.put('employees', emp({ faceEnrolled: [0.1] }), 'o', 'seed');
    const [e] = await store.list<Employee>('employees');
    expect(e).toMatchObject({ name: 'ສົມ', baseSalary: 5_000_000, bankAccount: '0123456789', faceEnrolled: [0.1], faceCount: 1 });
  });

  it('someone who may not read pay or faces gets placeholders for pay and only a face count', async () => {
    const be = new Fake(), store = new RemoteStore(be, 'c');
    await store.put('employees', emp({ faceEnrolled: [0.1], facePoses: [[0.2], [0.3]] }), 'o', 'seed');
    be.hidden.add('employeePay'); be.hidden.add('employeeSecret');
    const [e] = await new RemoteStore(be, 'c').list<Employee>('employees');
    expect(e.baseSalary).toBe(0);
    expect(e.payMethod).toBe('cash');
    expect(e.bankAccount).toBeUndefined();
    expect(e.faceEnrolled).toBeUndefined();
    expect(faceCountOf(e)).toBe(3);
  });

  it('writes only what changed: a person updating their own photo does not touch pay or face records', async () => {
    const be = new Fake(), store = new RemoteStore(be, 'c');
    await store.put('employees', emp({ faceEnrolled: [0.1] }), 'o', 'seed');
    const [me] = await store.list<Employee>('employees');
    be.writes = [];
    await store.put('employees', { ...me, photo: 'data:image/jpeg;base64,xx' }, 'e1', 'profile-photo');
    expect(be.writes).toEqual(['employees/e1']);
  });

  it('a manager who cannot read the face data can still save the person without wiping it', async () => {
    const be = new Fake(), store = new RemoteStore(be, 'c');
    await store.put('employees', emp({ faceEnrolled: [0.1] }), 'o', 'seed');
    be.hidden.add('employeeSecret');
    const manager = new RemoteStore(be, 'c');
    const [e] = await manager.list<Employee>('employees');
    be.writes = [];
    await manager.put('employees', { ...e, position: 'ຫົວໜ້າຄົວ' }, 'o', 'employee-profile');
    expect(be.writes).toEqual(['employees/e1']);
    expect(be.rows.get('c|employeeSecret|e1')).toEqual({ faceEnrolled: [0.1] });
    expect(be.rows.get('c|employees|e1').faceCount).toBe(1);
  });

  it('clearing the face (device change, re-enrolment) removes the stored template and zeroes the count', async () => {
    const be = new Fake(), store = new RemoteStore(be, 'c');
    await store.put('employees', emp({ faceEnrolled: [0.1] }), 'o', 'seed');
    const [e] = await store.list<Employee>('employees');
    await store.put('employees', { ...e, faceEnrolled: undefined, facePoses: undefined }, 'o', 'device-change-apply');
    expect(be.rows.has('c|employeeSecret|e1')).toBe(false);
    expect(be.rows.get('c|employees|e1').faceCount).toBe(0);
  });

  it('an owner who cannot read faces can still clear a person face, and a record with no face key never clears it', async () => {
    const be = new Fake(), store = new RemoteStore(be, 'c');
    await store.put('employees', emp({ faceEnrolled: [0.1] }), 'o', 'seed');
    be.hidden.add('employeeSecret');
    const owner = new RemoteStore(be, 'c');
    const [e] = await owner.list<Employee>('employees');
    await owner.put('employees', { ...e, position: 'x' }, 'o', 'employee-profile'); // no face key: untouched
    expect(be.rows.has('c|employeeSecret|e1')).toBe(true);
    await owner.put('employees', { ...e, faceEnrolled: undefined, facePoses: undefined }, 'o', 'device-change-apply');
    expect(be.rows.has('c|employeeSecret|e1')).toBe(false);
    expect(be.rows.get('c|employees|e1').faceCount).toBe(0);
  });

  it('a pay change writes the pay record', async () => {
    const be = new Fake(), store = new RemoteStore(be, 'c');
    await store.put('employees', emp(), 'o', 'seed');
    const [e] = await store.list<Employee>('employees');
    be.writes = [];
    await store.put('employees', { ...e, baseSalary: 6_000_000 }, 'o', 'apply-baseSalary');
    expect(be.writes).toEqual(['employeePay/e1']);
    expect(be.rows.get('c|employeePay|e1').baseSalary).toBe(6_000_000);
  });
});

describe('payroll periods and payslips', () => {
  it('a period\'s net pay per person is kept in payslips, apart from the period', async () => {
    const be = new Fake(), store = new RemoteStore(be, 'c');
    await store.put('payrollRuns', { id: '2026-10', companyId: 'c', status: 'locked', lateConfirmed: [], slips: { e1: 4_000_000, e2: 3_000_000 } }, 'o', 'payroll-lock');
    expect(be.rows.get('c|payrollRuns|2026-10')).not.toHaveProperty('slips');
    expect(be.rows.get('c|payslips|2026-10:e1')).toEqual({ id: '2026-10:e1', runId: '2026-10', employeeId: 'e1', net: 4_000_000 });
    const [run] = await store.list<any>('payrollRuns');
    expect(run.slips).toEqual({ e1: 4_000_000, e2: 3_000_000 });
  });
  it('someone who can read only their own payslip sees only their own net pay', async () => {
    const be = new Fake(), store = new RemoteStore(be, 'c');
    await store.put('payrollRuns', { id: '2026-10', companyId: 'c', status: 'locked', lateConfirmed: [], slips: { e1: 4_000_000, e2: 3_000_000 } }, 'o', 'payroll-lock');
    const real = be.list.bind(be);
    be.list = async (c, col) => (col === 'payslips' ? (await real(c, col)).filter(r => r.data.employeeId === 'e1') : real(c, col));
    const [run] = await new RemoteStore(be, 'c').list<any>('payrollRuns');
    expect(run.slips).toEqual({ e1: 4_000_000 });
  });
});

describe('audit and deletion', () => {
  it('every write adds an audit entry with the before and after, minus photos and secrets', async () => {
    const be = new Fake(), store = new RemoteStore(be, 'c');
    await store.put('employees', emp({ photo: 'data:image/jpeg;base64,AAAA', faceEnrolled: [0.1] }), 'o', 'seed');
    const [e] = await store.list<Employee>('employees');
    await store.put('employees', { ...e, position: 'ໃໝ່' }, 'o', 'employee-profile');
    expect(be.log).toHaveLength(2);
    expect(be.log[1]).toMatchObject({ by: 'o', action: 'employee-profile', entity: 'employees', entityId: 'e1' });
    expect((be.log[1].before as any).position).toBe('ພໍ່ຄົວ');
    expect((be.log[1].after as any).position).toBe('ໃໝ່');
    expect((be.log[0].after as any).photo).toBe('[ຮູບ]');
    expect((be.log[0].after as any).faceEnrolled).toBe('[ລັບ]');
  });
  it('removing a row logs what it was', async () => {
    const be = new Fake(), store = new RemoteStore(be, 'c');
    await store.put('shifts', { id: 's1', name: '455' }, 'o', 'shift-personal');
    await store.list('shifts');
    await store.remove('shifts', 's1', 'o', 'shift-delete');
    expect(be.rows.has('c|shifts|s1')).toBe(false);
    expect(be.log.at(-1)).toMatchObject({ action: 'shift-delete', entityId: 's1', before: { id: 's1', name: '455' } });
  });
  it('a refused write is an error and leaves no audit entry', async () => {
    const be = new Fake(); be.refuse = 'settings';
    await expect(new RemoteStore(be, 'c').put('settings', { id: 'c' }, 'o', 'settings-update')).rejects.toThrow('row-level security');
    expect(be.log).toHaveLength(0);
  });
});

describe('clocking in with no signal', () => {
  const memory = () => { let q: QueuedWrite[] = []; return { read: () => q, write: (x: QueuedWrite[]) => { q = x; } }; };
  const scan = (id: string) => ({ id, employeeId: 'e1', kind: 'in', offline: true });

  it('a scan made offline is kept on the phone, still shows in the list, and is sent when the signal is back', async () => {
    const be = new Fake(), box = memory(), store = new RemoteStore(be, 'c', box);
    be.down = true;
    await store.put('scans', scan('s1'), 'e1', 'clock-in');
    expect(box.read()).toHaveLength(1);
    be.down = false;
    expect((await store.list<any>('scans')).map(s => s.id)).toEqual(['s1']); // seen from the queue
    expect(await store.flush()).toBe(1);
    expect(box.read()).toHaveLength(0);
    expect(be.rows.has('c|scans|s1')).toBe(true);
    expect(be.log.map(l => l.action)).toEqual(['clock-in']);
  });
  it('the same scan queued twice is sent once', async () => {
    const be = new Fake(), box = memory(), store = new RemoteStore(be, 'c', box);
    be.down = true;
    await store.put('scans', scan('s1'), 'e1', 'clock-in');
    await store.put('scans', { ...scan('s1'), reasons: ['x'] }, 'e1', 'clock-in');
    expect(box.read()).toHaveLength(1);
  });
  it('still offline at flush time: nothing is lost', async () => {
    const be = new Fake(), box = memory(), store = new RemoteStore(be, 'c', box);
    be.down = true;
    await store.put('scans', scan('s1'), 'e1', 'clock-in');
    expect(await store.flush()).toBe(0);
    expect(box.read()).toHaveLength(1);
  });
  it('only clock-ins are queued: any other write fails loudly when offline', async () => {
    const be = new Fake(), box = memory(), store = new RemoteStore(be, 'c', box);
    be.down = true;
    await expect(store.put('leaves', { id: 'l1' }, 'e1', 'leave-request')).rejects.toThrow();
    expect(box.read()).toHaveLength(0);
  });
  it('a database refusal is not treated as no signal: it is reported, not queued', async () => {
    const be = new Fake(), box = memory(), store = new RemoteStore(be, 'c', box);
    be.refuse = 'scans';
    await expect(store.put('scans', scan('s1'), 'e1', 'clock-in')).rejects.toThrow('row-level security');
    expect(box.read()).toHaveLength(0);
  });
});
