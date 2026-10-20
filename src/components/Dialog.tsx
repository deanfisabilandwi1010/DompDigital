import { useEffect, useId, useRef, type ReactNode } from 'react';

interface Props {
  title: string;
  icon?: string;
  description?: ReactNode;
  children: ReactNode;
  onClose: () => void;
  tone?: 'sage' | 'butter' | 'blue' | 'lilac' | 'coral' | 'paper';
  variant?: 'dialog' | 'wide' | 'drawer';
  role?: 'dialog' | 'alertdialog';
  /** Mencegah tutup via Escape saat sedang menyimpan. */
  busy?: boolean;
}

/**
 * Dialog modal berbasis <dialog> native: focus trap & inert latar oleh browser,
 * Escape menutup, fokus dikembalikan ke elemen pemicu.
 */
export function Dialog({ title, icon, description, children, onClose, tone = 'sage', variant = 'dialog', role = 'dialog', busy }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const busyRef = useRef(busy);
  busyRef.current = busy;

  useEffect(() => {
    const el = ref.current!;
    const opener = document.activeElement as HTMLElement | null;
    if (!el.open) el.showModal();
    const target = el.querySelector<HTMLElement>('[data-autofocus]') ?? el.querySelector<HTMLElement>('input, select, textarea, button:not(.dialog-close)');
    target?.focus();
    const onCancel = (e: Event) => {
      e.preventDefault();
      if (!busyRef.current) onCloseRef.current();
    };
    el.addEventListener('cancel', onCancel);
    return () => {
      el.removeEventListener('cancel', onCancel);
      if (el.open) el.close();
      if (opener && document.contains(opener)) opener.focus();
    };
  }, []);

  const cls = variant === 'wide' ? 'dialog dialog--wide' : variant === 'drawer' ? 'dialog drawer' : 'dialog';
  return (
    <dialog ref={ref} className={cls} aria-labelledby={titleId} aria-describedby={description ? descId : undefined} role={role}>
      <div className="window">
        <div className={`window__bar window__bar--${tone}`}>
          {icon && <span className="window__icon" aria-hidden="true">{icon}</span>}
          <h2 className="window__title" id={titleId}>{title}</h2>
          <div className="window__actions">
            <button type="button" className="btn btn--icon dialog-close" onClick={onClose} aria-label="Tutup" disabled={busy}>✕</button>
          </div>
        </div>
        <div className="window__body">
          {description && <p className="dialog__desc" id={descId}>{description}</p>}
          {children}
        </div>
      </div>
    </dialog>
  );
}
