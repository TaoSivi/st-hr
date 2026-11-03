import type { Settings, Shift, Branch, Role, TaxBracket } from './types';
import { shiftRange } from './leavePart';

/** The company's rules in plain Lao: what each setting is called, how it reads, and what changed between two versions. */

export type RuleKey = Exclude<keyof Settings, 'companyId'>;
export type RulesTab = 'places' | 'shifts' | 'time' | 'leave' | 'holidays' | 'pay';

export const RULE_LABEL: Record<RuleKey, string> = {
  graceMinutes: 'ຜ່ອນຜັນມາຊ້າ (ນາທີ)',
  lateDeductPerMinute: 'ຫັກມາຊ້າ (ກີບ/ນາທີ)',
  otRate: 'ອັດຕາ OT (ເທົ່າ)',
  workHoursPerMonth: 'ຊົ່ວໂມງວຽກ/ເດືອນ',
  ssRate: 'ປະກັນສັງຄົມພະນັກງານ (%)',
  taxBrackets: 'ຂັ້ນອາກອນ',
  maxClockSkewMin: 'ໂມງຕ່າງໄດ້ສູງສຸດ (ນາທີ)',
  faceMinScore: 'ໃບໜ້າຂັ້ນຕ່ຳ (%)',
  leaveDaysPerYear: 'ມື້ລາພັກ/ປີ',
  leaveAccrual: 'ວິທີໄດ້ສິດລາ',
  leaveCarryOverMax: 'ຍົກໄປປີໜ້າສູງສຸດ (ມື້)',
  leaveApproversRequired: 'ຕ້ອງອະນຸມັດຈັກຄົນ',
  leaveApproverRoles: 'ໃຜອະນຸມັດການລາໄດ້',
  escalateAfterHours: 'ສົ່ງຫາເຈົ້າຂອງຫຼັງ (ຊົ່ວໂມງ)',
  makerChecker: 'ເງິນເດືອນ / ເລກບັນຊີ ຕ້ອງກວດ 2 ຄົນ',
  advanceMaxPctOfEarned: 'ເບີກລ່ວງໜ້າສູງສຸດ (% ຂອງເງິນທີ່ໄດ້ແລ້ວ)',
  photoRetentionDays: 'ເກັບຮູບ (ມື້)',
  randomSamplePerDay: 'ສຸ່ມກວດຕໍ່ມື້',
  holidays: 'ວັນພັກລັດຖະການ',
  leavePayoutOnExit: 'ຈ່າຍວັນລາພັກຄ້າງ ເມື່ອພະນັກງານອອກ',
  compLeaveExpiryDays: 'ວັນພັກຊົດເຊີຍໝົດອາຍຸ (ມື້)',
  approverRoles: 'ຜູ້ອະນຸມັດແຕ່ລະເລື່ອງ',
  employeeMenus: 'ເມນູທີ່ປິດສຳລັບພະນັກງານ'
};

const ROLE_LAO: Record<Role, string> = { employee: 'ພະນັກງານ', head: 'ຫົວໜ້າ', accountant: 'ບັນຊີ', owner: 'ເຈົ້າຂອງ / HR', auditor: 'ຜູ້ກວດສອບ' };
const ACCRUAL_LAO: Record<Settings['leaveAccrual'], string> = { monthly: 'ສະສົມເປັນເດືອນ', yearStart: 'ໄດ້ເຕັມຕົ້ນປີ', anniversary: 'ຕາມວັນຄົບຮອບ' };

/** 1234567 → "1,234,567"; 0.07×100 → 7, never 7.000000000000001. */
const num = (v: number, scale = 1) => (Number.isFinite(v) ? (Math.round(v * scale * 1e6) / 1e6).toLocaleString('en-US') : '—');
const onOff = (b: boolean) => (b ? 'ເປີດ' : 'ປິດ');
const taxText = (b: TaxBracket[]) => b.map(x => `${x.upTo == null ? 'ຂຶ້ນໄປ' : '≤' + num(x.upTo)}: ${num(x.rate, 100)}%`).join(' · ');

/** One setting's value as it reads in a sentence or a change list. */
export function ruleValue(key: RuleKey, s: Settings): string {
  switch (key) {
    case 'ssRate': case 'advanceMaxPctOfEarned': return `${num(s[key], 100)}%`;
    case 'makerChecker': case 'leavePayoutOnExit': return onOff(s[key]);
    case 'leaveAccrual': return ACCRUAL_LAO[s.leaveAccrual];
    case 'leaveApproverRoles': return s.leaveApproverRoles.map(r => ROLE_LAO[r]).join(', ') || '—';
    case 'leaveApproversRequired': return `${s.leaveApproversRequired} ຄົນ`;
    case 'holidays': return `${s.holidays.length} ວັນ`;
    case 'taxBrackets': return taxText(s.taxBrackets);
    case 'approverRoles': { const o = s.approverRoles ?? {}; const keys = Object.keys(o) as (keyof typeof o)[]; return keys.length ? keys.map(k => `${k}: ${(o[k] ?? []).map(r => ROLE_LAO[r]).join('+')}`).join(' · ') : 'ຄ່າເລີ່ມຕົ້ນ'; }
    case 'employeeMenus': { const off = Object.entries(s.employeeMenus ?? {}).filter(([, v]) => v === false).map(([k]) => k); return off.length ? `ປິດ: ${off.join(', ')}` : 'ເປີດທັງໝົດ'; }
    case 'compLeaveExpiryDays': return s.compLeaveExpiryDays === 0 ? 'ບໍ່ໝົດອາຍຸ' : `${num(s.compLeaveExpiryDays)} ມື້`;
    default: return num(s[key] as number);
  }
}

export interface RuleChange { key: RuleKey; label: string; from: string; to: string }

/** What differs between two versions of the settings, ready to list. Holidays say which dates came and went. */
export function ruleChanges(before: Partial<Settings> | undefined, after: Partial<Settings> | undefined): RuleChange[] {
  if (!before || !after) return [];
  const out: RuleChange[] = [];
  for (const key of Object.keys(RULE_LABEL) as RuleKey[]) {
    if (JSON.stringify(before[key]) === JSON.stringify(after[key])) continue;
    if (before[key] === undefined || after[key] === undefined) continue; // an older record without this setting: nothing to compare
    if (key === 'holidays') {
      const a = before.holidays!, b = after.holidays!;
      const added = b.filter(d => !a.includes(d)), removed = a.filter(d => !b.includes(d));
      out.push({ key, label: RULE_LABEL[key], from: `${a.length} ວັນ`, to: [added.length ? `ເພີ່ມ ${added.join(', ')}` : '', removed.length ? `ລຶບ ${removed.join(', ')}` : ''].filter(Boolean).join(' · ') });
    } else out.push({ key, label: RULE_LABEL[key], from: ruleValue(key, before as Settings), to: ruleValue(key, after as Settings) });
  }
  return out;
}

const SHIFT_LABEL: Record<string, string> = { name: 'ຊື່', start: 'ເລີ່ມ', end: 'ເລີກ', breakStart: 'ເລີ່ມພັກ', breakEnd: 'ເສັດພັກ', flexible: 'ຢືດຢຸ່ນ', dailyHours: 'ຊົ່ວໂມງ/ມື້', allowance: 'ເບ້ຍລ້ຽງ/ກະ' };
const BRANCH_LABEL: Record<string, string> = { name: 'ຊື່', lat: 'ລະຕິຈູດ', lng: 'ລອງຈິຈູດ', radiusM: 'ລັດສະໝີ (ມ.)' };
const show = (v: unknown) => (v === undefined || v === null || v === '' ? '—' : typeof v === 'boolean' ? onOff(v) : typeof v === 'number' ? num(v) : String(v));

/** One audit entry about a shift or a branch as lines of text: "ເລີ່ມ: 08:00 → 07:30", or "ເພີ່ມ" for a new one. */
export function recordChanges(kind: 'shift' | 'branch', before: Record<string, unknown> | undefined, after: Record<string, unknown> | undefined): string[] {
  const labels = kind === 'shift' ? SHIFT_LABEL : BRANCH_LABEL;
  if (!after) return [];
  if (!before) return [`ເພີ່ມ${kind === 'shift' ? 'ກະ' : 'ສາຂາ'} ${show(after.name)}`];
  return Object.keys(labels).filter(k => JSON.stringify(before[k]) !== JSON.stringify(after[k])).map(k => `${show(after.name)} · ${labels[k]}: ${show(before[k])} → ${show(after[k])}`);
}

export interface RulesSection { title: string; tab: RulesTab; lines: string[] }

/** The rules in force as plain sentences, grouped the way the settings tabs are. */
export function rulesSummary(s: Settings, shifts: Shift[], branches: Pick<Branch, 'name' | 'radiusM'>[]): RulesSection[] {
  return [
    {
      title: 'ສາຂາ & GPS', tab: 'places',
      lines: branches.length ? branches.map(b => `${b.name}: ລົງເວລາໄດ້ເມື່ອຢູ່ໃນລັດສະໝີ ${num(b.radiusM)} ແມັດ`) : ['ຍັງບໍ່ມີສາຂາ']
    },
    {
      title: 'ກະວຽກ', tab: 'shifts',
      lines: shifts.length ? shifts.map(x => `${x.name}: ${shiftRange(x)}${x.allowance ? ` · ເບ້ຍລ້ຽງ ${num(x.allowance)} ກີບ/ກະ` : ''}`) : ['ຍັງບໍ່ມີກະ']
    },
    {
      title: 'ເວລາ & ສະແກນ', tab: 'time',
      lines: [
        `ມາຊ້າເກີນ ${num(s.graceMinutes)} ນາທີ ຈຶ່ງນັບວ່າມາຊ້າ (ນັບຕັ້ງແຕ່ເວລາເລີ່ມກະ) · ຫັກ ${num(s.lateDeductPerMinute)} ກີບ/ນາທີ`,
        `ໃບໜ້າຕ້ອງກົງຢ່າງໜ້ອຍ ${num(s.faceMinScore)}% ຖ້າຕ່ຳກວ່ານີ້ການລົງເວລາຈະລໍຫົວໜ້າກວດ`,
        `ໂມງໂທລະສັບຕ່າງຈາກເຊີບເວີເກີນ ${num(s.maxClockSkewMin)} ນາທີ → ລໍຫົວໜ້າກວດ`,
        `ສຸ່ມກວດ ${num(s.randomSamplePerDay)} ລາຍການຕໍ່ມື້ · ເກັບຮູບສະແກນ ${num(s.photoRetentionDays)} ມື້ ແລ້ວລຶບເອງ`
      ]
    },
    {
      title: 'ລາພັກ & ອະນຸມັດ', tab: 'leave',
      lines: [
        `ລາພັກປະຈຳປີ ${num(s.leaveDaysPerYear)} ມື້/ປີ · ${ACCRUAL_LAO[s.leaveAccrual]} · ຍົກໄປປີໜ້າໄດ້ສູງສຸດ ${num(s.leaveCarryOverMax)} ມື້`,
        `ວັນພັກຊົດເຊີຍ: ${s.compLeaveExpiryDays === 0 ? 'ບໍ່ໝົດອາຍຸ' : `ໝົດອາຍຸຫຼັງ ${num(s.compLeaveExpiryDays)} ມື້`}`,
        `ອະນຸມັດໂດຍ ${ruleValue('leaveApproverRoles', s)} · ຕ້ອງ ${s.leaveApproversRequired} ຄົນ · ຖ້າຄ້າງເກີນ ${num(s.escalateAfterHours)} ຊົ່ວໂມງ ເຈົ້າຂອງຊ່ວຍອະນຸມັດໄດ້`,
        `ເມື່ອພະນັກງານອອກ: ${s.leavePayoutOnExit ? 'ຈ່າຍເງິນວັນລາພັກທີ່ຍັງເຫຼືອ' : 'ບໍ່ຈ່າຍວັນລາພັກທີ່ຍັງເຫຼືອ'}`
      ]
    },
    { title: 'ວັນພັກລັດຖະການ', tab: 'holidays', lines: [s.holidays.length ? `${s.holidays.length} ວັນ (ບໍ່ນັບເປັນຂາດ ແລະ ບໍ່ນັບເປັນມື້ລາ)` : 'ຍັງບໍ່ໄດ້ໃສ່ວັນພັກ'] },
    {
      title: 'ເງິນເດືອນ & ອາກອນ', tab: 'pay',
      lines: [
        `OT ຄິດ ${num(s.otRate)} ເທົ່າຂອງຄ່າແຮງຕໍ່ຊົ່ວໂມງ (ເງິນເດືອນ ÷ ${num(s.workHoursPerMonth)} ຊົ່ວໂມງ/ເດືອນ)`,
        `ປະກັນສັງຄົມ ${num(s.ssRate, 100)}% ຂອງເງິນເດືອນພື້ນຖານ`,
        `ອາກອນຕາມຂັ້ນ: ${taxText(s.taxBrackets)}`,
        `ເບີກລ່ວງໜ້າໄດ້ສູງສຸດ ${num(s.advanceMaxPctOfEarned, 100)}% ຂອງເງິນທີ່ໄດ້ແລ້ວ`,
        `ເງິນເດືອນ / ເລກບັນຊີ ທີ່ປ່ຽນ ${s.makerChecker ? 'ຕ້ອງມີອີກຄົນກວດ (2 ຄົນ)' : 'ບໍ່ຕ້ອງມີຄົນກວດຊ້ຳ'}`
      ]
    }
  ];
}
