-- People of Shrewsbury — local business profiles
-- One row per business an owner (or authorised manager) has claimed or added. Rows start 'pending'; a
-- reviewer (service role / dashboard, see docs/MAINTAINING.md) checks the consent and flips status to
-- 'approved' before anyone else sees them. Unclaimed businesses are NOT stored here: the game lists them
-- from OpenStreetMap (src/city/data/businesses.json) with "story not yet added".
-- Same pattern as public.profiles: readable when approved or own; owners edit their own; only an admin
-- changes status.

create table if not exists public.businesses (
  id             uuid primary key default gen_random_uuid(),
  owner_id       uuid not null references auth.users (id) on delete cascade,
  -- the OpenStreetMap listing this claims ("osm-n739861173"), or null for a business not on OSM yet
  osm_id         text unique check (osm_id ~ '^osm-[nwr][0-9]{1,15}$'),
  name           text not null check (char_length(name) between 2 and 80),
  category       text not null check (category in ('food', 'retail', 'services', 'health', 'auto', 'trades',
                                                   'finance', 'fitness', 'lodging', 'offices', 'civic')),
  district       text check (char_length(district) <= 30),
  address        text check (char_length(address) <= 120),
  website        text check (website ~ '^https://[^\s]+$' and char_length(website) <= 200),
  story          text check (char_length(story) <= 1200),
  owner_name     text check (char_length(owner_name) <= 60),          -- shown only if the owner chooses
  year_founded   int  check (year_founded between 1700 and 2100),
  jobs           int  check (jobs between 0 and 100000),              -- optional
  photos         text[] not null default '{}' check (cardinality(photos) <= 6),  -- storage paths, owner-supplied only
  -- consent: the exact wording version they agreed to, and when (docs/consent/business-v1.md)
  consent_version text not null check (char_length(consent_version) <= 20),
  consent_at     timestamptz not null default now(),
  -- reserved for enterable buildings (ROADMAP); ignored by v0, set only with written permission
  interior       jsonb,
  status         text not null default 'pending' check (status in ('pending', 'approved', 'hidden')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists businesses_status_idx on public.businesses (status);

alter table public.businesses enable row level security;

drop policy if exists "businesses are readable when approved or own" on public.businesses;
create policy "businesses are readable when approved or own"
  on public.businesses for select
  using (status = 'approved' or auth.uid() = owner_id);

drop policy if exists "insert own pending business" on public.businesses;
create policy "insert own pending business"
  on public.businesses for insert
  with check (auth.uid() = owner_id and status = 'pending' and interior is null);

drop policy if exists "update own business" on public.businesses;
create policy "update own business"
  on public.businesses for update
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

drop policy if exists "delete own business" on public.businesses;
create policy "delete own business"
  on public.businesses for delete
  using (auth.uid() = owner_id);

-- Owners edit their content; status, osm_id, owner and interior are the reviewer's.
revoke update on public.businesses from anon, authenticated;
grant update (name, category, district, address, website, story, owner_name, year_founded, jobs, photos,
              consent_version, consent_at, updated_at)
  on public.businesses to authenticated;
grant select on public.businesses to anon, authenticated;
grant insert, delete on public.businesses to authenticated;

create or replace function public.touch_business() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists businesses_touch on public.businesses;
create trigger businesses_touch before update on public.businesses
  for each row execute function public.touch_business();
