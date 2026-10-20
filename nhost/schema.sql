-- Kantong — schema Postgres untuk Nhost (Hasura). Versi schema: 1
-- Idempoten: aman dijalankan ulang. Diterapkan oleh `npm run setup:nhost`.
--
-- Prinsip:
--  * Setiap baris milik satu pengguna (user_id → auth.users). Isolasi ditegakkan permission Hasura
--    dan foreign key komposit (user_id, id) agar relasi tidak bisa menunjuk data pengguna lain.
--  * Nilai uang = bigint Rupiah, dibatasi safe integer JavaScript.
--  * Saldo TIDAK disimpan; dihitung dari record sumber.
--  * FK deferrable agar restore (hapus semua + sisipkan ulang) bisa berjalan dalam satu transaksi.
--  * Kolom version + trigger menolak edit basi dari tab/perangkat lain.
--  * Trigger alokasi mengunci per pengguna lalu memeriksa dana tersedia (anti race condition).

create table if not exists public.settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 40),
  timezone text not null default 'Asia/Jakarta',
  reduced_motion boolean not null default false,
  hide_amounts boolean not null default false,
  budget_warn_pct integer not null default 80 check (budget_warn_pct between 50 and 100),
  last_backup_at timestamptz,
  onboarded_at timestamptz,
  version integer not null default 1
);

create table if not exists public.accounts (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  type text not null check (type in ('cash', 'bank', 'ewallet')),
  opening_balance bigint not null check (opening_balance between 0 and 9007199254740991),
  opening_date date not null,
  archived_at timestamptz,
  version integer not null check (version > 0),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  unique (user_id, id)
);

create table if not exists public.categories (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  kind text not null check (kind in ('income', 'expense')),
  grp text not null default 'Lainnya',
  icon text not null default '',
  color text not null default '',
  default_priority text check (default_priority in ('need', 'want')),
  default_behavior text check (default_behavior in ('fixed', 'variable')),
  system_key text,
  archived_at timestamptz,
  version integer not null check (version > 0),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  unique (user_id, id)
);

create table if not exists public.pockets (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  icon text not null default '',
  color text not null default '',
  archived_at timestamptz,
  version integer not null check (version > 0),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  unique (user_id, id)
);

create table if not exists public.transactions (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('income', 'expense', 'transfer', 'refund')),
  date date not null,
  amount bigint not null check (amount > 0 and amount <= 9007199254740991),
  account_id uuid not null,
  destination_account_id uuid,
  category_id uuid,
  pocket_id uuid,
  original_expense_id uuid,
  group_id uuid,
  note text not null default '' check (char_length(note) <= 500),
  tags jsonb not null default '[]'::jsonb,
  priority text check (priority in ('need', 'want')),
  behavior text check (behavior in ('fixed', 'variable')),
  status text not null check (status in ('active', 'voided')),
  version integer not null check (version > 0),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  unique (user_id, id),
  check (type <> 'transfer' or (destination_account_id is not null and destination_account_id <> account_id)),
  check (type not in ('income', 'expense') or category_id is not null),
  check (type <> 'refund' or original_expense_id is not null),
  foreign key (user_id, account_id) references public.accounts(user_id, id) deferrable initially deferred,
  foreign key (user_id, destination_account_id) references public.accounts(user_id, id) deferrable initially deferred,
  foreign key (user_id, category_id) references public.categories(user_id, id) deferrable initially deferred,
  foreign key (user_id, pocket_id) references public.pockets(user_id, id) deferrable initially deferred,
  foreign key (user_id, original_expense_id) references public.transactions(user_id, id) deferrable initially deferred
);
create index if not exists transactions_user_date_idx on public.transactions (user_id, date);

create table if not exists public.allocations (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  from_pocket_id uuid,
  to_pocket_id uuid,
  amount bigint not null check (amount > 0 and amount <= 9007199254740991),
  note text not null default '' check (char_length(note) <= 500),
  status text not null check (status in ('active', 'voided')),
  enforce_funds boolean not null default true,
  version integer not null check (version > 0),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  check (from_pocket_id is not null or to_pocket_id is not null),
  check (from_pocket_id is distinct from to_pocket_id),
  foreign key (user_id, from_pocket_id) references public.pockets(user_id, id) deferrable initially deferred,
  foreign key (user_id, to_pocket_id) references public.pockets(user_id, id) deferrable initially deferred
);

create table if not exists public.adjustments (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null,
  date date not null,
  signed_amount bigint not null check (signed_amount <> 0 and abs(signed_amount) <= 9007199254740991),
  reason text not null check (char_length(reason) between 1 and 200),
  status text not null check (status in ('active', 'voided')),
  version integer not null check (version > 0),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  foreign key (user_id, account_id) references public.accounts(user_id, id) deferrable initially deferred
);

create table if not exists public.budgets (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  month text not null check (month ~ '^\d{4}-\d{2}$'),
  category_id uuid not null,
  limit_amount bigint not null check (limit_amount between 0 and 9007199254740991),
  version integer not null check (version > 0),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  constraint budgets_month_category_key unique (user_id, month, category_id) deferrable initially deferred,
  foreign key (user_id, category_id) references public.categories(user_id, id) deferrable initially deferred
);

create table if not exists public.goals (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  pocket_id uuid not null,
  name text not null check (char_length(name) between 1 and 50),
  target_amount bigint not null check (target_amount > 0 and target_amount <= 9007199254740991),
  deadline date,
  icon text not null default '',
  color text not null default '',
  celebration_shown_at timestamptz,
  version integer not null check (version > 0),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  constraint goals_pocket_key unique (user_id, pocket_id) deferrable initially deferred,
  foreign key (user_id, pocket_id) references public.pockets(user_id, id) deferrable initially deferred
);

create table if not exists public.reminders (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 50),
  kind text not null check (kind in ('income', 'bill')),
  frequency text not null check (frequency in ('weekly', 'monthly', 'yearly')),
  anchor_date date not null,
  amount bigint not null check (amount > 0 and amount <= 9007199254740991),
  account_id uuid not null,
  category_id uuid not null,
  pocket_id uuid,
  active boolean not null default true,
  version integer not null check (version > 0),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  unique (user_id, id),
  foreign key (user_id, account_id) references public.accounts(user_id, id) deferrable initially deferred,
  foreign key (user_id, category_id) references public.categories(user_id, id) deferrable initially deferred,
  foreign key (user_id, pocket_id) references public.pockets(user_id, id) deferrable initially deferred
);

create table if not exists public.occurrences (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  reminder_id uuid not null,
  due_date date not null,
  linked_transaction_id uuid,
  status text not null check (status in ('recorded', 'skipped', 'open')),
  version integer not null check (version > 0),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  constraint occurrences_reminder_due_key unique (reminder_id, due_date) deferrable initially deferred,
  foreign key (user_id, reminder_id) references public.reminders(user_id, id) deferrable initially deferred,
  foreign key (user_id, linked_transaction_id) references public.transactions(user_id, id) deferrable initially deferred
);

create table if not exists public.audit_events (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  entity_type text not null,
  entity_id uuid not null,
  action text not null,
  before jsonb,
  after jsonb,
  created_at timestamptz not null
);
create index if not exists audit_events_user_entity_idx on public.audit_events (user_id, entity_id);

-- ---------- Kontrol versi (edit basi ditolak) ----------
create or replace function public.kantong_check_version() returns trigger
language plpgsql as $$
begin
  if new.version <> old.version + 1 then
    raise exception 'KANTONG_CONFLICT: % berubah di tempat lain (tersimpan v%, dikirim v%)', tg_table_name, old.version, new.version
      using errcode = '23514';
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['settings','accounts','categories','pockets','transactions','allocations','adjustments','budgets','goals','reminders','occurrences']
  loop
    execute format('drop trigger if exists kantong_version on public.%I', t);
    execute format('create trigger kantong_version before update on public.%I for each row execute function public.kantong_check_version()', t);
  end loop;
end $$;

-- ---------- Batas alokasi: dana tersedia, diperiksa di bawah kunci per pengguna ----------
create or replace function public.kantong_check_allocation() returns trigger
language plpgsql as $$
declare
  avail bigint;
  total bigint;
  in_pockets bigint;
begin
  if new.status <> 'active' or not new.enforce_funds then
    new.enforce_funds := true;
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status = 'active' and old.amount = new.amount
     and old.from_pocket_id is not distinct from new.from_pocket_id then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('kantong:' || new.user_id::text, 0));

  if new.from_pocket_id is not null then
    select coalesce(sum(case when a.to_pocket_id = new.from_pocket_id then a.amount else -a.amount end), 0)
      into avail
      from public.allocations a
     where a.user_id = new.user_id and a.status = 'active' and a.id <> new.id
       and (a.to_pocket_id = new.from_pocket_id or a.from_pocket_id = new.from_pocket_id);
    select avail + coalesce(sum(case when t.type = 'refund' then t.amount else -t.amount end), 0)
      into avail
      from public.transactions t
     where t.user_id = new.user_id and t.status = 'active' and t.pocket_id = new.from_pocket_id
       and t.type in ('expense', 'refund');
  else
    select coalesce(sum(opening_balance), 0) into total from public.accounts where user_id = new.user_id;
    select total + coalesce(sum(case when type in ('income', 'refund') then amount when type = 'expense' then -amount else 0 end), 0)
      into total from public.transactions where user_id = new.user_id and status = 'active';
    select total + coalesce(sum(signed_amount), 0)
      into total from public.adjustments where user_id = new.user_id and status = 'active';
    select coalesce(sum((case when to_pocket_id is not null then amount else 0 end)
                      - (case when from_pocket_id is not null then amount else 0 end)), 0)
      into in_pockets from public.allocations
     where user_id = new.user_id and status = 'active' and id <> new.id;
    select in_pockets + coalesce(sum(case when type = 'refund' then amount else -amount end), 0)
      into in_pockets from public.transactions
     where user_id = new.user_id and status = 'active' and pocket_id is not null and type in ('expense', 'refund');
    avail := total - in_pockets;
  end if;

  if avail < new.amount then
    raise exception 'KANTONG_INSUFFICIENT_FUNDS: dana tersedia %', greatest(avail, 0) using errcode = '23514';
  end if;
  return new;
end $$;

drop trigger if exists kantong_allocation_funds on public.allocations;
create trigger kantong_allocation_funds before insert or update on public.allocations
  for each row execute function public.kantong_check_allocation();
