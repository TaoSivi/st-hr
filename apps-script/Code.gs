/**
 * ST HR — Google Sheets backend (Google Apps Script web app).
 *
 * One Google Sheet = one company. The sheet is the database; this script is the only way the app reaches it:
 * it signs people in (employee code + 4-digit PIN), and for every read and write it checks the person's role,
 * the same rules as supabase/schema.sql. Nobody needs access to the sheet itself, and the sheet should be shared with nobody.
 *
 * Two kinds of top accounts: Admin (role owner: runs the company) and Super admin (the platform owner: also owner, but only a Super admin may
 * make or change an Admin, reset an Admin's PIN, or touch the Super admin account).
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

var WRITES = { approve: 1, create: 1, login: 1, logout: 1, upsert: 1, del: 1, addAudit: 1, createLogin: 1, setPin: 1, changeOwnPin: 1, removeLogin: 1, revealPin: 1 };

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
    case 'me': var m = memberOf(session(token)); m.company = companyRecord(); return m;
    case 'company': session(token); return companyRecord();
    case 'list': return list(session(token), req.collection);
    case 'get': return get(session(token), req.collection, req.id);
    case 'approve': return approve(session(token), req);
    case 'upsert': return upsert(approved(session(token), req.approval), req.collection, req.id, req.data);
    case 'del': return del(approved(session(token), req.approval), req.collection, req.id);
    case 'addAudit': return addAudit(approved(session(token), req.approval), req.entry);
    case 'listAudit': return listAudit(session(token));
    case 'createLogin': return createLogin(session(token), req);
    case 'setPin': return setPin(session(token), req);
    case 'changeOwnPin': return changeOwnPin(session(token), req);
    case 'removeLogin': return removeLogin(session(token), req);
    case 'revealPin': return revealPin(session(token), req);
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
/**
 * Admin and Super admin may read a person's PIN. So the PIN is also kept sealed: scrambled with a secret key that lives in Script Properties
 * (PIN_KEY, made on first use), never in the sheet. Whoever can open the spreadsheet sees only scrambled text; only this script, answering
 * an Admin or Super admin, can unscramble it, and every look is written to the audit log. The salt changes with every new PIN, so no two scrambles share a pad.
 */
function pinKey() {
  var p = PropertiesService.getScriptProperties(), k = p.getProperty('PIN_KEY');
  if (!k) { k = newToken(); p.setProperty('PIN_KEY', k); }
  return k;
}
function pinPad(salt) { return sha256('pin|' + pinKey() + '|' + salt); }
function sealPin(salt, pin) {
  var pad = pinPad(salt), out = 'v1:', s = String(pin);
  for (var i = 0; i < 4; i++) out += ('0' + (parseInt(pad.substr(i * 2, 2), 16) ^ s.charCodeAt(i)).toString(16)).slice(-2);
  return out;
}
function openPin(salt, sealed) {
  if (!sealed || String(sealed).indexOf('v1:') !== 0 || String(sealed).length !== 11) return null;
  var pad = pinPad(salt), h = String(sealed).slice(3), out = '';
  for (var i = 0; i < 4; i++) out += String.fromCharCode(parseInt(h.substr(i * 2, 2), 16) ^ parseInt(pad.substr(i * 2, 2), 16));
  return /^\d{4}$/.test(out) ? out : null;
}
function newToken() { return Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, ''); }

// ---------------------------------------------------------------- the sheet as a table
function book() { return REQ.book || (REQ.book = SpreadsheetApp.getActiveSpreadsheet()); }

/** The sheet called name, or null. All tabs are listed once per request: asking for each by name is slower. */
function tabIfAny(name) {
  if (!REQ.tabs) {
    REQ.tabs = {};
    book().getSheets().forEach(function (t) { REQ.tabs[t.getName()] = t; });
  }
  return REQ.tabs[name] || null;
}

function tab(name, header) {
  var s = tabIfAny(name);
  if (s) return s;
  s = book().insertSheet(name);
  REQ.tabs[name] = s;
  s.getRange(1, 1, s.getMaxRows(), s.getMaxColumns()).setNumberFormat('@'); // text: ids like "001" or "2026-11-04" must not turn into numbers or dates
  s.getRange(1, 1, 1, header.length).setValues([header]);
  s.setFrozenRows(1);
  return s;
}

function readTable(s) {
  var vals = s.getDataRange().getValues(), out = [];
  for (var i = 1; i < vals.length; i++) {
    var r = vals[i], json = '';
    for (var c = 3; c < r.length; c++) { if (r[c] === '' || r[c] === null) break; json += String(r[c]); }
    out.push({ row: i + 1, id: String(r[0]), updatedAt: String(r[1]), updatedBy: String(r[2]), json: json });
  }
  return out;
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

/**
 * A collection is read from the script cache when it can be: the key carries a version that every write replaces, so a write can never be
 * hidden by an old copy. Edits made by hand in the sheet show up when the copy expires (5 minutes).
 */
function collVersion(coll) {
  var v = cacheGet('v:' + coll);
  if (v === null) { v = Date.now() + Math.random(); cachePut('v:' + coll, v); }
  return v;
}
function collectionChanged(coll) { cachePut('v:' + coll, Date.now() + Math.random()); }

function recordRows(coll) {
  var key = 'c:' + coll + ':' + collVersion(coll), hit = cacheGet(key);
  if (hit) return hit;
  var t = tabIfAny(PREFIX + coll);
  if (!t) return []; // nothing has been saved in this collection yet: reading never creates tabs
  var rows = readTable(t).map(function (r) {
    return { id: r.id, data: JSON.parse(r.json || 'null'), row: r.row };
  });
  cachePut(key, rows, 300);
  return rows;
}

// ---------------------------------------------------------------- company, users, sessions
var CACHE_SECONDS = 21600;
function cacheGet(key) { try { var v = CacheService.getScriptCache().get(key); return v === null ? null : JSON.parse(v); } catch (e) { return null; } }
function cachePut(key, value, seconds) { try { CacheService.getScriptCache().put(key, JSON.stringify(value), seconds || CACHE_SECONDS); } catch (e) { /* too big or unavailable: the next request reads the sheet */ } }
function cacheDrop(key) { try { CacheService.getScriptCache().remove(key); } catch (e) { /* ignore */ } }

function companyTab() { return tab('_company', ['id', 'name', 'plan', 'data']); }
function usersTab() { return tab('_users', ['employeeId', 'code', 'salt', 'hash', 'roles', 'fails', 'lockUntil', 'createdAt', 'pinSealed']); }
function sessionsTab() { return tab('_sessions', ['tokenHash', 'employeeId', 'expires']); }

function readCompany() {
  if (REQ.company !== undefined) return REQ.company;
  var c = cacheGet('company');
  if (!c) {
    var s = tabIfAny('_company');
    if (s) {
      var vals = s.getDataRange().getValues();
      if (vals.length >= 2) {
        var r = vals[1], json = '';
        for (var i = 3; i < r.length; i++) { if (r[i] === '') break; json += String(r[i]); }
        c = { id: String(r[0]), name: String(r[1]), plan: String(r[2]), data: JSON.parse(json || '{}') };
        cachePut('company', c);
      }
    }
  }
  REQ.company = c || null;
  return REQ.company;
}

function info() {
  var c = readCompany();
  if (!c) return { companyId: null, name: null, users: [] };
  var emps = employeesById(), today = new Date().toISOString().slice(0, 10);
  var users = userRows().map(function (u) {
    var e = emps[u.employeeId] || {};
    if (e.endDate && e.endDate < today) return null; // someone who has left is not offered
    var top = u.roles.indexOf('superadmin') >= 0 ? 'superadmin' : u.roles.filter(function (r) { return r !== 'employee'; })[0] || 'employee';
    return { code: u.code.toUpperCase(), name: e.name || u.code.toUpperCase(), role: top };
  }).filter(function (x) { return x; });
  return { companyId: c.id, name: c.name, users: users };
}

function companyRecord() {
  var c = readCompany();
  var d = JSON.parse(JSON.stringify(c.data || {}));
  d.id = c.id; d.name = c.name; d.plan = c.plan;
  return d;
}

function userRows() {
  if (REQ.users) return REQ.users;
  var cached = cacheGet('users');
  if (cached) return (REQ.users = cached);
  var vals = usersTab().getDataRange().getValues(), out = [];
  for (var i = 1; i < vals.length; i++) {
    var r = vals[i];
    out.push({ row: i + 1, employeeId: String(r[0]), code: String(r[1]), salt: String(r[2]), hash: String(r[3]), roles: JSON.parse(String(r[4] || '["employee"]')), fails: Number(r[5] || 0), lockUntil: Number(r[6] || 0), sealed: String(r[8] || '') });
  }
  cachePut('users', out);
  return (REQ.users = out);
}
function usersChanged() { REQ.users = undefined; cacheDrop('users'); }
function saveUser(u) {
  var cells = [u.employeeId, u.code, u.salt, u.hash, JSON.stringify(u.roles), String(u.fails || 0), String(u.lockUntil || 0), u.createdAt || new Date().toISOString(), u.sealed || ''];
  var s = usersTab(), row = u.row || s.getLastRow() + 1;
  if (row > s.getMaxRows()) s.insertRowsAfter(s.getMaxRows(), 50);
  if (s.getMaxColumns() < 9) s.insertColumnsAfter(s.getMaxColumns(), 9 - s.getMaxColumns());
  var rng = s.getRange(row, 1, 1, 9);
  rng.setNumberFormat('@');
  rng.setValues([cells]);
  if (!cacheGet('usersHeader9')) { s.getRange(1, 9, 1, 1).setValues([['pinSealed']]); cachePut('usersHeader9', 1); } // sheets made before the sealed PIN get its column title once
  usersChanged();
}

function createCompany(req) {
  var want = PropertiesService.getScriptProperties().getProperty('SIGNUP_CODE');
  if (!want) throw fail('ຍັງບໍ່ໄດ້ຕັ້ງ SIGNUP_CODE ໃນ Script Properties ຂອງ Apps Script');
  if (String(req.signupCode || '') !== want) throw fail('ລະຫັດສ້າງບໍລິສັດບໍ່ຖືກ');
  if (readCompany()) throw fail('Google Sheet ນີ້ມີບໍລິສັດແລ້ວ');
  var co = req.company || {}, owner = req.owner || {};
  if (!co.id || !co.name || !owner.employeeId || !owner.code) throw fail('ຂໍ້ມູນບໍ່ຄົບ');
  checkPin(req.pin);
  var sup = req.superAdmin || null;
  if (sup) {
    if (!sup.employeeId || !sup.code) throw fail('ຂໍ້ມູນ Super admin ບໍ່ຄົບ');
    checkPin(sup.pin);
    if (String(sup.code).toLowerCase() === String(owner.code).toLowerCase() || sup.employeeId === owner.employeeId) throw fail('ລະຫັດ Super admin ຕ້ອງບໍ່ຊ້ຳກັບ Admin');
  }
  var cells = [co.id, co.name, co.plan || 'pro'].concat(chunks(JSON.stringify(co)));
  writeRow(companyTab(), 0, cells);
  REQ.company = undefined;
  cacheDrop('company');
  var salt = Utilities.getUuid();
  saveUser({ employeeId: owner.employeeId, code: String(owner.code).toLowerCase(), salt: salt, hash: hashPin(salt, String(req.pin)), sealed: sealPin(salt, req.pin), roles: ['employee', 'owner'] });
  appendAudit('system', 'company-create', '_company', co.id, null, { id: co.id, name: co.name });
  if (!sup) return openSession(owner.employeeId, ['employee', 'owner'], co.id);
  var salt2 = Utilities.getUuid(), superRoles = ['employee', 'owner', 'superadmin'];
  saveUser({ employeeId: sup.employeeId, code: String(sup.code).toLowerCase(), salt: salt2, hash: hashPin(salt2, String(sup.pin)), sealed: sealPin(salt2, sup.pin), roles: superRoles });
  appendAudit('system', 'super-admin-create', '_users', sup.employeeId, null, { code: sup.code });
  return openSession(sup.employeeId, superRoles, co.id); // whoever sets the system up is signed in as the Super admin
}

function openSession(employeeId, roles, companyId) {
  var token = newToken(), h = sha256(token);
  var s = sessionsTab();
  var now = Date.now(), expires = now + SESSION_DAYS * 86400000;
  // forget sessions that have run out
  var rows = readTable(s);
  for (var i = rows.length - 1; i >= 0; i--) if (Number(rows[i].updatedBy) < now) s.deleteRow(rows[i].row);
  writeRow(s, 0, [h, employeeId, String(expires)]);
  cachePut('s:' + companyId + ':' + h, { e: employeeId, x: expires }); // keyed by company, so a company made after a wipe never inherits old sessions
  // the company comes with the sign-in so the app does not ask for it in a second trip
  return { token: token, member: { userId: employeeId, companyId: companyId, employeeId: employeeId, roles: roles }, company: companyRecord() };
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
  // a PIN made before PINs could be looked up becomes lookable the next time its owner signs in (this is the one moment the script knows it)
  var missing = openPin(u.salt, u.sealed) === null;
  if (u.fails || u.lockUntil || missing) { u.fails = 0; u.lockUntil = 0; if (missing) u.sealed = sealPin(u.salt, pin); saveUser(u); }
  return openSession(u.employeeId, u.roles, c.id);
}

function logout(token) {
  if (!token) return true;
  var s = sessionsTab(), h = sha256(token), rows = readTable(s);
  var co = readCompany();
  if (co) cacheDrop('s:' + co.id + ':' + h);
  for (var i = 0; i < rows.length; i++) if (rows[i].id === h) { s.deleteRow(rows[i].row); break; }
  return true;
}

/** Who is calling: the session for this token, with the roles currently on their login. */
function session(token) {
  if (REQ.me) return REQ.me;
  if (!token) throw fail('ຕ້ອງເຂົ້າລະບົບກ່ອນ', 'auth');
  var h = sha256(token), expired = 'ໝົດເວລາເຂົ້າລະບົບ — ເຂົ້າໃໝ່', co = readCompany();
  if (!co) throw fail(expired, 'auth');
  var found = cacheGet('s:' + co.id + ':' + h);
  if (!found) {
    var rows = readTable(sessionsTab()), row = null;
    for (var i = 0; i < rows.length; i++) if (rows[i].id === h) row = rows[i];
    if (!row) throw fail(expired, 'auth');
    found = { e: row.updatedAt, x: Number(row.updatedBy) };
    cachePut('s:' + co.id + ':' + h, found);
  }
  if (found.x < Date.now()) throw fail(expired, 'auth');
  var me = null, all = userRows();
  for (var j = 0; j < all.length; j++) if (all[j].employeeId === found.e) me = all[j];
  if (!me) throw fail('ບັນຊີນີ້ຖືກປິດແລ້ວ', 'auth');
  REQ.me = { me: me.employeeId, roles: me.roles, companyId: readCompany().id, user: me };
  return REQ.me;
}

function memberOf(c) { return { userId: c.me, companyId: c.companyId, employeeId: c.me, roles: c.roles }; }
function has(c, r) { return c.roles.indexOf(r) >= 0; }
function hasAny(c, rs) { return rs.some(function (r) { return has(c, r); }); }
function needOwner(c) { needRight(c, 'userMng', 'ບໍ່ມີສິດຈັດການບັນຊີເຂົ້າລະບົບ'); }
function isSuper(c) { return has(c, 'superadmin'); }
/** Companies set up before Super admin existed have none, and keep working as they did. */
function superExists() { return userRows().some(function (u) { return u.roles.indexOf('superadmin') >= 0; }); }
/** An Admin's or the Super admin's account (PIN, login, role) is for a Super admin to manage; anyone may still change their own PIN. */
function guardTarget(c, employeeId, roles) {
  if (!superExists() || isSuper(c) || employeeId === c.me) return;
  if (roles.indexOf('owner') >= 0 || roles.indexOf('superadmin') >= 0) throw fail('ສະເພາະ Super admin ຈັດການບັນຊີຂອງ Admin ໄດ້');
}

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
  if (!R(c, 'dataDept')) return false;
  var emps = employeesById(), t = emps[emp];
  if (!t) return false;
  // the caller's own departments, or the approver's when someone stands behind them
  return [c.me, c.approver].some(function (id) {
    var h = id && emps[id];
    if (!h) return false;
    if (h.headOf !== undefined && h.headOf !== null) return h.headOf.indexOf('*') >= 0 || h.headOf.indexOf(t.dept) >= 0;
    return h.dept === t.dept;
  });
}

/**
 * What each role may do, as rights (the same lists as src/domain/rights.ts; a test keeps them equal). The owner has every right; the Super admin may
 * replace a role's list (settings.roleRights) and Admin may tick single rights on a person (employee.perm). Everything below asks for a right.
 */
var PAGE_KEYS = ['overview', 'review', 'approvals', 'time', 'reports', 'map', 'leave', 'staff', 'pay', 'access', 'settings', 'audit', 'records'];
var ACTION_KEYS = ['scan.review', 'ot.preapprove', 'advance.decide', 'staff.edit', 'staff.change.decide', 'payroll.prepare', 'payroll.lock', 'payroll.confirmLate', 'payroll.items', 'payroll.items.decide', 'settings.edit'];
var SCOPE_KEYS = ['dataAll', 'dataDept', 'writeAll', 'userMng', 'override'];
var ALL_RIGHTS = PAGE_KEYS.map(function (p) { return 'p.' + p; }).concat(ACTION_KEYS, SCOPE_KEYS);
var ROLE_RIGHTS = {
  employee: [],
  head: ['p.overview', 'p.review', 'p.approvals', 'p.time', 'p.reports', 'p.map', 'p.leave', 'scan.review', 'ot.preapprove', 'advance.decide', 'dataDept', 'override'],
  accountant: ['p.overview', 'p.approvals', 'p.time', 'p.reports', 'p.staff', 'p.pay', 'staff.edit', 'staff.change.decide', 'payroll.prepare', 'payroll.lock', 'payroll.confirmLate', 'payroll.items', 'payroll.items.decide', 'dataAll', 'writeAll', 'override'],
  auditor: ['p.overview', 'p.review', 'p.approvals', 'p.time', 'p.reports', 'p.map', 'p.leave', 'p.staff', 'p.pay', 'p.access', 'p.settings', 'p.audit', 'dataAll']
};
var EDITABLE_ROLES = ['head', 'accountant', 'auditor'];
function isRight(k) { return ALL_RIGHTS.indexOf(k) >= 0; }

function settingsRecord() {
  if (REQ.settings === undefined) {
    var rows = recordRows('settings').filter(function (r) { return r.data; });
    REQ.settings = rows.length ? rows[0].data : null;
  }
  return REQ.settings;
}

/** The rights this caller has: their roles', then the ticks on them. The owner and the Super admin always have all of them. */
function rightsOf(c) {
  if (c.rights) return c.rights;
  var set = {}, k;
  if (has(c, 'owner') || has(c, 'superadmin')) { ALL_RIGHTS.forEach(function (x) { set[x] = true; }); return (c.rights = set); }
  var st = settingsRecord(), custom = (st && st.roleRights) || {};
  c.roles.forEach(function (r) {
    var list = Array.isArray(custom[r]) && EDITABLE_ROLES.indexOf(r) >= 0 ? custom[r] : (ROLE_RIGHTS[r] || []);
    list.forEach(function (x) { if (isRight(x)) set[x] = true; });
  });
  var emp = employeesById()[c.me], perm = emp && emp.perm;
  if (perm && typeof perm === 'object') for (k in perm) {
    if (!isRight(k)) continue;
    if (perm[k] === true) set[k] = true; else if (perm[k] === false) delete set[k];
  }
  return (c.rights = set);
}
function R(c, key) { return rightsOf(c)[key] === true; }
function RAny(c, keys) { return keys.some(function (k) { return R(c, k); }); }
function needRight(c, key, msg) { if (!R(c, key)) throw fail(msg || 'ບໍ່ມີສິດ'); }

function canRead(c, coll, rid, d) {
  var who = recEmp(coll, rid, d);
  switch (coll) {
    case 'employees': case 'branches': case 'shifts': case 'settings': case 'overrides': case 'payrollRuns': return true;
    case 'notifications': return who === c.me;
    case 'employeeSecret': return rid === c.me;
    case 'changes': case 'exports': return R(c, 'dataAll');
    case 'employeePay': case 'payslips': case 'payItems': return RAny(c, ['p.pay', 'p.staff']) || who === c.me;
    default: return R(c, 'dataAll') || who === c.me || headCovers(c, who);
  }
}

function canWrite(c, coll, rid, d, op) {
  var who = recEmp(coll, rid, d);
  switch (coll) {
    case 'settings': case 'branches': return R(c, 'settings.edit');
    case 'shifts': return R(c, 'settings.edit') || (R(c, 'staff.edit') && d && d.personal != null);
    case 'employeePay': case 'changes': return RAny(c, ['staff.edit', 'staff.change.decide']);
    case 'payrollRuns': return RAny(c, ['payroll.prepare', 'payroll.lock', 'payroll.confirmLate']);
    case 'payItems': return RAny(c, ['payroll.items', 'payroll.items.decide']);
    case 'payslips': return RAny(c, ['payroll.prepare', 'payroll.lock']);
    case 'employees': return op === 'delete' ? R(c, 'userMng') : (R(c, 'staff.edit') || rid === c.me || (op === 'update' && headCovers(c, rid)));
    case 'employeeSecret': return rid === c.me || (op === 'delete' && R(c, 'userMng'));
    case 'exports': return op === 'insert' && R(c, 'p.reports');
    case 'notifications': return op === 'insert' || who === c.me;
    case 'overrides': return RAny(c, ['scan.review', 'ot.preapprove', 'staff.edit']);
    default:
      if (op === 'delete') return R(c, 'settings.edit');
      return R(c, 'writeAll') || who === c.me || headCovers(c, who);
  }
}

var SELF_KEYS = ['photo', 'deviceId', 'deviceBoundAt', 'faceCount', 'faceConsentAt', 'faceReenroll', 'pinMustChange'];
var HEAD_KEYS = ['faceReenroll'];

/** What an employee record may change, and by whom. */
function guardEmployee(c, id, old, next) {
  var supers = superExists();
  if (supers && !isSuper(c)) {
    if ((old && old.superAdmin) || next.superAdmin) throw fail('ສະເພາະ Super admin ແກ້ Super admin ໄດ້');
  }
  if (!old) {
    if (!R(c, 'staff.edit')) throw fail('ບໍ່ມີສິດເພີ່ມພະນັກງານ');
    var r = next.roles || ['employee'];
    if (JSON.stringify(r) !== '["employee"]' && !R(c, 'userMng')) throw fail('ພະນັກງານໃໝ່ເລີ່ມດ້ວຍບົດບາດພະນັກງານເທົ່ານັ້ນ');
    if (supers && !isSuper(c) && r.indexOf('owner') >= 0) throw fail('ສະເພາະ Super admin ກຳນົດ Admin ໄດ້');
    guardPerm(c, id, null, next);
    return;
  }
  if (JSON.stringify(old.roles) !== JSON.stringify(next.roles) || JSON.stringify(old.headOf) !== JSON.stringify(next.headOf)) {
    if (!R(c, 'userMng')) throw fail('ບໍ່ມີສິດປ່ຽນບົດບາດ');
  }
  if (supers && !isSuper(c) && ((old.roles || []).indexOf('owner') >= 0) !== ((next.roles || []).indexOf('owner') >= 0)) throw fail('ສະເພາະ Super admin ກຳນົດ Admin ໄດ້');
  guardPerm(c, id, old, next);
  if (R(c, 'staff.edit')) return;
  var keys = {}, k;
  for (k in old) keys[k] = 1;
  for (k in next) keys[k] = 1;
  var allowed = id === c.me ? SELF_KEYS : HEAD_KEYS;
  for (k in keys) {
    if (JSON.stringify(old[k]) !== JSON.stringify(next[k]) && allowed.indexOf(k) < 0) throw fail('ແກ້ຂໍ້ມູນນີ້ເອງບໍ່ໄດ້: ' + k);
  }
}

/** The ticks on a person: only someone who manages rights sets them, never on themselves, and never a right the setter does not hold. */
function guardPerm(c, id, old, next) {
  var before = old && old.perm ? JSON.stringify(old.perm) : '', after = next.perm ? JSON.stringify(next.perm) : '';
  if (before === after) return;
  if (!R(c, 'userMng')) throw fail('ບໍ່ມີສິດຕັ້ງສິດຂອງພະນັກງານ');
  if (id === c.me) throw fail('ຕັ້ງສິດຂອງຕົນເອງບໍ່ໄດ້');
  var p = next.perm || {}, oldp = (old && old.perm) || {}, k;
  if (typeof p !== 'object' || Array.isArray(p)) throw fail('ສິດບໍ່ຖືກຕ້ອງ');
  for (k in p) {
    if (!isRight(k) || typeof p[k] !== 'boolean') throw fail('ສິດບໍ່ຖືກຕ້ອງ');
    if (p[k] === true && oldp[k] !== true && !R(c, k)) throw fail('ໃຫ້ສິດທີ່ຕົນເອງບໍ່ມີບໍ່ໄດ້');
  }
}

/** What each role gives is the Super admin's to change (the Admin's, in a company that has no Super admin). */
function guardSettings(c, old, next) {
  var before = JSON.stringify((old && old.roleRights) || {}), after = JSON.stringify((next && next.roleRights) || {});
  if (before === after) return;
  if (superExists() ? !isSuper(c) : !has(c, 'owner')) throw fail('ສະເພາະ Super admin ປ່ຽນສິດຂອງບົດບາດໄດ້');
  var rr = next.roleRights || {}, role;
  for (role in rr) {
    if (EDITABLE_ROLES.indexOf(role) < 0 || !Array.isArray(rr[role]) || !rr[role].every(isRight)) throw fail('ສິດຂອງບົດບາດບໍ່ຖືກຕ້ອງ');
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
  if (coll === 'settings') guardSettings(c, old, data);
  guardUpsert(c, coll, old, data);
  writeRow(s, row, [id, new Date().toISOString(), by(c)].concat(chunks(JSON.stringify(data))));
  collectionChanged(coll);
  if (coll === 'employees') { syncRoles(id, data); REQ.emps = undefined; c.rights = undefined; }
  if (coll === 'settings') { REQ.settings = undefined; c.rights = undefined; }
  return true;
}

var SCAN_FIXED = ['kind', 'deviceTime', 'branchId', 'employeeId'];
/** The Super admin gate for the writes that are not deletes. Other fields of a clock-in (status, review note, a purged photo) change in normal work. */
function guardUpsert(c, coll, old, data) {
  if (coll === 'employeePay' && old && JSON.stringify(old) !== JSON.stringify(data)) superGate(c, 'ແກ້ເງິນເດືອນ / ເລກບັນຊີ');
  if (coll === 'payrollRuns') {
    var was = old && old.status === 'locked', will = data.status === 'locked';
    if (was !== will) superGate(c, will ? 'ປິດງວດເງິນເດືອນ' : 'ເປີດງວດເງິນເດືອນ');
  }
  if (coll === 'scans' && old && SCAN_FIXED.some(function (k) { return JSON.stringify(old[k]) !== JSON.stringify(data[k]); })) superGate(c, 'ແກ້ການລົງເວລາຍ້ອນຫຼັງ');
}

/** Things that are not records of work, so removing them is routine and needs no approval. */
var DELETE_FREE = ['notifications', 'employeeSecret', 'exports'];
var HISTORY = ['scans', 'leaves', 'advances', 'payItems', 'requests', 'ots', 'overrides', 'changes', 'payslips'];

/** A person leaves the roster for good only when nothing was ever recorded for them; otherwise the old records would point at nobody (use closing the account instead). */
function guardDeleteEmployee(c, id, rec) {
  if (id === c.me) throw fail('ລຶບບັນຊີຂອງຕົນເອງບໍ່ໄດ້');
  var login = null, all = userRows();
  for (var i = 0; i < all.length; i++) if (all[i].employeeId === id) login = all[i];
  var roles = (rec.roles || []).concat(login ? login.roles : []);
  guardTarget(c, id, roles);
  var found = HISTORY.filter(function (coll) { return recordRows(coll).some(function (r) { return r.data && String(recEmp(coll, r.id, r.data)) === id; }); });
  if (found.length) throw fail('ພະນັກງານຄົນນີ້ມີປະຫວັດ (' + found.join(', ') + ') — ລຶບບໍ່ໄດ້ ເພາະບັນທຶກເກົ່າຈະບໍ່ມີເຈົ້າຂອງ. ໃຊ້ "ປິດບັນຊີ" ແທນ');
}

/** The person's own rows and sign-in go with them. */
function dropEmployeeRows(id) {
  ['employeePay', 'employeeSecret'].forEach(function (coll) {
    var t = tabIfAny(PREFIX + coll), row = t ? findRow(t, id) : 0;
    if (row) { t.deleteRow(row); collectionChanged(coll); }
  });
  var all = userRows();
  for (var k = 0; k < all.length; k++) if (all[k].employeeId === id) { usersTab().deleteRow(all[k].row); usersChanged(); break; }
  var st = sessionsTab(), rows = readTable(st);
  for (var j = rows.length - 1; j >= 0; j--) if (rows[j].updatedAt === id) st.deleteRow(rows[j].row);
}

function del(c, coll, id) {
  checkCollection(coll);
  id = String(id);
  var s = tab(PREFIX + coll, RECORD_HEADER), row = findRow(s, id);
  if (!row) return true;
  var r = s.getRange(row, 1, 1, s.getLastColumn()).getValues()[0], json = '';
  for (var i = 3; i < r.length; i++) { if (r[i] === '') break; json += String(r[i]); }
  var rec = JSON.parse(json || '{}');
  if (!canWrite(c, coll, id, rec, 'delete')) throw fail('ບໍ່ມີສິດລຶບຂໍ້ມູນນີ້');
  if (DELETE_FREE.indexOf(coll) < 0) superGate(c, 'ລຶບຂໍ້ມູນຖາວອນ');
  if (coll === 'employees') guardDeleteEmployee(c, id, rec);
  if (DELETE_FREE.indexOf(coll) < 0) { // the whole record stays in the log, so a deletion can always be looked into
    var kept = {}, k; for (k in rec) kept[k] = k === 'photo' ? '[ຮູບ]' : rec[k];
    appendAudit(by(c), 'record-delete', coll, id, kept, null);
  }
  s.deleteRow(row);
  collectionChanged(coll);
  if (coll === 'employees') { dropEmployeeRows(id); REQ.emps = undefined; }
  return true;
}

/** The role the owner sets on an employee is the role their login has. */
function syncRoles(employeeId, data) {
  var all = userRows();
  for (var i = 0; i < all.length; i++) {
    if (all[i].employeeId !== employeeId) continue;
    var roles = ['employee'].concat((data.roles || []).filter(function (r) { return r !== 'employee' && r !== 'superadmin'; }));
    if (all[i].roles.indexOf('superadmin') >= 0) roles.push('superadmin'); // the marker lives on the login and only the script gives it
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
  appendAudit(by(c), String(e.action), String(e.entity || ''), String(e.entityId || ''), e.before, e.after);
  return true;
}

function listAudit(c) {
  if (!R(c, 'p.audit')) throw fail('ບໍ່ມີສິດເບິ່ງບັນທຶກ');
  var s = tab('_audit', AUDIT_HEADER), n = s.getLastRow();
  if (n < 2) return [];
  return s.getRange(2, 1, n - 1, 8).getValues().map(function (r) {
    var p = function (v) { try { return v === '' ? undefined : JSON.parse(String(v)); } catch (x) { return String(v); } };
    return { id: String(r[0]), companyId: c.companyId, at: String(r[1]), by: String(r[2]), action: String(r[3]), entity: String(r[4]), entityId: String(r[5]), before: p(r[6]), after: p(r[7]) };
  });
}

// ---------------------------------------------------------------- approving with a PIN
var APPROVAL_SECONDS = 120;
/** Someone without the right asks a colleague who has it (and may approve for others) to type their PIN: the colleague's action rights then count for this caller, for two minutes. */
function approve(c, req) {
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
  if (u.employeeId === c.me) throw fail('ຜູ້ອະນຸມັດຕ້ອງເປັນອີກຄົນໜຶ່ງ');
  var who = { me: u.employeeId, roles: u.roles, companyId: c.companyId, user: u };
  if (!R(who, 'override')) throw fail('ຄົນນີ້ບໍ່ມີສິດອະນຸມັດແທນ');
  var token = newToken();
  cachePut('a:' + c.companyId + ':' + sha256(token), { by: u.employeeId, to: c.me, until: now + APPROVAL_SECONDS * 1000 }, APPROVAL_SECONDS);
  var e = employeesById()[u.employeeId];
  appendAudit(u.employeeId, 'approve-for', 'employees', c.me, null, { to: c.me });
  return { approval: token, approverId: u.employeeId, approverName: (e && e.name) || u.code.toUpperCase(), seconds: APPROVAL_SECONDS };
}

/** The caller with an approval behind them: their rights plus the approver's action rights. Managing logins and rights is never lent. */
function approved(c, token) {
  if (!token) return c;
  var hit = cacheGet('a:' + c.companyId + ':' + sha256(String(token)));
  if (!hit || hit.to !== c.me || hit.until < Date.now()) throw fail('ການອະນຸມັດໝົດເວລາແລ້ວ — ຂໍໃໝ່', '');
  var u = null, all = userRows();
  for (var i = 0; i < all.length; i++) if (all[i].employeeId === hit.by) u = all[i];
  if (!u) throw fail('ຜູ້ອະນຸມັດຖືກປິດບັນຊີແລ້ວ');
  var lent = rightsOf({ me: u.employeeId, roles: u.roles, companyId: c.companyId, user: u }), mine = rightsOf(c), set = {}, k;
  for (k in mine) set[k] = true;
  for (k in lent) if (k !== 'userMng') set[k] = true;
  var out = {}; for (k in c) out[k] = c[k];
  out.rights = set; out.approver = hit.by; out.approverSuper = u.roles.indexOf('superadmin') >= 0;
  return out;
}
/**
 * In a company that has a Super admin, an Admin needs the Super admin's PIN behind these: deleting a record for good, changing a person's pay or
 * bank account, closing or reopening a payroll month, and changing a clock-in after the fact. The Super admin never needs it.
 * The app asks for that PIN by itself when the database answers code "needsuper", then repeats the action with the approval attached.
 */
function superGate(c, what) {
  if (!superExists() || isSuper(c) || !has(c, 'owner')) return;
  if (c.approverSuper) return;
  throw fail('ຕ້ອງໃຫ້ Super admin ອະນຸມັດ: ' + what, 'needsuper');
}
function by(c) { return c.approver ? c.me + ' ← ' + c.approver : c.me; }

// ---------------------------------------------------------------- logins (owner only)
function checkPin(pin) { if (!/^\d{4}$/.test(String(pin || ''))) throw fail('PIN ຕ້ອງເປັນຕົວເລກ 4 ຕົວ'); }

function createLogin(c, req) {
  needOwner(c);
  checkPin(req.pin);
  var emp = employeesById()[req.employeeId];
  if (!emp) throw fail('ບໍ່ພົບພະນັກງານ');
  var existing = userRows().filter(function (u) { return u.employeeId === req.employeeId; })[0];
  guardTarget(c, req.employeeId, existing ? existing.roles : (emp.roles || []));
  var code = String(req.code || emp.code || '').trim().toLowerCase();
  if (!code) throw fail('ພະນັກງານຍັງບໍ່ມີລະຫັດ');
  var all = userRows(), mine = null;
  for (var i = 0; i < all.length; i++) {
    if (all[i].employeeId === req.employeeId) mine = all[i];
    else if (all[i].code === code) throw fail('ລະຫັດພະນັກງານນີ້ມີຄົນໃຊ້ແລ້ວ');
  }
  var salt = Utilities.getUuid();
  var u = mine || { employeeId: req.employeeId, roles: ['employee'].concat((emp.roles || []).filter(function (r) { return r !== 'employee'; })) };
  u.code = code; u.salt = salt; u.hash = hashPin(salt, String(req.pin)); u.sealed = sealPin(salt, req.pin); u.fails = 0; u.lockUntil = 0;
  saveUser(u);
  return true;
}

function setPin(c, req) {
  needOwner(c);
  checkPin(req.pin);
  var all = userRows();
  for (var i = 0; i < all.length; i++) if (all[i].employeeId === req.employeeId) {
    guardTarget(c, req.employeeId, all[i].roles);
    var u = all[i], salt = Utilities.getUuid();
    u.salt = salt; u.hash = hashPin(salt, String(req.pin)); u.sealed = sealPin(salt, req.pin); u.fails = 0; u.lockUntil = 0;
    saveUser(u);
    return true;
  }
  throw fail('ພະນັກງານຄົນນີ້ຍັງບໍ່ມີບັນຊີເຂົ້າລະບົບ');
}

/** Admin and Super admin read a PIN. An Admin cannot read another Admin's or the Super admin's (same rule as managing them). Every look is logged. */
function revealPin(c, req) {
  if (!has(c, 'owner') && !isSuper(c)) throw fail('ສະເພາະ Admin ຂຶ້ນໄປເບິ່ງ PIN ໄດ້');
  var all = userRows(), u = null;
  for (var i = 0; i < all.length; i++) if (all[i].employeeId === req.employeeId) u = all[i];
  if (!u) throw fail('ພະນັກງານຄົນນີ້ຍັງບໍ່ມີບັນຊີເຂົ້າລະບົບ');
  var top = u.roles.indexOf('owner') >= 0 || u.roles.indexOf('superadmin') >= 0;
  if (u.employeeId !== c.me && top && superExists() && !isSuper(c)) throw fail('ສະເພາະ Super admin ເບິ່ງ PIN ຂອງ Admin ໄດ້');
  var pin = openPin(u.salt, u.sealed);
  if (u.employeeId !== c.me) appendAudit(by(c), 'pin-reveal', '_users', u.employeeId, null, { found: pin !== null });
  return { pin: pin };
}

function changeOwnPin(c, req) {
  checkPin(req.pin);
  var u = c.user, salt = Utilities.getUuid();
  u.salt = salt; u.hash = hashPin(salt, String(req.pin)); u.sealed = sealPin(salt, req.pin); u.fails = 0; u.lockUntil = 0;
  saveUser(u);
  return true;
}

function removeLogin(c, req) {
  needOwner(c);
  if (req.employeeId === c.me) throw fail('ປິດບັນຊີຂອງຕົນເອງບໍ່ໄດ້');
  var all = userRows();
  for (var k = 0; k < all.length; k++) if (all[k].employeeId === req.employeeId) guardTarget(c, req.employeeId, all[k].roles);
  for (var i = 0; i < all.length; i++) if (all[i].employeeId === req.employeeId) { usersTab().deleteRow(all[i].row); usersChanged(); break; }
  var s = sessionsTab(), rows = readTable(s);
  for (var j = rows.length - 1; j >= 0; j--) if (rows[j].updatedAt === req.employeeId) s.deleteRow(rows[j].row);
  return true;
}

function listLogins(c) {
  needOwner(c);
  return userRows().map(function (u) { return u.employeeId; });
}

// ---------------------------------------------------------------- by hand only (not reachable from the web app)
/**
 * Run this from the Apps Script editor (select wipeEverything, press Run) to clear the company and start again:
 * it deletes every tab and every saved copy. There is no undo, so download the sheet first if you may need the data.
 */
function wipeEverything() {
  var ss = SpreadsheetApp.getActiveSpreadsheet(), old = ss.getSheets();
  var fresh = ss.insertSheet('_new');
  old.forEach(function (t) { ss.deleteSheet(t); });
  fresh.setName('Sheet1');
  cacheDrop('company');
  cacheDrop('users');
  COLLECTIONS.forEach(function (c) { collectionChanged(c); });
  return 'wiped';
}
