-- People of City · starter database (one file)
--
-- Every table, row-level security policy and database function the foundation uses, with no data.
-- Paste it into your Supabase project's SQL editor (Database → SQL editor) and run it once.
--
-- Generated from supabase/migrations/ (the source of truth), in order. To regenerate after editing them:
--   (cat supabase/schema.header.sql; for f in supabase/migrations/*.sql; do echo; echo "-- ==== $f"; cat "$f"; done) > supabase/schema.sql

-- ==== supabase/migrations/20261003193000_profiles.sql
-- Designers of Bengaluru — player profiles
-- One row per signed-in person. New profiles start 'pending'; an admin flips
-- status to 'approved' (Supabase table editor) before anyone else can see them.

create table if not exists public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  name          text not null check (char_length(name) between 2 and 40),
  role          text not null check (char_length(role) between 2 and 60),
  company       text check (char_length(company) <= 60),
  location      text not null default 'Koramangala' check (char_length(location) <= 40),
  building      text check (char_length(building) <= 80),
  previously    text check (char_length(previously) <= 80),
  open_to_work  boolean not null default false,
  skills        text[] not null default '{}' check (cardinality(skills) <= 6),
  portfolio     text check (portfolio ~ '^https://[^\s]+$' and char_length(portfolio) <= 200),
  linkedin      text check (linkedin ~ '^https://(www\.)?linkedin\.com/[^\s]+$' and char_length(linkedin) <= 200),
  x             text check (x ~ '^https://(x|twitter)\.com/[A-Za-z0-9_]{1,15}/?$'),
  character     text not null default 'designer' check (char_length(character) <= 30),
  spot          text not null default 'junction' check (char_length(spot) <= 30),
  status        text not null default 'pending' check (status in ('pending', 'approved', 'hidden')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Everyone (including guests) sees approved profiles; you always see your own.
drop policy if exists "profiles are readable when approved or own" on public.profiles;
create policy "profiles are readable when approved or own"
  on public.profiles for select
  using (status = 'approved' or auth.uid() = id);

-- You can only create your own row, and it must start pending.
drop policy if exists "insert own pending profile" on public.profiles;
create policy "insert own pending profile"
  on public.profiles for insert
  with check (auth.uid() = id and status = 'pending');

drop policy if exists "update own profile" on public.profiles;
create policy "update own profile"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

drop policy if exists "delete own profile" on public.profiles;
create policy "delete own profile"
  on public.profiles for delete
  using (auth.uid() = id);

-- Nobody but an admin (service role / dashboard) may change status.
revoke update on public.profiles from anon, authenticated;
grant update (name, role, company, location, building, previously, open_to_work, skills,
              portfolio, linkedin, x, character, spot, updated_at)
  on public.profiles to authenticated;

create or replace function public.touch_profile() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_profile();

-- ==== supabase/migrations/20261003193100_access.sql
-- Designers of Bengaluru — THE GATE (CLAUDE.md Phase 5D-B)
-- Being visible is earned: an invite code (instant, no review) or a reviewed application.
-- This migration adds invite codes, access settings and the two server functions the
-- gate calls. Payments (5D-C) and the review queue (5D-D) come later.
--
-- Safe to re-run.

-- ---------------------------------------------------------------------------
-- Settings (config-driven, change without a release)
-- ---------------------------------------------------------------------------

create table if not exists public.app_settings (
  key   text primary key,
  value jsonb not null
);

insert into public.app_settings (key, value) values
  ('invites_per_member', '2'),
  ('invite_sent_expiry_days', '30')
on conflict (key) do nothing;

alter table public.app_settings enable row level security;
drop policy if exists "settings are public" on public.app_settings;
create policy "settings are public" on public.app_settings for select using (true);

create or replace function public.setting_int(p_key text, p_default int) returns int
language sql stable security definer set search_path = public as $$
  select coalesce((select (value #>> '{}')::int from public.app_settings where key = p_key), p_default)
$$;

-- ---------------------------------------------------------------------------
-- Profiles: who invited you, and the 'rejected' state for applications
-- ---------------------------------------------------------------------------

alter table public.profiles add column if not exists invited_by uuid references auth.users (id) on delete set null;
alter table public.profiles add column if not exists review_note text check (char_length(review_note) <= 400);

alter table public.profiles drop constraint if exists profiles_status_check;
alter table public.profiles add constraint profiles_status_check
  check (status in ('pending', 'approved', 'hidden', 'rejected'));

-- ---------------------------------------------------------------------------
-- Invite codes
-- ---------------------------------------------------------------------------

create table if not exists public.invites (
  code        text primary key check (code ~ '^BLR-[A-Z0-9]{6}$'),
  -- null = a founder code made by the admin
  owner       uuid references auth.users (id) on delete cascade,
  state       text not null default 'available' check (state in ('available', 'sent', 'used', 'revoked')),
  created_at  timestamptz not null default now(),
  -- creating an invite link for someone starts the expiry clock
  sent_at     timestamptz,
  used_by     uuid references auth.users (id) on delete set null,
  used_at     timestamptz,
  note        text check (char_length(note) <= 120)
);

create index if not exists invites_owner on public.invites (owner);

alter table public.invites enable row level security;

-- You can see your own codes. Nobody writes to this table directly: only the
-- functions below (and the admin) do.
drop policy if exists "read own invites" on public.invites;
create policy "read own invites" on public.invites for select using (auth.uid() = owner);
revoke insert, update, delete on public.invites from anon, authenticated;

-- 6 characters from an alphabet without look-alikes (no 0/O, 1/I/L): ~887M codes.
create or replace function public.gen_invite_code() returns text
language plpgsql volatile set search_path = public as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  c text;
begin
  loop
    c := 'BLR-';
    for i in 1..6 loop
      c := c || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.invites where code = c);
  end loop;
  return c;
end $$;

-- Give someone (or, with null, nobody: founder codes) n fresh codes.
create or replace function public.issue_invites(p_owner uuid, p_n int) returns setof text
language plpgsql volatile security definer set search_path = public as $$
declare
  c text;
begin
  for i in 1..greatest(p_n, 0) loop
    c := public.gen_invite_code();
    insert into public.invites (code, owner) values (c, p_owner);
    return next c;
  end loop;
end $$;

-- Only the admin (SQL editor / service role) may mint codes.
revoke execute on function public.issue_invites(uuid, int) from public, anon, authenticated;
revoke execute on function public.gen_invite_code() from public, anon, authenticated;

-- What a code is worth, without using it: ok / invalid / used / expired / own.
create or replace function public.invite_state(r public.invites) returns text
language sql stable security definer set search_path = public as $$
  select case
    when r.code is null then 'invalid'
    when r.state = 'revoked' then 'invalid'
    when r.state = 'used' then 'used'
    when r.state = 'sent' and r.sent_at < now() - make_interval(days => public.setting_int('invite_sent_expiry_days', 30)) then 'expired'
    when r.owner is not null and r.owner = auth.uid() then 'own'
    else 'ok'
  end
$$;

-- The gate's CHECK button. Returns the inviter's name so the gate can say who vouched.
create or replace function public.check_invite(p_code text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  r public.invites;
  st text;
  who public.profiles;
begin
  select * into r from public.invites where code = upper(trim(p_code));
  st := public.invite_state(r);
  if st <> 'ok' then
    return jsonb_build_object('state', st);
  end if;
  select * into who from public.profiles where id = r.owner;
  return jsonb_build_object(
    'state', 'ok',
    'inviter_name', coalesce(who.name, 'The founders'),
    'inviter_role', coalesce(who.role, 'Designers of Bengaluru')
  );
end $$;

grant execute on function public.check_invite(text) to anon, authenticated;

-- End of the invite path, after the magic-link sign-in: in ONE transaction the code is
-- re-checked and marked used, your profile goes live (approved, no review), and you get
-- your own codes to share.
create or replace function public.redeem_invite(p_code text, p_profile jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  r public.invites;
  st text;
begin
  if uid is null then
    return jsonb_build_object('ok', false, 'state', 'signed_out');
  end if;

  select * into r from public.invites where code = upper(trim(p_code)) for update;
  st := public.invite_state(r);
  if st <> 'ok' then
    return jsonb_build_object('ok', false, 'state', st);
  end if;

  insert into public.profiles as p (
    id, name, role, company, location, building, previously, open_to_work, skills,
    portfolio, linkedin, x, character, spot, status, invited_by
  ) values (
    uid,
    p_profile ->> 'name',
    p_profile ->> 'role',
    nullif(p_profile ->> 'company', ''),
    coalesce(nullif(p_profile ->> 'location', ''), 'Koramangala'),
    nullif(p_profile ->> 'building', ''),
    nullif(p_profile ->> 'previously', ''),
    coalesce((p_profile ->> 'open_to_work')::boolean, false),
    coalesce(array(select jsonb_array_elements_text(p_profile -> 'skills')), '{}'),
    nullif(p_profile ->> 'portfolio', ''),
    nullif(p_profile ->> 'linkedin', ''),
    nullif(p_profile ->> 'x', ''),
    coalesce(nullif(p_profile ->> 'character', ''), 'designer'),
    coalesce(nullif(p_profile ->> 'spot', ''), 'junction'),
    'approved',
    r.owner
  )
  on conflict (id) do update set
    name = excluded.name, role = excluded.role, company = excluded.company,
    location = excluded.location, building = excluded.building, previously = excluded.previously,
    open_to_work = excluded.open_to_work, skills = excluded.skills, portfolio = excluded.portfolio,
    linkedin = excluded.linkedin, x = excluded.x, character = excluded.character, spot = excluded.spot,
    -- an invite approves an application that was waiting (or turned down) too
    status = 'approved', invited_by = excluded.invited_by;

  update public.invites set state = 'used', used_by = uid, used_at = now() where code = r.code;

  if not exists (select 1 from public.invites where owner = uid) then
    perform public.issue_invites(uid, public.setting_int('invites_per_member', 2));
  end if;

  return jsonb_build_object('ok', true);
end $$;

grant execute on function public.redeem_invite(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Existing members: everyone already approved gets their codes
-- ---------------------------------------------------------------------------

do $$
declare
  p record;
begin
  for p in
    select id from public.profiles pr
    where pr.status = 'approved' and not exists (select 1 from public.invites i where i.owner = pr.id)
  loop
    perform public.issue_invites(p.id, public.setting_int('invites_per_member', 2));
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Admin cheatsheet (run in the SQL editor)
-- ---------------------------------------------------------------------------
-- Make 5 founder codes (no owner):        select public.issue_invites(null, 5);
-- See every code and its state:           select code, owner, state, sent_at, used_at from public.invites order by created_at desc;
-- See your own codes:                     select code, state from public.invites where owner = (select id from auth.users where email = 'you@example.com');
-- Revoke a code:                          update public.invites set state = 'revoked' where code = 'BLR-XXXXXX';

-- ==== supabase/migrations/20261006175948_applications.sql
-- Designers of Bengaluru — APPLY TO JOIN (CLAUDE.md Phase 5E-A)
-- The paid way in. An applicant builds their profile, answers four questions, and the
-- application is saved here BEFORE payment. Payment (Dodo) and the admin review page come
-- in 5E-B; this migration already has the columns and states they need.
--
-- Safe to re-run.

-- ---------------------------------------------------------------------------
-- Admins (reviewers). Added by hand:  insert into public.admins (user_id)
--   select id from auth.users where email = 'you@example.com';
-- ---------------------------------------------------------------------------

create table if not exists public.admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.admins enable row level security;
revoke all on public.admins from anon, authenticated;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid())
$$;

grant execute on function public.is_admin() to authenticated;

-- ---------------------------------------------------------------------------
-- Applications
-- ---------------------------------------------------------------------------

create table if not exists public.applications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  email       text not null check (char_length(email) <= 254),

  -- the four questions
  why         text not null check (char_length(why) between 20 and 400),     -- WHY HERE?
  want        text not null check (char_length(want) between 20 and 400),    -- WHAT ARE YOU LOOKING FOR?
  bring       text not null check (char_length(bring) between 20 and 400),   -- WHAT WILL YOU BRING?
  show_link   text not null check (show_link ~ '^https://[^\s]+$' and char_length(show_link) <= 200), -- SHOW US ONE THING
  show_why    text not null check (char_length(show_why) between 10 and 200),

  -- the profile they built, exactly as the reviewer sees it; becomes their profile on approval
  profile     jsonb not null,

  status      text not null default 'submitted' check (status in (
                'draft', 'submitted', 'paid', 'under_review', 'approved', 'rejected', 'refunded', 'refund_failed')),

  -- 5E-B: Dodo Payments + review
  payment_id  text,
  amount      int check (amount >= 0),
  currency    text check (char_length(currency) = 3),
  reviewer    uuid references auth.users (id) on delete set null,
  reason      text check (char_length(reason) <= 400),
  paid_at     timestamptz,
  decided_at  timestamptz,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- One open application per person (= per email: one account per email).
create unique index if not exists applications_one_open
  on public.applications (user_id) where status not in ('rejected', 'refunded');
create index if not exists applications_queue on public.applications (status, created_at);

alter table public.applications enable row level security;

-- Applicants see their own; reviewers see all. Answers are never public.
drop policy if exists "read own or admin" on public.applications;
create policy "read own or admin" on public.applications for select
  using (auth.uid() = user_id or public.is_admin());

-- Nobody writes directly: submit_application() below (and 5E-B's server code) do.
-- So nobody can set their own status.
revoke insert, update, delete on public.applications from anon, authenticated;

drop trigger if exists applications_touch on public.applications;
create trigger applications_touch before update on public.applications
  for each row execute function public.touch_profile();

-- ---------------------------------------------------------------------------
-- submit_application(answers, profile)
-- Signed-in only (the magic link confirmed the email). Creates the application, or
-- updates it while it is still unpaid. Returns:
--   { ok: true, id, status }
--   { ok: false, state: signed_out | member | in_review | invalid }
-- ---------------------------------------------------------------------------

create or replace function public.submit_application(p_answers jsonb, p_profile jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  mail text := auth.jwt() ->> 'email';
  cur public.applications;
  new_id uuid;
begin
  if uid is null or mail is null then
    return jsonb_build_object('ok', false, 'state', 'signed_out');
  end if;

  -- already in the city: nothing to apply for
  if exists (select 1 from public.profiles where id = uid and status = 'approved') then
    return jsonb_build_object('ok', false, 'state', 'member');
  end if;

  if char_length(coalesce(p_profile ->> 'name', '')) < 2 or char_length(coalesce(p_profile ->> 'role', '')) < 2 then
    return jsonb_build_object('ok', false, 'state', 'invalid');
  end if;

  select * into cur from public.applications
    where user_id = uid and status not in ('rejected', 'refunded')
    for update;

  if cur.id is not null and cur.status not in ('draft', 'submitted') then
    -- paid: the reviewer is looking at exactly what was paid for
    return jsonb_build_object('ok', false, 'state', 'in_review', 'status', cur.status);
  end if;

  begin
    if cur.id is not null then
      update public.applications set
        email = mail,
        why = trim(p_answers ->> 'why'),
        want = trim(p_answers ->> 'want'),
        bring = trim(p_answers ->> 'bring'),
        show_link = trim(p_answers ->> 'show_link'),
        show_why = trim(p_answers ->> 'show_why'),
        profile = p_profile,
        status = 'submitted'
      where id = cur.id;
      new_id := cur.id;
    else
      insert into public.applications (user_id, email, why, want, bring, show_link, show_why, profile)
      values (
        uid, mail,
        trim(p_answers ->> 'why'),
        trim(p_answers ->> 'want'),
        trim(p_answers ->> 'bring'),
        trim(p_answers ->> 'show_link'),
        trim(p_answers ->> 'show_why'),
        p_profile
      )
      returning id into new_id;
    end if;
  exception when check_violation or not_null_violation then
    return jsonb_build_object('ok', false, 'state', 'invalid');
  end;

  return jsonb_build_object('ok', true, 'id', new_id, 'status', 'submitted');
end $$;

revoke execute on function public.submit_application(jsonb, jsonb) from public, anon;
grant execute on function public.submit_application(jsonb, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Admin cheatsheet (run in the SQL editor)
-- ---------------------------------------------------------------------------
-- Make yourself a reviewer:   insert into public.admins (user_id) select id from auth.users where email = 'you@example.com';
-- See the applications:       select created_at, email, status, profile ->> 'name' as name, why, want, bring, show_link from public.applications order by created_at desc;

-- ==== supabase/migrations/20261006181812_payments_review.sql
-- Designers of Bengaluru — PAYMENT (DODO) + ADMIN REVIEW (CLAUDE.md Phase 5E-B)
-- Dodo Payments takes the application fee; a reviewer (public.admins) accepts or
-- rejects + refunds. Payment and refund states are written by the server only
-- (src/app/api/*, with the secret key) after Dodo confirms them — never by the client.
--
-- Safe to re-run.

-- What the fee is and which Dodo product charges it, per mode (test / live — live on Vercel production only).
-- Config-driven: change the price by creating a new Dodo product (brand "People of
-- Bangalore") and updating these rows — no release needed.
insert into public.app_settings (key, value) values
  ('application_fee', '{"amount": 59900, "currency": "INR"}'),
  ('dodo_product_id', '{"test": null, "live": null}'),
  ('review_auto_refund_days', '14')
on conflict (key) do nothing;

alter table public.applications add column if not exists checkout_id text;
alter table public.applications add column if not exists refund_id text;

create index if not exists applications_payment on public.applications (payment_id);

-- ACCEPT. Admins only (checked inside, so it can be called straight from the admin page).
-- In one transaction: the profile snapshot becomes a live profile (approved), the new
-- member gets their invite codes, and the application is marked approved.
create or replace function public.approve_application(p_id uuid, p_note text default null) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  a public.applications;
  p jsonb;
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'state', 'not_admin');
  end if;

  select * into a from public.applications where id = p_id for update;
  if a.id is null then
    return jsonb_build_object('ok', false, 'state', 'missing');
  end if;
  if a.status not in ('paid', 'under_review') then
    return jsonb_build_object('ok', false, 'state', 'not_reviewable', 'status', a.status);
  end if;

  p := a.profile;
  insert into public.profiles as pr (
    id, name, role, company, location, building, previously, open_to_work, skills,
    portfolio, linkedin, x, character, spot, status
  ) values (
    a.user_id,
    p ->> 'name',
    p ->> 'role',
    nullif(p ->> 'company', ''),
    coalesce(nullif(p ->> 'location', ''), 'Koramangala'),
    nullif(p ->> 'building', ''),
    nullif(p ->> 'previously', ''),
    coalesce((p ->> 'open_to_work')::boolean, false),
    coalesce(array(select jsonb_array_elements_text(p -> 'skills')), '{}'),
    nullif(p ->> 'portfolio', ''),
    nullif(p ->> 'linkedin', ''),
    nullif(p ->> 'x', ''),
    coalesce(nullif(p ->> 'character', ''), 'designer'),
    coalesce(nullif(p ->> 'spot', ''), 'junction'),
    'approved'
  )
  on conflict (id) do update set
    name = excluded.name, role = excluded.role, company = excluded.company,
    location = excluded.location, building = excluded.building, previously = excluded.previously,
    open_to_work = excluded.open_to_work, skills = excluded.skills, portfolio = excluded.portfolio,
    linkedin = excluded.linkedin, x = excluded.x, character = excluded.character, spot = excluded.spot,
    status = 'approved';

  if not exists (select 1 from public.invites where owner = a.user_id) then
    perform public.issue_invites(a.user_id, public.setting_int('invites_per_member', 2));
  end if;

  update public.applications
    set status = 'approved', reviewer = auth.uid(), reason = nullif(trim(p_note), ''), decided_at = now()
    where id = a.id;

  return jsonb_build_object('ok', true);
end $$;

grant execute on function public.approve_application(uuid, text) to authenticated;

-- ==== supabase/migrations/20261007000000_status.sql
-- Designers of Bengaluru — STATUS (CLAUDE.md Phase 5F-B)
-- A short line + an emoji above your head: who's open to being approached, and
-- something to say. Called "note" here because profiles.status is already approval.
--
-- Safe to re-run.

alter table public.profiles add column if not exists note_text text;
alter table public.profiles add column if not exists note_emoji text;
-- null = don't clear
alter table public.profiles add column if not exists note_expires_at timestamptz;

alter table public.profiles drop constraint if exists profiles_note_text_check;
alter table public.profiles add constraint profiles_note_text_check
  check (note_text is null or char_length(note_text) between 1 and 100);

-- one emoji; some emoji are several code points (skin tones, flags, ZWJ sequences)
alter table public.profiles drop constraint if exists profiles_note_emoji_check;
alter table public.profiles add constraint profiles_note_emoji_check
  check (note_emoji is null or char_length(note_emoji) between 1 and 16);

-- Members change their own status at any time, without re-approval. The existing
-- "update own profile" policy keeps it to your own row; this only opens the columns.
grant update (note_text, note_emoji, note_expires_at) on public.profiles to authenticated;

-- Moderation: an admin can clear anyone's status (from the SQL editor, or later the admin page).
create or replace function public.admin_clear_status(p_user uuid) returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'admins only';
  end if;
  update public.profiles set note_text = null, note_emoji = null, note_expires_at = null where id = p_user;
end $$;

revoke execute on function public.admin_clear_status(uuid) from public, anon;
grant execute on function public.admin_clear_status(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Admin cheatsheet (SQL editor)
-- ---------------------------------------------------------------------------
-- Everyone's current status:  select name, note_emoji, note_text, note_expires_at from public.profiles
--                             where note_text is not null or note_emoji is not null;
-- Clear someone's status:     update public.profiles set note_text = null, note_emoji = null,
--                             note_expires_at = null where name = 'THEIR NAME';

-- ==== supabase/migrations/20261007110614_connections.sql
-- People of Bengaluru — CONNECT (CLAUDE.md Phase 5G)
-- Discovery → Intent → Mutual match → Introduction → Take it from here.
--
-- contacts:    one preferred contact per member. Only the owner can read or write it directly;
--              the other person sees it only through my_connections(), once both said yes.
-- connections: no client access at all. Everything goes through the functions below, so a
--              decline can never be read by the sender.

insert into public.app_settings (key, value) values
  ('connect_daily_limit', '10'),
  ('connect_expiry_days', '14'),
  ('connect_cooldown_days', '30')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- contacts
-- ---------------------------------------------------------------------------

create or replace function public.valid_contact(p_method text, p_value text) returns boolean
language sql immutable as $$
  select case p_method
    when 'whatsapp'  then p_value ~ '^\+[1-9][0-9]{7,14}$'
    when 'email'     then p_value ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' and char_length(p_value) <= 200
    when 'instagram' then p_value ~ '^[A-Za-z0-9._]{1,30}$'
    when 'telegram'  then p_value ~ '^[A-Za-z0-9_]{5,32}$'
    when 'x'         then p_value ~ '^[A-Za-z0-9_]{1,15}$'
    when 'linkedin'  then p_value ~ '^https://(www\.)?linkedin\.com/[^\s]+$' and char_length(p_value) <= 200
    else false
  end
$$;

create table if not exists public.contacts (
  user_id     uuid primary key references public.profiles (id) on delete cascade,
  method      text not null,
  value       text not null,
  -- email me when someone wants to connect / when it's a match
  emails      boolean not null default true,
  updated_at  timestamptz not null default now(),
  constraint contacts_valid check (public.valid_contact(method, value))
);

alter table public.contacts enable row level security;

create policy "own contact: read" on public.contacts for select using (auth.uid() = user_id);
create policy "own contact: insert" on public.contacts for insert with check (auth.uid() = user_id);
create policy "own contact: update" on public.contacts for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own contact: delete" on public.contacts for delete using (auth.uid() = user_id);

create trigger contacts_touch before update on public.contacts
  for each row execute function public.touch_profile();

-- ---------------------------------------------------------------------------
-- connections
-- ---------------------------------------------------------------------------

create table if not exists public.connections (
  id            uuid primary key default gen_random_uuid(),
  from_id       uuid not null references public.profiles (id) on delete cascade,
  to_id         uuid not null references public.profiles (id) on delete cascade,
  intent        text not null check (intent in ('coffee', 'work', 'ideas', 'build', 'hangout')),
  status        text not null default 'pending'
                check (status in ('pending', 'accepted', 'declined', 'expired', 'withdrawn', 'removed')),
  created_at    timestamptz not null default now(),
  decided_at    timestamptz,
  -- the recipient has seen the request · the sender has seen the match
  to_seen_at    timestamptz,
  from_seen_at  timestamptz,
  check (from_id <> to_id)
);

-- one open request or connection per pair, whichever way round
create unique index if not exists connections_open_pair
  on public.connections (least(from_id, to_id), greatest(from_id, to_id))
  where status in ('pending', 'accepted');
create index if not exists connections_to on public.connections (to_id, status);
create index if not exists connections_from on public.connections (from_id, created_at desc);

-- RLS on, no policies: invisible to clients except through the functions below.
alter table public.connections enable row level security;

-- ---------------------------------------------------------------------------
-- helpers
-- ---------------------------------------------------------------------------

create or replace function public.is_member(p_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = p_id and status = 'approved')
$$;

create or replace function public.connect_setting(p_key text, p_fallback int) returns int
language sql stable security definer set search_path = public as $$
  select coalesce((select (value #>> '{}')::int from app_settings where key = p_key), p_fallback)
$$;

-- pending requests past their expiry become 'expired'
create or replace function public.expire_connections(p_a uuid, p_b uuid) returns void
language sql security definer set search_path = public as $$
  update connections set status = 'expired', decided_at = coalesce(decided_at, now())
   where status = 'pending'
     and created_at < now() - make_interval(days => connect_setting('connect_expiry_days', 14))
     and ((from_id = p_a and to_id = p_b) or (from_id = p_b and to_id = p_a))
$$;

-- ---------------------------------------------------------------------------
-- actions
-- ---------------------------------------------------------------------------

create or replace function public.send_connect(p_to uuid, p_intent text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  r connections;
begin
  if me is null then return jsonb_build_object('ok', false, 'state', 'signed_out'); end if;
  if not is_member(me) then return jsonb_build_object('ok', false, 'state', 'not_member'); end if;
  if p_to = me then return jsonb_build_object('ok', false, 'state', 'self'); end if;
  if not is_member(p_to) then return jsonb_build_object('ok', false, 'state', 'not_found'); end if;
  if p_intent not in ('coffee', 'work', 'ideas', 'build', 'hangout') then
    return jsonb_build_object('ok', false, 'state', 'invalid');
  end if;
  if not exists (select 1 from contacts where user_id = me) then
    return jsonb_build_object('ok', false, 'state', 'no_contact');
  end if;

  perform expire_connections(me, p_to);

  select * into r from connections
   where status in ('pending', 'accepted')
     and ((from_id = me and to_id = p_to) or (from_id = p_to and to_id = me))
   limit 1;

  if found and r.status = 'accepted' then
    return jsonb_build_object('ok', false, 'state', 'connected', 'id', r.id);
  end if;
  if found and r.from_id = me then
    return jsonb_build_object('ok', false, 'state', 'already_sent', 'id', r.id);
  end if;
  if found then
    -- they already asked you: that's a match
    update connections set status = 'accepted', decided_at = now(), to_seen_at = coalesce(to_seen_at, now())
     where id = r.id;
    return jsonb_build_object('ok', true, 'state', 'matched', 'id', r.id, 'intent', r.intent, 'other', p_to);
  end if;

  -- after a request ends without a match, wait before asking the same person again
  if exists (
    select 1 from connections
     where from_id = me and to_id = p_to
       and status in ('declined', 'expired', 'withdrawn')
       and created_at > now() - make_interval(days => connect_setting('connect_cooldown_days', 30))
  ) then
    return jsonb_build_object('ok', false, 'state', 'cooldown');
  end if;

  if (select count(*) from connections where from_id = me and created_at > now() - interval '1 day')
     >= connect_setting('connect_daily_limit', 10) then
    return jsonb_build_object('ok', false, 'state', 'limit');
  end if;

  insert into connections (from_id, to_id, intent) values (me, p_to, p_intent) returning * into r;
  return jsonb_build_object('ok', true, 'state', 'sent', 'id', r.id, 'intent', r.intent, 'other', p_to);
end $$;

create or replace function public.respond_connect(p_id uuid, p_accept boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  r connections;
begin
  if me is null then return jsonb_build_object('ok', false, 'state', 'signed_out'); end if;
  select * into r from connections where id = p_id and to_id = me;
  if not found then return jsonb_build_object('ok', false, 'state', 'not_found'); end if;
  perform expire_connections(r.from_id, r.to_id);
  select * into r from connections where id = p_id;
  if r.status <> 'pending' then return jsonb_build_object('ok', false, 'state', r.status); end if;
  if p_accept and not exists (select 1 from contacts where user_id = me) then
    return jsonb_build_object('ok', false, 'state', 'no_contact');
  end if;
  if p_accept and not is_member(r.from_id) then
    return jsonb_build_object('ok', false, 'state', 'not_found');
  end if;

  update connections
     set status = case when p_accept then 'accepted' else 'declined' end,
         decided_at = now(),
         to_seen_at = coalesce(to_seen_at, now())
   where id = p_id;
  return jsonb_build_object('ok', true, 'state', case when p_accept then 'matched' else 'declined' end,
                            'id', p_id, 'intent', r.intent, 'other', r.from_id);
end $$;

create or replace function public.withdraw_connect(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  update connections set status = 'withdrawn', decided_at = now()
   where id = p_id and from_id = auth.uid() and status = 'pending';
  return jsonb_build_object('ok', found);
end $$;

create or replace function public.remove_connect(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  update connections set status = 'removed', decided_at = now()
   where id = p_id and auth.uid() in (from_id, to_id) and status = 'accepted';
  return jsonb_build_object('ok', found);
end $$;

-- Everything you can see about your connections. The ONLY place a contact is revealed:
-- both people said yes, and the other person is still a member.
create or replace function public.my_connections() returns jsonb
language sql stable security definer set search_path = public as $$
  with mine as (
    select c.*,
           case when c.from_id = auth.uid() then 'out' else 'in' end as dir,
           case when c.from_id = auth.uid() then c.to_id else c.from_id end as other_id,
           c.created_at < now() - make_interval(days => connect_setting('connect_expiry_days', 14)) as stale
      from connections c
     where auth.uid() in (c.from_id, c.to_id)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', m.id,
           'dir', m.dir,
           'intent', m.intent,
           'state', case when m.status = 'accepted' then 'matched' else 'pending' end,
           'created_at', m.created_at,
           'decided_at', case when m.status = 'accepted' then m.decided_at end,
           'seen', case when m.status = 'accepted' and m.dir = 'out' then m.from_seen_at is not null
                        when m.dir = 'in' then m.to_seen_at is not null
                        else true end,
           'other', jsonb_build_object('id', p.id, 'name', p.name, 'role', p.role, 'character', p.character, 'location', p.location),
           'contact', case when m.status = 'accepted'
                           then (select jsonb_build_object('method', k.method, 'value', k.value)
                                   from contacts k where k.user_id = m.other_id) end
         ) order by coalesce(m.decided_at, m.created_at) desc), '[]'::jsonb)
    from mine m
    join profiles p on p.id = m.other_id and p.status = 'approved'
   where m.status = 'accepted'
      -- open requests; a decline looks exactly like silence to the sender
      or (m.status = 'pending' and not m.stale)
      or (m.status = 'declined' and m.dir = 'out' and not m.stale)
$$;

create or replace function public.mark_connections_seen() returns void
language sql security definer set search_path = public as $$
  update connections set to_seen_at = now()
   where to_id = auth.uid() and status = 'pending' and to_seen_at is null;
  update connections set from_seen_at = now()
   where from_id = auth.uid() and status = 'accepted' and from_seen_at is null;
$$;

revoke execute on function public.send_connect(uuid, text), public.respond_connect(uuid, boolean),
  public.withdraw_connect(uuid), public.remove_connect(uuid), public.my_connections(),
  public.mark_connections_seen(), public.expire_connections(uuid, uuid) from anon, public;
grant execute on function public.send_connect(uuid, text), public.respond_connect(uuid, boolean),
  public.withdraw_connect(uuid), public.remove_connect(uuid), public.my_connections(),
  public.mark_connections_seen() to authenticated;
revoke execute on function public.expire_connections(uuid, uuid) from authenticated;

-- ==== supabase/migrations/20261008102020_invites.sql
-- People of Bengaluru — YOUR INVITES (CLAUDE.md Phase 5D, spec docs/superpowers/specs/2026-10-08-invite-flow-design.md)
-- Members turn a code into a link (marked sent, 30-day clock), see who joined, and get a fresh code
-- back when a link goes unused. An expired code stays dead: check_invite keeps answering 'expired'.
--
-- Safe to re-run.

-- ---------------------------------------------------------------------------
-- Schema: the 'expired' state, and who an unused link was for
-- ---------------------------------------------------------------------------

alter table public.invites drop constraint if exists invites_state_check;
alter table public.invites add constraint invites_state_check
  check (state in ('available', 'sent', 'used', 'revoked', 'expired'));

-- On a fresh code that replaced an unused link: that link's "who's it for" ('' when it had none).
alter table public.invites add column if not exists renewed_from text check (char_length(renewed_from) <= 40);

-- An expired code reads as expired whether or not it has been renewed yet.
create or replace function public.invite_state(r public.invites) returns text
language sql stable security definer set search_path = public as $$
  select case
    when r.code is null then 'invalid'
    when r.state = 'revoked' then 'invalid'
    when r.state = 'used' then 'used'
    when r.state = 'expired' then 'expired'
    when r.state = 'sent' and r.sent_at < now() - make_interval(days => public.setting_int('invite_sent_expiry_days', 30)) then 'expired'
    when r.owner is not null and r.owner = auth.uid() then 'own'
    else 'ok'
  end
$$;

-- ---------------------------------------------------------------------------
-- create_invite_link: one of your ready codes becomes a sent link
-- ---------------------------------------------------------------------------

create or replace function public.create_invite_link(p_code text, p_note text) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  r public.invites;
begin
  if uid is null then
    return jsonb_build_object('ok', false, 'state', 'signed_out');
  end if;
  select * into r from public.invites where code = upper(trim(p_code)) and owner = uid for update;
  if r.code is null then
    return jsonb_build_object('ok', false, 'state', 'invalid');
  end if;
  if r.state <> 'available' then
    return jsonb_build_object('ok', false, 'state', r.state);
  end if;
  update public.invites
    set state = 'sent', sent_at = now(), note = left(nullif(trim(coalesce(p_note, '')), ''), 40)
    where code = r.code
    returning * into r;
  return jsonb_build_object('ok', true, 'code', r.code, 'sent_at', r.sent_at);
end $$;

revoke execute on function public.create_invite_link(text, text) from public, anon;
grant execute on function public.create_invite_link(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- my_invites: renew unused links, then list your slots
-- ---------------------------------------------------------------------------

create or replace function public.my_invites() returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  exp_days int := public.setting_int('invite_sent_expiry_days', 30);
  old record;
  fresh text;
begin
  if uid is null then
    return '[]'::jsonb;
  end if;

  -- a link unused for exp_days is dead; its slot comes back as a fresh code
  for old in
    select code, note from public.invites
    where owner = uid and state = 'sent' and sent_at < now() - make_interval(days => exp_days)
    for update
  loop
    update public.invites set state = 'expired' where code = old.code;
    fresh := public.gen_invite_code();
    insert into public.invites (code, owner, renewed_from) values (fresh, uid, coalesce(old.note, ''));
  end loop;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'code', i.code,
      'state', i.state,
      'note', i.note,
      'sent_at', i.sent_at,
      'expires_at', case when i.sent_at is null then null else i.sent_at + make_interval(days => exp_days) end,
      'renewed_from', i.renewed_from,
      'joined', case when i.state = 'used' then jsonb_build_object(
        'name', coalesce(p.name, 'A new member'),
        'role', p.role,
        'at', i.used_at
      ) end
    ) order by i.created_at, i.code)
    from public.invites i
    left join public.profiles p on p.id = i.used_by and p.status = 'approved'
    where i.owner = uid and i.state in ('available', 'sent', 'used')
  ), '[]'::jsonb);
end $$;

revoke execute on function public.my_invites() from public, anon;
grant execute on function public.my_invites() to authenticated;

-- ---------------------------------------------------------------------------
-- Admin cheatsheet
-- ---------------------------------------------------------------------------
-- Test renewal: update public.invites set sent_at = now() - interval '31 days' where code = 'BLR-XXXXXX';
--               then open YOUR INVITES as that member (or: select public.my_invites(); as them).

-- ==== supabase/migrations/20261010022208_connect_note.sql
-- People of Bengaluru — CONNECT: an optional note on a request (CLAUDE.md Phase 5G)
-- One line from the sender (≤ 200 characters), shown to the person asked: in the city and in the
-- request email. Still no chat: it is sent once, with the request, and never replied to.
--
-- Safe to re-run.

alter table public.connections add column if not exists note text check (char_length(note) <= 200);

-- send_connect gains p_note (default null, so callers that don't send one keep working)
drop function if exists public.send_connect(uuid, text);

create or replace function public.send_connect(p_to uuid, p_intent text, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  r connections;
  v_note text := left(nullif(btrim(coalesce(p_note, '')), ''), 200);
begin
  if me is null then return jsonb_build_object('ok', false, 'state', 'signed_out'); end if;
  if not is_member(me) then return jsonb_build_object('ok', false, 'state', 'not_member'); end if;
  if p_to = me then return jsonb_build_object('ok', false, 'state', 'self'); end if;
  if not is_member(p_to) then return jsonb_build_object('ok', false, 'state', 'not_found'); end if;
  if p_intent not in ('coffee', 'work', 'ideas', 'build', 'hangout') then
    return jsonb_build_object('ok', false, 'state', 'invalid');
  end if;
  if not exists (select 1 from contacts where user_id = me) then
    return jsonb_build_object('ok', false, 'state', 'no_contact');
  end if;

  perform expire_connections(me, p_to);

  select * into r from connections
   where status in ('pending', 'accepted')
     and ((from_id = me and to_id = p_to) or (from_id = p_to and to_id = me))
   limit 1;

  if found and r.status = 'accepted' then
    return jsonb_build_object('ok', false, 'state', 'connected', 'id', r.id);
  end if;
  if found and r.from_id = me then
    return jsonb_build_object('ok', false, 'state', 'already_sent', 'id', r.id);
  end if;
  if found then
    -- they already asked you: that's a match (your note isn't needed any more)
    update connections set status = 'accepted', decided_at = now(), to_seen_at = coalesce(to_seen_at, now())
     where id = r.id;
    return jsonb_build_object('ok', true, 'state', 'matched', 'id', r.id, 'intent', r.intent, 'other', p_to);
  end if;

  -- after a request ends without a match, wait before asking the same person again
  if exists (
    select 1 from connections
     where from_id = me and to_id = p_to
       and status in ('declined', 'expired', 'withdrawn')
       and created_at > now() - make_interval(days => connect_setting('connect_cooldown_days', 30))
  ) then
    return jsonb_build_object('ok', false, 'state', 'cooldown');
  end if;

  if (select count(*) from connections where from_id = me and created_at > now() - interval '1 day')
     >= connect_setting('connect_daily_limit', 10) then
    return jsonb_build_object('ok', false, 'state', 'limit');
  end if;

  insert into connections (from_id, to_id, intent, note) values (me, p_to, p_intent, v_note) returning * into r;
  return jsonb_build_object('ok', true, 'state', 'sent', 'id', r.id, 'intent', r.intent, 'other', p_to, 'note', r.note);
end $$;

revoke execute on function public.send_connect(uuid, text, text) from anon, public;
grant execute on function public.send_connect(uuid, text, text) to authenticated;

-- my_connections: + note (both people in the request see it)
create or replace function public.my_connections() returns jsonb
language sql stable security definer set search_path = public as $$
  with mine as (
    select c.*,
           case when c.from_id = auth.uid() then 'out' else 'in' end as dir,
           case when c.from_id = auth.uid() then c.to_id else c.from_id end as other_id,
           c.created_at < now() - make_interval(days => connect_setting('connect_expiry_days', 14)) as stale
      from connections c
     where auth.uid() in (c.from_id, c.to_id)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', m.id,
           'dir', m.dir,
           'intent', m.intent,
           'note', m.note,
           'state', case when m.status = 'accepted' then 'matched' else 'pending' end,
           'created_at', m.created_at,
           'decided_at', case when m.status = 'accepted' then m.decided_at end,
           'seen', case when m.status = 'accepted' and m.dir = 'out' then m.from_seen_at is not null
                        when m.dir = 'in' then m.to_seen_at is not null
                        else true end,
           'other', jsonb_build_object('id', p.id, 'name', p.name, 'role', p.role, 'character', p.character, 'location', p.location),
           'contact', case when m.status = 'accepted'
                           then (select jsonb_build_object('method', k.method, 'value', k.value)
                                   from contacts k where k.user_id = m.other_id) end
         ) order by coalesce(m.decided_at, m.created_at) desc), '[]'::jsonb)
    from mine m
    join profiles p on p.id = m.other_id and p.status = 'approved'
   where m.status = 'accepted'
      -- open requests; a decline looks exactly like silence to the sender
      or (m.status = 'pending' and not m.stale)
      or (m.status = 'declined' and m.dir = 'out' and not m.stale)
$$;

-- ==== supabase/migrations/20261011080848_chat_phase_a.sql
-- People of Bengaluru — CHAT (CLAUDE.md Phase 5G): a match opens a 1:1 chat inside the city,
-- replacing the contact handoff. Only matched members can write; unmatch or block deletes the
-- thread for both; admins never read threads, only what someone reported.
--
-- PHASE A, additive. Dev and production share this database and the live site still runs the old
-- code, so nothing old is changed in a way it would notice: the new behaviour lives in *_v2
-- functions. Phase B (20261012000000_drop_contacts.sql) removes contacts + the old functions once production
-- runs the new code.
--
-- Safe to re-run.

-- ---------------------------------------------------------------------------
-- email preference (was contacts.emails; contacts go away in phase B)
-- ---------------------------------------------------------------------------

create table if not exists public.member_settings (
  user_id     uuid primary key references public.profiles (id) on delete cascade,
  -- email me about connect requests, matches and unread messages
  emails      boolean not null default true,
  updated_at  timestamptz not null default now()
);

alter table public.member_settings enable row level security;

drop policy if exists "own settings: read" on public.member_settings;
drop policy if exists "own settings: insert" on public.member_settings;
drop policy if exists "own settings: update" on public.member_settings;
create policy "own settings: read" on public.member_settings for select using (auth.uid() = user_id);
create policy "own settings: insert" on public.member_settings for insert with check (auth.uid() = user_id);
create policy "own settings: update" on public.member_settings for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop trigger if exists member_settings_touch on public.member_settings;
create trigger member_settings_touch before update on public.member_settings
  for each row execute function public.touch_profile();

insert into public.member_settings (user_id, emails)
  select user_id, emails from public.contacts
on conflict (user_id) do nothing;

-- ---------------------------------------------------------------------------
-- threads: one per accepted connection
-- ---------------------------------------------------------------------------

alter table public.connections add column if not exists last_message_at timestamptz;
-- each side's last read, and the last unread-message email to each side
alter table public.connections add column if not exists from_read_at timestamptz;
alter table public.connections add column if not exists to_read_at timestamptz;
alter table public.connections add column if not exists from_emailed_at timestamptz;
alter table public.connections add column if not exists to_emailed_at timestamptz;

create table if not exists public.messages (
  id             uuid primary key default gen_random_uuid(),
  connection_id  uuid not null references public.connections (id) on delete cascade,
  sender_id      uuid not null references public.profiles (id) on delete cascade,
  body           text not null check (char_length(body) between 1 and 500),
  created_at     timestamptz not null default now()
);

create index if not exists messages_thread on public.messages (connection_id, created_at desc);
create index if not exists messages_sender on public.messages (sender_id, created_at desc);

-- RLS on, no policies: read and written only through the functions below.
alter table public.messages enable row level security;

-- ---------------------------------------------------------------------------
-- blocks and reports
-- ---------------------------------------------------------------------------

create table if not exists public.blocks (
  blocker_id  uuid not null references public.profiles (id) on delete cascade,
  blocked_id  uuid not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
alter table public.blocks enable row level security;

create table if not exists public.reports (
  id             uuid primary key default gen_random_uuid(),
  reporter_id    uuid references public.profiles (id) on delete set null,
  reported_id    uuid references public.profiles (id) on delete set null,
  -- what the reporter saw, copied before the thread is deleted: the request + the last messages
  snapshot       jsonb not null,
  reason         text check (char_length(reason) <= 500),
  status         text not null default 'open' check (status in ('open', 'resolved', 'hidden')),
  resolved_by    uuid references auth.users (id) on delete set null,
  created_at     timestamptz not null default now(),
  resolved_at    timestamptz
);
create index if not exists reports_open on public.reports (status, created_at desc);
alter table public.reports enable row level security;

drop policy if exists "admins read reports" on public.reports;
create policy "admins read reports" on public.reports for select using (public.is_admin());

-- ---------------------------------------------------------------------------
-- helpers
-- ---------------------------------------------------------------------------

create or replace function public.is_blocked(p_a uuid, p_b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from blocks where (blocker_id = p_a and blocked_id = p_b) or (blocker_id = p_b and blocked_id = p_a))
$$;

-- the accepted connection p_conn, if the caller is in it and the other person is still a member
create or replace function public.my_thread(p_conn uuid) returns connections
language sql stable security definer set search_path = public as $$
  select c.* from connections c
   where c.id = p_conn and c.status = 'accepted' and auth.uid() in (c.from_id, c.to_id)
     and is_member(case when c.from_id = auth.uid() then c.to_id else c.from_id end)
$$;

-- ---------------------------------------------------------------------------
-- connect, v2: no contact needed any more; blocks respected (a block reads as "not found")
-- ---------------------------------------------------------------------------

create or replace function public.send_connect_v2(p_to uuid, p_intent text, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  r connections;
  v_note text := left(nullif(btrim(coalesce(p_note, '')), ''), 200);
begin
  if me is null then return jsonb_build_object('ok', false, 'state', 'signed_out'); end if;
  if not is_member(me) then return jsonb_build_object('ok', false, 'state', 'not_member'); end if;
  if p_to = me then return jsonb_build_object('ok', false, 'state', 'self'); end if;
  if not is_member(p_to) or is_blocked(me, p_to) then return jsonb_build_object('ok', false, 'state', 'not_found'); end if;
  if p_intent not in ('coffee', 'work', 'ideas', 'build', 'hangout') then
    return jsonb_build_object('ok', false, 'state', 'invalid');
  end if;

  perform expire_connections(me, p_to);

  select * into r from connections
   where status in ('pending', 'accepted')
     and ((from_id = me and to_id = p_to) or (from_id = p_to and to_id = me))
   limit 1;

  if found and r.status = 'accepted' then
    return jsonb_build_object('ok', false, 'state', 'connected', 'id', r.id);
  end if;
  if found and r.from_id = me then
    return jsonb_build_object('ok', false, 'state', 'already_sent', 'id', r.id);
  end if;
  if found then
    -- they already asked you: that's a match (your note isn't needed any more)
    update connections set status = 'accepted', decided_at = now(), to_seen_at = coalesce(to_seen_at, now())
     where id = r.id;
    return jsonb_build_object('ok', true, 'state', 'matched', 'id', r.id, 'intent', r.intent, 'other', p_to);
  end if;

  if exists (
    select 1 from connections
     where from_id = me and to_id = p_to
       and status in ('declined', 'expired', 'withdrawn')
       and created_at > now() - make_interval(days => connect_setting('connect_cooldown_days', 30))
  ) then
    return jsonb_build_object('ok', false, 'state', 'cooldown');
  end if;

  if (select count(*) from connections where from_id = me and created_at > now() - interval '1 day')
     >= connect_setting('connect_daily_limit', 10) then
    return jsonb_build_object('ok', false, 'state', 'limit');
  end if;

  insert into connections (from_id, to_id, intent, note) values (me, p_to, p_intent, v_note) returning * into r;
  return jsonb_build_object('ok', true, 'state', 'sent', 'id', r.id, 'intent', r.intent, 'other', p_to, 'note', r.note);
end $$;

create or replace function public.respond_connect_v2(p_id uuid, p_accept boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  r connections;
begin
  if me is null then return jsonb_build_object('ok', false, 'state', 'signed_out'); end if;
  select * into r from connections where id = p_id and to_id = me;
  if not found then return jsonb_build_object('ok', false, 'state', 'not_found'); end if;
  perform expire_connections(r.from_id, r.to_id);
  select * into r from connections where id = p_id;
  if r.status <> 'pending' then return jsonb_build_object('ok', false, 'state', r.status); end if;
  if p_accept and (not is_member(r.from_id) or is_blocked(me, r.from_id)) then
    return jsonb_build_object('ok', false, 'state', 'not_found');
  end if;

  update connections
     set status = case when p_accept then 'accepted' else 'declined' end,
         decided_at = now(),
         to_seen_at = coalesce(to_seen_at, now())
   where id = p_id;
  return jsonb_build_object('ok', true, 'state', case when p_accept then 'matched' else 'declined' end,
                            'id', p_id, 'intent', r.intent, 'other', r.from_id);
end $$;

-- unmatch: the thread is deleted for both (the old function, same signature, now also clears messages)
create or replace function public.remove_connect(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  update connections set status = 'removed', decided_at = now()
   where id = p_id and auth.uid() in (from_id, to_id) and status = 'accepted';
  if found then delete from messages where connection_id = p_id; end if;
  return jsonb_build_object('ok', found);
end $$;

-- Everything you see about your connections: requests, matches (with unread + last message), sent.
create or replace function public.my_connections_v2() returns jsonb
language sql stable security definer set search_path = public as $$
  with mine as (
    select c.*,
           case when c.from_id = auth.uid() then 'out' else 'in' end as dir,
           case when c.from_id = auth.uid() then c.to_id else c.from_id end as other_id,
           case when c.from_id = auth.uid() then c.from_read_at else c.to_read_at end as my_read_at,
           c.created_at < now() - make_interval(days => connect_setting('connect_expiry_days', 14)) as stale
      from connections c
     where auth.uid() in (c.from_id, c.to_id)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', m.id,
           'dir', m.dir,
           'intent', m.intent,
           'note', m.note,
           'state', case when m.status = 'accepted' then 'matched' else 'pending' end,
           'created_at', m.created_at,
           'decided_at', case when m.status = 'accepted' then m.decided_at end,
           'seen', case when m.status = 'accepted' and m.dir = 'out' then m.from_seen_at is not null
                        when m.dir = 'in' then m.to_seen_at is not null
                        else true end,
           'other', jsonb_build_object('id', p.id, 'name', p.name, 'role', p.role, 'character', p.character, 'location', p.location),
           'last_message_at', m.last_message_at,
           'unread', case when m.status = 'accepted' then
                       (select count(*) from messages x
                         where x.connection_id = m.id and x.sender_id <> auth.uid()
                           and x.created_at > coalesce(m.my_read_at, '-infinity'::timestamptz))
                     else 0 end,
           'last', case when m.status = 'accepted' then
                     (select jsonb_build_object('body', left(x.body, 120), 'mine', x.sender_id = auth.uid(), 'at', x.created_at)
                        from messages x where x.connection_id = m.id order by x.created_at desc limit 1) end
         ) order by coalesce(m.last_message_at, m.decided_at, m.created_at) desc), '[]'::jsonb)
    from mine m
    join profiles p on p.id = m.other_id and p.status = 'approved'
   where not is_blocked(auth.uid(), m.other_id)
     and (m.status = 'accepted'
      -- open requests; a decline looks exactly like silence to the sender
      or (m.status = 'pending' and not m.stale)
      or (m.status = 'declined' and m.dir = 'out' and not m.stale))
$$;

-- ---------------------------------------------------------------------------
-- messages
-- ---------------------------------------------------------------------------

create or replace function public.send_message(p_conn uuid, p_body text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  c connections;
  v_body text := btrim(coalesce(p_body, ''));
  m messages;
begin
  if me is null then return jsonb_build_object('ok', false, 'state', 'signed_out'); end if;
  if not is_member(me) then return jsonb_build_object('ok', false, 'state', 'not_member'); end if;
  c := my_thread(p_conn);
  if c.id is null or is_blocked(c.from_id, c.to_id) then return jsonb_build_object('ok', false, 'state', 'not_found'); end if;
  if char_length(v_body) = 0 then return jsonb_build_object('ok', false, 'state', 'empty'); end if;
  if char_length(v_body) > 500 then return jsonb_build_object('ok', false, 'state', 'too_long'); end if;
  if (select count(*) from messages where sender_id = me and created_at > now() - interval '1 minute') >= 30 then
    return jsonb_build_object('ok', false, 'state', 'slow_down');
  end if;

  insert into messages (connection_id, sender_id, body) values (c.id, me, v_body) returning * into m;
  update connections
     set last_message_at = m.created_at,
         from_read_at = case when from_id = me then m.created_at else from_read_at end,
         to_read_at   = case when to_id = me then m.created_at else to_read_at end
   where id = c.id;
  return jsonb_build_object('ok', true, 'state', 'sent', 'message',
    jsonb_build_object('id', m.id, 'connection_id', m.connection_id, 'sender_id', m.sender_id, 'body', m.body, 'created_at', m.created_at));
end $$;

-- the newest p_limit messages before p_before (oldest first), for one of your threads
create or replace function public.thread_messages(p_conn uuid, p_before timestamptz default null, p_limit int default 50) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'connection_id', x.connection_id, 'sender_id', x.sender_id,
                                               'body', x.body, 'created_at', x.created_at) order by x.created_at), '[]'::jsonb)
    from (select * from messages
           where connection_id = (my_thread(p_conn)).id
             and created_at < coalesce(p_before, 'infinity'::timestamptz)
           order by created_at desc
           limit least(greatest(coalesce(p_limit, 50), 1), 100)) x
$$;

create or replace function public.mark_read(p_conn uuid) returns void
language sql security definer set search_path = public as $$
  update connections
     set from_read_at = case when from_id = auth.uid() then now() else from_read_at end,
         to_read_at   = case when to_id = auth.uid() then now() else to_read_at end
   where id = p_conn and status = 'accepted' and auth.uid() in (from_id, to_id)
$$;

-- ---------------------------------------------------------------------------
-- block, report, admin
-- ---------------------------------------------------------------------------

-- Ends anything open between you, deletes the thread for both, and stops either asking again.
create or replace function public.block_member(p_other uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
begin
  if me is null or p_other is null or p_other = me then return jsonb_build_object('ok', false); end if;
  insert into blocks (blocker_id, blocked_id) values (me, p_other) on conflict do nothing;
  delete from messages where connection_id in (
    select id from connections where (from_id = me and to_id = p_other) or (from_id = p_other and to_id = me));
  update connections set status = 'removed', decided_at = now()
   where status in ('pending', 'accepted')
     and ((from_id = me and to_id = p_other) or (from_id = p_other and to_id = me));
  return jsonb_build_object('ok', true);
end $$;

-- Copies what you saw (the request + the last 20 messages) for the admins, then blocks them.
create or replace function public.report_member(p_conn uuid, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  c connections;
  v_other uuid;
begin
  select * into c from connections where id = p_conn and me in (from_id, to_id);
  if not found then return jsonb_build_object('ok', false, 'state', 'not_found'); end if;
  v_other := case when c.from_id = me then c.to_id else c.from_id end;
  insert into reports (reporter_id, reported_id, reason, snapshot) values (
    me, v_other, left(nullif(btrim(coalesce(p_reason, '')), ''), 500),
    jsonb_build_object(
      'connection', jsonb_build_object('id', c.id, 'from_id', c.from_id, 'to_id', c.to_id, 'intent', c.intent,
                                       'note', c.note, 'status', c.status, 'created_at', c.created_at),
      'reported', (select jsonb_build_object('id', p.id, 'name', p.name, 'role', p.role) from profiles p where p.id = v_other),
      'messages', (select coalesce(jsonb_agg(jsonb_build_object('from', x.sender_id, 'body', x.body, 'at', x.created_at) order by x.created_at), '[]'::jsonb)
                     from (select * from messages where connection_id = c.id order by created_at desc limit 20) x)));
  perform block_member(v_other);
  return jsonb_build_object('ok', true);
end $$;

-- Admins: close a report; with p_hide the reported member leaves the city (profiles.status = hidden).
create or replace function public.admin_resolve_report(p_id uuid, p_hide boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r reports;
begin
  if not is_admin() then raise exception 'admins only'; end if;
  update reports set status = case when p_hide then 'hidden' else 'resolved' end,
                     resolved_by = auth.uid(), resolved_at = now()
   where id = p_id returning * into r;
  if not found then return jsonb_build_object('ok', false); end if;
  if p_hide and r.reported_id is not null then
    update profiles set status = 'hidden' where id = r.reported_id;
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------------
-- unread-message emails (called by the server with the service key, from /api/cron/chat-digest)
-- ---------------------------------------------------------------------------

-- Each person with messages unread for at least p_min_age in a thread, not emailed about that thread
-- within p_gap: who to email, from whom, how many.
create or replace function public.chat_digest_due(p_min_age interval default '10 minutes', p_gap interval default '6 hours')
returns table (connection_id uuid, recipient_id uuid, sender_id uuid, sender_name text, unread int)
language sql stable security definer set search_path = public as $$
  select c.id, side.recipient, side.sender, p.name, u.unread::int
    from connections c
    cross join lateral (
      values (c.to_id, c.from_id, c.to_read_at, c.to_emailed_at), (c.from_id, c.to_id, c.from_read_at, c.from_emailed_at)
    ) as side (recipient, sender, read_at, emailed_at)
    cross join lateral (
      select count(*) as unread, min(x.created_at) as first_at
        from messages x
       where x.connection_id = c.id and x.sender_id = side.sender
         and x.created_at > coalesce(side.read_at, '-infinity'::timestamptz)
    ) u
    join profiles p on p.id = side.sender and p.status = 'approved'
   where c.status = 'accepted'
     and c.last_message_at > now() - interval '7 days'
     and u.unread > 0
     and u.first_at < now() - p_min_age
     and (side.emailed_at is null or side.emailed_at < now() - p_gap)
     and coalesce((select ms.emails from member_settings ms where ms.user_id = side.recipient), true)
     and is_member(side.recipient)
   limit 200
$$;

create or replace function public.chat_mark_emailed(p_conn uuid, p_recipient uuid) returns void
language sql security definer set search_path = public as $$
  update connections
     set from_emailed_at = case when from_id = p_recipient then now() else from_emailed_at end,
         to_emailed_at   = case when to_id = p_recipient then now() else to_emailed_at end
   where id = p_conn
$$;

-- ---------------------------------------------------------------------------
-- realtime: each member listens on their own private topic "user:<id>"
-- ---------------------------------------------------------------------------

drop policy if exists "members hear their own topic" on realtime.messages;
create policy "members hear their own topic" on realtime.messages for select to authenticated
  using (realtime.topic() = 'user:' || auth.uid()::text);

-- never let a realtime hiccup fail the write that triggered it
create or replace function public.notify_user(p_user uuid, p_event text, p_payload jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform realtime.send(p_payload, p_event, 'user:' || p_user::text, true);
exception when others then
  raise warning 'notify_user failed: %', sqlerrm;
end $$;

create or replace function public.messages_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  c connections;
  v jsonb := jsonb_build_object('id', new.id, 'connection_id', new.connection_id, 'sender_id', new.sender_id,
                                'body', new.body, 'created_at', new.created_at);
begin
  select * into c from connections where id = new.connection_id;
  perform notify_user(c.from_id, 'message', v);
  perform notify_user(c.to_id, 'message', v);
  return null;
end $$;

drop trigger if exists messages_notify on public.messages;
create trigger messages_notify after insert on public.messages
  for each row execute function public.messages_notify();

-- requests, matches, unmatches: just "look again" (the list itself comes from my_connections_v2)
create or replace function public.connections_notify() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform notify_user(new.to_id, 'connections', jsonb_build_object('id', new.id));
  elsif new.status is distinct from old.status then
    perform notify_user(new.from_id, 'connections', jsonb_build_object('id', new.id));
    perform notify_user(new.to_id, 'connections', jsonb_build_object('id', new.id));
  end if;
  return null;
end $$;

drop trigger if exists connections_notify on public.connections;
create trigger connections_notify after insert or update of status on public.connections
  for each row execute function public.connections_notify();

-- ---------------------------------------------------------------------------
-- grants
-- ---------------------------------------------------------------------------

revoke execute on function
  public.is_blocked(uuid, uuid), public.my_thread(uuid),
  public.send_connect_v2(uuid, text, text), public.respond_connect_v2(uuid, boolean),
  public.my_connections_v2(), public.send_message(uuid, text), public.thread_messages(uuid, timestamptz, int),
  public.mark_read(uuid), public.block_member(uuid), public.report_member(uuid, text),
  public.admin_resolve_report(uuid, boolean),
  public.chat_digest_due(interval, interval), public.chat_mark_emailed(uuid, uuid),
  public.notify_user(uuid, text, jsonb), public.messages_notify(), public.connections_notify()
from anon, authenticated, public;

grant execute on function
  public.send_connect_v2(uuid, text, text), public.respond_connect_v2(uuid, boolean),
  public.my_connections_v2(), public.send_message(uuid, text), public.thread_messages(uuid, timestamptz, int),
  public.mark_read(uuid), public.block_member(uuid), public.report_member(uuid, text),
  public.admin_resolve_report(uuid, boolean)
to authenticated;

grant execute on function public.chat_digest_due(interval, interval), public.chat_mark_emailed(uuid, uuid) to service_role;

revoke all on public.blocks, public.messages from anon, authenticated;
revoke insert, update, delete on public.reports from anon, authenticated;

-- ==== supabase/migrations/20261011182137_api_grants.sql
-- People of Bengaluru — who may touch what through the API, written down.
-- Projects created before late 2026 (production) gave anon / authenticated / service_role broad access
-- to every new table by default; newer ones (the staging branch) give none. Row-level security still
-- decides which rows; these grants only say which tables and functions each role may reach at all.
-- On production this changes nothing (it already has these and more). Safe to re-run.

grant usage on schema public to anon, authenticated, service_role;

-- the server (service role key) does everything RLS doesn't let members do
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
alter default privileges in schema public grant execute on functions to service_role;

-- read: everyone sees approved profiles and the settings; members see their own rows (RLS)
grant select on public.profiles, public.app_settings to anon, authenticated;
grant select on public.invites, public.applications, public.member_settings, public.reports to authenticated;

-- write: your own profile (insert pending, delete; update is per column in 0001 / 0005) and email setting
grant insert, delete on public.profiles to authenticated;
grant insert, update on public.member_settings to authenticated;

-- connections, messages, blocks and admins stay closed: only the security-definer functions touch them

-- ==== supabase/migrations/20261012000000_drop_contacts.sql
-- People of Bengaluru — CHAT, PHASE B (CLAUDE.md Phase 5G). Run ONLY after production (main) runs the
-- chat code: the old site still reads contacts and calls the old connect functions.
-- Deletes every saved contact (WhatsApp numbers, handles): chat replaced the handoff, so we stop holding them.
--
-- Safe to re-run.

drop function if exists public.send_connect(uuid, text, text);
drop function if exists public.send_connect(uuid, text);
drop function if exists public.respond_connect(uuid, boolean);
drop function if exists public.my_connections();

drop table if exists public.contacts;
drop function if exists public.valid_contact(text, text);

-- ==== supabase/migrations/20261013121743_admin_invites.sql
-- People of Bengaluru — FOUNDER INVITES IN /admin (CLAUDE.md Phase 5D). Admins mint founder codes
-- (no owner) in batches with a label, see each one's state and who joined with it, rename the label
-- (who it went to) and revoke a code that hasn't been used. Every function checks is_admin() itself.
--
-- Safe to re-run.

-- Mint p_n founder codes (1–200), all with the same label.
create or replace function public.admin_issue_invites(p_n int, p_note text default null) returns setof text
language plpgsql volatile security definer set search_path = public as $$
declare
  c text;
  n text := left(nullif(trim(coalesce(p_note, '')), ''), 120);
begin
  if not is_admin() then raise exception 'admins only'; end if;
  if p_n is null or p_n < 1 or p_n > 200 then raise exception 'between 1 and 200 codes at a time'; end if;
  for c in select * from public.issue_invites(null, p_n) loop
    if n is not null then update invites set note = n where code = c; end if;
    return next c;
  end loop;
end $$;

-- Every founder code, newest first, with who joined with it.
create or replace function public.admin_founder_invites()
returns table (code text, state text, note text, created_at timestamptz, used_at timestamptz,
               used_by uuid, used_name text, used_role text, used_status text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'admins only'; end if;
  return query
    select i.code, i.state, i.note, i.created_at, i.used_at, i.used_by, p.name, p.role, p.status
      from invites i
      left join profiles p on p.id = i.used_by
     where i.owner is null
     order by i.created_at desc, i.code;
end $$;

-- Who a founder code went to (or the batch label). Empty clears it.
create or replace function public.admin_set_invite_note(p_code text, p_note text) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'admins only'; end if;
  update invites set note = left(nullif(trim(coalesce(p_note, '')), ''), 120)
   where code = upper(trim(p_code)) and owner is null;
  return jsonb_build_object('ok', found);
end $$;

-- Kill a founder code that hasn't been used (it then answers "invalid" at the gate).
create or replace function public.admin_revoke_invite(p_code text) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'admins only'; end if;
  update invites set state = 'revoked'
   where code = upper(trim(p_code)) and owner is null and state in ('available', 'sent');
  return jsonb_build_object('ok', found);
end $$;

revoke execute on function
  public.admin_issue_invites(int, text), public.admin_founder_invites(),
  public.admin_set_invite_note(text, text), public.admin_revoke_invite(text)
from public, anon;

grant execute on function
  public.admin_issue_invites(int, text), public.admin_founder_invites(),
  public.admin_set_invite_note(text, text), public.admin_revoke_invite(text)
to authenticated;

-- ==== supabase/migrations/20261013160000_application_whatsapp.sql
-- People of Bengaluru — an optional WhatsApp number on the application (CLAUDE.md 5E).
-- Asked on the email step of Apply to join, so a reviewer can reach the applicant. It lives only on the
-- application (applicant + admins can read it, same RLS as the answers); it is never copied to the profile
-- and never shown in the city.
--
-- Additive and backward compatible: the old client simply doesn't send it. Safe to re-run.

alter table public.applications add column if not exists whatsapp text
  check (whatsapp ~ '^\+[1-9][0-9]{7,14}$');

create or replace function public.submit_application(p_answers jsonb, p_profile jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  mail text := auth.jwt() ->> 'email';
  cur public.applications;
  new_id uuid;
  wa text := nullif(trim(coalesce(p_answers ->> 'whatsapp', '')), '');
begin
  if uid is null or mail is null then
    return jsonb_build_object('ok', false, 'state', 'signed_out');
  end if;

  -- already in the city: nothing to apply for
  if exists (select 1 from public.profiles where id = uid and status = 'approved') then
    return jsonb_build_object('ok', false, 'state', 'member');
  end if;

  if char_length(coalesce(p_profile ->> 'name', '')) < 2 or char_length(coalesce(p_profile ->> 'role', '')) < 2 then
    return jsonb_build_object('ok', false, 'state', 'invalid');
  end if;

  select * into cur from public.applications
    where user_id = uid and status not in ('rejected', 'refunded')
    for update;

  if cur.id is not null and cur.status not in ('draft', 'submitted') then
    -- paid: the reviewer is looking at exactly what was paid for
    return jsonb_build_object('ok', false, 'state', 'in_review', 'status', cur.status);
  end if;

  begin
    if cur.id is not null then
      update public.applications set
        email = mail,
        why = trim(p_answers ->> 'why'),
        want = trim(p_answers ->> 'want'),
        bring = trim(p_answers ->> 'bring'),
        show_link = trim(p_answers ->> 'show_link'),
        show_why = trim(p_answers ->> 'show_why'),
        whatsapp = wa,
        profile = p_profile,
        status = 'submitted'
      where id = cur.id;
      new_id := cur.id;
    else
      insert into public.applications (user_id, email, why, want, bring, show_link, show_why, whatsapp, profile)
      values (
        uid, mail,
        trim(p_answers ->> 'why'),
        trim(p_answers ->> 'want'),
        trim(p_answers ->> 'bring'),
        trim(p_answers ->> 'show_link'),
        trim(p_answers ->> 'show_why'),
        wa,
        p_profile
      )
      returning id into new_id;
    end if;
  exception when check_violation or not_null_violation then
    return jsonb_build_object('ok', false, 'state', 'invalid');
  end;

  return jsonb_build_object('ok', true, 'id', new_id, 'status', 'submitted');
end $$;

revoke execute on function public.submit_application(jsonb, jsonb) from public, anon;
grant execute on function public.submit_application(jsonb, jsonb) to authenticated;

-- ==== supabase/migrations/20261013170000_application_one_question.sql
-- People of Bengaluru — the application asks one question now (CLAUDE.md 5E): WHY HERE?
-- The other three (looking for, will bring, show us one thing) are gone: their columns are dropped
-- (existing answers in them are deleted) and submit_application no longer writes them.
--
-- Safe to re-run.

alter table public.applications
  drop column if exists want,
  drop column if exists bring,
  drop column if exists show_link,
  drop column if exists show_why;

create or replace function public.submit_application(p_answers jsonb, p_profile jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  mail text := auth.jwt() ->> 'email';
  cur public.applications;
  new_id uuid;
  wa text := nullif(trim(coalesce(p_answers ->> 'whatsapp', '')), '');
begin
  if uid is null or mail is null then
    return jsonb_build_object('ok', false, 'state', 'signed_out');
  end if;

  -- already in the city: nothing to apply for
  if exists (select 1 from public.profiles where id = uid and status = 'approved') then
    return jsonb_build_object('ok', false, 'state', 'member');
  end if;

  if char_length(coalesce(p_profile ->> 'name', '')) < 2 or char_length(coalesce(p_profile ->> 'role', '')) < 2 then
    return jsonb_build_object('ok', false, 'state', 'invalid');
  end if;

  select * into cur from public.applications
    where user_id = uid and status not in ('rejected', 'refunded')
    for update;

  if cur.id is not null and cur.status not in ('draft', 'submitted') then
    -- paid: the reviewer is looking at exactly what was paid for
    return jsonb_build_object('ok', false, 'state', 'in_review', 'status', cur.status);
  end if;

  begin
    if cur.id is not null then
      update public.applications set
        email = mail,
        why = trim(p_answers ->> 'why'),
        whatsapp = wa,
        profile = p_profile,
        status = 'submitted'
      where id = cur.id;
      new_id := cur.id;
    else
      insert into public.applications (user_id, email, why, whatsapp, profile)
      values (
        uid, mail,
        trim(p_answers ->> 'why'),
        wa,
        p_profile
      )
      returning id into new_id;
    end if;
  exception when check_violation or not_null_violation then
    return jsonb_build_object('ok', false, 'state', 'invalid');
  end;

  return jsonb_build_object('ok', true, 'id', new_id, 'status', 'submitted');
end $$;

revoke execute on function public.submit_application(jsonb, jsonb) from public, anon;
grant execute on function public.submit_application(jsonb, jsonb) to authenticated;

-- ==== supabase/migrations/20261014120000_application_without_signin.sql
-- People of Bengaluru — APPLY WITHOUT SIGNING IN (CLAUDE.md Phase 5E, while applications are free)
-- With no payment there is nothing to tie to a verified account, so the applicant no longer confirms
-- their email first. /api/apply/submit (service role) finds or creates the account for that email and
-- puts the application straight into the review queue. The magic link comes later, to sign in once approved.
--
-- Safe to re-run.

create or replace function public.submit_application_for(p_email text, p_answers jsonb, p_profile jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  uid uuid;
  mail text;
  confirmed timestamptz;
  cur public.applications;
  new_id uuid;
  wa text := nullif(trim(coalesce(p_answers ->> 'whatsapp', '')), '');
begin
  select id, email, email_confirmed_at into uid, mail, confirmed from auth.users where lower(email) = lower(trim(p_email)) limit 1;
  if uid is null then
    return jsonb_build_object('ok', false, 'state', 'no_user');
  end if;

  if exists (select 1 from public.profiles where id = uid and status = 'approved') then
    return jsonb_build_object('ok', false, 'state', 'member');
  end if;

  -- nobody signed in here, so never touch an account someone has proven: they apply signed in
  if confirmed is not null then
    return jsonb_build_object('ok', false, 'state', 'signin_required');
  end if;

  if char_length(coalesce(p_profile ->> 'name', '')) < 2 or char_length(coalesce(p_profile ->> 'role', '')) < 2 then
    return jsonb_build_object('ok', false, 'state', 'invalid');
  end if;

  select * into cur from public.applications
    where user_id = uid and status not in ('rejected', 'refunded')
    for update;

  -- an open application is never rewritten from outside: the reviewer keeps what was sent
  if cur.id is not null then
    return jsonb_build_object('ok', false, 'state',
      case when cur.status in ('draft', 'submitted') then 'signin_required' else 'in_review' end);
  end if;

  begin
    insert into public.applications (user_id, email, why, whatsapp, profile, status)
    values (uid, mail, trim(p_answers ->> 'why'), wa, p_profile, 'under_review')
    returning id into new_id;
  exception when check_violation or not_null_violation then
    return jsonb_build_object('ok', false, 'state', 'invalid');
  end;

  return jsonb_build_object('ok', true, 'id', new_id, 'status', 'under_review');
end $$;

-- the server only: anyone could otherwise apply in someone else's name without the route's checks
revoke execute on function public.submit_application_for(text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.submit_application_for(text, jsonb, jsonb) to service_role;

-- ==== supabase/migrations/20261017090000_check_invite_name.sql
-- People of Bengaluru — founder codes vouch as "People of Bengaluru" (was "Designers of Bengaluru").
-- check_invite() unchanged otherwise. Safe to re-run.

create or replace function public.check_invite(p_code text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  r public.invites;
  st text;
  who public.profiles;
begin
  select * into r from public.invites where code = upper(trim(p_code));
  st := public.invite_state(r);
  if st <> 'ok' then
    return jsonb_build_object('state', st);
  end if;
  select * into who from public.profiles where id = r.owner;
  return jsonb_build_object(
    'state', 'ok',
    'inviter_name', coalesce(who.name, 'The founders'),
    'inviter_role', coalesce(who.role, 'People of Bengaluru')
  );
end $$;

grant execute on function public.check_invite(text) to anon, authenticated;

-- ==== supabase/migrations/20261017120000_chat_digest_once.sql
-- People of Bengaluru — CHAT DIGEST: one email per batch of unread messages (CLAUDE.md 5G)
-- Bug: chat_digest_due() re-sent "X sent you a message" every 6 hours for as long as the messages
-- stayed unread (up to 7 days), about the same old messages. Now a chat is due only when a message
-- arrived after the last email (and still at most once per 6 hours). Safe to re-run.

create or replace function public.chat_digest_due(p_min_age interval default '10 minutes', p_gap interval default '6 hours')
returns table (connection_id uuid, recipient_id uuid, sender_id uuid, sender_name text, unread int)
language sql stable security definer set search_path = public as $$
  select c.id, side.recipient, side.sender, p.name, u.unread::int
    from connections c
    cross join lateral (
      values (c.to_id, c.from_id, c.to_read_at, c.to_emailed_at), (c.from_id, c.to_id, c.from_read_at, c.from_emailed_at)
    ) as side (recipient, sender, read_at, emailed_at)
    cross join lateral (
      select count(*) as unread, min(x.created_at) as first_at, max(x.created_at) as last_at
        from messages x
       where x.connection_id = c.id and x.sender_id = side.sender
         and x.created_at > coalesce(side.read_at, '-infinity'::timestamptz)
    ) u
    join profiles p on p.id = side.sender and p.status = 'approved'
   where c.status = 'accepted'
     and c.last_message_at > now() - interval '7 days'
     and u.unread > 0
     and u.first_at < now() - p_min_age
     -- something new since the last email, and not more than once per p_gap
     and (side.emailed_at is null or (u.last_at > side.emailed_at and side.emailed_at < now() - p_gap))
     and coalesce((select ms.emails from member_settings ms where ms.user_id = side.recipient), true)
     and is_member(side.recipient)
   limit 200
$$;

revoke execute on function public.chat_digest_due(interval, interval) from public, anon, authenticated;
grant execute on function public.chat_digest_due(interval, interval) to service_role;

-- ==== supabase/migrations/20261122120000_businesses.sql
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
