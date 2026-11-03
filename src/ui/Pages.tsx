import { useMemo, useState } from 'react';
import { useHR } from '../app/state';
import { buildAttendance } from '../domain/attendanceReport';
import { exportAttendanceXlsx, reportEmployees, reportInput } from '../app/exportAttendance';
import { featureBlock } from '../domain/company';
import { shiftRange } from '../domain/leavePart';
import { getDeviceId } from '../device/deviceId';
import { faceResetBlock, faceTemplates, POSES } from '../domain/face';
import { effectiveShift, type HRRequest } from '../domain/requests';
import MapCard, { type MapMark } from './MapCard';
import { MyRequests, RequestSheet } from './RequestsUI';
import { KIND_LABEL } from './labels';
import { hhmm, initials, laoDate, laoMonth, money, retentionLabel, ROLE_NAMES, sameDay, ymd } from './format';

export const APP_VERSION = '0.3.0';

export function Profile() {
  const hr = useHR();
  const me = hr.me!;
  const shift = hr.shifts.find(s => s.id === me.shiftId)!;
  const branch = hr.branches.find(b => b.id === me.homeBranchId);
  const row = (k: string, v: string) => <div className="row"><span className="grow muted">{k}</span><b style={{ textAlign: 'right' }}>{v}</b></div>;
  const mask = (a?: string) => (a && a.length > 4 ? '•••• ' + a.slice(-4) : a || '—');
  return (
    <div className="screen">
      <div className="card dark col" style={{ alignItems: 'center', textAlign: 'center' }}>
        <span className="avatar" style={{ width: 84, height: 84, fontSize: 28 }}>{initials(me.name)}</span>
        <b style={{ fontSize: 22 }}>{me.name}</b>
        <span style={{ color: '#9fd8d4' }}>{me.position} · {me.code}</span>
      </div>
      <div className="card col">
        {row('ພະແນກ', me.dept)}{row('ສາຂາຫຼັກ', branch?.name ?? '—')}{row('ກະປະຈຳ', `${shift.name} ${shiftRange(shift)}`)}
        {row('ເລີ່ມວຽກ', me.startDate.split('-').reverse().join('/'))}{row('ບົດບາດ', me.roles.map(r => ROLE_NAMES[r]).join(', '))}
        {row('ຮັບເງິນເດືອນ', me.payMethod === 'cash' ? 'ເງິນສົດ' : `${me.bankName ?? ''} ${mask(me.bankAccount)}`)}
        {row('ໃບໜ້າ', me.faceEnrolled ? `ລົງທະບຽນແລ້ວ ${me.faceConsentAt?.slice(0, 10) ?? ''}` : 'ຍັງບໍ່ລົງທະບຽນ')}
      </div>
      <span className="muted small">ຢາກແກ້ຂໍ້ມູນ ເຊັ່ນ ເລກບັນຊີ: ແຈ້ງ HR. ການປ່ຽນເລກບັນຊີຕ້ອງໃຊ້ 2 ຄົນອະນຸມັດ ແລະ ທ່ານຈະໄດ້ຮັບແຈ້ງເຕືອນ.</span>
    </div>
  );
}

export function Directory() {
  const hr = useHR();
  const [q, setQ] = useState('');
  const list = hr.employees.filter(e => !e.endDate && (e.name + e.dept + e.position + e.code).toLowerCase().includes(q.toLowerCase()));
  const depts = [...new Set(list.map(e => e.dept))];
  return (
    <div className="screen">
      <input className="input" type="search" placeholder="ຄົ້ນຫາຊື່, ພະແນກ, ລະຫັດ…" value={q} onChange={e => setQ(e.target.value)} aria-label="ຄົ້ນຫາ" />
      {list.length === 0 && <div className="empty">ບໍ່ພົບ</div>}
      {depts.map(d => (
        <div key={d} className="card col" style={{ gap: 8 }}>
          <span className="muted small">{d} · {list.filter(e => e.dept === d).length} ຄົນ</span>
          {list.filter(e => e.dept === d).map(e => (
            <div key={e.id} className="row"><span className="avatar">{initials(e.name)}</span>
              <div className="col grow" style={{ gap: 0 }}><b>{e.name}</b><span className="muted small">{e.position} · {e.code}</span></div></div>
          ))}
        </div>
      ))}
    </div>
  );
}

export function Notifications({ onOpen }: { onOpen: (link?: string) => void }) {
  const hr = useHR();
  const mine = hr.notifications.filter(n => n.userId === hr.me!.id).sort((a, b) => b.at.localeCompare(a.at));
  const readAll = async () => { for (const n of mine.filter(n => !n.read)) await hr.store.put('notifications', { ...n, read: true }, hr.me!.id, 'notification-read'); await hr.save('notifications', { ...mine[0], read: true }, 'notification-read'); };
  return (
    <div className="screen">
      {mine.some(n => !n.read) && <button className="btn ghost" style={{ alignSelf: 'flex-end' }} onClick={readAll}>ອ່ານແລ້ວທັງໝົດ</button>}
      {mine.length === 0 && <div className="empty">ບໍ່ມີແຈ້ງເຕືອນ</div>}
      {mine.map(n => (
        <button key={n.id} className="card row" style={{ border: 'none', textAlign: 'left', background: n.read ? 'var(--card)' : 'var(--ok-bg)' }}
          onClick={async () => { if (!n.read) await hr.save('notifications', { ...n, read: true }, 'notification-read'); onOpen(n.link); }}>
          {!n.read && <i className="cal-dot ok" />}
          <div className="col grow" style={{ gap: 0 }}><span style={{ fontWeight: n.read ? 400 : 700 }}>{n.text}</span><span className="muted small">{n.at.slice(0, 10)} {hhmm(n.at)}</span></div>
        </button>
      ))}
    </div>
  );
}

export function Reports({ team }: { team: boolean }) {
  const hr = useHR();
  const now = new Date();
  const [ym, setYm] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const [exporting, setExporting] = useState(false);
  const [note, setNote] = useState('');
  const move = (d: number) => { setNote(''); setYm(({ y, m }) => { const t = new Date(y, m + d, 1); return { y: t.getFullYear(), m: t.getMonth() }; }); };
  // the screen and the Excel file are built from the same list and the same calculation
  const people = reportEmployees(hr, team, ym.y, ym.m);
  const report = buildAttendance(reportInput(hr, people, ym.y, ym.m));
  const rows = report.summary;
  const me = rows.find(r => r.employee.id === hr.me!.id);
  const tile = (k: string, v: string | number) => <div className="card" style={{ padding: '12px 14px' }}><span className="muted small">{k}</span><div className="big-num" style={{ fontSize: 26 }}>{v}</div></div>;
  const doExport = async () => {
    const gate = featureBlock(hr.company, 'excelExport', ymd(new Date()));
    if (gate) return setNote(gate);
    setExporting(true);
    setNote('');
    try {
      const r = await exportAttendanceXlsx(hr, team, ym.y, ym.m);
      setNote(`ດາວໂຫຼດແລ້ວ: ${r.fileName} (${r.employees} ຄົນ)`);
    } catch (e: any) {
      setNote('Export ບໍ່ສຳເລັດ: ' + (e?.message || 'ລອງໃໝ່'));
    } finally {
      setExporting(false);
    }
  };
  return (
    <div className="screen">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <button className="icon-btn dark" aria-label="ເດືອນກ່ອນ" onClick={() => move(-1)}>‹</button><b style={{ fontSize: 18 }}>{laoMonth(ym.y, ym.m)}</b><button className="icon-btn dark" aria-label="ເດືອນຖັດໄປ" onClick={() => move(1)}>›</button>
      </div>
      <button className="btn" onClick={doExport} disabled={exporting || report.days.length === 0} style={{ alignSelf: 'flex-start' }}>
        {exporting ? 'ກຳລັງສ້າງໄຟລ໌…' : team ? 'ດາວໂຫຼດລາຍງານເຂົ້າ-ອອກ (Excel)' : 'ດາວໂຫຼດລາຍງານຂອງຂ້ອຍ (Excel)'}
      </button>
      {report.days.length === 0 && <span className="muted small">ເດືອນນີ້ຍັງບໍ່ມີຂໍ້ມູນໃຫ້ດາວໂຫຼດ</span>}
      {note && <div className={`pill ${note.startsWith('Export') ? 'bad' : 'ok'}`} role="status" style={{ alignSelf: 'flex-start', height: 'auto', padding: '6px 12px', whiteSpace: 'normal' }}>{note}</div>}
      {!team && me && <div className="grid" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
        {tile('ມາວຽກ (ມື້)', me.workedDays)}{tile('ມາຊ້າ', `${me.lateDays} ຄັ້ງ`)}{tile('ຂາດ (ມື້)', me.absentDays)}{tile('ລາ (ມື້)', me.leaveDays)}
        {tile('ຊົ່ວໂມງເຮັດວຽກ', me.hours.toFixed(1))}{tile('OT (ນາທີ)', me.otMin)}
      </div>}
      {team && <div className="card scroll-x"><table className="t"><thead><tr><th>ພະນັກງານ</th><th className="num">ມາ</th><th className="num">ຊ້າ</th><th className="num">ນາທີຊ້າ</th><th className="num">ຂາດ</th><th className="num">ລາ</th><th className="num">ຊມ</th><th className="num">OT</th></tr></thead><tbody>
        {rows.map(s => <tr key={s.employee.id}><td><b>{s.employee.name}</b><div className="muted small">{s.employee.dept}</div></td><td className="num">{s.workedDays}</td><td className="num">{s.lateDays}</td><td className="num">{s.lateMin}</td><td className="num">{s.absentDays}</td><td className="num">{s.leaveDays}</td><td className="num">{s.hours.toFixed(1)}</td><td className="num">{s.otMin}</td></tr>)}
      </tbody></table>{rows.length === 0 && <div className="empty">ບໍ່ມີພະນັກງານໃນຂອບເຂດຂອງທ່ານ</div>}</div>}
    </div>
  );
}

export function SchedulePage() {
  const hr = useHR();
  const me = hr.me!;
  const start = useMemo(() => { const d = new Date(); d.setDate(d.getDate() - d.getDay()); return d; }, []);
  const [week, setWeek] = useState(0);
  const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + week * 7 + i); return ymd(d); });
  return (
    <>
      <div className="screen" style={{ paddingBottom: 0 }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <button className="icon-btn dark" aria-label="ອາທິດກ່ອນ" onClick={() => setWeek(week - 1)}>‹</button><b>{days[0].slice(5)} → {days[6].slice(5)}</b><button className="icon-btn dark" aria-label="ອາທິດຖັດໄປ" onClick={() => setWeek(week + 1)}>›</button>
        </div>
        <div className="card col" style={{ gap: 0, padding: '6px 16px' }}>
          {days.map(d => {
            const sid = effectiveShift(me, d, hr.overrides);
            const s = hr.shifts.find(x => x.id === sid);
            const changed = hr.overrides.some(o => o.employeeId === me.id && o.date === d);
            return <div key={d} className="row" style={{ minHeight: 48, borderBottom: '1px solid #f2f8f7', background: d === ymd(new Date()) ? 'var(--warn-bg)' : undefined }}>
              <span className="grow">{laoDate(new Date(d + 'T12:00:00'))}</span>
              {changed && <span className="pill info">ປ່ຽນແລ້ວ</span>}
              <b style={{ color: s ? 'var(--ink)' : '#dc2626' }}>{s ? `${s.name} ${shiftRange(s)}` : 'ພັກ'}</b></div>;
          })}
        </div>
      </div>
      <MyRequests kinds={['schedule', 'shiftSwap', 'dayOffSwap']} />
    </>
  );
}

export function CertificateView({ r, onClose }: { r: HRRequest<'certificate'>; onClose: () => void }) {
  const hr = useHR();
  const e = hr.employees.find(x => x.id === r.employeeId)!;
  const approver = hr.employees.find(x => x.id === r.approvals[r.approvals.length - 1]?.by);
  const today = new Date();
  return (
    <div className="fullscreen" style={{ background: '#fff', color: '#111' }}>
      <div className="row no-print"><button className="btn ghost" onClick={onClose}>‹ ກັບ</button><span className="grow" /><button className="btn" onClick={() => window.print()}>ພິມ / ບັນທຶກ PDF</button></div>
      <article className="cert">
        <p style={{ textAlign: 'center', margin: 0 }}>ສາທາລະນະລັດ ປະຊາທິປະໄຕ ປະຊາຊົນລາວ<br />ສັນຕິພາບ ເອກະລາດ ປະຊາທິປະໄຕ ເອກະພາບ ວັດທະນະຖາວອນ</p>
        <p style={{ marginTop: 24 }}><b>[ຊື່ບໍລິສັດ]</b><br />ເລກທີ: {r.id.slice(0, 8).toUpperCase()}</p>
        <h2 style={{ textAlign: 'center', fontSize: 22, margin: '24px 0' }}>{r.payload.type === 'salary' ? 'ໜັງສືຢັ້ງຢືນເງິນເດືອນ' : 'ໜັງສືຢັ້ງຢືນການເຮັດວຽກ'}</h2>
        <p>ຂໍຢັ້ງຢືນວ່າ <b>{e.name}</b> ລະຫັດພະນັກງານ {e.code} ເປັນພະນັກງານຂອງ [ຊື່ບໍລິສັດ] ໃນຕຳແໜ່ງ <b>{e.position}</b> ພະແນກ {e.dept} ຕັ້ງແຕ່ວັນທີ {e.startDate.split('-').reverse().join('/')} ຈົນເຖິງປັດຈຸບັນ.</p>
        {r.payload.type === 'salary' && <p>ເງິນເດືອນພື້ນຖານ <b>{money(e.baseSalary)} ກີບ</b> ຕໍ່ເດືອນ, ເບ້ຍລ້ຽງ {money(e.allowance)} ກີບ ຕໍ່ເດືອນ.</p>}
        <p>ອອກໃຫ້ເພື່ອ: {r.payload.purpose}</p>
        <p style={{ textAlign: 'right', marginTop: 40 }}>ອອກໃຫ້ ວັນທີ {today.getDate()}/{today.getMonth() + 1}/{today.getFullYear()}<br /><br /><br />ຜູ້ອະນຸມັດ: {approver?.name ?? '—'}<br />{approver?.position ?? ''}</p>
      </article>
    </div>
  );
}

export function TeamMap() {
  const hr = useHR();
  const now = new Date();
  const marks: MapMark[] = useMemo(() => hr.scans.filter(s => sameDay(s.deviceTime, now) && s.lat != null)
    .map(s => ({ lat: s.lat!, lng: s.lng!, label: `${hr.employees.find(e => e.id === s.employeeId)?.name} · ${KIND_LABEL[s.kind]} ${hhmm(s.deviceTime)}`, color: s.status === 'pending' ? '#f4b740' : s.status === 'rejected' ? '#dc2626' : '#16a34a' })),
  [hr.scans, hr.employees]); // eslint-disable-line react-hooks/exhaustive-deps
  const noGps = hr.scans.filter(s => sameDay(s.deviceTime, now) && s.lat == null);
  return (
    <div className="screen">
      <MapCard branches={hr.branches} pos={null} marks={marks} height={380} />
      <div className="row wrap small"><span className="row" style={{ gap: 6 }}><i className="cal-dot ok" />ຜ່ານ</span><span className="row" style={{ gap: 6 }}><i className="cal-dot late" />ລໍກວດ</span><span className="row" style={{ gap: 6 }}><i className="cal-dot absent" />ປະຕິເສດ</span></div>
      <div className="card col"><b>ການສະແກນມື້ນີ້ · {marks.length} ຈຸດ</b>
        {noGps.length > 0 && <span className="muted small">ບໍ່ມີ GPS {noGps.length} ລາຍການ: {noGps.map(s => hr.employees.find(e => e.id === s.employeeId)?.name).join(', ')}</span>}
      </div>
    </div>
  );
}

export function About() {
  return (
    <div className="screen">
      <div className="card col" style={{ alignItems: 'center', textAlign: 'center' }}>
        <span className="logo" style={{ width: 64, height: 64, fontSize: 22 }}>ST</span>
        <b style={{ fontSize: 20 }}>ST HR</b><span className="muted">ເວີຊັນ {APP_VERSION} · ໂໝດສາທິດ</span>
      </div>
      <div className="card col small">
        <span>ລະບົບບຸກຄະລາກອນ: ລົງເວລາດ້ວຍໃບໜ້າ + GPS, ລາພັກ, ຄຳຂໍ, ເງິນເດືອນ.</span>
        <span className="muted">ໂໝດສາທິດເກັບຂໍ້ມູນໄວ້ໃນເຄື່ອງນີ້ເທົ່ານັ້ນ. ແຜນທີ່ © OpenStreetMap contributors. ການຈື່ໜ້າໃຊ້ face-api (MIT).</span>
      </div>
    </div>
  );
}

export function Privacy() {
  const { settings } = useHR();
  return (
    <div className="screen">
      <article className="card col privacy">
        <b style={{ fontSize: 18 }}>ນະໂຍບາຍຄວາມເປັນສ່ວນຕົວ</b>
        <span className="muted small">ສະບັບຮ່າງ — ຕ້ອງໃຫ້ຜູ້ຊ່ຽວຊານດ້ານກົດໝາຍກວດກ່ອນໃຊ້ຈິງ</span>
        <b>1. ຂໍ້ມູນທີ່ເກັບ</b>
        <span>ຊື່, ລະຫັດພະນັກງານ, ຕຳແໜ່ງ, ເງິນເດືອນ ແລະ ເລກບັນຊີ; ເວລາເຂົ້າ-ອອກວຽກ; ຕຳແໜ່ງ GPS ຕອນສະແກນເທົ່ານັ້ນ (ບໍ່ຕິດຕາມຕະຫຼອດເວລາ); ຮູບໃບໜ້າຕອນສະແກນ ແລະ ຂໍ້ມູນຕົວເລກຂອງໃບໜ້າ (128 ຕົວເລກ) ທີ່ໃຊ້ທຽບໜ້າ.</span>
        <b>2. ຈຸດປະສົງ</b>
        <span>ໃຊ້ສະເພາະການບັນທຶກເວລາເຮັດວຽກ, ການຄິດເງິນເດືອນ ແລະ ການກວດສອບພາຍໃນ. ບໍ່ຂາຍ ແລະ ບໍ່ສົ່ງໃຫ້ບຸກຄົນພາຍນອກ ນອກຈາກທີ່ກົດໝາຍກຳນົດ.</span>
        <b>3. ໄລຍະເວລາເກັບ</b>
        <span>ຮູບຕອນສະແກນເກັບ {retentionLabel(settings.photoRetentionDays)} ແລ້ວລຶບອັດຕະໂນມັດ. ຂໍ້ມູນເງິນເດືອນເກັບຕາມທີ່ກົດໝາຍບັນຊີກຳນົດ.</span>
        <b>4. ໃຜເຂົ້າເຖິງໄດ້</b>
        <span>ທ່ານເຫັນຂໍ້ມູນຂອງຕົນເອງ. ຫົວໜ້າເຫັນເວລາ ແລະ ຮູບສະແກນຂອງທີມ. ເງິນເດືອນເຫັນໄດ້ແຕ່ HR, ບັນຊີ ແລະ ຜູ້ກວດສອບ. ທຸກການເຂົ້າແກ້ໄຂຖືກບັນທຶກໃນ audit log.</span>
        <b>5. ສິດຂອງທ່ານ</b>
        <span>ຂໍເບິ່ງ ຫຼື ແກ້ຂໍ້ມູນຂອງຕົນເອງ; ຖອນຄວາມຍິນຍອມການໃຊ້ໃບໜ້າໄດ້ທຸກເວລາ (ໃນ ຕັ້ງຄ່າ) ແລະ ລົງເວລາແບບໃຫ້ຫົວໜ້າຢືນຢັນແທນ.</span>
        <b>6. ຕິດຕໍ່</b>
        <span>[ຊື່ ແລະ ເບີໂທ ຜູ້ຮັບຜິດຊອບຂໍ້ມູນສ່ວນບຸກຄົນ]</span>
      </article>
    </div>
  );
}

export function EmpSettings({ onLogout }: { onLogout: () => void }) {
  const hr = useHR();
  const me = hr.me!;
  const [msg, setMsg] = useState('');
  const [deviceSheet, setDeviceSheet] = useState(false);
  const [faceSheet, setFaceSheet] = useState(false);
  const [notif, setNotif] = useState(() => { try { return localStorage.getItem('sthr-notif') !== 'off'; } catch { return true; } });
  return (
    <div className="screen">
      <div className="card col">
        <label className="row" style={{ minHeight: 48 }}><span className="grow">ສະແດງແຈ້ງເຕືອນ</span>
          <input type="checkbox" checked={notif} onChange={e => { setNotif(e.target.checked); try { localStorage.setItem('sthr-notif', e.target.checked ? 'on' : 'off'); } catch { /* ignore */ } }} style={{ width: 24, height: 24 }} /></label>
        <div className="row" style={{ minHeight: 48 }}><span className="grow">ພາສາ</span><b>ລາວ</b></div>
      </div>
      <div className="card col">
        <b>ເຄື່ອງທີ່ຜູກກັບບັນຊີ</b>
        <span className="muted small">{!me.deviceId ? 'ຍັງບໍ່ໄດ້ຜູກ — ເຄື່ອງທຳອິດທີ່ສະແກນຈະຖືກຜູກ.' : me.deviceId === getDeviceId() ? 'ເຄື່ອງນີ້ຖືກຜູກກັບບັນຊີຂອງເຈົ້າແລ້ວ.' : 'ບັນຊີນີ້ຜູກກັບເຄື່ອງອື່ນ. ການສະແກນຈາກເຄື່ອງນີ້ຈະລໍຫົວໜ້າກວດ.'}</span>
        {me.deviceId && me.deviceId !== getDeviceId() && <button className="btn ghost" onClick={() => setDeviceSheet(true)}>ຂໍປ່ຽນມາໃຊ້ເຄື່ອງນີ້</button>}
        {deviceSheet && <RequestSheet kind="deviceChange" onClose={() => setDeviceSheet(false)} />}
      </div>
      <div className="card col">
        <b>ຂໍ້ມູນໃບໜ້າ</b>
        <span className="muted small">{me.faceEnrolled ? `ລົງທະບຽນແລ້ວ ${faceTemplates(me).length} ທ່າ. ຖ້າຖອນຄວາມຍິນຍອມ ຂໍ້ມູນໃບໜ້າຈະຖືກລຶບ ແລະ ການລົງເວລາຈະໄປລໍຫົວໜ້າກວດ.` : 'ຍັງບໍ່ໄດ້ລົງທະບຽນ — ຈະຖືກຖາມຕອນກົດເຂົ້າວຽກເທື່ອທຳອິດ.'}</span>
        {me.faceEnrolled && faceTemplates(me).length < POSES.length && !me.faceReenroll && <span className="muted small">ມີບໍ່ຄົບ {POSES.length} ທ່າ — ຂໍລົງທະບຽນໃໝ່ ເພື່ອໃຫ້ສະແກນຕິດງ່າຍຂຶ້ນ.</span>}
        {me.faceReenroll && <span className="pill ok" style={{ alignSelf: 'flex-start' }}>ອະນຸມັດແລ້ວ — ເທື່ອຕໍ່ໄປທີ່ກົດເຂົ້າວຽກ ຈະໃຫ້ຖ່າຍໃບໜ້າໃໝ່</span>}
        {me.faceEnrolled && !faceResetBlock(me) && <button className="btn ghost" onClick={() => setFaceSheet(true)}>ຂໍລົງທະບຽນໃບໜ້າໃໝ່</button>}
        {faceSheet && <RequestSheet kind="faceReset" onClose={() => setFaceSheet(false)} />}
        {me.faceEnrolled && <button className="btn danger" onClick={async () => { await hr.save('employees', { ...me, faceEnrolled: undefined, facePoses: undefined, faceReenroll: undefined, faceConsentAt: undefined }, 'face-consent-withdraw'); setMsg('ລຶບຂໍ້ມູນໃບໜ້າແລ້ວ'); }}>ຖອນຄວາມຍິນຍອມ ແລະ ລຶບຂໍ້ມູນໃບໜ້າ</button>}
        {msg && <span className="pill ok" style={{ alignSelf: 'flex-start' }}>{msg}</span>}
      </div>
      <button className="btn ghost" onClick={onLogout}>ອອກຈາກລະບົບ</button>
    </div>
  );
}
