import { describe, expect, it } from 'vitest';
import { branchDeleteBlock, validateBranch } from './branches';

const existing = [{ id: 'b1', name: 'ສາຂາໜ້າຮ້ານ' }];
const ok = { id: 'new', name: 'ສາຂາໃໝ່', lat: 17.97, lng: 102.63, radiusM: 100 };

describe('validateBranch', () => {
  it('accepts a sound branch', () => expect(validateBranch(ok, existing)).toEqual([]));
  it('needs a name, and not one already used (any letter case, extra spaces)', () => {
    expect(validateBranch({ ...ok, name: '  ' }, existing).join()).toMatch('ຊື່');
    expect(validateBranch({ ...ok, name: ' ສາຂາໜ້າຮ້ານ ' }, existing).join()).toMatch('ແລ້ວ');
    expect(validateBranch({ ...ok, name: 'Main' }, [{ id: 'x', name: 'main' }]).join()).toMatch('ແລ້ວ');
  });
  it('a branch may keep its own name when edited', () => expect(validateBranch({ ...ok, id: 'b1', name: 'ສາຂາໜ້າຮ້ານ' }, existing)).toEqual([]));
  it('latitude and longitude must be real coordinates; NaN is refused', () => {
    for (const lat of [91, -91, NaN, Infinity]) expect(validateBranch({ ...ok, lat }, existing).join(), String(lat)).toMatch('ລະຕິຈູດ');
    for (const lng of [181, -181, NaN]) expect(validateBranch({ ...ok, lng }, existing).join(), String(lng)).toMatch('ລອງຈິຈູດ');
    expect(validateBranch({ ...ok, lat: 90, lng: -180 }, existing)).toEqual([]); // the edges are valid
  });
  it('refuses 0,0, the signature of a failed GPS read', () => expect(validateBranch({ ...ok, lat: 0, lng: 0 }, existing).join()).toMatch('0,0'));
  it('radius is a whole number of metres from 10 to 2000', () => {
    for (const radiusM of [9, 2001, 50.5, NaN, 0]) expect(validateBranch({ ...ok, radiusM }, existing).join(), String(radiusM)).toMatch('ລັດສະໝີ');
    for (const radiusM of [10, 2000]) expect(validateBranch({ ...ok, radiusM }, existing)).toEqual([]);
  });
});

describe('deleting a branch', () => {
  const b = { id: 'b2' }, main = { id: 'b1' };
  const ctx = (over: Partial<Parameters<typeof branchDeleteBlock>[1]> = {}) => ({ branches: [main, b], employees: [{ homeBranchId: 'b1' }], scans: [{ branchId: 'b1' }], ...over });
  it('an unused branch can go', () => expect(branchDeleteBlock(b, ctx())).toBeNull());
  it('not while someone has it as their branch, and not once it holds scan history', () => {
    expect(branchDeleteBlock(b, ctx({ employees: [{ homeBranchId: 'b2' }] }))).toMatch('ມີ 1 ຄົນ');
    expect(branchDeleteBlock(b, ctx({ scans: [{ branchId: 'b2' }, { branchId: 'b2' }] }))).toMatch('ມີການລົງເວລາ 2');
  });
  it('the last branch stays', () => expect(branchDeleteBlock(b, ctx({ branches: [b] }))).toMatch('ຢ່າງໜ້ອຍ 1 ສາຂາ'));
});
