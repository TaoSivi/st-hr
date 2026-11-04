/**
 * ST HR — Google Sheets backend (Google Apps Script web app).
 *
 * One Google Sheet = one company. The sheet is the database; this script is the only way the app reaches it:
 * it signs people in (employee code + 6-digit PIN), and for every read and write it checks the person's role,
 * the same rules as supabase/schema.sql. Nobody needs access to the sheet itself, and the sheet should be shared with nobody.
 *
 * Tabs it creates:  c_<collection> (one per kind of record) · _company · _users · _sessions · _audit
 * Setup: see apps-script/README.md.  The app talks to it with POST requests whose body is JSON (see doPost).
 */

var PREFIX = 'c_';
var CHUNK = 40000;            // a cell holds at most 50,000 characters: longer records continue in the next cell of the row
var SESSION_DAYS = 14;
var MAX_FAILS = 5;
var LOCK_MIN = 5;
var KDF_ROUNDS = 1000;
var COLLECTIONS = ['advances', 'branches', 'changes', 'employees', 'employeePay', 'employeeSecret', 'exports', 'leaves', 'notifications', 'ots', 'overrides', 'payItems', 'payrollRuns', 'payslips', 'requests', 'scans', 'settings', 'shifts'];
var RECORD_HEADER = ['id', 'updatedAt', 'updatedBy', 'data'];
var REQ = {};                 // per-request cache

// ---------------------------------------------------------------- entry
function doGet() {
  return ContentService.createTextOutput('ST HR sheet backend is running').setMimeType(ContentService.MimeType.TEXT);
}

function doPost(e) {
  REQ = {};
  var out;
  try {
    var req = JSON.parse(e.postData.contents);
    out = { ok: true, data: handle(req) };
  } catch (err) {
    out = { ok: false, error: String((err && err.message) || err), code: (err && err.code) || '' };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

var WRITES = { create: 1, login: 1, logout: 1, upsert: 1, del: 1, addAudit: 1, createLogin: 1, setPin: 1, changeOwnPin: 1, removeLogin: 1 };

function handle(req) {
  if (req.action === 'multi') {
    // several reads in one trip; each answers on its own so one refusal does not hide the rest
    return (req.ops || []).map(function (op) {
      try { return { ok: true, data: dispatch(op, req.token) }; } catch (err) { return { ok: false, error: String((err && err.message) || err), code: (err && err.code) || '' }; }
    });
  }
  if (!WRITES[req.action]) return dispatch(req, req.token);
  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try { return dispatch(req, req.token); } finally { lock.releaseLock(); }
}

function dispatch(req, token) {
  switch (req.action) {
    case 'info': return info();
    case 'create': return createCompany(req);
    case 'login': return login(req);
    case 'logout': return logout(token);
    case 'me': return memberOf(session(token));
    case 'company': return companyRecord(session(token));
    case 'list': return list(session(token), req.collection);
    case 'get': return get(session(token), req.collection, req.id);
    case 'upsert': return upsert(session(token), req.collection, req.id, req.data);
    case 'del': return del(session(token), req.collection, req.id);
    case 'addAudit': return addAudit(session(token), req.entry);
    case 'listAudit': return listAudit(session(token));
    case 'createLogin': return createLogin(session(token), req);
    case 'setPin': return setPin(session(token), req);
    case 'changeOwnPin': return changeOwnPin(session(token), req);
    case 'removeLogin': return removeLogin(session(token), req);
    case 'listLogins': return listLogins(session(token));
  }
  throw fail('unknown action');
}

function fail(msg, code) { var e = new Error(msg); e.code = code || ''; return e; }

// ---------------------------------------------------------------- sha-256 (pure JS: fast enough to repeat thousands of times)
var K256 = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
];
function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }
function sha256(str) {
  var m = unescape(encodeURIComponent(str)), l = m.length, n = (((l + 8) >> 6) + 1) * 16, w = [], i;
  for (i = 0; i < n; i++) w[i] = 0;
  for (i = 0; i < l; i++) w[i >> 2] |= m.charCodeAt(i) << (24 - (i % 4) * 8);
  w[l >> 2] |= 0x80 << (24 - (l % 4) * 8);
  w[n - 1] = l * 8;
  var h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19], a = [];
  for (var o = 0; o < n; o += 16) {
    for (i = 0; i < 64; i++) {
      if (i < 16) a[i] = w[o + i];
      else {
        var x = a[i - 15], y = a[i - 2];
        a[i] = (a[i - 16] + (rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3)) + a[i - 7] + (rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10))) | 0;
      }
    }
    var A = h[0], B = h[1], C = h[2], D = h[3], E = h[4], F = h[5], G = h[6], H = h[7];
    for (i = 0; i < 64; i++) {
      var t1 = (H + (rotr(E, 6) ^ rotr(E, 11) ^ rotr(E, 25)) + ((E & F) ^ (~E & G)) + K256[i] + a[i]) | 0;
      var t2 = ((rotr(A, 2) ^ rotr(A, 13) ^ rotr(A, 22)) + ((A & B) ^ (A & C) ^ (B & C))) | 0;
      H = G; G = F; F = E; E = (D + t1) | 0; D = C; C = B; B = A; A = (t1 + t2) | 0;
    }
    h[0] = (h[0] + A) | 0; h[1] = (h[1] + B) | 0; h[2] = (h[2] + C) | 0; h[3] = (h[3] + D) | 0;
    h[4] = (h[4] + E) | 0; h[5] = (h[5] + F) | 0; h[6] = (h[6] + G) | 0; h[7] = (h[7] + H) | 0;
  }
  return h.map(function (v) { return ('00000000' + (v >>> 0).toString(16)).slice(-8); }).join('');
}
function hashPin(salt, pin) {
  var h = sha256(salt + ':' + pin);
  for (var i = 0; i < KDF_ROUNDS; i++) h = sha256(h + salt + pin);
  return h;
}
function newToken() { return Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, ''); }

// ---------------------------------------------------------------- the sheet as a table
function book() { return SpreadsheetApp.getActiveSpreadsheet(); }

function tab(name, header) {
  var s = book().getSheetByName(name);
  if (s) return s;
  s = book().insertSheet(name);
  s.getRange(1, 1, s.getMaxRows(), s.getMaxColumns()).setNumberFormat('@'); // text: ids like "001" or "2026-11-04" must not turn into numbers or dates
  s.getRange(1, 1, 1, header.length).setValues([header]);
  s.setFrozenRows(1);
  return s;
}

function readTable(s) {
  var n = s.getLastRow();
  if (n < 2) return [];
  var vals = s.getRange(2, 1, n - 1, s.getLastColumn()).getValues();
  return vals.map(function (r, i) {
    var json = '';
    for (var c = 3; c < r.length; c++) { if (r[c] === '' || r[c] === null) break; json += String(r[c]); }
    return { row: i + 2, id: String(r[0]), updatedAt: String(r[1]), updatedBy: String(r[2]), json: json };
  });
}

function findRow(s, id) {
  var n = s.getLastRow();
  if (n < 2) return 0;
  var ids = s.getRange(2, 1, n - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) if (String(ids[i][0]) === id) return i + 2;
  return 0;
}

function writeRow(s, row, cells) {
  var width = Math.max(s.getLastColumn(), cells.length);
  var padded = cells.slice();
  while (padded.length < width) padded.push('');
  if (s.getMaxColumns() < width) s.insertColumnsAfter(s.getMaxColumns(), width - s.getMaxColumns());
  var r = row || s.getLastRow() + 1;
  if (r > s.getMaxRows()) s.insertRowsAfter(s.getMaxRows(), 200);
  var rng = s.getRange(r, 1, 1, width);
  rng.setNumberFormat('@');
  rng.setValues([padded]);
}

function chunks(json) {
  var out = [];
  for (var i = 0; i < json.length; i += CHUNK) out.push(json.substr(i, CHUNK));
  return out.length ? out : ['{}'];
}

function recordRows(coll) {
  return readTable(tab(PREFIX + coll, RECORD_HEADER)).map(function (r) {
    return { id: r.id, data: JSON.parse(r.json || 'null'), row: r.row };
  });
}

// ---------------------------------------------------------------- company, users, sessions
function companyTab() { return tab('_company', ['id', 'name', 'plan', 'data']); }
function usersTab() { return tab('_users', ['employeeId', 'code', 'salt', 'hash', 'roles', 'fails', 'lockUntil', 'createdAt']); }
function sessionsTab() { return tab('_sessions', ['tokenHash', 'employeeId', 'expires']); }

function readCompany() {
  if (REQ.company !== undefined) return REQ.company;
  var s = book().getSheetByName('_company');
  var c = null;
  if (s && s.getLastRow() >= 2) {
    var r = s.getRange(2, 1, 1, s.getLastColumn()).getValues()[0];
    var json = '';
    for (var i = 3; i < r.length; i++) { if (r[i] === '') break; json += String(r[i]); }
    c = { id: String(r[0]), name: String(r[1]), plan: String(r[2]), data: JSON.parse(json || '{}') };
  }
  REQ.company = c;
  return c;
}

function info() {
  var c = readCompany();
  return c ? { companyId: c.id, name: c.name } : { companyId: null, name: null };
}

function companyRecord(me) {
  var c = readCompany();
  var d = c.data || {};
  d.id = c.id; d.name = c.name; d.plan = c.plan;
  return d;
}

function userRows() {
  var s = usersTab(), n = s.getLastRow();
  if (n < 2) return [];
  return s.getRange(2, 1, n - 1, 8).getValues().map(function (r, i) {
    return { row: i + 2, employeeId: String(r[0]), code: String(r[1]), salt: String(r[2]), hash: String(r[3]), roles: JSON.parse(String(r[4] || '["employee"]')), fails: Number(r[5] || 0), lockUntil: Number(r[6] || 0) };
  });
}
function saveUser(u) {
  var cells = [u.employeeId, u.code, u.salt, u.hash, JSON.stringify(u.roles), String(u.fails || 0), String(u.lockUntil || 0), u.createdAt || new Date().toISOString()];
  var s = usersTab(), row = u.row || s.getLastRow() + 1;
  if (row > s.getMaxRows()) s.insertRowsAfter(s.getMaxRows(), 50);
  var rng = s.getRange(row, 1, 1, 8);
  rng.setNumberFormat('@');
  rng.setValues([cells]);
}

function createCompany(req) {
  var want = PropertiesService.getScriptProperties().getProperty('SIGNUP_CODE');
  if (!want) throw fail('ຍັງບໍ່ໄດ້ຕັ້ງ SIGNUP_CODE ໃນ Script Properties ຂອງ Apps Script');
  if (String(req.signupCode || '') !== want) throw fail('ລະຫັດສ້າງບໍລິສັດບໍ່ຖືກ');
  if (readCompany()) throw fail('Google Sheet ນີ້ມີບໍລິສັດແລ້ວ');
  var co = req.company || {}, owner = req.owner || {};
  if (!co.id || !co.name || !owner.employeeId || !owner.code) throw fail('ຂໍ້ມູນບໍ່ຄົບ');
  if (!/^\d{6}$/.test(String(req.pin || ''))) throw fail('PIN ຕ້ອງເປັນຕົວເລກ 6 ຕົວ');
  var cells = [co.id, co.name, co.plan || 'pro'].concat(chunks(JSON.stringify(co)));
  writeRow(companyTab(), 0, cells);
  REQ.company = undefined;
  var salt = Utilities.getUuid();
  saveUser({ employeeId: owner.employeeId, code: String(owner.code).toLowerCase(), salt: salt, hash: hashPin(salt, String(req.pin)), roles: ['employee', 'owner'] });
  appendAudit('system', 'company-create', '_company', co.id, null, { id: co.id, name: co.name });
  return openSession(owner.employeeId, ['employee', 'owner'], co.id);
}

function openSession(employeeId, roles, companyId) {
  var token = newToken();
  var s = sessionsTab();
  var now = Date.now();
  // forget sessions that have run out
  var rows = readTable(s);
  for (var i = rows.length - 1; i >= 0; i--) if (Number(rows[i].updatedBy) < now) s.deleteRow(rows[i].row);
  writeRow(s, 0, [sha256(token), employeeId, String(now + SESSION_DAYS * 86400000)]);
  return { token: token, member: { userId: employeeId, companyId: companyId, employeeId: employeeId, roles: roles } };
}

function login(req) {
  var c = readCompany();
  if (!c) throw fail('ຍັງບໍ່ມີບໍລິສັດໃນ Google Sheet ນີ້');
  var code = String(req.code || '').trim().toLowerCase(), pin = String(req.pin || '');
  var all = userRows(), u = null;
  for (var i = 0; i < all.length; i++) if (all[i].code === code) u = all[i];
  var bad = 'ລະຫັດພະນັກງານ ຫຼື PIN ບໍ່ຖືກ';
  if (!u) { Utilities.sleep(400); throw fail(bad); }
  var now = Date.now();
  if (u.lockUntil > now) throw fail('ໃສ່ PIN ຜິດຫຼາຍເທື່ອ — ລໍ ' + Math.ceil((u.lockUntil - now) / 60000) + ' ນາທີ');
  if (hashPin(u.salt, pin) !== u.hash) {
    u.fails += 1;
    if (u.fails >= MAX_FAILS) { u.lockUntil = now + LOCK_MIN * 60000; u.fails = 0; }
    saveUser(u);
    throw fail(bad);
  }
  if (u.fails || u.lockUntil) { u.fails = 0; u.lockUntil = 0; saveUser(u); }
  return openSession(u.employeeId, u.roles, c.id);
}

function logout(token) {
  if (!token) return true;
  var s = sessionsTab(), h = sha256(token), rows = readTable(s);
  for (var i = 0; i < rows.length; i++) if (rows[i].id === h) { s.deleteRow(rows[i].row); break; }
  return true;
}

/** Who is calling: the session for this token, with the roles currently on their login. */
function session(token) {
  if (REQ.me) return REQ.me;
  if (!token) throw fail('ຕ້ອງເຂົ້າລະບົບກ່ອນ', 'auth');
  var h = sha256(token), rows = readTable(sessionsTab()), found = null;
  for (var i = 0; i < rows.length; i++) if (rows[i].id === h) found = rows[i];
  if (!found || Number(found.updatedBy) < Date.now()) throw fail('ໝົດເວລາເຂົ້າລະບົບ — ເຂົ້າໃໝ່', 'auth');
  var me = null, all = userRows();
  for (var j = 0; j < all.length; j++) if (all[j].employeeId === found.updatedAt) me = all[j];
  if (!me) throw fail('ບັນຊີນີ້ຖືກປິດແລ້ວ', 'auth');
  REQ.me = { me: me.employeeId, roles: me.roles, companyId: readCompany().id, user: me };
  return REQ.me;
}

function memberOf(c) { return { userId: c.me, companyId: c.companyId, employeeId: c.me, roles: c.roles }; }
function has(c, r) { return c.roles.indexOf(r) >= 0; }
function hasAny(c, rs) { return rs.some(function (r) { return has(c, r); }); }
function needOwner(c) { if (!has(c, 'owner')) throw fail('ສະເພາະເຈົ້າຂອງ'); }

// ---------------------------------------------------------------- who may read / write what (same rules as supabase/schema.sql)
function employeesById() {
  if (!REQ.emps) {
    REQ.emps = {};
    recordRows('employees').forEach(function (r) { if (r.data) REQ.emps[r.id] = r.data; });
  }
  return REQ.emps;
}

function recEmp(coll, rid, d) {
  if (coll === 'employees' || coll === 'employeePay' || coll === 'employeeSecret') return rid;
  if (coll === 'notifications') return d && d.userId;
  return d && d.employeeId;
}

function headCovers(c, emp) {
  if (!has(c, 'head')) return false;
  var emps = employeesById(), h = emps[c.me], t = emps[emp];
  if (!h || !t) return false;
  if (h.headOf !== undefined && h.headOf !== null) return h.headOf.indexOf('*') >= 0 || h.headOf.indexOf(t.dept) >= 0;
  return h.dept === t.dept;
}

var MANAGERS = ['owner', 'accountant', 'auditor'];

function canRead(c, coll, rid, d) {
  var who = recEmp(coll, rid, d);
  switch (coll) {
    case 'employees': case 'branches': case 'shifts': case 'settings': case 'overrides': case 'payrollRuns': return true;
    case 'notifications': return who === c.me;
    case 'employeeSecret': return rid === c.me;
    case 'changes': case 'exports': return hasAny(c, MANAGERS);
    case 'employeePay': case 'payslips': case 'payItems': return hasAny(c, MANAGERS) || who === c.me;
    default: return hasAny(c, MANAGERS) || who === c.me || headCovers(c, who);
  }
}

function canWrite(c, coll, rid, d, op) {
  var who = recEmp(coll, rid, d);
  switch (coll) {
    case 'settings': case 'branches': return has(c, 'owner');
    case 'shifts': return has(c, 'owner') || (has(c, 'accountant') && d && d.personal != null);
    case 'employeePay': case 'changes': case 'payrollRuns': case 'payItems': case 'payslips': return hasAny(c, ['owner', 'accountant']);
    case 'employees': return op !== 'delete' && (hasAny(c, ['owner', 'accountant']) || rid === c.me || (op === 'update' && headCovers(c, rid)));
    case 'employeeSecret': return rid === c.me || (op === 'delete' && has(c, 'owner'));
    case 'exports': return op === 'insert' && hasAny(c, ['owner', 'accountant', 'head', 'auditor']);
    case 'notifications': return op === 'insert' || who === c.me;
    case 'overrides': return hasAny(c, ['owner', 'head', 'accountant']);
    default:
      if (op === 'delete') return has(c, 'owner');
      return hasAny(c, ['owner', 'accountant']) || who === c.me || headCovers(c, who);
  }
}

var SELF_KEYS = ['photo', 'deviceId', 'deviceBoundAt', 'faceCount', 'faceConsentAt', 'faceReenroll', 'pinMustChange'];
var HEAD_KEYS = ['faceReenroll'];

/** What an employee record may change, and by whom. */
function guardEmployee(c, id, old, next) {
  if (!old) {
    if (!hasAny(c, ['owner', 'accountant'])) throw fail('ບໍ່ມີສິດເພີ່ມພະນັກງານ');
    var r = next.roles || ['employee'];
    if (JSON.stringify(r) !== '["employee"]' && !has(c, 'owner')) throw fail('ພະນັກງານໃໝ່ເລີ່ມດ້ວຍບົດບາດພະນັກງານເທົ່ານັ້ນ');
    return;
  }
  if (JSON.stringify(old.roles) !== JSON.stringify(next.roles) || JSON.stringify(old.headOf) !== JSON.stringify(next.headOf)) {
    if (!has(c, 'owner')) throw fail('ສະເພາະເຈົ້າຂອງ ປ່ຽນບົດບາດໄດ້');
  }
  if (hasAny(c, ['owner', 'accountant'])) return;
  var keys = {}, k;
  for (k in old) keys[k] = 1;
  for (k in next) keys[k] = 1;
  var allowed = id === c.me ? SELF_KEYS : HEAD_KEYS;
  for (k in keys) {
    if (JSON.stringify(old[k]) !== JSON.stringify(next[k]) && allowed.indexOf(k) < 0) throw fail('ແກ້ຂໍ້ມູນນີ້ເອງບໍ່ໄດ້: ' + k);
  }
}

function checkCollection(coll) {
  if (COLLECTIONS.indexOf(coll) < 0) throw fail('ບໍ່ຮູ້ຈັກຂໍ້ມູນ: ' + coll);
}

// ---------------------------------------------------------------- records
function list(c, coll) {
  checkCollection(coll);
  return recordRows(coll).filter(function (r) { return r.data && canRead(c, coll, r.id, r.data); }).map(function (r) { return { id: r.id, data: r.data }; });
}

function get(c, coll, id) {
  var rows = list(c, coll).filter(function (r) { return r.id === id; });
  return rows[0] || null;
}

function upsert(c, coll, id, data) {
  checkCollection(coll);
  id = String(id);
  if (!data || typeof data !== 'object') throw fail('ຂໍ້ມູນບໍ່ຖືກ');
  var s = tab(PREFIX + coll, RECORD_HEADER), row = findRow(s, id), old = null;
  if (row) {
    var r = s.getRange(row, 1, 1, s.getLastColumn()).getValues()[0], json = '';
    for (var i = 3; i < r.length; i++) { if (r[i] === '') break; json += String(r[i]); }
    old = JSON.parse(json || 'null');
  }
  var op = old ? 'update' : 'insert';
  if (!canWrite(c, coll, id, data, op) || (old && !canWrite(c, coll, id, old, op))) throw fail('ບໍ່ມີສິດບັນທຶກຂໍ້ມູນນີ້');
  if (coll === 'employees') guardEmployee(c, id, old, data);
  writeRow(s, row, [id, new Date().toISOString(), c.me].concat(chunks(JSON.stringify(data))));
  if (coll === 'employees') syncRoles(id, data);
  if (coll === 'employees') REQ.emps = undefined;
  return true;
}

function del(c, coll, id) {
  checkCollection(coll);
  id = String(id);
  var s = tab(PREFIX + coll, RECORD_HEADER), row = findRow(s, id);
  if (!row) return true;
  var r = s.getRange(row, 1, 1, s.getLastColumn()).getValues()[0], json = '';
  for (var i = 3; i < r.length; i++) { if (r[i] === '') break; json += String(r[i]); }
  if (!canWrite(c, coll, id, JSON.parse(json || '{}'), 'delete')) throw fail('ບໍ່ມີສິດລຶບຂໍ້ມູນນີ້');
  s.deleteRow(row);
  return true;
}

/** The role the owner sets on an employee is the role their login has. */
function syncRoles(employeeId, data) {
  var all = userRows();
  for (var i = 0; i < all.length; i++) {
    if (all[i].employeeId !== employeeId) continue;
    var roles = ['employee'].concat((data.roles || []).filter(function (r) { return r !== 'employee'; }));
    if (JSON.stringify(roles) !== JSON.stringify(all[i].roles)) { all[i].roles = roles; saveUser(all[i]); }
  }
}

// ---------------------------------------------------------------- audit log (added to, read by the owner and the auditor, never changed)
var AUDIT_HEADER = ['seq', 'at', 'by', 'action', 'entity', 'entityId', 'before', 'after'];
function cut(v) { var j = v === undefined || v === null ? '' : JSON.stringify(v); return j.length > CHUNK ? j.substr(0, CHUNK) + '…[ຕັດ]' : j; }

function appendAudit(by, action, entity, entityId, before, after) {
  var s = tab('_audit', AUDIT_HEADER), seq = s.getLastRow();
  writeRow(s, 0, [String(seq), new Date().toISOString(), by, action, entity, entityId, cut(before), cut(after)]);
}

function addAudit(c, e) {
  if (!e || !e.action) throw fail('ຂໍ້ມູນບໍ່ຖືກ');
  appendAudit(c.me, String(e.action), String(e.entity || ''), String(e.entityId || ''), e.before, e.after);
  return true;
}

function listAudit(c) {
  if (!hasAny(c, ['owner', 'auditor'])) throw fail('ບໍ່ມີສິດເບິ່ງບັນທຶກ');
  var s = tab('_audit', AUDIT_HEADER), n = s.getLastRow();
  if (n < 2) return [];
  return s.getRange(2, 1, n - 1, 8).getValues().map(function (r) {
    var p = function (v) { try { return v === '' ? undefined : JSON.parse(String(v)); } catch (x) { return String(v); } };
    return { id: String(r[0]), companyId: c.companyId, at: String(r[1]), by: String(r[2]), action: String(r[3]), entity: String(r[4]), entityId: String(r[5]), before: p(r[6]), after: p(r[7]) };
  });
}

// ---------------------------------------------------------------- logins (owner only)
function checkPin(pin) { if (!/^\d{6}$/.test(String(pin || ''))) throw fail('PIN ຕ້ອງເປັນຕົວເລກ 6 ຕົວ'); }

function createLogin(c, req) {
  needOwner(c);
  checkPin(req.pin);
  var emp = employeesById()[req.employeeId];
  if (!emp) throw fail('ບໍ່ພົບພະນັກງານ');
  var code = String(req.code || emp.code || '').trim().toLowerCase();
  if (!code) throw fail('ພະນັກງານຍັງບໍ່ມີລະຫັດ');
  var all = userRows(), mine = null;
  for (var i = 0; i < all.length; i++) {
    if (all[i].employeeId === req.employeeId) mine = all[i];
    else if (all[i].code === code) throw fail('ລະຫັດພະນັກງານນີ້ມີຄົນໃຊ້ແລ້ວ');
  }
  var salt = Utilities.getUuid();
  var u = mine || { employeeId: req.employeeId, roles: ['employee'].concat((emp.roles || []).filter(function (r) { return r !== 'employee'; })) };
  u.code = code; u.salt = salt; u.hash = hashPin(salt, String(req.pin)); u.fails = 0; u.lockUntil = 0;
  saveUser(u);
  return true;
}

function setPin(c, req) {
  needOwner(c);
  checkPin(req.pin);
  var all = userRows();
  for (var i = 0; i < all.length; i++) if (all[i].employeeId === req.employeeId) {
    var u = all[i], salt = Utilities.getUuid();
    u.salt = salt; u.hash = hashPin(salt, String(req.pin)); u.fails = 0; u.lockUntil = 0;
    saveUser(u);
    return true;
  }
  throw fail('ພະນັກງານຄົນນີ້ຍັງບໍ່ມີບັນຊີເຂົ້າລະບົບ');
}

function changeOwnPin(c, req) {
  checkPin(req.pin);
  var u = c.user, salt = Utilities.getUuid();
  u.salt = salt; u.hash = hashPin(salt, String(req.pin)); u.fails = 0; u.lockUntil = 0;
  saveUser(u);
  return true;
}

function removeLogin(c, req) {
  needOwner(c);
  if (req.employeeId === c.me) throw fail('ປິດບັນຊີຂອງຕົນເອງບໍ່ໄດ້');
  var all = userRows();
  for (var i = 0; i < all.length; i++) if (all[i].employeeId === req.employeeId) { usersTab().deleteRow(all[i].row); break; }
  var s = sessionsTab(), rows = readTable(s);
  for (var j = rows.length - 1; j >= 0; j--) if (rows[j].updatedAt === req.employeeId) s.deleteRow(rows[j].row);
  return true;
}

function listLogins(c) {
  needOwner(c);
  return userRows().map(function (u) { return u.employeeId; });
}
