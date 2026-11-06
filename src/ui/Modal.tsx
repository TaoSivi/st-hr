import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * The one pop-up window for every edit form: a title, a body that scrolls, and a footer with the buttons that always stays in view
 * (so Save is never off-screen below a long form). On a phone it slides up from the bottom as a sheet.
 * Clicking outside does not close it (typed data would be lost by accident); the ✕ button and the Esc key do.
 */
export default function Modal({ title, onClose, footer, children, width = 560, busy = false }: {
  title: ReactNode;
  onClose: () => void;
  footer?: ReactNode;
  children: ReactNode;
  width?: number;
  busy?: boolean;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) closeRef.current(); };
    document.addEventListener('keydown', onKey);
    const before = document.body.style.overflow;
    document.body.style.overflow = 'hidden'; // the page behind does not scroll
    const opener = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = before; opener?.focus?.(); };
  }, [busy]);

  return createPortal(
    <div className="modal-back" role="presentation">
      <div className="modal" ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined} style={{ maxWidth: width }}>
        <div className="modal-head">
          <h2 className="grow">{title}</h2>
          <button className="icon-btn dark modal-x" aria-label="ປິດ" disabled={busy} onClick={onClose}>✕</button>
        </div>
        <div className="modal-body col">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body
  );
}
