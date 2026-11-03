import { useState } from 'react';
import { useHR } from '../app/state';
import { uid } from '../data/store';
import { buildXlsx, XLSX_MIME } from '../domain/xlsx';
import { readCsvRows, readXlsxRows } from '../domain/xlsxRead';
import { parseStaffRows, staffTemplate, type ImportResult } from '../domain/staffImport';
import { countedEmployees, limitsOf } from '../domain/company';
import { changeNeedsSecondPerson } from '../domain/payroll';
import { downloadBytes, money, ymd } from './format';
import { sharedShifts } from '../domain/personalShift';

/** Bring a staff list in from Excel: download the template, pick the filled file, check every row, then add the good ones. */
export default function StaffImport({ onClose, onDone }: { onClose: () => void; onDone: (msg: string) => void }) {
  const hr = useHR();
  const me = hr.me!;
  const [file, setFile] = useState('');
  const [res, setRes] = useState<ImportResult | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const today = ymd(new Date());
  const branchName = (id: string) => hr.branches.find(b => b.id === id)?.name ?? '—';
  const shiftName = (id: string) => hr.shifts.find(s => s.id === id)?.name ?? '—';

  const template = () => downloadBytes('ແບບຟອມ_ລາຍຊື່ພະນັກງານ.xlsx', buildXlsx(staffTemplate({ branches: hr.branches, shifts: sharedShifts(hr.shifts) })), XLSX_MIME);
  const pick = async (f?: File) => {
    if (!f) return;
    setErr(''); setRes(null); setFile(f.name);
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const table = /\.csv$/i.test(f.name) ? readCsvRows(new TextDecoder('utf-8').decode(bytes)) : readXlsxRows(bytes);
      setRes(parseStaffRows(table, { existing: hr.employees, shifts: sharedShifts(hr.shifts), branches: hr.branches, companyId: me.companyId, newId: uid }));
    } catch (e: any) { setErr(e?.message || 'ອ່ານໄຟລ໌ບໍ່ໄດ້'); }
  };

  const room = limitsOf(hr.company, today).maxEmployees - countedEmployees(hr.employees, today);
  const twoPeople = changeNeedsSecondPerson(hr.settings) && !hr.approver!.selfOk;
  const go = async () => {
    if (!res?.ok.length) return;
    if (res.ok.length > room) return setErr(`ແພັກເກັດນີ້ຮັບພະນັກງານໄດ້ອີກ ${Math.max(room, 0)} ຄົນ ແຕ່ໃນໄຟລ໌ມີ ${res.ok.length} ຄົນ — ຍົກລະດັບແພັກເກັດ ຫຼື ແບ່ງນຳເຂົ້າ`);
    setBusy(true);
    try {
      if (twoPeople) {
        // the same two-person check as hiring by hand: each hire waits for someone else to approve
        for (const e of res.ok) await hr.save('changes', { id: uid(), companyId: me.companyId, employeeId: e.id, field: 'hire', from: '', to: JSON.stringify(e), by: me.id, at: new Date().toISOString(), status: 'pending' }, 'change-request-import');
        onDone(`ສົ່ງການຈ້າງ ${res.ok.length} ຄົນ ຈາກ ${file} ໃຫ້ອີກຄົນອະນຸມັດແລ້ວ (ກວດ 2 ຄົນ)`);
      } else {
        for (const e of res.ok) await hr.save('employees', e, 'employee-import');
        await hr.notify(hr.employees.filter(x => x.roles.includes('owner') && !x.endDate && x.id !== me.id).map(x => x.id), `ນຳເຂົ້າພະນັກງານ ${res.ok.length} ຄົນ ຈາກ ${file}`, 'profile');
        onDone(`ເພີ່ມພະນັກງານ ${res.ok.length} ຄົນ ຈາກ ${file} ແລ້ວ`);
      }
    } catch (e: any) {
      setErr(`ບັນທຶກບໍ່ສຳເລັດ: ${e?.message || ''} — ກວດລາຍຊື່ໃນຕາຕະລາງ ກ່ອນລອງໃໝ່ (ຄົນທີ່ບັນທຶກໄປແລ້ວຈະຖືກກັນບໍ່ໃຫ້ຊ້ຳ)`);
    } finally { setBusy(false); }
  };

  const bad = res?.rows.filter(r => r.errors.length) ?? [];
  return (
    <div className="card col">
      <div className="row"><h2 className="grow">ນຳເຂົ້າລາຍຊື່ພະນັກງານຈາກ Excel</h2><button className="btn ghost" onClick={onClose}>ປິດ</button></div>
      <div className="col" style={{ gap: 6 }}>
        <b>1. ດາວໂຫຼດແບບຟອມ ແລ້ວໃສ່ລາຍຊື່</b>
        <span className="muted small">ໃນແບບຟອມມີແຜ່ນ "ວິທີໃສ່" ບອກທຸກຖັນ ແລະ ຊື່ສາຂາ / ກະທີ່ໃຊ້ໄດ້. ຖັນທີ່ມີ * ຕ້ອງໃສ່. ລຶບແຖວຕົວຢ່າງອອກກ່ອນ.</span>
        <button className="btn ghost" style={{ alignSelf: 'flex-start' }} onClick={template}>⬇ ດາວໂຫຼດແບບຟອມ Excel</button>
      </div>
      <div className="col" style={{ gap: 6 }}>
        <b>2. ເລືອກໄຟລ໌ທີ່ໃສ່ແລ້ວ (.xlsx ຫຼື .csv)</b>
        <input className="input" type="file" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" aria-label="ເລືອກໄຟລ໌ລາຍຊື່" onChange={e => { pick(e.target.files?.[0]); e.target.value = ''; }} />
      </div>
      {err && <div className="error" role="alert">{err}</div>}
      {res && res.missingColumns.length > 0 && <div className="error" role="alert">ບໍ່ພົບຖັນ: {res.missingColumns.join(', ')} — ກະລຸນາໃຊ້ແບບຟອມ (ແຖວຫົວຕາຕະລາງຕ້ອງມີຊື່ຖັນຕາມແບບຟອມ)</div>}
      {res && !res.missingColumns.length && (
        <>
          <b>3. ກວດກ່ອນນຳເຂົ້າ</b>
          <div className="row wrap">
            <span className="pill ok">ພ້ອມ {res.ok.length} ຄົນ</span>
            {bad.length > 0 && <span className="pill warn">ມີບັນຫາ {bad.length} ແຖວ (ຈະບໍ່ນຳເຂົ້າ — ແກ້ໃນ Excel ແລ້ວເລືອກໄຟລ໌ໃໝ່)</span>}
            {res.rows.length === 0 && <span className="pill">ບໍ່ມີແຖວຂໍ້ມູນໃຕ້ຫົວຕາຕະລາງ</span>}
          </div>
          <div className="scroll-x"><table className="t"><thead><tr><th>ແຖວ</th><th>ລະຫັດ</th><th>ຊື່</th><th>ພະແນກ · ຕຳແໜ່ງ</th><th>ສາຂາ · ກະ</th><th>ເລີ່ມ</th><th className="num">ເງິນເດືອນ</th><th>ຮັບເງິນ</th><th>ຜົນ</th></tr></thead><tbody>
            {res.rows.map(r => { const e = r.employee!; return (
              <tr key={r.line} style={r.errors.length ? { background: 'var(--bad-bg)' } : undefined}>
                <td>{r.line}</td><td>{e.code}</td><td><b>{e.name || '—'}</b></td><td className="small">{e.dept} · {e.position}</td>
                <td className="small">{branchName(e.homeBranchId)} · {shiftName(e.shiftId)}</td><td className="small">{e.startDate}</td>
                <td className="num">{Number.isFinite(e.baseSalary) ? money(e.baseSalary) : '—'}</td>
                <td className="small">{e.payMethod === 'cash' ? 'ເງິນສົດ' : `${e.bankName ?? ''} ${e.bankAccount ?? ''}`}</td>
                <td className="small">{r.errors.length ? <span style={{ color: 'var(--bad)' }}>{r.errors.join(' · ')}</span> : <span className="pill ok">ພ້ອມ</span>}</td>
              </tr>); })}
          </tbody></table></div>
          <span className="muted small">{twoPeople ? 'ເປີດ "ກວດ 2 ຄົນ" ຢູ່: ການຈ້າງແຕ່ລະຄົນຈະລໍອີກຄົນ (ເຈົ້າຂອງ ຫຼື ບັນຊີ) ອະນຸມັດ ກ່ອນເຂົ້າລາຍຊື່.' : 'ພະນັກງານຈະເຂົ້າລາຍຊື່ທັນທີ ໃນບົດບາດ "ພະນັກງານ". ບົດບາດອື່ນໃຫ້ກຳນົດຕໍ່ໃນ ແກ້ໄຂ.'} ທຸກລາຍການຖືກບັນທຶກໃນ ບັນທຶກການແກ້ໄຂ.</span>
          <button className="btn" style={{ alignSelf: 'flex-start' }} disabled={busy || !res.ok.length} onClick={go}>{busy ? 'ກຳລັງບັນທຶກ…' : twoPeople ? `ສົ່ງ ${res.ok.length} ຄົນ ໃຫ້ອະນຸມັດ` : `ນຳເຂົ້າ ${res.ok.length} ຄົນ`}</button>
        </>
      )}
    </div>
  );
}
