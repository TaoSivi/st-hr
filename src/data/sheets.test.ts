import { beforeEach, describe, expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { RemoteStore } from './remote';
import { sheetsApi } from './sheets';
import type { Employee } from '../domain/types';

/** A tiny stand-in for the parts of Google Apps Script that Code.gs uses, so the real script runs here. */
class FakeSheet {
  grid: string[][] = [];
  rows = 1000; cols = 26;
  constructor(public name: string) {}
  private cell(r: number, c: number) { return this.grid[r - 1]?.[c - 1] ?? ''; }
  getName() { return this.name; }
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
    getSheetByName: (n: string) => sheets.get(n) ?? null,
    getSheets: () => [...sheets.values()],
    insertSheet: (n: string) => { const s = new FakeSheet(n); sheets.set(n, s); return s; }
  };
  const out = (s: string) => ({ setMimeType() { return this; }, getContent: () => s });
  const ctx: any = {
    SpreadsheetApp: { getActiveSpreadsheet: () => book },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k: string) => props.get(k) ?? null }) },
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
    await owner.api.createCompany({ signupCode: 'secret-code', company: { id: 'c1', name: 'ຮ້ານທົດລອງ', plan: 'pro' } as any, ownerEmployeeId: 'e-owner', ownerCode: 'ST-001', pin: '123456' });
    await owner.store.put('employees', emp('e-owner', 'ST-001', { roles: ['employee', 'owner'] }), 'e-owner', 'seed');
    await owner.store.put('employees', emp('e-a', 'ST-002'), 'e-owner', 'hire');
    await owner.store.put('employees', emp('e-b', 'ST-003'), 'e-owner', 'hire');
    await owner.api.createLogin('e-a', 'ST-002', '222222');
    await owner.api.createLogin('e-b', 'ST-003', '333333');
  });

  it('creating a company needs the signup code, and only works once', async () => {
    const fresh = loadScript(), p = phone(fresh.post);
    const mk = (code: string) => p.api.createCompany({ signupCode: code, company: { id: 'c2', name: 'x' } as any, ownerEmployeeId: 'o', ownerCode: 'ST-001', pin: '123456' });
    await expect(mk('wrong')).rejects.toThrow('ລະຫັດສ້າງບໍລິສັດບໍ່ຖືກ');
    await mk('secret-code');
    await expect(mk('secret-code')).rejects.toThrow('ມີບໍລິສັດແລ້ວ');
    expect(await p.api.info()).toEqual({ companyId: 'c2', name: 'x' });
  });

  it('signs in with code + PIN, loads the company, and rejects a wrong PIN', async () => {
    const a = phone(t.post);
    await expect(a.api.signIn('st-002', '000000')).rejects.toThrow('ບໍ່ຖືກ');
    const m = await a.api.signIn('ST-002', '222222');
    expect(m).toMatchObject({ employeeId: 'e-a', companyId: 'c1', roles: ['employee'] });
    expect((await a.api.currentMember())?.employeeId).toBe('e-a');
    expect(await a.api.loadCompany()).toMatchObject({ id: 'c1', name: 'ຮ້ານທົດລອງ' });
    await a.api.signOut();
    expect(await a.api.currentMember()).toBeNull();
  });

  it('locks a login after five wrong PINs', async () => {
    const a = phone(t.post);
    for (let i = 0; i < 5; i++) await expect(a.api.signIn('ST-002', '999999')).rejects.toThrow();
    await expect(a.api.signIn('ST-002', '222222')).rejects.toThrow('ລໍ');
  });

  it('one list call per collection travels as a single batch and employees come back joined', async () => {
    const a = phone(t.post);
    await a.api.signIn('ST-002', '222222');
    let posts = 0;
    const counting = (b: unknown) => { posts++; return t.post(b); };
    const b = phone(counting); b.api.signIn; // separate counter phone
    await b.api.signIn('ST-002', '222222');
    posts = 0;
    const [emps, shifts, scans] = await Promise.all([b.store.list<Employee>('employees'), b.store.list('shifts'), b.store.list('scans')]);
    expect(posts).toBe(1);
    expect(emps.map(e => e.id).sort()).toEqual(['e-a', 'e-b', 'e-owner']);
    expect(shifts).toEqual([]); expect(scans).toEqual([]);
  });

  it('pay is hidden from other employees but joined for the owner and the person', async () => {
    const a = phone(t.post), o = phone(t.post);
    await a.api.signIn('ST-002', '222222'); await o.api.signIn('ST-001', '123456');
    const seenByA = await a.store.list<Employee>('employees');
    expect(seenByA.find(e => e.id === 'e-b')!.baseSalary).toBe(0);
    expect(seenByA.find(e => e.id === 'e-a')!.baseSalary).toBe(5_000_000);
    expect((await o.store.list<Employee>('employees')).find(e => e.id === 'e-b')!.baseSalary).toBe(5_000_000);
  });

  it('face data is only readable by its owner, and the owner can still clear it', async () => {
    const a = phone(t.post), o = phone(t.post);
    await a.api.signIn('ST-002', '222222'); await o.api.signIn('ST-001', '123456');
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
    await a.api.signIn('ST-002', '222222');
    const list = await a.store.list<Employee>('employees');
    const me = list.find(e => e.id === 'e-a')!, other = list.find(e => e.id === 'e-b')!;
    await expect(a.store.put('employees', { ...me, roles: ['employee', 'owner'] }, 'e-a', 'x')).rejects.toThrow('ເຈົ້າຂອງ');
    await expect(a.store.put('employees', { ...me, baseSalary: 9_999_999 }, 'e-a', 'x')).rejects.toThrow('ບໍ່ມີສິດ');
    await expect(a.store.put('employees', { ...other, position: 'boss' }, 'e-a', 'x')).rejects.toThrow('ບໍ່ມີສິດ');
    await a.store.put('employees', { ...me, deviceId: 'phone-1' }, 'e-a', 'bind'); // allowed: the person's own device
  });

  it('scans: you see your own, not a colleague\'s; the owner sees all; the head sees their department', async () => {
    const a = phone(t.post), b = phone(t.post), o = phone(t.post);
    await a.api.signIn('ST-002', '222222'); await b.api.signIn('ST-003', '333333'); await o.api.signIn('ST-001', '123456');
    await a.store.put('scans', { id: 'sa', employeeId: 'e-a', at: 1 }, 'e-a', 'scan');
    await b.store.put('scans', { id: 'sb', employeeId: 'e-b', at: 2 }, 'e-b', 'scan');
    await expect(a.store.put('scans', { id: 'forged', employeeId: 'e-b', at: 3 }, 'e-a', 'scan')).rejects.toThrow('ບໍ່ມີສິດ');
    expect((await a.store.list<any>('scans')).map(s => s.id)).toEqual(['sa']);
    expect((await o.store.list<any>('scans')).map(s => s.id).sort()).toEqual(['sa', 'sb']);
    // make e-b a head of the department: sees e-a's scan too
    const eb = (await o.store.list<Employee>('employees')).find(e => e.id === 'e-b')!;
    await o.store.put('employees', { ...eb, roles: ['employee', 'head'] }, 'e-owner', 'role');
    await b.api.signIn('ST-003', '333333'); // the new role is on the login
    expect((await b.store.list<any>('scans')).map(s => s.id).sort()).toEqual(['sa', 'sb']);
  });

  it('long records (a photo) survive being split over several cells', async () => {
    const a = phone(t.post);
    await a.api.signIn('ST-002', '222222');
    const photo = 'data:image/jpeg;base64,' + 'A'.repeat(130_000);
    await a.store.put('scans', { id: 'big', employeeId: 'e-a', photo }, 'e-a', 'scan');
    expect((await a.store.list<any>('scans'))[0].photo).toBe(photo);
    await a.store.put('scans', { id: 'big', employeeId: 'e-a', photo: 'short' }, 'e-a', 'scan'); // shrinking leaves no stale tail
    expect((await a.store.list<any>('scans'))[0].photo).toBe('short');
  });

  it('the owner makes logins and resets PINs; a closed login cannot get in or use its old session', async () => {
    const a = phone(t.post);
    await a.api.signIn('ST-002', '222222');
    await owner.api.setPin('e-a', '444444');
    await expect(phone(t.post).api.signIn('ST-002', '222222')).rejects.toThrow();
    await phone(t.post).api.signIn('ST-002', '444444');
    await expect(a.api.setPin('e-b', '555555')).rejects.toThrow('ເຈົ້າຂອງ');
    expect([...(await owner.api.listLogins())].sort()).toEqual(['e-a', 'e-b', 'e-owner']);
    await owner.api.removeLogin('e-a');
    await expect(a.store.list('scans')).rejects.toThrow();
    await expect(phone(t.post).api.signIn('ST-002', '444444')).rejects.toThrow();
  });

  it('changing your own PIN works and must be six digits', async () => {
    const a = phone(t.post);
    await a.api.signIn('ST-002', '222222');
    await expect(a.api.changeOwnPin('12')).rejects.toThrow('6');
    await a.api.changeOwnPin('777777');
    await phone(t.post).api.signIn('ST-002', '777777');
  });

  it('the audit log is written under the real caller, readable only by owner/auditor', async () => {
    const a = phone(t.post);
    await a.api.signIn('ST-002', '222222');
    const me = (await a.store.list<Employee>('employees')).find(e => e.id === 'e-a')!;
    await a.store.put('employees', { ...me, deviceId: 'd1' }, 'someone-else', 'bind');
    const log = await owner.store.audit();
    const last = log.filter(l => l.action === 'bind').pop()!;
    expect(last.by).toBe('e-a'); // not the name the phone claimed
    await expect(a.store.audit()).rejects.toThrow('ບໍ່ມີສິດ');
  });

  it('unknown collections are refused, and a bad or missing session is told to sign in again', async () => {
    const a = phone(t.post);
    await a.api.signIn('ST-002', '222222');
    await expect(a.api.backend.upsert('c1', 'junk', 'x', { a: 1 }, 'e-a')).rejects.toThrow('ບໍ່ຮູ້ຈັກ');
    expect(t.post({ action: 'list', collection: 'scans' })).toMatchObject({ ok: false, code: 'auth' });
    expect(t.post({ action: 'list', collection: 'scans', token: 'nope' })).toMatchObject({ ok: false, code: 'auth' });
  });

  it('reading never creates tabs, and sign-in brings the company so opening needs no extra trip', async () => {
    const a = phone(t.post);
    const before = [...t.sheets.keys()].sort();
    await a.api.signIn('ST-002', '222222');
    await a.store.list('leaves'); await a.store.list('ots');
    expect([...t.sheets.keys()].sort()).toEqual(before);
    let posts = 0;
    const counting = phone((b: unknown) => { posts++; return t.post(b); });
    await counting.api.signIn('ST-002', '222222');
    expect(await counting.api.loadCompany()).toMatchObject({ id: 'c1', name: 'ຮ້ານທົດລອງ' });
    expect(posts).toBe(1); // the sign-in itself; the company needed no second call
  });

  it('a removed login loses its cached session at once, and a new role shows without signing in again', async () => {
    const a = phone(t.post);
    await a.api.signIn('ST-003', '333333');
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
