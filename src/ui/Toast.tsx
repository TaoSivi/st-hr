import { useEffect, useState } from 'react';

/** A short "done" note after something the person did was saved. One place, so every screen gets it. */
interface Item { id: number; text: string }
let items: Item[] = [];
let seq = 0;
const listeners = new Set<(i: Item[]) => void>();
const emit = () => listeners.forEach(f => f(items));

export function toast(text: string) {
  const it = { id: ++seq, text };
  items = [...items, it].slice(-3);
  emit();
  setTimeout(() => { items = items.filter(x => x !== it); emit(); }, 2400);
}

/** What to say after a save, or null when it was not the person's own action (clock-ins have their own result screen). */
export function savedText(collection: string, action: string, kind: 'save' | 'remove' = 'save'): string | null {
  if (collection === 'notifications' || /^(clock-|device-bind|notify|sync|photo-purge|missed|notification-read|system)/.test(action)) return null;
  if (kind === 'remove' || /delete/.test(action)) return 'ລຶບແລ້ວ';
  if (/-reject/.test(action)) return 'ບໍ່ອະນຸມັດແລ້ວ';
  if (/-approve/.test(action)) return 'ອະນຸມັດແລ້ວ';
  if (/request$/.test(action)) return 'ສົ່ງຄຳຂໍແລ້ວ';
  return 'ບັນທຶກແລ້ວ';
}

export default function ToastHost() {
  const [list, setList] = useState<Item[]>(items);
  useEffect(() => { listeners.add(setList); return () => { listeners.delete(setList); }; }, []);
  if (!list.length) return null;
  return (
    <div className="toasts" role="status" aria-live="polite">
      {list.map(t => (
        <div key={t.id} className="toast">
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><circle cx="12" cy="12" r="10" className="toast-ring" /><path d="M7 12.5l3.2 3.2L17 9" className="toast-tick" /></svg>
          <span>{t.text}</span>
        </div>
      ))}
    </div>
  );
}
