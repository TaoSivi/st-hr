const KEY = 'sthr-device';
let memory = '';

/**
 * A random id for this browser / phone, created once and kept. It is not a secret and not proof of identity:
 * it only lets the system notice that an account is being used from a different phone than before.
 * Clearing the browser's data makes a new id, which is exactly a "new phone" for the system.
 */
export function getDeviceId(): string {
  try {
    let id = localStorage.getItem(KEY);
    if (!id) {
      id = 'd-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    // private mode: stable for this tab only, so the account looks like it moved phones on the next visit and goes to review (the safe direction)
    return memory || (memory = 'd-' + Math.random().toString(36).slice(2, 10));
  }
}

/** A short, human description to show the approver ("Android · Chrome"). */
export function deviceLabel(): string {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const os = /Android/i.test(ua) ? 'Android' : /iPhone|iPad/i.test(ua) ? 'iOS' : /Windows/i.test(ua) ? 'Windows' : /Mac/i.test(ua) ? 'Mac' : 'ອື່ນໆ';
  const br = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : /Firefox\//.test(ua) ? 'Firefox' : '';
  return [os, br].filter(Boolean).join(' · ');
}
