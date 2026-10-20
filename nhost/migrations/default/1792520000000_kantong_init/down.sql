-- Membalik migrasi kantong_init: menghapus seluruh tabel & fungsi Kantong (DATA HILANG).
drop table if exists public.audit_events, public.occurrences, public.reminders, public.goals, public.budgets,
  public.adjustments, public.allocations, public.transactions, public.pockets, public.categories,
  public.accounts, public.settings cascade;
drop function if exists public.kantong_check_allocation();
drop function if exists public.kantong_check_version();
