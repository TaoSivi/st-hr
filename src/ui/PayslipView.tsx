import type { Payslip } from '../domain/payroll';
import type { Employee } from '../domain/types';
import { money } from './format';

export interface PayslipData { employee: Employee; slip: Payslip; lateMin: number; otMin: number; unpaidDays: number }

/**
 * A full-screen payslip that prints cleanly (the browser's "save as PDF" gives the PDF).
 * `final` is false until the period is locked: an unlocked slip is marked as an estimate so it cannot be mistaken for the real one.
 */
export function PayslipView({ data, monthLabel, final, onClose }: { data: PayslipData; monthLabel: string; final: boolean; onClose: () => void }) {
  const { employee: e, slip: s } = data;
  const line = (k: string, v: number, neg = false, note?: string) => (
    <tr><td>{k}{note && <span style={{ color: '#666', fontSize: 13 }}> · {note}</span>}</td><td style={{ textAlign: 'right' }}>{neg && v ? '−' : ''}{money(v)}</td></tr>);
  return (
    <div className="fullscreen" style={{ background: '#fff', color: '#111' }} role="dialog" aria-label="ສະລິບເງິນເດືອນ">
      <div className="row no-print"><button className="btn ghost" onClick={onClose}>‹ ກັບ</button><span className="grow" /><button className="btn" onClick={() => window.print()}>ພິມ / ບັນທຶກ PDF</button></div>
      <article className="cert payslip">
        <h2 style={{ textAlign: 'center', fontSize: 22, margin: '0 0 4px' }}>ສະລິບເງິນເດືອນ</h2>
        <p style={{ textAlign: 'center', margin: 0 }}>[ຊື່ບໍລິສັດ] · {monthLabel}</p>
        {!final && <p style={{ textAlign: 'center', margin: '8px 0', color: '#b45309', fontWeight: 700 }}>ຕົວເລກປະມານການ — ງວດຍັງບໍ່ລັອກ ອາດປ່ຽນໄດ້</p>}
        <table style={{ width: '100%', margin: '12px 0', lineHeight: 1.6 }}><tbody>
          <tr><td>ຊື່</td><td><b>{e.name}</b></td><td>ລະຫັດ</td><td>{e.code}</td></tr>
          <tr><td>ຕຳແໜ່ງ</td><td>{e.position}</td><td>ພະແນກ</td><td>{e.dept}</td></tr>
          <tr><td>ຮັບເງິນ</td><td colSpan={3}>{e.payMethod === 'cash' ? 'ເງິນສົດ' : `${e.bankName ?? ''} ${e.bankAccount ?? ''}`}</td></tr>
        </tbody></table>
        <table style={{ width: '100%', borderCollapse: 'collapse', lineHeight: 1.9 }}><tbody>
          <tr><th colSpan={2} style={{ textAlign: 'left', borderBottom: '1px solid #999' }}>ລາຍຮັບ</th></tr>
          {line('ເງິນເດືອນພື້ນຖານ', s.base, false, s.prorate < 1 ? `ຄິດ ${Math.round(s.prorate * 1000) / 10}% ຂອງເດືອນ` : undefined)}
          {line('ເບ້ຍລ້ຽງ', s.allowance)}
          {line('ຄ່າລ່ວງເວລາ (OT)', s.ot, false, data.otMin ? `${data.otMin} ນາທີ` : undefined)}
          {s.adjustments !== 0 && line('ປັບປຸງ', s.adjustments)}
          <tr><th colSpan={2} style={{ textAlign: 'left', borderBottom: '1px solid #999', paddingTop: 8 }}>ລາຍຫັກ</th></tr>
          {line('ມາຊ້າ', s.lateDeduction, true, s.lateDeduction ? `${data.lateMin} ນາທີ` : undefined)}
          {line('ລາບໍ່ຮັບເງິນເດືອນ', s.unpaidLeave, true, data.unpaidDays ? `${data.unpaidDays} ມື້` : undefined)}
          {line('ປະກັນສັງຄົມ', s.socialSecurity, true)}
          {line('ອາກອນລາຍໄດ້', s.tax, true)}
          {line('ເບີກລ່ວງໜ້າ', s.advance, true)}
          {s.reimbursement > 0 && line('ຄືນຄ່າໃຊ້ຈ່າຍ', s.reimbursement)}
          <tr><td style={{ borderTop: '2px solid #111', fontWeight: 700, fontSize: 18 }}>ຮັບສຸດທິ</td><td style={{ borderTop: '2px solid #111', textAlign: 'right', fontWeight: 700, fontSize: 18 }}>{money(s.net)} ກີບ</td></tr>
        </tbody></table>
        <p style={{ color: '#666', fontSize: 13, marginTop: 16 }}>ເອກະສານນີ້ອອກຈາກລະບົບ ST HR · ອັດຕາອາກອນ ແລະ ປະກັນສັງຄົມ ເປັນຄ່າຕົວຢ່າງ</p>
      </article>
    </div>
  );
}
