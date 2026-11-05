import { describe, expect, it } from 'vitest';
import { NEEDS_SUPER, withSuperApproval } from './superGate';

const refusal = (what = 'ລຶບຂໍ້ມູນຖາວອນ') => Object.assign(new Error('ຕ້ອງໃຫ້ Super admin ອະນຸມັດ: ' + what), { code: NEEDS_SUPER });

describe('withSuperApproval', () => {
  it('passes a plain success straight through, asking nobody', async () => {
    let asked = 0;
    expect(await withSuperApproval(async () => 7, { ask: async () => { asked++; return 't'; }, runWith: async (_t, f) => f() })).toBe(7);
    expect(asked).toBe(0);
  });
  it('on "needsuper": asks with the reason, then repeats the action with that approval', async () => {
    let tries = 0, reason = '', used = '';
    const out = await withSuperApproval(async () => { tries++; if (tries === 1) throw refusal('ແກ້ເງິນເດືອນ'); return 'done'; }, {
      ask: async r => { reason = r; return 'tok'; },
      runWith: async (t, f) => { used = t; return f(); }
    });
    expect(out).toBe('done');
    expect(tries).toBe(2);
    expect(reason).toBe('ແກ້ເງິນເດືອນ');
    expect(used).toBe('tok');
  });
  it('a cancelled approval stops the action: it is not run again and the caller hears about it', async () => {
    let tries = 0;
    await expect(withSuperApproval(async () => { tries++; throw refusal(); }, { ask: async () => { throw new Error('ຍົກເລີກ'); }, runWith: async (_t, f) => f() })).rejects.toThrow('ຍົກເລີກ');
    expect(tries).toBe(1);
  });
  it('with nobody to ask, the refusal is passed on; other errors always are', async () => {
    await expect(withSuperApproval(async () => { throw refusal(); }, {})).rejects.toThrow('Super admin');
    await expect(withSuperApproval(async () => { throw new Error('ບໍ່ມີສິດ'); }, { ask: async () => 't', runWith: async (_t, f) => f() })).rejects.toThrow('ບໍ່ມີສິດ');
  });
  it('if it is refused again even with the approval, that refusal surfaces (no endless asking)', async () => {
    let asked = 0;
    await expect(withSuperApproval(async () => { throw refusal(); }, { ask: async () => { asked++; return 't'; }, runWith: async (_t, f) => f() })).rejects.toThrow('Super admin');
    expect(asked).toBe(1);
  });
});
