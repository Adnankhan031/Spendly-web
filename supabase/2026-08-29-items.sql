-- Itemised receipts — delta migration, 2026-08-29
--
-- Everything here is also in schema.sql; this is the short version so it can be
-- pasted into the SQL editor without re-running the whole catalogue.
-- Safe to run more than once.

-- Subcategories are categories rows with a parent. Clients filter on this, so a
-- receipt line can be "Fresh Produce" without it appearing in category pickers.
alter table public.categories   add column if not exists parent_key text;

-- The shop a receipt came from, read off the bill.
alter table public.transactions add column if not exists merchant text;

-- One line of a receipt. The transaction keeps the total; these are only the
-- breakdown, so budgets and cycle totals are untouched by itemising.
create table if not exists public.transaction_items (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  transaction_id  uuid not null references public.transactions(id) on delete cascade,
  name            text not null,
  normalised      text not null default '',
  qty             numeric not null default 1,
  amount_minor    bigint not null,
  category_id     uuid references public.categories(id) on delete set null,
  confidence      real not null default 1,
  sort            int not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);

create index if not exists idx_item_txn     on public.transaction_items (transaction_id);
create index if not exists idx_item_updated on public.transaction_items (user_id, updated_at);

-- Row-level security: without this the table is readable by anyone with the
-- publishable key, which is compiled into both apps.
alter table public.transaction_items enable row level security;

do $$
begin
  execute 'drop policy if exists "own rows select" on public.transaction_items';
  execute 'drop policy if exists "own rows insert" on public.transaction_items';
  execute 'drop policy if exists "own rows update" on public.transaction_items';
  execute 'drop policy if exists "own rows delete" on public.transaction_items';

  execute 'create policy "own rows select" on public.transaction_items
             for select using (auth.uid() = user_id)';
  execute 'create policy "own rows insert" on public.transaction_items
             for insert with check (auth.uid() = user_id)';
  execute 'create policy "own rows update" on public.transaction_items
             for update using (auth.uid() = user_id) with check (auth.uid() = user_id)';
  execute 'create policy "own rows delete" on public.transaction_items
             for delete using (auth.uid() = user_id)';
end $$;

-- Keep updated_at honest, since the delta sync watermarks off it.
drop trigger if exists trg_item_touch on public.transaction_items;
create trigger trg_item_touch before update on public.transaction_items
  for each row execute function public.touch_updated_at();
