-- CARLEA review 3.2 / MIGRATION 001. DO NOT APPLY TO PRODUCTION YET.
-- Target: existing CARLEA schema inspected on 2026-09-21.
-- No new tables, no data deletion, no automatic conversion of historic payments.
-- Apply once through migrations, first to an isolated copy of the existing schema.
begin;

do $$
begin
  if to_regclass('public.client_subscriptions') is null
     or to_regclass('public.admin_audit') is null
     or to_regprocedure('carlea_private.participant(uuid)') is null then
    raise exception 'Required existing CARLEA schema is missing; stop and review';
  end if;
end $$;

alter table public.client_subscriptions
  add column if not exists cancel_at_period_end boolean not null default false,
  add column if not exists cancelled_at timestamptz,
  add column if not exists verified_at timestamptz,
  add column if not exists verified_by uuid references public.profiles(id) on delete set null,
  add column if not exists payment_reference text;

comment on column public.client_subscriptions.verified_at is
  'Server-recorded manual payment review. NULL rows created after the 3.2 cutoff never grant paid access. Pre-cutoff active rows retain only their original unexpired period. Not a provider webhook.';
comment on column public.client_subscriptions.payment_reference is
  'Non-secret external payment reference entered by an authorized administrator after independent verification.';
comment on column public.client_subscriptions.cancel_at_period_end is
  'Cancellation retains access until ends_at; does not imply provider cancellation. No provider is integrated.';

-- Existing rows remain untouched; constraints apply to new/updated rows.
alter table public.client_subscriptions
  add constraint carlea_subscription_verified_period
    check (verified_at is null or
      (status in ('active','cancelled','expired') and starts_at is not null
       and ends_at is not null and ends_at > starts_at
       and length(btrim(payment_reference)) between 5 and 160
       and payment_reference is not null)) not valid;

create index if not exists carlea_client_entitlement_lookup
  on public.client_subscriptions(user_id, ends_at desc)
  where status = 'active' and verified_at is not null;
create index if not exists carlea_client_history_lookup
  on public.client_subscriptions(user_id, created_at desc);
create index if not exists carlea_client_verifier_lookup
  on public.client_subscriptions(verified_by) where verified_by is not null;
create unique index if not exists carlea_manual_payment_reference_unique
  on public.client_subscriptions(payment_reference) where payment_reference is not null;

-- Reuse existing RLS SELECT policies (self/admin). Only audited RPCs write.
alter table public.client_subscriptions enable row level security;
revoke insert, update, delete, truncate, references, trigger
  on public.client_subscriptions from public, anon, authenticated;
grant select on public.client_subscriptions to authenticated;

-- Internal-only helper accepts a uid, never exposed to browser roles.
create or replace function carlea_private.membership_tier(uid uuid)
returns integer language sql stable security definer set search_path = ''
as $$
  select coalesce(max(case s.plan when 'diamond' then 2 when 'premium' then 1 else 0 end),0)
  from public.client_subscriptions s join public.profiles p on p.id=s.user_id
  where s.user_id=uid and p.status='active' and s.status='active'
    and (s.verified_at is not null
      or s.created_at<timestamptz '2026-09-21 16:17:04+00')
    and s.starts_at<=now() and s.ends_at>now()
$$;
revoke all on function carlea_private.membership_tier(uuid) from public, anon, authenticated;

-- Single permission matrix, shared by user and conversation capabilities.
create or replace function carlea_private.membership_capabilities(level integer)
returns jsonb language sql immutable set search_path = ''
as $$
  select jsonb_build_object(
    'canMessage',level>=1,'canSendText',level>=1,'canReceiveText',level>=1,
    'canSendMedia',level>=2,'canReceiveMedia',level>=2,
    'canSendAudio',level>=2,'canReceiveAudio',level>=2,
    'canAccessPremium',level>=1,'canAccessDiamond',level>=2,
    'canRequestVideoCall',level>=2)
$$;
revoke all on function carlea_private.membership_capabilities(integer) from public, anon, authenticated;

create or replace function carlea_private.get_my_entitlements()
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare level integer; until_at timestamptz;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  level := carlea_private.membership_tier(auth.uid());
  select max(s.ends_at) into until_at from public.client_subscriptions s
    where s.user_id=auth.uid() and s.status='active'
      and (s.verified_at is not null
        or s.created_at<timestamptz '2026-09-21 16:17:04+00')
      and s.starts_at<=now() and s.ends_at>now()
      and s.plan::text=case level when 2 then 'diamond' when 1 then 'premium' else 'free' end;
  return jsonb_build_object('schema_version',1,
    'plan',case level when 2 then 'diamond' when 1 then 'premium' else 'free' end,
    'valid_until',until_at,'capabilities',carlea_private.membership_capabilities(level));
end $$;
create or replace function public.get_my_entitlements()
returns jsonb language sql stable security invoker set search_path = ''
as $$ select carlea_private.get_my_entitlements() $$;
revoke all on function carlea_private.get_my_entitlements(),public.get_my_entitlements() from public,anon;
grant execute on function carlea_private.get_my_entitlements(),public.get_my_entitlements() to authenticated;

-- Preserve creator ownership and active admin moderation, separately from plans.
create or replace function carlea_private.tier(cid uuid)
returns integer language sql stable security definer set search_path = ''
as $$
  select case when auth.uid() is null or not public.is_active() then 0
    when public.is_admin() or public.owns_creator(cid) then 2
    else carlea_private.membership_tier(auth.uid()) end
$$;
create or replace function carlea_private.current_app_plan()
returns public.user_plan language sql stable security definer set search_path = ''
as $$
  select (case carlea_private.membership_tier(auth.uid())
    when 2 then 'diamond' when 1 then 'premium' else 'free' end)::public.user_plan
$$;
create or replace function carlea_private.can_chat(cid uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select carlea_private.participant(cid) and exists (
    select 1 from public.conversations cv where cv.id=cid
      and carlea_private.membership_tier(cv.user_id)>=1)
$$;
create or replace function carlea_private.media_allowed(cid uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select carlea_private.participant(cid) and exists (
    select 1 from public.conversations cv where cv.id=cid
      and carlea_private.membership_tier(cv.user_id)>=2)
$$;
create or replace function carlea_private.conversation_capabilities(cid uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare result jsonb;
begin
  if auth.uid() is null or not carlea_private.can_chat(cid) then
    raise exception 'Esta conversación requiere una membresía Premium vigente'; end if;
  select carlea_private.membership_capabilities(carlea_private.membership_tier(cv.user_id))
    || jsonb_build_object('media',carlea_private.media_allowed(cid),
      'peer_name',case when cv.user_id=auth.uid() then c.stage_name else p.display_name end)
    into result from public.conversations cv
    join public.creators c on c.id=cv.creator_id join public.profiles p on p.id=cv.user_id
    where cv.id=cid;
  return result;
end $$;

create or replace function carlea_private.request_client_membership(p_plan text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare result uuid;
begin
  if auth.uid() is null or not public.is_active() then raise exception 'Cuenta activa requerida'; end if;
  if p_plan is null or p_plan not in ('premium','diamond') then raise exception 'Plan no válido'; end if;
  -- Serialize requests, cancellation and activation on the account row.
  perform 1 from public.profiles where id=auth.uid() for update;
  if exists(select 1 from public.client_subscriptions where user_id=auth.uid()
      and status='active' and ends_at>now()) then
    raise exception 'Ya tienes una membresía vigente; solicita a soporte un cambio de plan'; end if;
  select id into result from public.client_subscriptions where user_id=auth.uid()
    and status='pending' and plan::text=p_plan order by created_at desc limit 1;
  if result is not null then return result; end if;
  if exists(select 1 from public.client_subscriptions where user_id=auth.uid()
      and status='pending') then raise exception 'Cancela primero tu solicitud pendiente'; end if;
  if (select count(*) from public.client_subscriptions where user_id=auth.uid()
      and created_at>now()-interval '1 day')>=5 then
    raise exception 'Límite diario de solicitudes alcanzado'; end if;
  insert into public.client_subscriptions(user_id,plan,status)
    values(auth.uid(),p_plan::public.user_plan,'pending') returning id into result;
  return result;
end $$;
create or replace function public.request_client_membership(p_plan text)
returns uuid language sql security invoker set search_path = ''
as $$ select carlea_private.request_client_membership(p_plan) $$;

create or replace function carlea_private.cancel_client_membership(p_subscription_id uuid)
returns timestamptz language plpgsql security definer set search_path = ''
as $$
declare s public.client_subscriptions;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  perform 1 from public.profiles where id=auth.uid() for update;
  select * into s from public.client_subscriptions where id=p_subscription_id
    and user_id=auth.uid() for update;
  if not found then raise exception 'Suscripción no disponible'; end if;
  if s.cancelled_at is not null then return s.ends_at; end if;
  if s.status not in ('active','pending') then return s.ends_at; end if;
  update public.client_subscriptions set cancel_at_period_end=(s.status='active'),
    cancelled_at=now(),status=case when s.status='pending' then 'cancelled' else status end,
    updated_at=now() where id=s.id;
  insert into public.notifications(user_id,type,title,body)
    values(auth.uid(),'system','Cancelación registrada',
      case when s.status='active' then 'Conservarás el acceso hasta el final del período contratado.'
        else 'Se canceló tu solicitud. No se realizó un cobro.' end);
  return s.ends_at;
end $$;
create or replace function public.cancel_client_membership(p_subscription_id uuid)
returns timestamptz language sql security invoker set search_path = ''
as $$ select carlea_private.cancel_client_membership(p_subscription_id) $$;

-- Temporary authorized manual verification. Never called by customer checkout.
-- No gateway integration or payment approval is simulated.
create or replace function carlea_private.admin_verify_client_membership(
  p_subscription_id uuid,p_reference text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare s public.client_subscriptions; owner_id uuid; ref text := btrim(p_reference);
begin
  if not public.is_admin() then raise exception 'Solo administración activa'; end if;
  if ref is null or length(ref)<5 or length(ref)>160 then
    raise exception 'Registra una referencia de pago verificada (5–160 caracteres)'; end if;
  select user_id into owner_id from public.client_subscriptions where id=p_subscription_id;
  if owner_id is null then raise exception 'Suscripción no disponible'; end if;
  perform 1 from public.profiles where id=owner_id and status='active' for update;
  if not found then raise exception 'La cuenta debe estar activa'; end if;
  select * into s from public.client_subscriptions where id=p_subscription_id for update;
  if s.verified_at is not null then
    if s.payment_reference=ref then return s.id; end if;
    raise exception 'Suscripción ya verificada; no se modificó su vigencia';
  end if;
  if s.status not in ('pending','active') then raise exception 'Estado no verificable'; end if;
  if s.status='active' and (s.starts_at is null or s.starts_at>now()
      or s.ends_at is null or s.ends_at<=now()) then
    raise exception 'Período histórico inválido o vencido; requiere revisión'; end if;
  if exists(select 1 from public.client_subscriptions where user_id=owner_id
      and id<>s.id and status='active' and ends_at>now()) then
    raise exception 'Hay otra membresía vigente; resuelve el solapamiento antes de continuar'; end if;
  update public.client_subscriptions set status='active',
    starts_at=case when s.status='pending' then now() else s.starts_at end,
    ends_at=case when s.status='pending' then now()+interval '1 month' else s.ends_at end,
    verified_at=now(),verified_by=auth.uid(),payment_reference=ref,updated_at=now()
    where id=s.id;
  insert into public.admin_audit(admin_id,action,target_id,reason)
    values(auth.uid(),'membership.manual_payment_verified',s.id,ref);
  insert into public.notifications(user_id,type,title,body)
    values(owner_id,'system','Membresía verificada',
      'Tu membresía fue activada tras una revisión manual del pago.');
  return s.id;
end $$;
create or replace function public.admin_verify_client_membership(
  p_subscription_id uuid,p_reference text)
returns uuid language sql security invoker set search_path = ''
as $$ select carlea_private.admin_verify_client_membership(p_subscription_id,p_reference) $$;

revoke all on function
  carlea_private.request_client_membership(text), public.request_client_membership(text),
  carlea_private.cancel_client_membership(uuid), public.cancel_client_membership(uuid),
  carlea_private.admin_verify_client_membership(uuid,text), public.admin_verify_client_membership(uuid,text)
  from public,anon;
grant execute on function
  carlea_private.request_client_membership(text), public.request_client_membership(text),
  carlea_private.cancel_client_membership(uuid), public.cancel_client_membership(uuid),
  carlea_private.admin_verify_client_membership(uuid,text), public.admin_verify_client_membership(uuid,text)
  to authenticated;

-- Existing experience workflow and notifications retained; entitlement check replaced.
create or replace function carlea_private.request_experience(p_experience_id uuid,p_notes text default null)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_creator_id uuid; v_request_id uuid;
begin
  if not public.is_active() then raise exception 'active_account_required'; end if;
  if carlea_private.membership_tier(auth.uid())<1 then raise exception 'subscription_required'; end if;
  select creator_id into v_creator_id from public.experiences
    where id=p_experience_id and active=true;
  if v_creator_id is null then raise exception 'experience_not_found'; end if;
  insert into public.experience_requests(user_id,creator_id,experience_id,user_notes)
    values(auth.uid(),v_creator_id,p_experience_id,p_notes) returning id into v_request_id;
  insert into public.notifications(user_id,type,title,body,entity_type,entity_id)
    select p.id,'experience_request','Nueva solicitud de experiencia',
      'Hay una nueva solicitud pendiente de confirmación.','experience_request',v_request_id
    from public.profiles p where p.role='admin' and p.status='active';
  return v_request_id;
end $$;

-- Existing RLS policies on content/messages/storage/calls reuse the replaced helpers.
-- Legacy demo RPC definitions are preserved for history; they cannot set verified_at.
-- Do not expose carlea_private in the PostgREST exposed-schemas setting.
notify pgrst, 'reload schema';
commit;
