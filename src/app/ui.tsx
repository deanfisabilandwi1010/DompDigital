// Penyedia UI global: toast (aria-live) dan dialog konfirmasi berbasis promise.
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { Dialog } from '../components/Dialog';

type Tone = 'success' | 'error' | 'info';
interface ToastItem {
  id: number;
  text: string;
  tone: Tone;
  action?: { label: string; run: () => void };
}

interface ConfirmOptions {
  title: string;
  body: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

interface UiApi {
  toast: (text: string, tone?: Tone, action?: ToastItem['action']) => void;
  confirm: (o: ConfirmOptions) => Promise<boolean>;
}

const UiCtx = createContext<UiApi | null>(null);

export function useUi(): UiApi {
  const v = useContext(UiCtx);
  if (!v) throw new Error('UiProvider hilang');
  return v;
}

export function UiProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [pending, setPending] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null);
  const seq = useRef(0);

  const dismiss = (id: number) => setToasts((t) => t.filter((x) => x.id !== id));
  const toast = useCallback<UiApi['toast']>((text, tone = 'success', action) => {
    const id = ++seq.current;
    setToasts((t) => [...t.slice(-2), { id, text, tone, action }]);
    window.setTimeout(() => dismiss(id), tone === 'error' ? 8000 : action ? 7000 : 4000);
  }, []);

  const confirm = useCallback<UiApi['confirm']>((o) => new Promise<boolean>((resolve) => setPending({ ...o, resolve })), []);
  const close = (v: boolean) => {
    pending?.resolve(v);
    setPending(null);
  };

  return (
    <UiCtx.Provider value={{ toast, confirm }}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast--${t.tone}`}>
            <span className="toast__icon" aria-hidden="true">{t.tone === 'error' ? '!' : t.tone === 'success' ? '✓' : 'i'}</span>
            <span>{t.text}</span>
            {t.action && (
              <button
                className="btn btn--sm"
                onClick={() => {
                  dismiss(t.id);
                  t.action!.run();
                }}
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
      {pending && (
        <Dialog title={pending.title} icon={pending.danger ? '⚠️' : '❔'} onClose={() => close(false)} tone={pending.danger ? 'coral' : 'butter'} role="alertdialog">
          <div className="stack">
            <div>{pending.body}</div>
            <div className="form-actions">
              <button className="btn" onClick={() => close(false)}>{pending.cancelLabel ?? 'Batal'}</button>
              <button className={`btn ${pending.danger ? 'btn--danger' : 'btn--primary'}`} onClick={() => close(true)} data-autofocus>
                {pending.confirmLabel ?? 'Lanjutkan'}
              </button>
            </div>
          </div>
        </Dialog>
      )}
    </UiCtx.Provider>
  );
}
