import { useState } from 'react';
import { useHR } from '../app/state';
import { LocalStore, uid } from '../data/store';
import { saveCompany, storePrefix } from '../data/companies';
import { backupFileName, backupProblem, makeBackup, restoreBackup, type Backup } from '../data/backup';
import { downloadBytes } from './format';

/** Download the company's data as one file, or put a file back. While data lives in this browser only, this is the only safe copy. */
export default function BackupCard({ readOnly }: { readOnly: boolean }) {
  const hr = useHR();
  const me = hr.me!;
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const download = async () => {
    setErr('');
    const now = new Date();
    const b = makeBackup(localStorage, hr.company, now);
    const fileName = backupFileName(hr.company, now);
    // recorded first, like every export: a copy of the payroll data must not leave without a trace
    await hr.save('exports', { id: uid(), companyId: me.companyId, kind: 'backup', fileName, keys: Object.keys(b.data).length }, 'export-backup');
    downloadBytes(fileName, new TextEncoder().encode(JSON.stringify(b)), 'application/json');
    setMsg(`ດາວໂຫຼດ ${fileName} ແລ້ວ — ເກັບໄວ້ບ່ອນປອດໄພ (ມີຂໍ້ມູນເງິນເດືອນ ແລະ ເລກບັນຊີ)`);
  };

  const restore = async (f?: File) => {
    if (!f) return;
    setErr(''); setMsg('');
    let b: Backup;
    try { b = JSON.parse(await f.text()); } catch { return setErr('ອ່ານໄຟລ໌ບໍ່ໄດ້ — ຕ້ອງເປັນໄຟລ໌ .json ທີ່ດາວໂຫຼດຈາກປຸ່ມຂ້າງເທິງ'); }
    const problem = backupProblem(b);
    if (problem) return setErr(problem);
    const same = b.company.id === hr.company.id;
    const ok = confirm(same
      ? `ກູ້ຄືນ "${b.company.name}" ຈາກໄຟລ໌ວັນທີ ${b.exportedAt.slice(0, 10)}?\n\nຂໍ້ມູນປັດຈຸບັນຂອງບໍລິສັດນີ້ໃນເຄື່ອງນີ້ ຈະຖືກແທນທີ່ດ້ວຍຂໍ້ມູນໃນໄຟລ໌.`
      : `ໄຟລ໌ນີ້ເປັນຂອງ "${b.company.name}" (ບໍ່ແມ່ນບໍລິສັດທີ່ເປີດຢູ່).\n\nເພີ່ມ / ແທນທີ່ບໍລິສັດນັ້ນໃນເຄື່ອງນີ້ ແລ້ວສະຫຼັບໄປໃຊ້?`);
    if (!ok) return;
    const entry = { kind: 'restore', fileName: f.name, company: b.company.id, backupOf: b.exportedAt };
    // restoring another company: the company open now keeps a record that it happened from here
    if (!same) await hr.save('exports', { id: uid(), companyId: me.companyId, ...entry }, 'import-backup');
    try {
      restoreBackup(localStorage, b, saveCompany);
    } catch (e: any) { return setErr(`ກູ້ຄືນບໍ່ສຳເລັດ: ${e?.message || ''}`); }
    // and the restored company records it too, written after the restore so the file's own log cannot overwrite it
    await new LocalStore(b.company.id, storePrefix(b.company.id)).put('exports', { id: uid(), companyId: b.company.id, ...entry }, me.id, 'import-backup');
    try { localStorage.setItem('sthr-company', b.company.id); } catch { /* the company picker still lists it */ }
    location.reload();
  };

  return (
    <div className="card col">
      <h2>ສຳຮອງ ແລະ ກູ້ຄືນຂໍ້ມູນ</h2>
      <div className="pill warn" style={{ alignSelf: 'flex-start', height: 'auto', padding: '8px 12px', whiteSpace: 'normal' }}>
        ຕອນນີ້ຂໍ້ມູນທັງໝົດເກັບໃນເບົາເຊີຂອງເຄື່ອງນີ້ເທົ່ານັ້ນ. ຖ້າລ້າງເບົາເຊີ, ເຄື່ອງເສຍ ຫຼື ປ່ຽນເຄື່ອງ ຂໍ້ມູນຈະຫາຍ — ດາວໂຫຼດໄຟລ໌ສຳຮອງເປັນປະຈຳ (ຢ່າງໜ້ອຍອາທິດລະເທື່ອ ແລະ ທຸກເທື່ອກ່ອນປິດງວດເງິນເດືອນ).
      </div>
      {readOnly ? <span className="muted small">ສະເພາະເຈົ້າຂອງ ສຳຮອງ ແລະ ກູ້ຄືນໄດ້.</span> : <>
        <div className="row wrap">
          <button className="btn" onClick={download}>⬇ ດາວໂຫຼດໄຟລ໌ສຳຮອງ</button>
          <label className="btn ghost" style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center' }}>⬆ ກູ້ຄືນຈາກໄຟລ໌
            <input type="file" accept=".json,application/json" hidden aria-label="ເລືອກໄຟລ໌ສຳຮອງ" onChange={e => { restore(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
        </div>
        <span className="muted small">ໄຟລ໌ສຳຮອງມີທຸກຢ່າງຂອງບໍລິສັດນີ້: ພະນັກງານ, ການລົງເວລາ (ລວມຮູບ), ການລາ, ເງິນເດືອນ, ກົດເກນ ແລະ ບັນທຶກການແກ້ໄຂ. ໃຊ້ກູ້ຄືນໃນເຄື່ອງໃໝ່ໄດ້.</span>
      </>}
      {msg && <div className="pill ok" role="status" style={{ alignSelf: 'flex-start', height: 'auto', padding: '6px 12px', whiteSpace: 'normal' }}>{msg}</div>}
      {err && <div className="error" role="alert">{err}</div>}
    </div>
  );
}
