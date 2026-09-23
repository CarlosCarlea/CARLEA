-- HISTORICAL PROPOSAL, INCOMPATIBLE WITH THE INSPECTED LIVE SCHEMA. DO NOT APPLY.
-- CARLÉA 3.1 MVP — migración de suscripciones por creadora a suscripción global.
-- REVISAR EN UN PROYECTO DE PRUEBAS ANTES DE PRODUCCIÓN.
-- No ejecutar junto con CAMBIOS_BASE_DATOS.sql: ese archivo corresponde a 3.0.

begin;

create table if not exists public.platform_plans (
  tier text primary key check (tier in ('premium','diamond')),
  price_cop integer not null check (price_cop in (19900,39900)),
  description text not null default '',
  active boolean not null default true,
  updated_at timestamptz not null default now()
);

insert into public.platform_plans(tier,price_cop,description)
values
  ('premium',19900,'Contenido Premium y chat de texto con todas las creadoras'),
  ('diamond',39900,'Todo Premium, contenido Diamante, multimedia y solicitudes de videollamada')
on conflict(tier) do update set
  price_cop=excluded.price_cop,
  description=excluded.description,
  active=true,
  updated_at=now();

create table if not exists public.platform_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles(id) on delete cascade,
  tier text not null references public.platform_plans(tier),
  status text not null default 'requested' check(status in ('requested','active','cancelled','expired')),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.registration_details (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  birth_date date not null,
  account_kind text not null default 'user' check(account_kind in ('user','creator')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function carlea_private.guard_adult_registration()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if new.birth_date > current_date - interval '18 years' or new.birth_date < date '1900-01-01' then
    raise exception 'Debes tener 18 años o más';
  end if;
  new.updated_at=now();
  return new;
end $$;

drop trigger if exists registration_adult_guard on public.registration_details;
create trigger registration_adult_guard
before insert or update on public.registration_details
for each row execute function carlea_private.guard_adult_registration();

alter table public.platform_plans enable row level security;
alter table public.platform_subscriptions enable row level security;
alter table public.registration_details enable row level security;

grant select on public.platform_plans to anon,authenticated;
grant select on public.platform_subscriptions,public.registration_details to authenticated;
grant insert(user_id,birth_date,account_kind),update(birth_date,account_kind,updated_at) on public.registration_details to authenticated;

drop policy if exists platform_plans_read on public.platform_plans;
create policy platform_plans_read on public.platform_plans for select
to anon,authenticated using(active or public.is_admin());

drop policy if exists platform_plans_admin_update on public.platform_plans;
create policy platform_plans_admin_update on public.platform_plans for update
to authenticated using(public.is_admin()) with check(public.is_admin());
grant update(price_cop,description,active,updated_at) on public.platform_plans to authenticated;

drop policy if exists platform_subscriptions_read on public.platform_subscriptions;
create policy platform_subscriptions_read on public.platform_subscriptions for select
to authenticated using(user_id=(select auth.uid()) or public.is_admin());

drop policy if exists registration_details_read on public.registration_details;
create policy registration_details_read on public.registration_details for select
to authenticated using(user_id=(select auth.uid()) or public.is_admin());

drop policy if exists registration_details_insert on public.registration_details;
create policy registration_details_insert on public.registration_details for insert
to authenticated with check(user_id=(select auth.uid()));

drop policy if exists registration_details_update on public.registration_details;
create policy registration_details_update on public.registration_details for update
to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));

-- Conserva el mejor plan vigente o solicitado de cada usuario existente.
insert into public.platform_subscriptions(user_id,tier,status,expires_at,created_at,updated_at)
select distinct on (user_id)
  user_id,tier,status,expires_at,created_at,now()
from public.creator_subscriptions
where status in ('active','requested')
order by user_id,(status='active') desc,(tier='diamond') desc,expires_at desc nulls last,created_at desc
on conflict(user_id) do update set
  tier=excluded.tier,
  status=excluded.status,
  expires_at=excluded.expires_at,
  updated_at=now();

create or replace function carlea_private.tier(cid uuid)
returns integer language sql stable security definer set search_path='' as $$
select case
  when auth.uid() is null or not public.is_active() then 0
  when public.is_admin() or public.owns_creator(cid) then 2
  else greatest(
    coalesce((select case plan when 'premium' then 2 when 'essential' then 1 else 0 end from public.profiles where id=auth.uid()),0),
    coalesce((select case tier when 'diamond' then 2 else 1 end from public.platform_subscriptions where user_id=auth.uid() and status='active' and expires_at>now()),0)
  )
end $$;

create or replace function carlea_private.media_allowed(cid uuid)
returns boolean language sql stable security definer set search_path='' as $$
select auth.uid() is not null and exists(
  select 1
  from public.conversations cv
  join public.profiles p on p.id=cv.user_id
  where cv.id=cid and (
    p.plan='premium' or exists(
      select 1 from public.platform_subscriptions s
      where s.user_id=cv.user_id and s.tier='diamond' and s.status='active' and s.expires_at>now()
    )
  )
) $$;

create or replace function carlea_private.can_chat(cid uuid)
returns boolean language sql stable security definer set search_path='' as $$
select carlea_private.participant(cid) and exists(
  select 1
  from public.conversations cv
  join public.profiles p on p.id=cv.user_id
  where cv.id=cid and (
    p.plan in ('essential','premium') or exists(
      select 1 from public.platform_subscriptions s
      where s.user_id=cv.user_id and s.status='active' and s.expires_at>now()
    )
  )
) $$;

create or replace function carlea_private.request_global_subscription(t text)
returns void language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or not public.is_active() or t not in ('premium','diamond') then
    raise exception 'Cuenta activa y plan válido requeridos';
  end if;
  if not exists(select 1 from public.platform_plans where tier=t and active) then
    raise exception 'Plan no disponible';
  end if;
  if exists(select 1 from public.platform_subscriptions where user_id=auth.uid() and status='active' and expires_at>now()) then
    raise exception 'Ya tienes un plan global activo; contacta a administración para cambiarlo';
  end if;
  insert into public.platform_subscriptions(user_id,tier,status,expires_at,updated_at)
  values(auth.uid(),t,'requested',null,now())
  on conflict(user_id) do update set tier=excluded.tier,status='requested',expires_at=null,updated_at=now();
end $$;

create or replace function public.request_global_subscription(t text)
returns void language sql security invoker set search_path='' as $$
select carlea_private.request_global_subscription(t)
$$;

create or replace function carlea_private.subscription_action(sid uuid,decision text)
returns void language plpgsql security definer set search_path='' as $$
declare s public.platform_subscriptions;
begin
  if auth.uid() is null then raise exception 'Acceso requerido'; end if;
  select * into s from public.platform_subscriptions where id=sid for update;
  if not found then raise exception 'Suscripción no encontrada'; end if;
  if decision='cancelled' and (s.user_id=auth.uid() or public.is_admin()) then
    update public.platform_subscriptions set status='cancelled',updated_at=now() where id=sid;
  elsif decision='active' and public.is_admin() then
    update public.platform_subscriptions set status='active',expires_at=now()+interval '1 month',updated_at=now() where id=sid;
    insert into public.admin_audit(admin_id,action,target_id,reason)
    values(auth.uid(),'global_subscription_activation',sid,'Activación global manual; pago verificado fuera de plataforma');
  else
    raise exception 'Acción no permitida';
  end if;
end $$;

create or replace function public.subscription_action(sid uuid,decision text)
returns void language sql security invoker set search_path='' as $$
select carlea_private.subscription_action(sid,decision)
$$;

create or replace function public.get_or_create_conversation(p_creator_id uuid)
returns uuid language plpgsql security invoker set search_path='' as $$
declare v_id uuid;
begin
  if carlea_private.tier(p_creator_id)<1 then raise exception 'Necesitas una suscripción global Premium o Diamante'; end if;
  if not exists(select 1 from public.creators where id=p_creator_id and chat_open and active and user_id is not null and user_id<>auth.uid()) then
    raise exception 'La creadora no está disponible para chat';
  end if;
  select id into v_id from public.conversations where user_id=auth.uid() and creator_id=p_creator_id;
  if v_id is null then
    insert into public.conversations(user_id,creator_id) values(auth.uid(),p_creator_id) returning id into v_id;
  end if;
  return v_id;
end $$;

revoke all on function carlea_private.request_global_subscription(text) from public,anon;
revoke all on function public.request_global_subscription(text) from public,anon;
grant execute on function carlea_private.request_global_subscription(text),public.request_global_subscription(text) to authenticated;
revoke all on function public.subscription_action(uuid,text),public.get_or_create_conversation(uuid) from public,anon;
grant execute on function public.subscription_action(uuid,text),public.get_or_create_conversation(uuid) to authenticated;
revoke insert,update on public.creator_subscriptions from authenticated;

commit;
