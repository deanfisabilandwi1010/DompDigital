// Model data Kantong. Semua nilai uang adalah integer Rupiah (Money).
// Tanggal transaksi adalah tanggal lokal 'YYYY-MM-DD'; timestamp (…At) adalah ISO UTC.

export type ID = string;
export type Money = number;
export type LocalDate = string;
export type IsoTime = string;
export type RecordStatus = 'active' | 'voided';

export type AccountType = 'cash' | 'bank' | 'ewallet';
export type CategoryKind = 'income' | 'expense';
export type Priority = 'need' | 'want';
export type Behavior = 'fixed' | 'variable';
export type TxType = 'income' | 'expense' | 'transfer' | 'refund';

/** Kolom bersama untuk record yang dapat diubah: versi dipakai untuk mendeteksi edit basi dari tab lain. */
interface Versioned {
  id: ID;
  version: number;
  createdAt: IsoTime;
  updatedAt: IsoTime;
}

export interface Settings {
  displayName: string;
  timezone: string;
  reducedMotion: boolean;
  hideAmounts: boolean;
  budgetWarnPct: number;
  lastBackupAt: IsoTime | null;
  onboardedAt: IsoTime | null;
  version: number;
}

export interface Account extends Versioned {
  name: string;
  type: AccountType;
  openingBalance: Money;
  openingDate: LocalDate;
  archivedAt: IsoTime | null;
}

export interface Category extends Versioned {
  name: string;
  kind: CategoryKind;
  grp: string;
  icon: string;
  color: string;
  defaultPriority: Priority | null;
  defaultBehavior: Behavior | null;
  /** 'admin_fee' menandai kategori biaya transfer. */
  systemKey: string | null;
  archivedAt: IsoTime | null;
}

export interface Pocket extends Versioned {
  name: string;
  icon: string;
  color: string;
  archivedAt: IsoTime | null;
}

export interface Transaction extends Versioned {
  type: TxType;
  date: LocalDate;
  amount: Money;
  accountId: ID;
  destinationAccountId: ID | null;
  categoryId: ID | null;
  pocketId: ID | null;
  originalExpenseId: ID | null;
  groupId: ID | null;
  note: string;
  tags: string[];
  priority: Priority | null;
  behavior: Behavior | null;
  status: RecordStatus;
}

/** null pada fromPocketId/toPocketId berarti "dana belum dialokasikan". */
export interface Allocation extends Versioned {
  date: LocalDate;
  fromPocketId: ID | null;
  toPocketId: ID | null;
  amount: Money;
  note: string;
  status: RecordStatus;
}

export interface Adjustment extends Versioned {
  accountId: ID;
  date: LocalDate;
  signedAmount: Money;
  reason: string;
  status: RecordStatus;
}

export interface Budget extends Versioned {
  month: string; // YYYY-MM
  categoryId: ID;
  limitAmount: Money;
}

export interface Goal extends Versioned {
  pocketId: ID;
  name: string;
  targetAmount: Money;
  deadline: LocalDate | null;
  icon: string;
  color: string;
  celebrationShownAt: IsoTime | null;
}

export type ReminderKind = 'income' | 'bill';
export type Frequency = 'weekly' | 'monthly' | 'yearly';

export interface Reminder extends Versioned {
  name: string;
  kind: ReminderKind;
  frequency: Frequency;
  anchorDate: LocalDate;
  amount: Money;
  accountId: ID;
  categoryId: ID;
  pocketId: ID | null;
  active: boolean;
}

export type OccurrenceStatus = 'recorded' | 'skipped' | 'open';

export interface Occurrence extends Versioned {
  reminderId: ID;
  dueDate: LocalDate;
  linkedTransactionId: ID | null;
  status: OccurrenceStatus;
}

export interface AuditEvent {
  id: ID;
  entityType: string;
  entityId: ID;
  action: 'create' | 'update' | 'void' | 'unvoid' | 'archive' | 'unarchive' | 'delete';
  before: unknown;
  after: unknown;
  createdAt: IsoTime;
}

export interface Dataset {
  settings: Settings;
  accounts: Account[];
  categories: Category[];
  pockets: Pocket[];
  transactions: Transaction[];
  allocations: Allocation[];
  adjustments: Adjustment[];
  budgets: Budget[];
  goals: Goal[];
  reminders: Reminder[];
  occurrences: Occurrence[];
  auditEvents: AuditEvent[];
}

export type TableKey = Exclude<keyof Dataset, 'settings'>;

export const TABLE_KEYS: TableKey[] = [
  'accounts',
  'categories',
  'pockets',
  'transactions',
  'adjustments',
  'allocations',
  'budgets',
  'goals',
  'reminders',
  'occurrences',
  'auditEvents',
];

export type RowOf<T extends TableKey> = Dataset[T][number];

export type PutRow = { id: ID } & Record<string, unknown>;

export type Change =
  | { table: TableKey; op: 'put'; row: PutRow }
  | { table: TableKey; op: 'delete'; id: ID }
  | { table: 'settings'; op: 'put'; row: Settings };

export function emptySettings(): Settings {
  return {
    displayName: '',
    timezone: 'Asia/Jakarta',
    reducedMotion: false,
    hideAmounts: false,
    budgetWarnPct: 80,
    lastBackupAt: null,
    onboardedAt: null,
    version: 0,
  };
}

export function emptyDataset(): Dataset {
  return {
    settings: emptySettings(),
    accounts: [],
    categories: [],
    pockets: [],
    transactions: [],
    allocations: [],
    adjustments: [],
    budgets: [],
    goals: [],
    reminders: [],
    occurrences: [],
    auditEvents: [],
  };
}

export class DomainError extends Error {
  constructor(message: string, public field?: string) {
    super(message);
    this.name = 'DomainError';
  }
}
