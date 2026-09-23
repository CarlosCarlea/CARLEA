-- Reduced, synthetic local fixture, NOT a production bootstrap or schema dump.
create role anon;
create role authenticated;
create schema auth;
create schema carlea_private;
grant usage on schema public,auth,carlea_private to anon,authenticated;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
create type public.user_plan as enum ('none','free','essential','premium','diamond');
create table public.profiles(id uuid primary key,role text,status text,plan public.user_plan,display_name text);
create table public.creators(id uuid primary key,user_id uuid references public.profiles,stage_name text,active boolean);
create table public.conversations(id uuid primary key,user_id uuid references public.profiles,creator_id uuid references public.creators);
create table public.client_subscriptions(
  id uuid primary key default gen_random_uuid(),user_id uuid not null references public.profiles,
  plan public.user_plan not null check(plan in ('premium','diamond')),
  status text not null default 'pending' check(status in ('pending','active','cancelled','expired')),
  starts_at timestamptz,ends_at timestamptz,payment_request_id uuid,
  created_at timestamptz default now(),updated_at timestamptz default now()
);
create table public.admin_audit(id uuid primary key default gen_random_uuid(),admin_id uuid references public.profiles,
  action text,target_id uuid,reason text,created_at timestamptz default now());
create table public.notifications(id uuid primary key default gen_random_uuid(),user_id uuid references public.profiles,
  type text,title text,body text,entity_type text,entity_id uuid);
create table public.experiences(id uuid primary key,creator_id uuid references public.creators,active boolean);
create table public.experience_requests(id uuid primary key default gen_random_uuid(),user_id uuid references public.profiles,
  creator_id uuid references public.creators,experience_id uuid references public.experiences,user_notes text);
create function public.is_active() returns boolean language sql stable security definer set search_path='' as $$
  select coalesce((select status='active' from public.profiles where id=auth.uid()),false)
$$;
create function public.is_admin() returns boolean language sql stable security definer set search_path='' as $$
  select coalesce((select role='admin' and status='active' from public.profiles where id=auth.uid()),false)
$$;
create function public.owns_creator(cid uuid) returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.creators where id=cid and user_id=auth.uid())
$$;
create function carlea_private.participant(cid uuid) returns boolean language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and public.is_active() and exists(
    select 1 from public.conversations cv join public.creators c on c.id=cv.creator_id
    join public.profiles p on p.id=cv.user_id where cv.id=cid and c.active and p.status='active'
    and (cv.user_id=auth.uid() or c.user_id=auth.uid())
    and exists(select 1 from public.profiles cp where cp.id=c.user_id and cp.status='active'))
$$;
alter table public.client_subscriptions enable row level security;
create policy client_subscriptions_read on public.client_subscriptions for select to authenticated
  using(user_id=auth.uid() or public.is_admin());
grant select on public.client_subscriptions to authenticated;
