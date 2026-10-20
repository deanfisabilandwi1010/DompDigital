import type { Behavior, Category, CategoryKind, Priority } from './types';

export const PALETTE = {
  paper: '#F6F0DF',
  surface: '#FFFCF3',
  ink: '#263B32',
  green: '#365B47',
  sage: '#B9CBA7',
  butter: '#F4D77A',
  coral: '#D87863',
  blue: '#9CBCC7',
  lilac: '#C5B8D9',
  danger: '#A43137',
} as const;

/** Warna isian (latar) yang boleh dipilih untuk kategori/kantong — bukan untuk teks. */
export const SWATCHES = ['#B9CBA7', '#F4D77A', '#D87863', '#9CBCC7', '#C5B8D9', '#E8C9A0', '#A9C9B4', '#E3B5B0'];

type Seed = [name: string, kind: CategoryKind, grp: string, icon: string, prio: Priority | null, beh: Behavior | null, systemKey?: string];

const SEEDS: Seed[] = [
  ['Gaji', 'income', 'Pemasukan', '💼', null, null],
  ['Honorarium', 'income', 'Pemasukan', '🧾', null, null],
  ['Usaha/freelance', 'income', 'Pemasukan', '🛠️', null, null],
  ['Hadiah', 'income', 'Pemasukan', '🎁', null, null],
  ['Pemasukan lain', 'income', 'Pemasukan', '➕', null, null],
  ['Makan & minum', 'expense', 'Kebutuhan', '🍜', 'need', 'variable'],
  ['Belanja rumah', 'expense', 'Kebutuhan', '🧺', 'need', 'variable'],
  ['Transportasi', 'expense', 'Kebutuhan', '🚌', 'need', 'variable'],
  ['Listrik/air/internet', 'expense', 'Kebutuhan', '💡', 'need', 'fixed'],
  ['Kesehatan', 'expense', 'Kebutuhan', '🩺', 'need', 'variable'],
  ['Pendidikan', 'expense', 'Kebutuhan', '📚', 'need', 'fixed'],
  ['Hiburan', 'expense', 'Gaya hidup', '🎬', 'want', 'variable'],
  ['Belanja pribadi', 'expense', 'Gaya hidup', '🛍️', 'want', 'variable'],
  ['Langganan digital', 'expense', 'Gaya hidup', '📺', 'want', 'fixed'],
  ['Liburan', 'expense', 'Gaya hidup', '🏝️', 'want', 'variable'],
  ['Olahraga/hobi', 'expense', 'Gaya hidup', '🏸', 'want', 'variable'],
  ['Keluarga', 'expense', 'Komitmen', '👪', 'need', 'fixed'],
  ['Donasi/sosial', 'expense', 'Komitmen', '🤝', 'need', 'variable'],
  ['Biaya administrasi', 'expense', 'Komitmen', '🏦', 'need', 'variable', 'admin_fee'],
  ['Pengeluaran lain', 'expense', 'Lainnya', '📦', null, null],
];

const GROUP_COLOR: Record<string, string> = {
  Pemasukan: PALETTE.sage,
  Kebutuhan: PALETTE.blue,
  'Gaya hidup': PALETTE.lilac,
  Komitmen: PALETTE.butter,
  Lainnya: '#E8C9A0',
};

/** createdAt dibedakan per milidetik agar urutan bawaan tetap stabil saat diurutkan. */
export function defaultCategories(now: string): Category[] {
  const t0 = Date.parse(now);
  return SEEDS.map(([name, kind, grp, icon, prio, beh, systemKey], i) => ({
    id: crypto.randomUUID(),
    name,
    kind,
    grp,
    icon,
    color: GROUP_COLOR[grp],
    defaultPriority: prio,
    defaultBehavior: beh,
    systemKey: systemKey ?? null,
    archivedAt: null,
    version: 1,
    createdAt: new Date(t0 + i).toISOString(),
    updatedAt: now,
  }));
}

export function adminFeeCategorySeed(now: string): Category {
  return defaultCategories(now).find((c) => c.systemKey === 'admin_fee')!;
}

export const CATEGORY_GROUPS = ['Pemasukan', 'Kebutuhan', 'Gaya hidup', 'Komitmen', 'Lainnya'];

export const POCKET_SUGGESTIONS: { name: string; icon: string; color: string }[] = [
  { name: 'Harian', icon: '☕', color: PALETTE.butter },
  { name: 'Tagihan', icon: '🧾', color: PALETTE.blue },
  { name: 'Dana darurat', icon: '🛟', color: PALETTE.coral },
  { name: 'Pendidikan', icon: '🎓', color: PALETTE.lilac },
  { name: 'Liburan', icon: '🏝️', color: PALETTE.sage },
];

export const ACCOUNT_TYPE_LABEL = { cash: 'Tunai', bank: 'Bank', ewallet: 'E-wallet' } as const;
export const ACCOUNT_TYPE_ICON = { cash: '💵', bank: '🏦', ewallet: '📱' } as const;
export const TX_TYPE_LABEL = { income: 'Pemasukan', expense: 'Pengeluaran', transfer: 'Transfer', refund: 'Pengembalian dana' } as const;
export const PRIORITY_LABEL = { need: 'Kebutuhan', want: 'Keinginan', none: 'Belum ditandai' } as const;
export const BEHAVIOR_LABEL = { fixed: 'Tetap', variable: 'Variabel', none: 'Belum ditandai' } as const;
export const FREQ_LABEL = { weekly: 'Mingguan', monthly: 'Bulanan', yearly: 'Tahunan' } as const;
