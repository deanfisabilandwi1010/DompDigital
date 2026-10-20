// Klien tipis untuk Nhost Auth (REST). Sesi disimpan di localStorage agar beberapa tab berbagi
// satu sesi; pembaruan token diserialkan dengan Web Locks bila tersedia (refresh token sekali pakai).

import { NHOST } from './config';

export interface NhostUser {
  id: string;
  email: string;
  displayName: string;
  emailVerified: boolean;
}

interface StoredSession {
  accessToken: string;
  /** epoch ms */
  expiresAt: number;
  refreshToken: string;
  user: NhostUser;
}

interface RawSession {
  accessToken: string;
  accessTokenExpiresIn: number;
  refreshToken: string;
  user: { id: string; email: string; displayName: string; emailVerified: boolean };
}

const KEY = 'kantong.nhost.session';

export class AuthError extends Error {
  constructor(message: string, public code?: string) {
    super(message);
    this.name = 'AuthError';
  }
}

function readStored(): StoredSession | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as StoredSession) : null;
  } catch {
    return null;
  }
}

function writeStored(s: StoredSession | null) {
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s));
    else localStorage.removeItem(KEY);
  } catch {
    /* penyimpanan diblokir: sesi hanya bertahan di memori */
  }
}

function toStored(r: RawSession): StoredSession {
  return {
    accessToken: r.accessToken,
    expiresAt: Date.now() + r.accessTokenExpiresIn * 1000,
    refreshToken: r.refreshToken,
    user: { id: r.user.id, email: r.user.email, displayName: r.user.displayName ?? '', emailVerified: !!r.user.emailVerified },
  };
}

const MESSAGES: Record<string, string> = {
  'invalid-email-password': 'Email atau kata sandi salah.',
  'unverified-user': 'Email belum diverifikasi. Buka tautan verifikasi di kotak masuk Anda.',
  'email-already-in-use': 'Email ini sudah terdaftar. Silakan masuk.',
  'password-too-short': 'Kata sandi terlalu pendek.',
  'password-in-hibp-database': 'Kata sandi ini pernah bocor di internet. Pilih kata sandi lain.',
  'disabled-user': 'Akun dinonaktifkan.',
  'user-not-found': 'Akun tidak ditemukan.',
  'invalid-request': 'Permintaan tidak valid.',
  'signup-disabled': 'Pendaftaran akun baru dinonaktifkan di proyek Nhost ini.',
  'too-many-requests': 'Terlalu banyak percobaan. Tunggu sebentar.',
};

async function post<T>(path: string, body: unknown, token?: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${NHOST.authUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });
  } catch {
    throw new AuthError('Tidak dapat menghubungi server. Periksa koneksi internet.', 'network');
  }
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const code = json.error as string | undefined;
    throw new AuthError((code && MESSAGES[code]) || json.message || `Gagal (${res.status}).`, code);
  }
  return json as T;
}

type Listener = (user: NhostUser | null) => void;

class NhostAuth {
  private session: StoredSession | null = readStored();
  private listeners = new Set<Listener>();
  private timer: number | undefined;

  constructor() {
    window.addEventListener('storage', (e) => {
      if (e.key !== KEY) return;
      const before = this.session?.user.id ?? null;
      this.session = readStored();
      if ((this.session?.user.id ?? null) !== before) this.emit();
    });
  }

  get user(): NhostUser | null {
    return this.session?.user ?? null;
  }

  onChange(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const fn of this.listeners) fn(this.user);
  }

  private set(s: StoredSession | null) {
    this.session = s;
    writeStored(s);
    this.schedule();
    this.emit();
  }

  private schedule() {
    window.clearTimeout(this.timer);
    if (!this.session) return;
    const ms = Math.max(5_000, this.session.expiresAt - Date.now() - 60_000);
    this.timer = window.setTimeout(() => void this.getAccessToken().catch(() => undefined), ms);
  }

  /** Memulihkan sesi saat aplikasi dibuka. */
  async init(): Promise<NhostUser | null> {
    if (!this.session) return null;
    try {
      await this.getAccessToken();
    } catch (e) {
      if (e instanceof AuthError && e.code !== 'network') this.set(null);
      else throw e;
    }
    return this.user;
  }

  async signIn(email: string, password: string): Promise<NhostUser> {
    const r = await post<{ session: RawSession | null; mfa: unknown }>('/signin/email-password', { email, password });
    if (!r.session) throw new AuthError('Akun ini memerlukan verifikasi tambahan (MFA) yang belum didukung.');
    this.set(toStored(r.session));
    return this.user!;
  }

  /** Mengembalikan null bila proyek mewajibkan verifikasi email sebelum masuk. */
  async signUp(email: string, password: string, displayName: string): Promise<NhostUser | null> {
    const r = await post<{ session: RawSession | null }>('/signup/email-password', {
      email,
      password,
      options: displayName ? { displayName } : {},
    });
    if (!r.session) return null;
    this.set(toStored(r.session));
    return this.user;
  }

  async signOut(): Promise<void> {
    const s = this.session;
    this.set(null);
    if (s) await post('/signout', { refreshToken: s.refreshToken }, s.accessToken).catch(() => undefined);
  }

  async resetPassword(email: string): Promise<void> {
    await post('/user/password/reset', { email });
  }

  /** Token akses yang masih berlaku ≥ 60 detik; diperbarui bila perlu (sekali untuk semua tab). */
  async getAccessToken(force = false): Promise<string> {
    const valid = (s: StoredSession | null) => !!s && s.expiresAt - Date.now() > 60_000;
    if (!force && valid(this.session)) return this.session!.accessToken;
    const run = async () => {
      const latest = readStored() ?? this.session;
      if (!force && valid(latest)) {
        this.session = latest;
        this.schedule();
        return latest!.accessToken;
      }
      if (!latest) throw new AuthError('Sesi berakhir. Silakan masuk lagi.', 'no-session');
      const r = await post<RawSession>('/token', { refreshToken: latest.refreshToken });
      this.set(toStored(r));
      return r.accessToken;
    };
    const locks = (navigator as Navigator & { locks?: LockManager }).locks;
    return locks ? locks.request('kantong-auth-refresh', run) : run();
  }
}

export const auth = new NhostAuth();
