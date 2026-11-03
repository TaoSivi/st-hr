import { describe, expect, it } from 'vitest';
import { averageDescriptors, bestFaceScore, faceResetBlock, faceTemplates, matchScore, needsEnroll, poseOk, POSES, SAMPLES_PER_POSE, yawOf } from './face';
import { decideRequest, requestBlock, validateRequest, type HRRequest } from './requests';
import { approvalAccess } from './permissions';
import { decideAndApply } from '../app/workflow';
import { defaultSettings } from './defaults';
import { employees } from '../data/seed';
import type { Employee } from './types';

const S = defaultSettings('c1');
const vec = (v: number, n = 128) => Array.from({ length: n }, () => v);
/** A descriptor `d` away from vec(0): all of the distance on the first number. */
const away = (d: number) => [d, ...vec(0, 127)];

/** 68 landmark x-positions with the jaw ends at 0 and 100 and the nose at `noseX`. */
const landmarks = (noseX: number) => Array.from({ length: 68 }, (_, i) => ({ x: i === 0 ? 0 : i === 16 ? 100 : i === 30 ? noseX : 50 }));

describe('yawOf / poseOk', () => {
  it('a nose in the middle of the jaw is facing the camera; off to a side is turned, with a sign', () => {
    expect(yawOf(landmarks(50))).toBe(0);
    expect(yawOf(landmarks(65))).toBeCloseTo(0.15);
    expect(yawOf(landmarks(35))).toBeCloseTo(-0.15);
    expect(yawOf([{ x: 5 }, ...Array(15).fill({ x: 5 }), { x: 5 }, ...Array(51).fill({ x: 5 })])).toBe(0); // zero-width jaw is not a crash
  });
  it('the front pose takes a roughly straight face and refuses a clearly turned one', () => {
    expect(poseOk('front', 0)).toBe(true);
    expect(poseOk('front', 0.19)).toBe(true);
    expect(poseOk('front', -0.19)).toBe(true);
    expect(poseOk('front', 0.3)).toBe(false);
  });
  it('a side pose needs a real turn, but not a profile', () => {
    expect(poseOk('left', 0.05)).toBe(false);
    expect(poseOk('left', 0.15)).toBe(true);
    expect(poseOk('left', -0.15)).toBe(true); // either direction: the person decides which way "left" is
    expect(poseOk('left', 0.6)).toBe(false);
  });
  it('the second side pose must be the opposite way to the first', () => {
    expect(poseOk('right', -0.2, 0.15)).toBe(true);
    expect(poseOk('right', 0.2, 0.15)).toBe(false);
    expect(poseOk('right', 0.2, -0.15)).toBe(true);
    expect(poseOk('right', 0.05, 0.15)).toBe(false);
    expect(poseOk('right', 0.2)).toBe(true); // nothing to be opposite to (first side pose was skipped)
  });
  it('asks for three poses, front first', () => {
    expect(POSES.map(p => p.id)).toEqual(['front', 'left', 'right']);
    expect(SAMPLES_PER_POSE).toBeGreaterThanOrEqual(2);
  });
});

describe('templates and matching', () => {
  it('averages captures number by number', () => expect(averageDescriptors([[0, 2], [2, 4]])).toEqual([1, 3]));
  it('scores identical faces 100 and far ones 0, as before', () => {
    expect(matchScore(vec(0.1), vec(0.1))).toBe(100);
    expect(matchScore(vec(0), away(2))).toBe(0);
    expect(matchScore(vec(0), away(0.54))).toBe(70);
  });
  it('lists the front template first, then each side; none when not enrolled', () => {
    expect(faceTemplates({})).toEqual([]);
    expect(faceTemplates({ facePoses: [vec(1)] })).toEqual([]); // side poses without a front are not a usable enrolment
    expect(faceTemplates({ faceEnrolled: vec(0) })).toEqual([vec(0)]);
    expect(faceTemplates({ faceEnrolled: vec(0), facePoses: [vec(1), vec(2)] })).toHaveLength(3);
  });
  it('a face matches the best of the poses on file: a turned head still passes on the side template', () => {
    const front = vec(0), side = away(0.5);
    const fresh = away(0.55); // close to the side pose, far from the front
    expect(bestFaceScore(fresh, { faceEnrolled: front })).toBe(matchScore(fresh, front));
    expect(bestFaceScore(fresh, { faceEnrolled: front, facePoses: [side] })).toBe(matchScore(fresh, side));
    expect(bestFaceScore(fresh, { faceEnrolled: front, facePoses: [side] })!).toBeGreaterThan(bestFaceScore(fresh, { faceEnrolled: front })!);
  });
  it('someone else is still far from every pose', () => {
    expect(bestFaceScore(away(1), { faceEnrolled: vec(0), facePoses: [away(0.2), away(-0.2)] })!).toBeLessThan(60);
  });
  it('nothing enrolled scores null, never 0 or a pass', () => expect(bestFaceScore(vec(0), {})).toBeNull());
});

describe('who has to take the face (again)', () => {
  it('a new person does; an enrolled one does not; an approved re-enrolment does', () => {
    expect(needsEnroll({})).toBe(true);
    expect(needsEnroll({ faceEnrolled: vec(0) })).toBe(false);
    expect(needsEnroll({ faceEnrolled: vec(0), faceReenroll: true })).toBe(true);
  });
  it('only an enrolled person without an approval already waiting can ask', () => {
    expect(faceResetBlock({})).toMatch('ຍັງບໍ່ໄດ້ລົງທະບຽນ');
    expect(faceResetBlock({ faceEnrolled: vec(0), faceReenroll: true })).toMatch('ອະນຸມັດແລ້ວ');
    expect(faceResetBlock({ faceEnrolled: vec(0) })).toBeNull();
  });
});

describe('the re-enrolment request', () => {
  const kl = employees.find(e => e.id === 'e-kl')!;
  const owner = employees.find(e => e.id === 'e-owner')!;
  const head = employees.find(e => e.id === 'e-head')!;
  const req = (employeeId = 'e-kl'): HRRequest<'faceReset'> => ({ id: 'r1', companyId: 'c1', kind: 'faceReset', employeeId, payload: {}, reason: 'ຈ່ອຍລົງ 8 ກິໂລ', createdAt: '2026-11-02T09:00:00', approvals: [], status: 'pending' });
  const NOW = new Date('2026-11-02T10:00:00');

  it('needs nothing but the reason', () => expect(validateRequest('faceReset', {}, '2026-11-02')).toBeNull());
  it('the owner and the head may decide it, the accountant, the auditor and the person themself may not', () => {
    expect(requestBlock(req(), owner, S, NOW)).toBeNull();
    expect(requestBlock(req(), head, S, NOW, kl.dept)).toBeNull();
    for (const id of ['e-acc', 'e-aud']) expect(requestBlock(req(), employees.find(e => e.id === id)!, S, NOW), id).not.toBeNull();
    expect(requestBlock(req(), kl, S, NOW)).not.toBeNull();
    expect(requestBlock(req('e-head'), head, S, NOW)).toMatch('ຕົນເອງ');
  });
  it('a head of another department cannot', () => {
    const kitchenHead = { ...head, dept: 'ຄົວ', headOf: ['ຄົວ'] };
    expect(requestBlock(req(), kitchenHead, S, NOW, 'ຄົວ')).toBeNull();
    expect(requestBlock(req(), kitchenHead, S, NOW, 'ບໍລິຫານ')).toMatch('ນອກຂອບເຂດ');
  });
  it('shows up in its own approvals section for heads and the owner, read-only for the auditor', () => {
    expect(approvalAccess(owner.roles, 'face', S)).toBe('act');
    expect(approvalAccess(head.roles, 'face', S)).toBe('act');
    expect(approvalAccess(employees.find(e => e.id === 'e-aud')!.roles, 'face', S)).toBe('view');
    for (const id of ['e-kl', 'e-acc']) expect(approvalAccess(employees.find(e => e.id === id)!.roles, 'face', S), id).toBe('none');
    // and the device section did not widen
    expect(approvalAccess(head.roles, 'device', S)).toBe('none');
  });
  it('approving it lets the person take the face again but keeps the old face until then, once', async () => {
    const saved: { collection: string; item: any }[] = [];
    const enrolled: Employee = { ...kl, faceEnrolled: vec(0), facePoses: [vec(1)] };
    const hr: any = { me: owner, settings: S, employees: [owner, enrolled], overrides: [], leaves: [], save: async (collection: string, item: any) => { saved.push({ collection, item }); }, notify: async () => {} };
    await decideAndApply(hr, req(), 'approve');
    const emps = saved.filter(s => s.collection === 'employees');
    expect(emps).toHaveLength(1);
    expect(emps[0].item).toMatchObject({ id: 'e-kl', faceReenroll: true });
    expect(emps[0].item.faceEnrolled).toEqual(vec(0)); // still able to clock in with the old face
    expect(emps[0].item.facePoses).toEqual([vec(1)]);
    expect(saved.find(s => s.collection === 'requests')!.item).toMatchObject({ status: 'approved' });
  });
  it('rejecting it changes nothing on the account and needs a reason', async () => {
    const saved: { collection: string }[] = [];
    const hr: any = { me: owner, settings: S, employees: [owner, kl], overrides: [], leaves: [], save: async (collection: string) => { saved.push({ collection }); }, notify: async () => {} };
    await expect(decideAndApply(hr, req(), 'reject')).rejects.toThrow();
    await decideAndApply(hr, req(), 'reject', 'ຍັງຄືເກົ່າ');
    expect(saved.some(s => s.collection === 'employees')).toBe(false);
  });
  it('decideRequest alone approves with one approver (the company default)', () => expect(decideRequest(req(), owner, 'approve', S, NOW).status).toBe('approved'));
});
