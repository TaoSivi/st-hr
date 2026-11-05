/**
 * Some actions of an Admin need the Super admin's PIN behind them (deleting for good, changing pay, closing a payroll month, editing a clock-in after the fact).
 * The database refuses with code "needsuper"; this asks the Super admin for the PIN and repeats the action with that approval attached.
 * With nobody to ask (a company that has no Super admin, or a demo), the refusal is simply passed on.
 */
export const NEEDS_SUPER = 'needsuper';

export interface SuperApproval {
  /** Opens the PIN screen, resolves with the approval, rejects when the Super admin cancels. */
  ask?: (reason: string) => Promise<string>;
  /** Runs something with that approval attached to every write it makes. */
  runWith?: <R>(approval: string, run: () => Promise<R>) => Promise<R>;
}

export async function withSuperApproval<T>(run: () => Promise<T>, a: SuperApproval): Promise<T> {
  try {
    return await run();
  } catch (e: any) {
    if (e?.code !== NEEDS_SUPER || !a.ask || !a.runWith) throw e;
    const approval = await a.ask(String(e.message ?? '').replace(/^[^:]*:\s*/, '') || 'ການກະທຳນີ້');
    return a.runWith(approval, run);
  }
}
