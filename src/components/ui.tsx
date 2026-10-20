import { useId, type ReactNode } from 'react';
import { useStore } from '../app/store';
import { groupDigits } from '../domain/money';
import type { Money } from '../domain/types';

export function RetroWindow({
  title,
  icon,
  tone = 'sage',
  actions,
  children,
  flush,
  className = '',
  id,
}: {
  title: string;
  icon?: string;
  tone?: 'sage' | 'butter' | 'blue' | 'lilac' | 'coral' | 'paper';
  actions?: ReactNode;
  children: ReactNode;
  flush?: boolean;
  className?: string;
  id?: string;
}) {
  const hid = useId();
  return (
    <section className={`window ${className}`} aria-labelledby={hid} id={id}>
      <div className={`window__bar window__bar--${tone}`}>
        {/* Titik dekoratif: bukan tombol */}
        <span className="window__dots" aria-hidden="true"><span /><span /></span>
        {icon && <span className="window__icon" aria-hidden="true">{icon}</span>}
        <h2 className="window__title" id={hid}>{title}</h2>
        {actions && <div className="window__actions">{actions}</div>}
      </div>
      <div className={`window__body ${flush ? 'window__body--flush' : ''}`}>{children}</div>
    </section>
  );
}

/** Nominal yang menghormati mode sembunyikan; label aksesibel ikut tersamar. */
export function Amount({ value, sign, className = '', colored }: { value: Money; sign?: boolean; className?: string; colored?: boolean }) {
  const { fmt, hidden } = useStore();
  const text = fmt(value, { sign });
  return (
    <span className={`amount ${colored && value < 0 && !hidden ? 'neg' : ''} ${className}`} aria-label={hidden ? 'Nominal disembunyikan' : undefined}>
      {text}
    </span>
  );
}

export function MoneyCard({
  label,
  value,
  sub,
  tone,
  onClick,
  href,
  sign,
}: {
  label: string;
  value: Money;
  sub?: ReactNode;
  tone?: 'butter' | 'sage' | 'coral' | 'blue' | 'lilac';
  onClick?: () => void;
  href?: string;
  sign?: boolean;
}) {
  const cls = `money-card ${tone ? `money-card--${tone}` : ''}`;
  const inner = (
    <>
      <span className="money-card__label">{label}</span>
      <span className="money-card__value"><Amount value={value} sign={sign} colored /></span>
      {sub && <span className="money-card__sub">{sub}</span>}
    </>
  );
  if (href) return <a className={cls} href={href}>{inner}</a>;
  if (onClick) return <button type="button" className={cls} onClick={onClick}>{inner}</button>;
  return <div className={cls}>{inner}</div>;
}

export function Field({ label, error, hint, children, className = '', htmlFor }: { label: string; error?: string; hint?: ReactNode; children: ReactNode; className?: string; htmlFor?: string }) {
  return (
    <div className={`field ${className}`}>
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && !error && <span className="field__hint">{hint}</span>}
      {error && <span className="field__error" role="alert">⚠ {error}</span>}
    </div>
  );
}

/** Input nominal: inputmode numeric, pemisah ribuan saat tampil; nilai disimpan sebagai string digit. */
export function AmountInput({
  id,
  value,
  onChange,
  invalid,
  describedBy,
  autoFocus,
  allowNegative,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  invalid?: boolean;
  describedBy?: string;
  autoFocus?: boolean;
  allowNegative?: boolean;
}) {
  return (
    <div className="amount-input">
      <span className="amount-input__prefix" aria-hidden="true">Rp</span>
      <input
        id={id}
        className="input input--amount"
        inputMode="numeric"
        autoComplete="off"
        placeholder="0"
        value={value}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        data-autofocus={autoFocus || undefined}
        onChange={(e) => onChange(formatAmountTyping(e.target.value, allowNegative))}
      />
    </div>
  );
}

export function formatAmountTyping(raw: string, allowNegative = false): string {
  const neg = allowNegative && raw.trim().startsWith('-');
  const digits = raw.replace(/[^\d]/g, '').replace(/^0+(?=\d)/, '').slice(0, 16);
  if (!digits) return neg ? '-' : '';
  // Kelompokkan string digit langsung, tanpa konversi Number (hindari pembulatan angka besar).
  return (neg ? '-' : '') + digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

export function amountToInput(n: Money | null | undefined): string {
  return n == null ? '' : (n < 0 ? '-' : '') + groupDigits(n);
}

const ART = {
  mascot: 'kantong-mascot',
  jar: 'tabungan-jar',
  crt: 'laporan-crt',
} as const;

/** Ilustrasi dekoratif (alt kosong), dimensi eksplisit, WebP dengan cadangan PNG. */
export function Illustration({ name, size = 120, className = '' }: { name: keyof typeof ART; size?: number; className?: string }) {
  const base = `${import.meta.env.BASE_URL}assets/retro/${ART[name]}`;
  return (
    <picture>
      <source srcSet={`${base}.webp`} type="image/webp" />
      <img src={`${base}.png`} width={size} height={size} alt="" loading="lazy" decoding="async" className={className} />
    </picture>
  );
}

export function EmptyState({ art = 'mascot', title, children, action }: { art?: keyof typeof ART; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <Illustration name={art} size={112} />
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function Meter({ pct, tone, label }: { pct: number; tone?: 'warn' | 'over' | 'lilac'; label: string }) {
  const w = Math.max(0, Math.min(100, pct));
  return (
    <div className="meter" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(w)} aria-label={label}>
      <div className={`meter__fill ${tone ? `meter__fill--${tone}` : ''}`} style={{ width: `${w}%` }} />
    </div>
  );
}

export function PrivacyToggle() {
  const { ds, run, hidden } = useStore();
  return (
    <button
      type="button"
      className="btn btn--icon"
      aria-pressed={hidden}
      aria-label={hidden ? 'Tampilkan nominal' : 'Sembunyikan nominal'}
      title={hidden ? 'Tampilkan nominal' : 'Sembunyikan nominal'}
      onClick={() => void run(() => [{ table: 'settings', op: 'put', row: { ...ds.settings, hideAmounts: !hidden, version: ds.settings.version + 1 } }], { allowDeficit: true })}
    >
      {hidden ? '🙈' : '👁️'}
    </button>
  );
}

export function BrandMark({ size = 36 }: { size?: number }) {
  return (
    <svg className="brand__mark" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect x="3" y="7" width="26" height="20" rx="5" fill="#B9CBA7" stroke="#263B32" strokeWidth="2.2" />
      <path d="M6 7.5 L22 4 L24 7" fill="none" stroke="#263B32" strokeWidth="2.2" strokeLinejoin="round" />
      <rect x="18" y="13" width="11" height="8" rx="3" fill="#F4D77A" stroke="#263B32" strokeWidth="2.2" />
      <circle cx="22.5" cy="17" r="1.6" fill="#263B32" />
    </svg>
  );
}
