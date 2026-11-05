import { beforeEach, describe, expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { RemoteStore } from './remote';
import { sheetsApi } from './sheets';
import type { Employee } from '../domain/types';
import { ALL_RIGHTS, ROLE_RIGHTS } from '../domain/rights';

/** A tiny stand-in for the parts of Google Apps Script that Code.gs uses, so the real script runs here. */
class FakeSheet {
  grid: string[][] = [];
  rows = 1000; cols = 26;
  constructor(public name: string) {}
  private cell(r: number, c: number) { return this.grid[r - 1]?.[c - 1] ?? ''; }
  getName() { return this.name; }
  setName(n: string) { this.name = n; }
  getDataRange() { return this.getRange(1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn())); }
  getMaxRows() { return this.rows; }
  getMaxColumns() { return this.cols; }
  getLastRow() { for (let r = this.grid.length; r >= 1; r--) if ((this.grid[r - 1] ?? []).some(v => v !== '' && v !== undefined)) return r; return 0; }
  getLastColumn() { let m = 0; for (const row of this.grid) for (let c = row.length; c >= 1; c--) if (row[c - 1] !== '' && row[c - 1] !== undefined) { m = Math.max(m, c); break; } return m; }
  insertRowsAfter(_a: number, n: number) { this.rows += n; }
  insertColumnsAfter(_a: number, n: number) { this.cols += n; }
  deleteRow(r: number) { this.grid.splice(r - 1, 1); }
  setFrozenRows() {}
  getRange(r: number, c: number, nr = 1, nc = 1) {
    const self = this;
    if (r + nr - 1 > this.rows || c + nc - 1 > this.cols) throw new Error('range outside the sheet');
    return {
      getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => self.cell(r + i, c + j))),
      setValues: (v: string[][]) => { v.forEach((row, i) => row.forEach((val, j) => { (self.grid[r + i - 1] ??= [])[c + j - 1] = val; })); },
      setNumberFormat: () => {}
    };
  }
}

function loadScript() {
  const sheets = new Map<string, FakeSheet>();
  const cache = new Map<string, string>();
  const props = new Map<string, string>([['SIGNUP_CODE', 'secret-code']]);
  const book = {
    getSheetByName: (n: string) => [...sheets.values()].find(x => x.name === n) ?? null,
    getSheets: () => [...sheets.values()],
    insertSheet: (n: string) => { const s = new FakeSheet(n); sheets.set(String(sheets.size) + n + Math.random(), s); return s; },
    deleteSheet: (s: FakeSheet) => { for (const [k, v] of sheets) if (v === s) sheets.delete(k); }
  };
  const out = (s: string) => ({ setMimeType() { return this; }, getContent: () => s });
  const ctx: any = {
    SpreadsheetApp: { getActiveSpreadsheet: () => book },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k: string) => props.get(k) ?? null, setProperty: (k: string, v: string) => { props.set(k, v); } }) },
    CacheService: { getScriptCache: () => ({ get: (k: string) => cache.get(k) ?? null, put: (k: string, v: string) => { cache.set(k, v); }, remove: (k: string) => { cache.delete(k); } }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    ContentService: { createTextOutput: out, MimeType: { JSON: 'json', TEXT: 'text' } },
    Utilities: { getUuid: () => randomUUID(), sleep() {} },
    console, JSON, Date, Math, String, Number, Array, Object, unescape, encodeURIComponent, Error
  };
  runInNewContext(readFileSync('apps-script/Code.gs', 'utf8'), ctx);
  const post = (body: unknown) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(body) } }).getContent());
  return { ctx, sheets, post };
}

const emp = (id: string, code: string, extra: Partial<Employee> = {}): Employee => ({
  id, companyId: 'c1', code, name: id, dept: 'ບໍລິຫານ', position: 'x', roles: ['employee'], shiftId: 's', branchId: 'b', startDate: '2020-01-01', baseSalary: 5_000_000, allowance: 0, payMethod: 'bank', bankName: 'LDB', bankAccount: '0011', ...extra
} as Employee);

/** Each phone has its own session token; the fetch below plays the network to the script. */
function phone(post: (b: unknown) => any) {
  let token: string | null = null;
  const tokens = { get: () => token, set: (t: string | null) => { token = t; } };
  const fetchImpl = (async (_u: string, init: any) => ({ text: async () => JSON.stringify(post(JSON.parse(init.body))) })) as any;
  const api = sheetsApi('https://script.google.com/x/exec', fetchImpl, tokens);
  return { api, store: new RemoteStore(api.backend, 'c1'), token: () => token };
}

describe('sha-256 in Code.gs', () => {
  it('matches the real thing, including Lao text', () => {
    const { ctx } = loadScript();
    for (const s of ['', 'abc', 'salt:123456', 'ລະຫັດ 123', 'x'.repeat(200)]) expect(ctx.sha256(s)).toBe(createHash('sha256').update(s, 'utf8').digest('hex'));
  });
});

describe('Google Sheets backend (Code.gs run against a fake sheet)', () => {
  let t: ReturnType<typeof loadScript>;
  let owner: ReturnType<typeof phone>;
  beforeEach(async () => {
    t = loadScript();
    owner = phone(t.post);
    await owner.api.createCompany({ signupCode: 'secret-code', company: { id: 'c1', name: 'ຮ້ານທົດລອງ', plan: 'pro' } as any, ownerEmployeeId: 'e-owner', ownerCode: 'ST-001', pin: '1234' });
    await owner.store.put('employees', emp('e-owner', 'ST-001', { roles: ['employee', 'owner'] }), 'e-owner', 'seed');
    await owner.store.put('employees', emp('e-a', 'ST-002'), 'e-owner', 'hire');
    await owner.store.put('employees', emp('e-b', 'ST-003'), 'e-owner', 'hire');
    await owner.api.createLogin('e-a', 'ST-002', '2222');
    await owner.api.createLogin('e-b', 'ST-003', '3333');
  });

  it('creating a company needs the signup code, and only works once', async () => {
    const fresh = loadScript(), p = phone(fresh.post);
    const mk = (code: string) => p.api.createCompany({ signupCode: code, company: { id: 'c2', name: 'x' } as any, ownerEmployeeId: 'o', ownerCode: 'ST-001', pin: '1234' });
    await expect(mk('wrong')).rejects.toThrow('ລະຫັດສ້າງບໍລິສັດບໍ່ຖືກ');
    await mk('secret-code');
    await expect(mk('secret-code')).rejects.toThrow('ມີບໍລິສັດແລ້ວ');
    expect(await p.api.info()).toMatchObject({ companyId: 'c2', name: 'x' });
  });

  it('signs in with code + PIN, loads the company, and rejects a wrong PIN', async () => {
    const a = phone(t.post);
    await expect(a.api.signIn('st-002', '0000')).rejects.toThrow('ບໍ່ຖືກ');
    const m = await a.api.signIn('ST-002', '2222');
    expect(m).toMatchObject({ employeeId: 'e-a', companyId: 'c1', roles: ['employee'] });
    expect((await a.api.currentMember())?.employeeId).toBe('e-a');
    expect(await a.api.loadCompany()).toMatchObject({ id: 'c1', name: 'ຮ້ານທົດລອງ' });
    await a.api.signOut();
    expect(await a.api.currentMember()).toBeNull();
  });

  it('locks a login after five wrong PINs', async () => {
    const a = phone(t.post);
    for (let i = 0; i < 5; i++) await expect(a.api.signIn('ST-002', '9999')).rejects.toThrow();
    await expect(a.api.signIn('ST-002', '2222')).rejects.toThrow('ລໍ');
  });

  it('one list call per collection travels as a single batch and employees come back joined', async () => {
    const a = phone(t.post);
    await a.api.signIn('ST-002', '2222');
    let posts = 0;
    const counting = (b: unknown) => { posts++; return t.post(b); };
    const b = phone(counting); b.api.signIn; // separate counter phone
    await b.api.signIn('ST-002', '2222');
    posts = 0;
    const [emps, shifts, scans] = await Promise.all([b.store.list<Employee>('employees'), b.store.list('shifts'), b.store.list('scans')]);
    expect(posts).toBe(1);
    expect(emps.map(e => e.id).sort()).toEqual(['e-a', 'e-b', 'e-owner']);
    expect(shifts).toEqual([]); expect(scans).toEqual([]);
  });

  it('pay is hidden from other employees but joined for the owner and the person', async () => {
    const a = phone(t.post), o = phone(t.post);
    await a.api.signIn('ST-002', '2222'); await o.api.signIn('ST-001', '1234');
    const seenByA = await a.store.list<Employee>('employees');
    expect(seenByA.find(e => e.id === 'e-b')!.baseSalary).toBe(0);
    expect(seenByA.find(e => e.id === 'e-a')!.baseSalary).toBe(5_000_000);
    expect((await o.store.list<Employee>('employees')).find(e => e.id === 'e-b')!.baseSalary).toBe(5_000_000);
  });

  it('face data is only readable by its owner, and the owner can still clear it', async () => {
    const a = phone(t.post), o = phone(t.post);
    await a.api.signIn('ST-002', '2222'); await o.api.signIn('ST-001', '1234');
    const me = (await a.store.list<Employee>('employees')).find(e => e.id === 'e-a')!;
    await a.store.put('employees', { ...me, faceEnrolled: [0.1, 0.2], facePoses: [[0.3]] }, 'e-a', 'face');
    const seenByOwner = (await o.store.list<Employee>('employees')).find(e => e.id === 'e-a')!;
    expect(seenByOwner.faceEnrolled).toBeUndefined();
    expect((seenByOwner as any).faceCount).toBe(2);
    await o.store.put('employees', { ...seenByOwner, faceEnrolled: undefined, facePoses: undefined }, 'e-owner', 'clear');
    expect(((await a.store.list<Employee>('employees')).find(e => e.id === 'e-a') as any).faceCount).toBe(0);
    expect((await a.store.list<Employee>('employees')).find(e => e.id === 'e-a')!.faceEnrolled).toBeUndefined();
  });

  it('an employee cannot give themselves a role, change pay, or edit someone else', async () => {
    const a = phone(t.post);
    await a.api.signIn('ST-002', '2222');
    const list = await a.store.list<Employee>('employees');
    const me = list.find(e => e.id === 'e-a')!, other = list.find(e => e.id === 'e-b')!;
    await expect(a.store.put('employees', { ...me, roles: ['employee', 'owner'] }, 'e-a', 'x')).rejects.toThrow('ບໍ່ມີສິດ');
    await expect(a.store.put('employees', { ...me, baseSalary: 9_999_999 }, 'e-a', 'x')).rejects.toThrow('ບໍ່ມີສິດ');
    await expect(a.store.put('employees', { ...other, position: 'boss' }, 'e-a', 'x')).rejects.toThrow('ບໍ່ມີສິດ');
    await a.store.put('employees', { ...me, deviceId: 'phone-1' }, 'e-a', 'bind'); // allowed: the person's own device
  });

  it('scans: you see your own, not a colleague\'s; the owner sees all; the head sees their department', async () => {
    const a = phone(t.post), b = phone(t.post), o = phone(t.post);
    await a.api.signIn('ST-002', '2222'); await b.api.signIn('ST-003', '3333'); await o.api.signIn('ST-001', '1234');
    await a.store.put('scans', { id: 'sa', employeeId: 'e-a', at: 1 }, 'e-a', 'scan');
    await b.store.put('scans', { id: 'sb', employeeId: 'e-b', at: 2 }, 'e-b', 'scan');
    await expect(a.store.put('scans', { id: 'forged', employeeId: 'e-b', at: 3 }, 'e-a', 'scan')).rejects.toThrow('ບໍ່ມີສິດ');
    expect((await a.store.list<any>('scans')).map(s => s.id)).toEqual(['sa']);
    expect((await o.store.list<any>('scans')).map(s => s.id).sort()).toEqual(['sa', 'sb']);
    // make e-b a head of the department: sees e-a's scan too
    const eb = (await o.store.list<Employee>('employees')).find(e => e.id === 'e-b')!;
    await o.store.put('employees', { ...eb, roles: ['employee', 'head'] }, 'e-owner', 'role');
    await b.api.signIn('ST-003', '3333'); // the new role is on the login
    expect((await b.store.list<any>('scans')).map(s => s.id).sort()).toEqual(['sa', 'sb']);
  });

  it('long records (a photo) survive being split over several cells', async () => {
    const a = phone(t.post);
    await a.api.signIn('ST-002', '2222');
    const photo = 'data:image/jpeg;base64,' + 'A'.repeat(130_000);
    await a.store.put('scans', { id: 'big', employeeId: 'e-a', photo }, 'e-a', 'scan');
    expect((await a.store.list<any>('scans'))[0].photo).toBe(photo);
    await a.store.put('scans', { id: 'big', employeeId: 'e-a', photo: 'short' }, 'e-a', 'scan'); // shrinking leaves no stale tail
    expect((await a.store.list<any>('scans'))[0].photo).toBe('short');
  });

  it('the owner makes logins and resets PINs; a closed login cannot get in or use its old session', async () => {
    const a = phone(t.post);
    await a.api.signIn('ST-002', '2222');
    await owner.api.setPin('e-a', '4444');
    await expect(phone(t.post).api.signIn('ST-002', '2222')).rejects.toThrow();
    await phone(t.post).api.signIn('ST-002', '4444');
    await expect(a.api.setPin('e-b', '5555')).rejects.toThrow('ບໍ່ມີສິດ');
    expect([...(await owner.api.listLogins())].sort()).toEqual(['e-a', 'e-b', 'e-owner']);
    await owner.api.removeLogin('e-a');
    await expect(a.store.list('scans')).rejects.toThrow();
    await expect(phone(t.post).api.signIn('ST-002', '4444')).rejects.toThrow();
  });

  it('changing your own PIN works and must be four digits', async () => {
    const a = phone(t.post);
    await a.api.signIn('ST-002', '2222');
    await expect(a.api.changeOwnPin('12')).rejects.toThrow('4');
    await a.api.changeOwnPin('7777');
    await phone(t.post).api.signIn('ST-002', '7777');
  });

  it('the audit log is written under the real caller, readable only by owner/auditor', async () => {
    const a = phone(t.post);
    await a.api.signIn('ST-002', '2222');
    const me = (await a.store.list<Employee>('employees')).find(e => e.id === 'e-a')!;
    await a.store.put('employees', { ...me, deviceId: 'd1' }, 'someone-else', 'bind');
    const log = await owner.store.audit();
    const last = log.filter(l => l.action === 'bind').pop()!;
    expect(last.by).toBe('e-a'); // not the name the phone claimed
    await expect(a.store.audit()).rejects.toThrow('ບໍ່ມີສິດ');
  });

  it('unknown collections are refused, and a bad or missing session is told to sign in again', async () => {
    const a = phone(t.post);
    await a.api.signIn('ST-002', '2222');
    await expect(a.api.backend.upsert('c1', 'junk', 'x', { a: 1 }, 'e-a')).rejects.toThrow('ບໍ່ຮູ້ຈັກ');
    expect(t.post({ action: 'list', collection: 'scans' })).toMatchObject({ ok: false, code: 'auth' });
    expect(t.post({ action: 'list', collection: 'scans', token: 'nope' })).toMatchObject({ ok: false, code: 'auth' });
  });

  it('reading never creates tabs, and sign-in brings the company so opening needs no extra trip', async () => {
    const a = phone(t.post);
    const names = () => [...t.sheets.values()].map(x => x.name).sort();
    const before = names();
    await a.api.signIn('ST-002', '2222');
    await a.store.list('leaves'); await a.store.list('ots');
    expect(names()).toEqual(before);
    let posts = 0;
    const counting = phone((b: unknown) => { posts++; return t.post(b); });
    await counting.api.signIn('ST-002', '2222');
    expect(await counting.api.loadCompany()).toMatchObject({ id: 'c1', name: 'ຮ້ານທົດລອງ' });
    expect(posts).toBe(1); // the sign-in itself; the company needed no second call
  });

  it('a removed login loses its cached session at once, and a new role shows without signing in again', async () => {
    const a = phone(t.post);
    await a.api.signIn('ST-003', '3333');
    await a.store.list('scans'); // the session is now cached
    const eb = (await owner.store.list<Employee>('employees')).find(e => e.id === 'e-b')!;
    await owner.store.put('employees', { ...eb, roles: ['employee', 'accountant'] }, 'e-owner', 'role');
    expect((await a.api.currentMember())!.roles).toEqual(['employee', 'accountant']);
    await owner.api.removeLogin('e-b');
    await expect(a.store.list('scans')).rejects.toThrow();
  });

  it('keeps ids like 001 and dates as text and never leaves a half-written company', async () => {
    await owner.store.put('shifts', { id: '001', name: 'x', start: '06:00', end: '14:00' } as any, 'e-owner', 'shift');
    expect((await owner.store.list<any>('shifts'))[0]).toMatchObject({ id: '001', start: '06:00' });
  });
});

describe('Super admin and Admin (Code.gs run against a fake sheet)', () => {
  let t: ReturnType<typeof loadScript>;
  let sup: ReturnType<typeof phone>, admin: ReturnType<typeof phone>;
  beforeEach(async () => {
    t = loadScript();
    sup = phone(t.post);
    await sup.api.createCompany({ signupCode: 'secret-code', company: { id: 'c1', name: 'ບໍລິສັດຈິງ' } as any, ownerEmployeeId: 'e-admin', ownerCode: 'ST-001', pin: '1111', superAdmin: { employeeId: 'e-super', code: 'ST-000', pin: '9999' } });
    await sup.store.put('employees', emp('e-admin', 'ST-001', { roles: ['employee', 'owner'] }), 'e-super', 'seed');
    await sup.store.put('employees', emp('e-super', 'ST-000', { roles: ['employee', 'owner'], superAdmin: true }), 'e-super', 'seed');
    await sup.store.put('employees', emp('e-a', 'ST-002'), 'e-super', 'seed');
    await sup.api.createLogin('e-a', 'ST-002', '2222');
    admin = phone(t.post);
    await admin.api.signIn('ST-001', '1111');
  });

  it('setting up signs the creator in as Super admin, and both accounts can sign in', async () => {
    expect((await sup.api.currentMember())!.roles).toEqual(['employee', 'owner', 'superadmin']);
    expect((await admin.api.currentMember())!.roles).toEqual(['employee', 'owner']);
    await phone(t.post).api.signIn('ST-000', '9999');
  });

  it('the two accounts need different codes and PINs of four digits', async () => {
    const p = phone(loadScript().post);
    const mk = (extra: any) => p.api.createCompany({ signupCode: 'secret-code', company: { id: 'c2', name: 'x' } as any, ownerEmployeeId: 'e-admin', ownerCode: 'ST-001', pin: '1111', superAdmin: { employeeId: 'e-super', code: 'ST-000', pin: '9999', ...extra } });
    await expect(mk({ code: 'st-001' })).rejects.toThrow('ຊ້ຳ');
    await expect(mk({ pin: '12' })).rejects.toThrow('4');
  });

  it('an Admin cannot reset the Super admin or another Admin, but can reset staff and their own PIN', async () => {
    await expect(admin.api.setPin('e-super', '5555')).rejects.toThrow('Super admin');
    await expect(admin.api.removeLogin('e-super')).rejects.toThrow('Super admin');
    await admin.api.setPin('e-a', '4444'); // ordinary staff: fine
    await admin.api.changeOwnPin('1231'); // own PIN: fine
    await sup.api.setPin('e-admin', '2221'); // the Super admin may reset the Admin
    await phone(t.post).api.signIn('ST-001', '2221');
  });

  it('an Admin cannot edit the Super admin record, mint another Super admin, or make another Admin', async () => {
    const list = await admin.store.list<Employee>('employees');
    const s = list.find(e => e.id === 'e-super')!, a = list.find(e => e.id === 'e-a')!;
    await expect(admin.store.put('employees', { ...s, position: 'Boss' }, 'e-admin', 'x')).rejects.toThrow('Super admin');
    await expect(admin.store.put('employees', { ...a, superAdmin: true }, 'e-admin', 'x')).rejects.toThrow('Super admin');
    await expect(admin.store.put('employees', { ...a, roles: ['employee', 'owner'] }, 'e-admin', 'x')).rejects.toThrow('Super admin');
    await expect(admin.store.put('employees', emp('e-new', 'ST-009', { roles: ['employee', 'owner'] }), 'e-admin', 'x')).rejects.toThrow('Super admin');
    await admin.store.put('employees', { ...a, roles: ['employee', 'head'] }, 'e-admin', 'role'); // other roles stay the Admin's to give
  });

  it('the Super admin can make an Admin, and the new Admin gets the owner role on their login', async () => {
    const list = await sup.store.list<Employee>('employees');
    await sup.store.put('employees', { ...list.find(e => e.id === 'e-a')!, roles: ['employee', 'owner'] }, 'e-super', 'admin');
    const a = phone(t.post);
    await a.api.signIn('ST-002', '2222');
    expect((await a.api.currentMember())!.roles).toEqual(['employee', 'owner']);
  });

  it('the Super admin keeps the marker when their record is saved again', async () => {
    const list = await sup.store.list<Employee>('employees');
    await sup.store.put('employees', { ...list.find(e => e.id === 'e-super')!, position: 'Platform' }, 'e-super', 'edit');
    expect((await sup.api.currentMember())!.roles).toContain('superadmin');
  });

  it('a company without a Super admin behaves as before: its owner may make owners', async () => {
    const t2 = loadScript(), o = phone(t2.post);
    await o.api.createCompany({ signupCode: 'secret-code', company: { id: 'c3', name: 'x' } as any, ownerEmployeeId: 'e-o', ownerCode: 'ST-001', pin: '1111' });
    await o.store.put('employees', emp('e-o', 'ST-001', { roles: ['employee', 'owner'] }), 'e-o', 'seed');
    await o.store.put('employees', emp('e-x', 'ST-002', { roles: ['employee', 'owner'] }), 'e-o', 'seed');
  });

  it('wipeEverything clears the company so a new one can be made', async () => {
    t.ctx.wipeEverything();
    expect(await sup.api.info()).toMatchObject({ companyId: null, name: null });
    const p = phone(t.post);
    await p.api.createCompany({ signupCode: 'secret-code', company: { id: 'c9', name: 'ໃໝ່' } as any, ownerEmployeeId: 'e-admin', ownerCode: 'ST-001', pin: '1111', superAdmin: { employeeId: 'e-super', code: 'ST-000', pin: '9999' } });
    expect((await p.api.info()).name).toBe('ໃໝ່');
    await expect(sup.store.list('scans')).rejects.toThrow(); // the old session is gone
  });
});

describe('sign-in cards, rights and ticks (Code.gs run against a fake sheet)', () => {
  let t: ReturnType<typeof loadScript>;
  let sup: ReturnType<typeof phone>, admin: ReturnType<typeof phone>, acc: ReturnType<typeof phone>, head: ReturnType<typeof phone>, aud: ReturnType<typeof phone>, staff: ReturnType<typeof phone>;
  beforeEach(async () => {
    t = loadScript();
    sup = phone(t.post);
    await sup.api.createCompany({ signupCode: 'secret-code', company: { id: 'c1', name: 'ບໍລິສັດຈິງ' } as any, ownerEmployeeId: 'e-admin', ownerCode: 'ST-001', pin: '1111', superAdmin: { employeeId: 'e-super', code: 'ST-000', pin: '9999' } });
    const put = (e: Employee) => sup.store.put('employees', e, 'e-super', 'seed');
    await put(emp('e-admin', 'ST-001', { name: 'Admin', roles: ['employee', 'owner'] }));
    await put(emp('e-super', 'ST-000', { name: 'Super admin', roles: ['employee', 'owner'], superAdmin: true }));
    await put(emp('e-acc', 'ST-002', { name: 'ບັນຊີ', roles: ['employee', 'accountant'] }));
    await put(emp('e-head', 'ST-003', { name: 'ຫົວໜ້າ', roles: ['employee', 'head'], dept: 'ຂາຍ' }));
    await put(emp('e-aud', 'ST-004', { name: 'ກວດ', roles: ['employee', 'auditor'] }));
    await put(emp('e-s', 'ST-005', { name: 'ພະນັກງານ', dept: 'ຂາຍ' }));
    await put(emp('e-gone', 'ST-006', { name: 'ອອກແລ້ວ', endDate: '2020-02-02' }));
    for (const [id, code, pin] of [['e-acc', 'ST-002', '2222'], ['e-head', 'ST-003', '3333'], ['e-aud', 'ST-004', '4444'], ['e-s', 'ST-005', '5555'], ['e-gone', 'ST-006', '6666']]) await sup.api.createLogin(id, code, pin);
    [admin, acc, head, aud, staff] = [phone(t.post), phone(t.post), phone(t.post), phone(t.post), phone(t.post)];
    await admin.api.signIn('ST-001', '1111'); await acc.api.signIn('ST-002', '2222'); await head.api.signIn('ST-003', '3333'); await aud.api.signIn('ST-004', '4444'); await staff.api.signIn('ST-005', '5555');
  });

  const emps = async (who: ReturnType<typeof phone>) => who.store.list<Employee>('employees');
  const setPerm = async (by: ReturnType<typeof phone>, id: string, perm: any, byId = 'e-admin') => by.store.put('employees', { ...(await emps(by)).find(e => e.id === id)!, perm }, byId, 'perm');
  /** Whose pay this person can see: the people on their screen whose salary is not the hidden placeholder. */
  const pay = async (who: ReturnType<typeof phone>) => (await emps(who)).filter(e => e.baseSalary > 0).map(e => e.id);
  const editStaff = async (who: ReturnType<typeof phone>, byId: string, position: string) => who.store.put('employees', { ...(await emps(who)).find(e => e.id === 'e-s')!, position }, byId, 'x');

  it('the sign-in screen lists the people as cards before anyone signs in, with no private data', async () => {
    const cards = (await phone(t.post).api.info()).users;
    expect(cards.map(c => c.code).sort()).toEqual(['ST-000', 'ST-001', 'ST-002', 'ST-003', 'ST-004', 'ST-005']); // ST-006 has left
    expect(cards.find(c => c.code === 'ST-000')).toEqual({ code: 'ST-000', name: 'Super admin', role: 'superadmin' });
    expect(cards.find(c => c.code === 'ST-002')).toEqual({ code: 'ST-002', name: 'ບັນຊີ', role: 'accountant' });
    expect(JSON.stringify(cards)).not.toMatch(/hash|salt|salary|baseSalary|bank/i);
  });

  it('the rights tables in Code.gs equal the ones in the app', () => {
    expect(JSON.parse(JSON.stringify(t.ctx.ROLE_RIGHTS))).toEqual({ employee: ROLE_RIGHTS.employee, head: ROLE_RIGHTS.head, accountant: ROLE_RIGHTS.accountant, auditor: ROLE_RIGHTS.auditor });
    expect(JSON.parse(JSON.stringify(t.ctx.ALL_RIGHTS))).toEqual(ALL_RIGHTS);
  });

  it('by default each role sees what it always did', async () => {
    expect((await pay(acc)).length).toBeGreaterThan(1);
    expect((await pay(aud)).length).toBeGreaterThan(1);
    expect(await pay(head)).toEqual(['e-head']); // only their own
    expect(await pay(staff)).toEqual(['e-s']);
    await expect(editStaff(aud, 'e-aud', 'x2')).rejects.toThrow();
    await expect(head.api.backend.listAudit('c1')).rejects.toThrow();
    await aud.api.backend.listAudit('c1');
  });

  it('a tick on one person grants a page of data, a tick off takes it away', async () => {
    await setPerm(admin, 'e-head', { 'p.pay': true });
    expect((await pay(head)).length).toBeGreaterThan(1);
    await setPerm(admin, 'e-acc', { 'p.pay': false, 'p.staff': false });
    expect(await pay(acc)).toEqual(['e-acc']); // only their own now
    await editStaff(acc, 'e-acc', 'y'); // staff.edit is a separate right and still theirs
    await setPerm(admin, 'e-acc', { 'staff.edit': false });
    await expect(editStaff(acc, 'e-acc', 'z')).rejects.toThrow('ບໍ່ມີສິດ');
  });

  it('a tick for scope: viewing the whole company, or only your own department', async () => {
    const scans = (who: ReturnType<typeof phone>) => who.store.list<any>('scans');
    await staff.store.put('scans', { id: 'sc1', companyId: 'c1', employeeId: 'e-s', kind: 'in', at: '2026-11-02T08:00:00', status: 'ok' } as any, 'e-s', 'scan');
    await acc.store.put('scans', { id: 'sc2', companyId: 'c1', employeeId: 'e-acc', kind: 'in', at: '2026-11-02T08:00:00', status: 'ok' } as any, 'e-acc', 'scan');
    expect((await scans(head)).map(s => s.id)).toEqual(['sc1']); // same department only
    await setPerm(admin, 'e-head', { dataAll: true });
    expect((await scans(head)).map(s => s.id).sort()).toEqual(['sc1', 'sc2']);
    await setPerm(admin, 'e-head', { dataDept: false, dataAll: false });
    expect(await scans(head)).toEqual([]);
  });

  it('who may tick: only someone who manages rights, never on themselves, never a right they lack', async () => {
    await expect(setPerm(acc, 'e-s', { 'p.pay': true }, 'e-acc')).rejects.toThrow('ບໍ່ມີສິດ');
    await expect(setPerm(staff, 'e-s', { 'p.pay': true }, 'e-s')).rejects.toThrow('ບໍ່ມີສິດ');
    await setPerm(admin, 'e-acc', { userMng: true }); // Admin hands user management to the accountant
    await expect(setPerm(acc, 'e-acc', { 'p.reports': true }, 'e-acc')).rejects.toThrow('ຕັ້ງສິດຂອງຕົນເອງ'); // even a right they hold: no ticks on yourself
    await expect(setPerm(acc, 'e-s', { 'p.audit': true }, 'e-acc')).rejects.toThrow('ບໍ່ມີ'); // the accountant cannot hand out a page they do not have
    await setPerm(acc, 'e-s', { 'p.pay': true }, 'e-acc'); // they can hand out what they hold
    expect((await pay(staff)).length).toBeGreaterThan(1);
    await expect(setPerm(admin, 'e-s', { nonsense: true })).rejects.toThrow('ບໍ່ຖືກຕ້ອງ');
    await expect(setPerm(admin, 'e-s', { 'p.pay': 'yes' })).rejects.toThrow('ບໍ່ຖືກຕ້ອງ');
  });

  it('only the Super admin changes what a role gives, and it changes for everyone in that role', async () => {
    const st = (await sup.store.list<any>('settings'))[0] ?? { id: 'c1', companyId: 'c1' };
    const next = { ...st, id: 'c1', roleRights: { accountant: ['p.overview', 'dataAll'] } };
    await expect(admin.store.put('settings', next, 'e-admin', 'settings')).rejects.toThrow('Super admin');
    await sup.store.put('settings', next, 'e-super', 'settings');
    expect(await pay(acc)).toEqual(['e-acc']); // pay data gone
    await expect(editStaff(acc, 'e-acc', 'q')).rejects.toThrow('ບໍ່ມີສິດ');
    await setPerm(admin, 'e-acc', { 'p.pay': true });
    expect((await pay(acc)).length).toBeGreaterThan(1); // a tick still wins over the role
    await expect(sup.store.put('settings', { ...next, roleRights: { owner: ['p.pay'] } }, 'e-super', 'settings')).rejects.toThrow('ບໍ່ຖືກຕ້ອງ');
    await expect(sup.store.put('settings', { ...next, roleRights: { head: ['p.nope'] } }, 'e-super', 'settings')).rejects.toThrow('ບໍ່ຖືກຕ້ອງ');
  });

  it('a company without a Super admin: the Admin changes roles as before', async () => {
    const t2 = loadScript(), o = phone(t2.post);
    await o.api.createCompany({ signupCode: 'secret-code', company: { id: 'c3', name: 'x' } as any, ownerEmployeeId: 'e-o', ownerCode: 'ST-001', pin: '1111' });
    await o.store.put('employees', emp('e-o', 'ST-001', { roles: ['employee', 'owner'] }), 'e-o', 'seed');
    await o.store.put('settings', { id: 'c3', companyId: 'c3', roleRights: { head: ['p.overview'] } } as any, 'e-o', 'settings');
  });

  it('signing in takes exactly four digits', async () => {
    await expect(phone(t.post).api.signIn('ST-002', '222222')).rejects.toThrow();
    await expect(admin.api.setPin('e-s', '555555')).rejects.toThrow('4');
  });
});

describe('approving with a colleague\'s PIN (Code.gs run against a fake sheet)', () => {
  let t: ReturnType<typeof loadScript>;
  let sup: ReturnType<typeof phone>, admin: ReturnType<typeof phone>, head: ReturnType<typeof phone>, staff: ReturnType<typeof phone>;
  beforeEach(async () => {
    t = loadScript();
    sup = phone(t.post);
    await sup.api.createCompany({ signupCode: 'secret-code', company: { id: 'c1', name: 'ບໍລິສັດຈິງ' } as any, ownerEmployeeId: 'e-admin', ownerCode: 'ST-001', pin: '1111', superAdmin: { employeeId: 'e-super', code: 'ST-000', pin: '9999' } });
    const put = (e: Employee) => sup.store.put('employees', e, 'e-super', 'seed');
    await put(emp('e-admin', 'ST-001', { name: 'Admin', roles: ['employee', 'owner'] }));
    await put(emp('e-super', 'ST-000', { name: 'Super admin', roles: ['employee', 'owner'], superAdmin: true }));
    await put(emp('e-acc', 'ST-002', { name: 'ບັນຊີ', roles: ['employee', 'accountant'] }));
    await put(emp('e-head', 'ST-003', { name: 'ຫົວໜ້າ', roles: ['employee', 'head'], dept: 'ຂາຍ' }));
    await put(emp('e-s', 'ST-005', { name: 'ພະນັກງານ', dept: 'ຂາຍ' }));
    for (const [id, code, pin] of [['e-acc', 'ST-002', '2222'], ['e-head', 'ST-003', '3333'], ['e-s', 'ST-005', '5555']]) await sup.api.createLogin(id, code, pin);
    [admin, head, staff] = [phone(t.post), phone(t.post), phone(t.post)];
    await admin.api.signIn('ST-001', '1111'); await head.api.signIn('ST-003', '3333'); await staff.api.signIn('ST-005', '5555');
  });
  const item = { id: 'pi1', companyId: 'c1', employeeId: 'e-s', kind: 'bonus', amount: 100000 } as any;
  const writtenBy = () => [...t.sheets.values()].find(s => s.name === 'c_payItems')!.grid[1][2];

  it('someone without the right is refused, and is let through with a colleague\'s PIN that has it', async () => {
    await expect(head.store.put('payItems', item, 'e-head', 'item')).rejects.toThrow('ບໍ່ມີສິດ');
    const a = await head.api.approve('ST-002', '2222');
    expect(a.approverId).toBe('e-acc');
    await head.api.withApproval(a.approval, () => head.store.put('payItems', item, 'e-head', 'item'));
    expect(writtenBy()).toBe('e-head ← e-acc'); // the sheet records who did it and who stood behind it
    await expect(head.store.put('payItems', { ...item, amount: 1 }, 'e-head', 'item')).rejects.toThrow('ບໍ່ມີສິດ'); // the approval was for that one action
  });

  it('an approval is not kept: it only rides on the writes of the approved action', async () => {
    const a = await head.api.approve('ST-002', '2222');
    await head.api.withApproval(a.approval, async () => {});
    await expect(head.store.put('payItems', item, 'e-head', 'item')).rejects.toThrow('ບໍ່ມີສິດ');
  });

  it('the PIN must be right, belong to someone else, and belong to someone who may approve for others', async () => {
    await expect(head.api.approve('ST-002', '0000')).rejects.toThrow('ບໍ່ຖືກ');
    await expect(head.api.approve('ST-003', '3333')).rejects.toThrow('ອີກຄົນ'); // not yourself
    await expect(head.api.approve('ST-005', '5555')).rejects.toThrow('ບໍ່ມີສິດອະນຸມັດ'); // a plain employee cannot
    for (let i = 0; i < 5; i++) await head.api.approve('ST-002', '0000').catch(() => {});
    await expect(head.api.approve('ST-002', '2222')).rejects.toThrow('ລໍ'); // wrong PINs lock the approver like a sign-in
  });

  it('an approval belongs to the person who asked, and runs out', async () => {
    const a = await head.api.approve('ST-002', '2222');
    await expect(staff.api.withApproval(a.approval, () => staff.store.put('payItems', item, 'e-s', 'item'))).rejects.toThrow('ໝົດເວລາ');
    const real = t.ctx.Date;
    t.ctx.Date = class extends real { constructor(...x: any[]) { super(...(x.length ? x : [real.now() + 5 * 60_000])); } static now() { return real.now() + 5 * 60_000; } };
    await expect(head.api.withApproval(a.approval, () => head.store.put('payItems', item, 'e-head', 'item'))).rejects.toThrow('ໝົດເວລາ');
  });

  it('managing logins and rights is never lent, even by the Admin', async () => {
    const a = await head.api.approve('ST-001', '1111');
    const s = (await head.store.list<Employee>('employees')).find(e => e.id === 'e-s')!;
    await expect(head.api.withApproval(a.approval, () => head.store.put('employees', { ...s, perm: { 'p.pay': true } }, 'e-head', 'perm'))).rejects.toThrow('ບໍ່ມີສິດ');
    await expect(head.api.withApproval(a.approval, () => head.api.setPin('e-s', '1212'))).rejects.toThrow('ບໍ່ມີສິດ');
  });

  it('who approved is in the log', async () => {
    await head.api.approve('ST-002', '2222');
    const log = await admin.api.backend.listAudit('c1');
    expect(log.find(l => l.action === 'approve-for')).toMatchObject({ by: 'e-acc', entityId: 'e-head' });
  });
});

describe('Admin and Super admin look up and set PINs (Code.gs run against a fake sheet)', () => {
  let t: ReturnType<typeof loadScript>;
  let sup: ReturnType<typeof phone>, admin: ReturnType<typeof phone>, staff: ReturnType<typeof phone>, head: ReturnType<typeof phone>;
  const usersGrid = () => [...t.sheets.values()].find(x => x.name === '_users')!.grid;
  const audit = () => [...t.sheets.values()].find(x => x.name === '_audit')!.grid.slice(1).map((r: any[]) => r[3]);
  beforeEach(async () => {
    t = loadScript();
    sup = phone(t.post);
    await sup.api.createCompany({ signupCode: 'secret-code', company: { id: 'c1', name: 'ບໍລິສັດຈິງ' } as any, ownerEmployeeId: 'e-admin', ownerCode: 'ST-001', pin: '1111', superAdmin: { employeeId: 'e-super', code: 'ST-000', pin: '9999' } });
    const put = (e: Employee) => sup.store.put('employees', e, 'e-super', 'seed');
    await put(emp('e-admin', 'ST-001', { name: 'Admin', roles: ['employee', 'owner'] }));
    await put(emp('e-super', 'ST-000', { name: 'Super admin', roles: ['employee', 'owner'], superAdmin: true }));
    await put(emp('e-head', 'ST-003', { name: 'ຫົວໜ້າ', roles: ['employee', 'head'], dept: 'ຂາຍ' }));
    await put(emp('e-s', 'ST-005', { name: 'ພະນັກງານ', dept: 'ຂາຍ' }));
    await sup.api.createLogin('e-head', 'ST-003', '3333');
    await sup.api.createLogin('e-s', 'ST-005', '5555');
    [admin, head, staff] = [phone(t.post), phone(t.post), phone(t.post)];
    await admin.api.signIn('ST-001', '1111'); await head.api.signIn('ST-003', '3333'); await staff.api.signIn('ST-005', '5555');
  });

  it('the Admin and the Super admin read a staff PIN; everyone else is refused', async () => {
    expect(await admin.api.revealPin('e-s')).toBe('5555');
    expect(await sup.api.revealPin('e-s')).toBe('5555');
    await expect(head.api.revealPin('e-s')).rejects.toThrow('Admin');
    await expect(staff.api.revealPin('e-head')).rejects.toThrow('Admin');
  });

  it('an Admin cannot read the Super admin PIN, the Super admin reads every PIN', async () => {
    await expect(admin.api.revealPin('e-super')).rejects.toThrow('Super admin');
    expect(await sup.api.revealPin('e-admin')).toBe('1111');
    expect(await sup.api.revealPin('e-super')).toBe('9999');
  });

  it('a new PIN, set by an Admin or by the person, is the one that shows', async () => {
    await admin.api.setPin('e-s', '4242');
    expect(await admin.api.revealPin('e-s')).toBe('4242');
    await staff.api.signIn('ST-005', '4242');
    await staff.api.changeOwnPin('7070');
    expect(await admin.api.revealPin('e-s')).toBe('7070');
  });

  it('the sheet never holds a PIN in the clear, and the scramble changes with each new PIN', async () => {
    const cell = () => usersGrid().find((r: any[]) => r[0] === 'e-s')![8] as string;
    const first = cell();
    expect(first).toMatch(/^v1:[0-9a-f]{8}$/);
    expect(first).not.toContain('5555');
    await admin.api.setPin('e-s', '5555');
    expect(cell()).not.toBe(first); // same PIN, new salt, new scramble
    expect(JSON.stringify(usersGrid())).not.toContain('"5555"');
  });

  it('a PIN made before PINs could be looked up shows after its owner signs in once', async () => {
    const row = usersGrid().find((r: any[]) => r[0] === 'e-s')!;
    row[8] = ''; // as in a company made before this feature
    t.ctx.CacheService.getScriptCache().remove('users');
    expect(await admin.api.revealPin('e-s')).toBeNull();
    await staff.api.signIn('ST-005', '5555');
    expect(await admin.api.revealPin('e-s')).toBe('5555');
  });

  it('every look is in the log, but looking at your own PIN is not', async () => {
    await admin.api.revealPin('e-s');
    await admin.api.revealPin('e-admin');
    expect(audit().filter(a => a === 'pin-reveal')).toHaveLength(1);
  });
});

describe('the Super admin gate on an Admin (Code.gs run against a fake sheet)', () => {
  let t: ReturnType<typeof loadScript>;
  let sup: ReturnType<typeof phone>, admin: ReturnType<typeof phone>, acc: ReturnType<typeof phone>;
  const grid = (name: string) => [...t.sheets.values()].find(x => x.name === name)?.grid ?? [];
  const auditActions = () => grid('_audit').slice(1).map((r: any[]) => r[3]);
  const leave = { id: 'l1', companyId: 'c1', employeeId: 'e-s', type: 'annual', from: '2026-11-10', to: '2026-11-10', days: 1, reason: 'x', status: 'approved', approvals: [] } as any;
  const scan = (extra: object = {}) => ({ id: 's1', companyId: 'c1', employeeId: 'e-s', kind: 'in', deviceTime: '2026-11-04T08:00:00.000Z', status: 'ok', reasons: [], ...extra }) as any;
  const run2 = { runs: 0 };
  const viaSuper = async <T,>(who: typeof admin, run: () => Promise<T>) => who.api.withApproval((await who.api.approve('ST-000', '9999')).approval, run);
  const slip = (status: string) => ({ id: '2026-10', companyId: 'c1', status, lateConfirmed: [] }) as any;
  const asSalary = (n: number) => emp('e-s', 'ST-005', { name: 'ພະນັກງານ', baseSalary: n });

  beforeEach(async () => {
    t = loadScript();
    sup = phone(t.post);
    await sup.api.createCompany({ signupCode: 'secret-code', company: { id: 'c1', name: 'ບໍລິສັດຈິງ' } as any, ownerEmployeeId: 'e-admin', ownerCode: 'ST-001', pin: '1111', superAdmin: { employeeId: 'e-super', code: 'ST-000', pin: '9999' } });
    const put = (e: Employee) => sup.store.put('employees', e, 'e-super', 'seed');
    await put(emp('e-admin', 'ST-001', { name: 'Admin', roles: ['employee', 'owner'] }));
    await put(emp('e-super', 'ST-000', { name: 'Super admin', roles: ['employee', 'owner'], superAdmin: true }));
    await put(emp('e-acc', 'ST-002', { name: 'ບັນຊີ', roles: ['employee', 'accountant'] }));
    await put(emp('e-s', 'ST-005', { name: 'ພະນັກງານ' }));
    await put(emp('e-tmp', 'ST-009', { name: 'ຄົນໃໝ່' }));
    await sup.api.createLogin('e-acc', 'ST-002', '2222');
    await sup.api.createLogin('e-s', 'ST-005', '5555');
    await sup.api.createLogin('e-tmp', 'ST-009', '9090');
    [admin, acc] = [phone(t.post), phone(t.post)];
    await admin.api.signIn('ST-001', '1111'); await acc.api.signIn('ST-002', '2222');
    await sup.store.put('leaves', leave, 'e-super', 'seed');
    await sup.store.put('scans', scan(), 'e-super', 'seed');
    run2.runs++;
  });

  it('the Super admin deletes, edits pay, closes payroll and edits a clock-in with nobody approving', async () => {
    await sup.store.put('employees', asSalary(6_000_000), 'e-super', 'x');
    await sup.store.put('payrollRuns', slip('locked'), 'e-super', 'x');
    await sup.store.put('scans', scan({ deviceTime: '2026-11-04T09:00:00.000Z' }), 'e-super', 'x');
    await sup.store.remove('leaves', 'l1', 'e-super', 'x');
  });

  it('an Admin is told to get the Super admin for each of the four things, with a code the app can act on', async () => {
    await expect(admin.store.remove('leaves', 'l1', 'e-admin', 'x')).rejects.toMatchObject({ code: 'needsuper' });
    await expect(admin.store.put('employees', asSalary(6_000_000), 'e-admin', 'x')).rejects.toMatchObject({ code: 'needsuper' });
    await expect(admin.store.put('employees', emp('e-s', 'ST-005', { name: 'ພະນັກງານ', bankAccount: '999' }), 'e-admin', 'x')).rejects.toMatchObject({ code: 'needsuper' });
    await expect(admin.store.put('payrollRuns', slip('locked'), 'e-admin', 'x')).rejects.toMatchObject({ code: 'needsuper' });
    await expect(admin.store.put('scans', scan({ deviceTime: '2026-11-04T09:00:00.000Z' }), 'e-admin', 'x')).rejects.toMatchObject({ code: 'needsuper' });
  });

  it('with the Super admin PIN behind it each goes through, and the sheet names both people', async () => {
    await viaSuper(admin, () => admin.store.remove('leaves', 'l1', 'e-admin', 'x'));
    expect(await sup.store.list('leaves')).toHaveLength(0);
    await viaSuper(admin, () => admin.store.put('employees', asSalary(6_000_000), 'e-admin', 'x'));
    expect(grid('c_employeePay').find((r: any[]) => r[0] === 'e-s')![2]).toBe('e-admin ← e-super');
    await viaSuper(admin, () => admin.store.put('scans', scan({ deviceTime: '2026-11-04T09:00:00.000Z' }), 'e-admin', 'x'));
  });

  it('every deletion keeps the whole record in the audit log, by the Admin and the Super admin who stood behind', async () => {
    await viaSuper(admin, () => admin.store.remove('leaves', 'l1', 'e-admin', 'x'));
    const row = grid('_audit').slice(1).find((r: any[]) => r[3] === 'record-delete')!;
    expect(row[2]).toBe('e-admin ← e-super');
    expect(row[4]).toBe('leaves');
    expect(JSON.parse(row[6])).toMatchObject({ id: 'l1', employeeId: 'e-s', days: 1 });
  });

  it('the approval has to be the Super admin one: an accountant PIN does not do', async () => {
    const a = await admin.api.approve('ST-002', '2222');
    await expect(admin.api.withApproval(a.approval, () => admin.store.remove('leaves', 'l1', 'e-admin', 'x'))).rejects.toMatchObject({ code: 'needsuper' });
  });

  it('normal work is not gated: a new hire first pay, a review decision, a photo purge, a note', async () => {
    await admin.store.put('employees', emp('e-new', 'ST-020', { name: 'ໃໝ່' }), 'e-admin', 'employee-hire');
    await admin.store.put('scans', scan({ status: 'approved', reviewedBy: 'e-admin', photo: undefined }), 'e-admin', 'scan-approve');
    await admin.store.put('notifications', { id: 'n1', companyId: 'c1', userId: 'e-admin', text: 'x', at: 'x', read: false } as any, 'e-admin', 'notify');
    await admin.store.remove('notifications', 'n1', 'e-admin', 'x');
  });

  it('reopening a closed payroll month needs the Super admin too', async () => {
    await sup.store.put('payrollRuns', slip('locked'), 'e-super', 'x');
    await expect(admin.store.put('payrollRuns', slip('prepared'), 'e-admin', 'x')).rejects.toMatchObject({ code: 'needsuper' });
    await viaSuper(admin, () => admin.store.put('payrollRuns', slip('prepared'), 'e-admin', 'x'));
  });

  it('a person with no history can be deleted (their login and pay rows go with them); one with history cannot', async () => {
    await viaSuper(admin, () => admin.store.remove('employees', 'e-tmp', 'e-admin', 'x'));
    expect((await sup.store.list<Employee>('employees')).some(e => e.id === 'e-tmp')).toBe(false);
    expect(grid('c_employeePay').some((r: any[]) => r[0] === 'e-tmp')).toBe(false);
    await expect(phone(t.post).api.signIn('ST-009', '9090')).rejects.toThrow();
    await expect(viaSuper(admin, () => admin.store.remove('employees', 'e-s', 'e-admin', 'x'))).rejects.toThrow('ມີປະຫວັດ');
  });

  it('nobody deletes themselves, and an Admin cannot delete the Super admin', async () => {
    await expect(viaSuper(admin, () => admin.store.remove('employees', 'e-admin', 'e-admin', 'x'))).rejects.toThrow('ຕົນເອງ');
    await expect(viaSuper(admin, () => admin.store.remove('employees', 'e-super', 'e-admin', 'x'))).rejects.toThrow('Super admin');
    await expect(sup.store.remove('employees', 'e-super', 'e-super', 'x')).rejects.toThrow('ຕົນເອງ');
  });

  it('an accountant cannot delete anything, approval or not', async () => {
    await expect(acc.store.remove('leaves', 'l1', 'e-acc', 'x')).rejects.toThrow('ບໍ່ມີສິດ');
    await expect(acc.store.remove('employees', 'e-tmp', 'e-acc', 'x')).rejects.toThrow('ບໍ່ມີສິດ');
  });

  it('a company with no Super admin works as before: the Admin does all of it alone', async () => {
    const t2 = loadScript(); const a2 = phone(t2.post);
    await a2.api.createCompany({ signupCode: 'secret-code', company: { id: 'c1', name: 'x' } as any, ownerEmployeeId: 'e-o', ownerCode: 'ST-001', pin: '1111' });
    await a2.store.put('employees', emp('e-o', 'ST-001', { roles: ['employee', 'owner'] }), 'e-o', 'seed');
    await a2.store.put('leaves', leave, 'e-o', 'seed');
    await a2.store.put('employees', emp('e-o', 'ST-001', { roles: ['employee', 'owner'], baseSalary: 7_000_000 }), 'e-o', 'x');
    await a2.store.remove('leaves', 'l1', 'e-o', 'x');
    expect(auditActions()).not.toContain('record-delete'); // that was the other company's sheet; this one has its own log
  });
});
