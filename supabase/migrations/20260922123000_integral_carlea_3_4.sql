-- CARLÉA 3.4.0 — actualización integral, aditiva y compatible.
-- Base esperada: 3.3.2 + migraciones 3.2.1/3.2.2.
-- No ejecutar a ciegas: probar primero en un proyecto Supabase aislado.
begin;

create schema if not exists carlea_private;
revoke all on schema carlea_private from public;
grant usage on schema carlea_private to authenticated;

-- ---------------------------------------------------------------------------
-- 1) EXTENSIONES SOBRE ESTRUCTURAS EXISTENTES (sin duplicar dominios)
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column if not exists onboarding_state text not null default 'registered',
  add column if not exists chat_sound_enabled boolean not null default true,
  add column if not exists city text default '',
  add column if not exists phone text default '';

alter table public.creator_applications
  add column if not exists document_back_path text,
  add column if not exists stage_name text,
  add column if not exists city text,
  add column if not exists phone text,
  add column if not exists birth_date date,
  add column if not exists terms_version text,
  add column if not exists privacy_version text,
  add column if not exists sensitive_consent_at timestamptz,
  add column if not exists creator_membership_payment_id uuid,
  add column if not exists documents_purge_after timestamptz;

alter table public.legal_acceptances
  add column if not exists acceptance_type text,
  add column if not exists legal_version text,
  add column if not exists accepted_at timestamptz not null default now(),
  add column if not exists source text,
  add column if not exists evidence jsonb not null default '{}'::jsonb;

alter table public.messages
  add column if not exists read_at timestamptz,
  add column if not exists message_kind text not null default 'participant';

alter table public.notifications
  add column if not exists dismissed_at timestamptz,
  add column if not exists action_target text;

alter table public.content
  add column if not exists resubmitted_at timestamptz,
  add column if not exists reviewed_at timestamptz;

alter table public.experiences
  add column if not exists template_key text,
  add column if not exists category text,
  add column if not exists availability_note text default '';

alter table public.experience_requests
  add column if not exists preferred_at timestamptz,
  add column if not exists creator_responded_at timestamptz,
  add column if not exists response_kind text,
  add column if not exists proposed_at timestamptz,
  add column if not exists response_notes text,
  add column if not exists payment_status text not null default 'not_required',
  add column if not exists payment_request_id uuid,
  add column if not exists completed_at timestamptz;

alter table public.video_calls
  add column if not exists duration_minutes integer,
  add column if not exists price_cop integer,
  add column if not exists platform_fee_cop integer,
  add column if not exists creator_net_cop integer,
  add column if not exists payment_status text not null default 'pending',
  add column if not exists payment_request_id uuid,
  add column if not exists requested_start_at timestamptz,
  add column if not exists proposed_start_at timestamptz,
  add column if not exists started_at timestamptz,
  add column if not exists ended_at timestamptz;

alter table public.reports
  add column if not exists conversation_id uuid references public.conversations(id) on delete set null,
  add column if not exists reported_user_id uuid references public.profiles(id) on delete set null,
  add column if not exists workflow_status text not null default 'open',
  add column if not exists evidence jsonb not null default '{}'::jsonb,
  add column if not exists updated_at timestamptz not null default now();

alter table public.client_subscriptions
  add column if not exists payment_request_id uuid;

-- Normalize existing experience rows into a shared logical catalogue while
-- preserving the existing per-creator rows and IDs used by requests.
update public.experiences
set template_key = coalesce(nullif(template_key,''),
  lower(regexp_replace(regexp_replace(coalesce(title,'experiencia'),'[^a-zA-Z0-9áéíóúÁÉÍÓÚñÑ]+','-','g'),'^-|-$','','g'))),
    category = coalesce(nullif(category,''),
      case
        when lower(coalesce(title,'')) ~ 'café|cafe|convers' then 'cafe_conversacion'
        when lower(coalesce(title,'')) ~ 'brunch|gastron' then 'brunch_gastronomia'
        when lower(coalesce(title,'')) ~ 'cena' then 'cena'
        when lower(coalesce(title,'')) ~ 'galer|cultur' then 'cultural_galeria'
        when lower(coalesce(title,'')) ~ 'música|musica|evento' then 'musica_eventos'
        when lower(coalesce(title,'')) ~ 'bar|mocktail' then 'bar_mocktails'
        when lower(coalesce(title,'')) ~ 'video' then 'videochat'
        else 'personalizada'
      end)
where template_key is null or template_key='' or category is null or category='';

create unique index if not exists carlea_experience_creator_template_uq
  on public.experiences(creator_id,template_key) where template_key is not null;
create index if not exists carlea_experience_active_lookup
  on public.experiences(creator_id,active,sort_order);
create index if not exists carlea_message_unread_lookup
  on public.messages(conversation_id,created_at desc) where read_at is null;
create index if not exists carlea_notification_unread_lookup
  on public.notifications(user_id,created_at desc) where read_at is null and dismissed_at is null;

-- ---------------------------------------------------------------------------
-- 2) NUEVAS ESTRUCTURAS SOLO DONDE NO EXISTE UN EQUIVALENTE
-- ---------------------------------------------------------------------------

create table if not exists public.creator_activity (
  creator_id uuid primary key references public.creators(id) on delete cascade,
  last_active_at timestamptz,
  last_content_at timestamptz,
  last_response_at timestamptz,
  last_heartbeat_at timestamptz,
  effective_active_seconds_30d bigint not null default 0,
  response_score numeric(5,2) not null default 50 check(response_score between 0 and 100),
  updated_at timestamptz not null default now()
);

create table if not exists public.creator_availability (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.creators(id) on delete cascade,
  weekday smallint not null check(weekday between 0 and 6),
  start_time time not null,
  end_time time not null,
  available boolean not null default true,
  applies_to text not null default 'all' check(applies_to in ('all','experience','video')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(end_time > start_time)
);
create unique index if not exists creator_availability_slot_uq
  on public.creator_availability(creator_id,weekday,start_time,end_time,applies_to);

create table if not exists public.payment_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  creator_id uuid references public.creators(id) on delete set null,
  product_type text not null check(product_type in ('client_membership','creator_membership','video_call','experience')),
  product_ref uuid,
  amount_cop integer not null check(amount_cop > 0),
  status text not null default 'pending' check(status in ('pending','approved','rejected','cancelled')),
  external_reference text,
  requested_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete set null,
  notes text,
  metadata jsonb not null default '{}'::jsonb
);
create index if not exists payment_requests_pending_idx on public.payment_requests(status,requested_at);
create unique index if not exists payment_reference_unique
  on public.payment_requests(external_reference) where external_reference is not null;

create table if not exists public.financial_ledger (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.creators(id) on delete restrict,
  movement_type text not null check(movement_type in ('video_call','experience','creator_membership','adjustment','payout')),
  source_type text not null,
  source_id uuid,
  gross_cop integer not null,
  platform_fee_cop integer not null default 0,
  net_cop integer not null,
  status text not null default 'pending' check(status in ('pending','earned','available','paid','void')),
  occurred_at timestamptz not null default now(),
  available_at timestamptz,
  paid_at timestamptz,
  payout_reference text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null
);
create index if not exists ledger_creator_status_idx on public.financial_ledger(creator_id,status,occurred_at desc);
create unique index if not exists ledger_source_unique on public.financial_ledger(source_type,source_id,movement_type)
  where source_id is not null and movement_type <> 'adjustment';

create table if not exists public.creator_memberships (
  creator_id uuid primary key references public.creators(id) on delete cascade,
  monthly_fee_cop integer not null default 39900 check(monthly_fee_cop=39900),
  status text not null default 'pending' check(status in ('pending','active','past_due','suspended')),
  current_period_start timestamptz,
  current_period_end timestamptz,
  last_charge_ledger_id uuid references public.financial_ledger(id) on delete set null,
  payment_request_id uuid references public.payment_requests(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.moderation_alerts (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  message_id uuid references public.messages(id) on delete cascade,
  sender_id uuid references public.profiles(id) on delete set null,
  alert_type text not null default 'possible_external_contact',
  match_type text not null,
  status text not null default 'open' check(status in ('open','in_review','resolved','dismissed')),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  review_notes text,
  created_at timestamptz not null default now()
);
create index if not exists moderation_alerts_open_idx on public.moderation_alerts(status,created_at desc);
create index if not exists moderation_alerts_conversation_idx on public.moderation_alerts(conversation_id,created_at desc);

create table if not exists public.chat_moderation_sessions (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  admin_id uuid not null references public.profiles(id) on delete restrict,
  reason text not null check(length(btrim(reason)) between 5 and 1000),
  can_intervene boolean not null default false,
  entered_at timestamptz not null default now(),
  intervention_enabled_at timestamptz,
  left_at timestamptz,
  expires_at timestamptz not null default (now()+interval '30 minutes')
);
create index if not exists moderation_sessions_active_idx
  on public.chat_moderation_sessions(admin_id,conversation_id,expires_at desc) where left_at is null;

-- ---------------------------------------------------------------------------
-- 3) RLS / PERMISOS: lectura mínima, escritura sensible por RPC
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array[
    'creator_activity','creator_availability','payment_requests','financial_ledger',
    'creator_memberships','moderation_alerts','chat_moderation_sessions'
  ] loop
    execute format('alter table public.%I enable row level security',t);
  end loop;
end $$;

revoke insert,update,delete,truncate,references,trigger on
  public.payment_requests, public.financial_ledger, public.creator_memberships,
  public.moderation_alerts, public.chat_moderation_sessions
from public,anon,authenticated;

grant select on public.creator_availability to authenticated,anon;
grant insert,update,delete on public.creator_availability to authenticated;
grant select on public.payment_requests,public.financial_ledger,public.creator_memberships,
  public.moderation_alerts,public.chat_moderation_sessions to authenticated;

-- Policies are created only if missing to keep the migration re-runnable.
do $$
begin
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='creator_availability' and policyname='creator_availability_read') then
    create policy creator_availability_read on public.creator_availability for select
      using(available or public.is_admin() or public.owns_creator(creator_id));
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='creator_availability' and policyname='creator_availability_owner_write') then
    create policy creator_availability_owner_write on public.creator_availability for all to authenticated
      using(public.is_active() and (public.owns_creator(creator_id) or public.is_admin()))
      with check(public.is_active() and (public.owns_creator(creator_id) or public.is_admin()));
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='payment_requests' and policyname='payment_requests_read') then
    create policy payment_requests_read on public.payment_requests for select to authenticated
      using(user_id=auth.uid() or public.is_admin() or (creator_id is not null and public.owns_creator(creator_id)));
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='financial_ledger' and policyname='financial_ledger_read') then
    create policy financial_ledger_read on public.financial_ledger for select to authenticated
      using(public.is_admin() or public.owns_creator(creator_id));
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='creator_memberships' and policyname='creator_memberships_read') then
    create policy creator_memberships_read on public.creator_memberships for select to authenticated
      using(public.is_admin() or public.owns_creator(creator_id));
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='moderation_alerts' and policyname='moderation_alerts_admin_read') then
    create policy moderation_alerts_admin_read on public.moderation_alerts for select to authenticated using(public.is_admin());
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='chat_moderation_sessions' and policyname='chat_moderation_sessions_admin_read') then
    create policy chat_moderation_sessions_admin_read on public.chat_moderation_sessions for select to authenticated using(public.is_admin());
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4) ACTIVIDAD / RANKING DINÁMICO
-- ---------------------------------------------------------------------------

create or replace function carlea_private.touch_creator_activity(p_has_recent_interaction boolean default true)
returns void language plpgsql security definer set search_path=''
as $$
declare cid uuid; previous timestamptz; delta_seconds bigint;
begin
  if auth.uid() is null or not public.is_active() then raise exception 'Cuenta activa requerida'; end if;
  select id into cid from public.creators where user_id=auth.uid() and active=true limit 1;
  if cid is null then raise exception 'Perfil de creadora requerido'; end if;
  insert into public.creator_activity(creator_id,last_active_at,last_heartbeat_at)
    values(cid,now(),now()) on conflict(creator_id) do nothing;
  select last_heartbeat_at into previous from public.creator_activity where creator_id=cid for update;
  delta_seconds := greatest(0,least(90,extract(epoch from (now()-coalesce(previous,now())))::bigint));
  update public.creator_activity
  set last_active_at=case when p_has_recent_interaction then now() else last_active_at end,
      last_heartbeat_at=now(),
      effective_active_seconds_30d=least(2592000,effective_active_seconds_30d + case when p_has_recent_interaction then delta_seconds else 0 end),
      updated_at=now()
  where creator_id=cid;
end $$;

create or replace function public.touch_creator_activity(p_has_recent_interaction boolean default true)
returns void language sql security invoker set search_path=''
as $$select carlea_private.touch_creator_activity(p_has_recent_interaction)$$;

create or replace function carlea_private.content_activity_trigger()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  insert into public.creator_activity(creator_id,last_content_at,updated_at)
  values(new.creator_id,coalesce(new.created_at,now()),now())
  on conflict(creator_id) do update set last_content_at=greatest(coalesce(public.creator_activity.last_content_at,'epoch'::timestamptz),coalesce(new.created_at,now())),updated_at=now();
  return new;
end $$;
drop trigger if exists carlea_content_activity on public.content;
create trigger carlea_content_activity after insert or update of status on public.content
for each row when (new.status='approved') execute function carlea_private.content_activity_trigger();

create or replace function carlea_private.list_ranked_creators()
returns table(
  id uuid, stage_name text, bio text, city text, verified boolean, chat_open boolean,
  cover_path text, accent text, last_active_at timestamptz, last_content_at timestamptz,
  visibility_score numeric, visibility_position bigint, online boolean
) language sql stable security definer set search_path=''
as $$
  with scored as (
    select c.id,c.stage_name,c.bio,coalesce(p.city,'') city,c.verified,c.chat_open,c.cover_path,c.accent,
      a.last_active_at,a.last_content_at,
      least(100::numeric,
        (case when a.last_content_at>now()-interval '24 hours' then 35 when a.last_content_at>now()-interval '7 days' then 24 when a.last_content_at>now()-interval '30 days' then 10 else 0 end) +
        (case when a.last_active_at>now()-interval '2 minutes' then 25 when a.last_active_at>now()-interval '24 hours' then 15 when a.last_active_at>now()-interval '7 days' then 6 else 0 end) +
        least(15::numeric,coalesce(a.effective_active_seconds_30d,0)::numeric/7200) +
        least(25::numeric,greatest(0,coalesce(a.response_score,50))/4)
      ) as score
    from public.creators c
    join public.profiles p on p.id=c.user_id and p.status='active'
    left join public.creator_activity a on a.creator_id=c.id
    where c.active=true
  )
  select s.id,s.stage_name,s.bio,s.city,s.verified,s.chat_open,s.cover_path,s.accent,
    s.last_active_at,s.last_content_at,round(s.score,2),
    row_number() over(order by s.score desc,s.last_content_at desc nulls last,s.stage_name),
    coalesce(s.last_active_at>now()-interval '2 minutes',false)
  from scored s
  order by s.score desc,s.last_content_at desc nulls last,s.stage_name;
$$;

create or replace function public.list_ranked_creators()
returns table(
  id uuid, stage_name text, bio text, city text, verified boolean, chat_open boolean,
  cover_path text, accent text, last_active_at timestamptz, last_content_at timestamptz,
  visibility_score numeric, visibility_position bigint, online boolean
) language sql stable security invoker set search_path=''
as $$select * from carlea_private.list_ranked_creators()$$;

-- Metadata segura para mostrar previews bloqueados sin filtrar rutas privadas.
create or replace function carlea_private.creator_content_manifest(p_creator_id uuid)
returns table(id uuid,media_type text,audience text,caption text,created_at timestamptz,can_view boolean,storage_bucket text,storage_path text)
language sql stable security definer set search_path=''
as $$
  select ct.id,ct.media_type::text,ct.audience::text,ct.caption,ct.created_at,
    (public.is_admin() or public.owns_creator(p_creator_id)
      or ct.audience::text='public'
      or (ct.audience::text='premium' and carlea_private.membership_tier(auth.uid())>=1)
      or (ct.audience::text='diamond' and carlea_private.membership_tier(auth.uid())>=2)) as can_view,
    case when (public.is_admin() or public.owns_creator(p_creator_id)
      or ct.audience::text='public'
      or (ct.audience::text='premium' and carlea_private.membership_tier(auth.uid())>=1)
      or (ct.audience::text='diamond' and carlea_private.membership_tier(auth.uid())>=2)) then ct.storage_bucket else null end,
    case when (public.is_admin() or public.owns_creator(p_creator_id)
      or ct.audience::text='public'
      or (ct.audience::text='premium' and carlea_private.membership_tier(auth.uid())>=1)
      or (ct.audience::text='diamond' and carlea_private.membership_tier(auth.uid())>=2)) then ct.storage_path else null end
  from public.content ct where ct.creator_id=p_creator_id and ct.status='approved'
  order by ct.created_at desc
$$;
create or replace function public.creator_content_manifest(p_creator_id uuid)
returns table(id uuid,media_type text,audience text,caption text,created_at timestamptz,can_view boolean,storage_bucket text,storage_path text)
language sql stable security invoker set search_path=''
as $$select * from carlea_private.creator_content_manifest(p_creator_id)$$;

-- ---------------------------------------------------------------------------
-- 5) CHAT: LEÍDOS, MODERACIÓN, ALERTAS DE CONTACTO EXTERNO
-- ---------------------------------------------------------------------------

create or replace function carlea_private.mark_conversation_read(p_conversation_id uuid)
returns integer language plpgsql security definer set search_path=''
as $$
declare n integer;
begin
  if auth.uid() is null or not carlea_private.participant(p_conversation_id) then raise exception 'Sin acceso a esta conversación'; end if;
  update public.messages set read_at=coalesce(read_at,now())
    where conversation_id=p_conversation_id and sender_id<>auth.uid() and read_at is null;
  get diagnostics n=row_count;
  return n;
end $$;
create or replace function public.mark_conversation_read(p_conversation_id uuid)
returns integer language sql security invoker set search_path=''
as $$select carlea_private.mark_conversation_read(p_conversation_id)$$;

create or replace function carlea_private.external_contact_alert()
returns trigger language plpgsql security definer set search_path=''
as $$
declare raw text:=lower(coalesce(new.body,'')); compact text; kind text;
begin
  compact:=regexp_replace(raw,'[^a-z0-9+]+','','g');
  if raw ~* '(whats?app|telegram|\mwsp\M|\mwa\M|mi[[:space:]]+n[uú]mero|escr[ií]beme[[:space:]]+al|h[aá]blame[[:space:]]+por|te[[:space:]]+paso[[:space:]]+mi[[:space:]]+contacto)' then
    kind:='keyword';
  elsif raw ~ '(\+?57[[:space:].-]?)?3[0-9]{2}([[:space:].-]?[0-9]){7}' or compact ~ '(\+?57)?3[0-9]{9}' then
    kind:='phone_pattern';
  end if;
  if kind is not null then
    insert into public.moderation_alerts(conversation_id,message_id,sender_id,match_type)
      values(new.conversation_id,new.id,new.sender_id,kind);
  end if;
  -- creator response signal used by ranking, without rewarding raw volume.
  update public.creator_activity a set last_response_at=now(),response_score=least(100,a.response_score+0.15),updated_at=now()
  from public.conversations cv join public.creators c on c.id=cv.creator_id
  where cv.id=new.conversation_id and c.id=a.creator_id and c.user_id=new.sender_id;
  return new;
end $$;
drop trigger if exists carlea_message_contact_alert on public.messages;
create trigger carlea_message_contact_alert after insert on public.messages
for each row execute function carlea_private.external_contact_alert();

create or replace function carlea_private.admin_chat(cid uuid)
returns boolean language sql stable security definer set search_path=''
as $$
  select auth.uid() is not null and public.is_admin() and (
    exists(select 1 from public.chat_moderation_sessions s where s.admin_id=auth.uid() and s.conversation_id=cid and s.left_at is null and s.expires_at>now())
    or exists(select 1 from public.admin_audit a where a.admin_id=auth.uid() and a.action='chat_review' and a.target_id=cid and a.created_at>now()-interval '30 minutes')
  )
$$;

create or replace function carlea_private.admin_enter_chat(p_conversation_id uuid,p_reason text)
returns uuid language plpgsql security definer set search_path=''
as $$
declare sid uuid; u uuid; cu uuid;
begin
  if not public.is_admin() then raise exception 'Solo administración activa'; end if;
  if length(btrim(coalesce(p_reason,'')))<5 then raise exception 'Indica un motivo de revisión'; end if;
  if not exists(select 1 from public.conversations where id=p_conversation_id) then raise exception 'Conversación inexistente'; end if;
  insert into public.chat_moderation_sessions(conversation_id,admin_id,reason) values(p_conversation_id,auth.uid(),btrim(p_reason)) returning id into sid;
  insert into public.admin_audit(admin_id,action,target_id,reason) values(auth.uid(),'chat.moderation_enter',p_conversation_id,btrim(p_reason));
  select cv.user_id,c.user_id into u,cu from public.conversations cv join public.creators c on c.id=cv.creator_id where cv.id=p_conversation_id;
  insert into public.notifications(user_id,type,title,body,entity_type,entity_id)
    select x,'moderation','Moderación CARLÉA','Moderación CARLÉA ingresó a la conversación para una revisión registrada.','conversation',p_conversation_id
    from unnest(array[u,cu]) x where x is not null;
  return sid;
end $$;
create or replace function public.admin_enter_chat(p_conversation_id uuid,p_reason text)
returns uuid language sql security invoker set search_path=''
as $$select carlea_private.admin_enter_chat(p_conversation_id,p_reason)$$;

create or replace function carlea_private.admin_enable_chat_intervention(p_session_id uuid)
returns void language plpgsql security definer set search_path=''
as $$
declare cid uuid;
begin
  if not public.is_admin() then raise exception 'Solo administración activa'; end if;
  update public.chat_moderation_sessions set can_intervene=true,intervention_enabled_at=coalesce(intervention_enabled_at,now())
    where id=p_session_id and admin_id=auth.uid() and left_at is null and expires_at>now() returning conversation_id into cid;
  if cid is null then raise exception 'Sesión no disponible'; end if;
  insert into public.admin_audit(admin_id,action,target_id,reason) values(auth.uid(),'chat.moderation_intervention_enabled',cid,'Intervención identificada como Moderación CARLÉA');
end $$;
create or replace function public.admin_enable_chat_intervention(p_session_id uuid)
returns void language sql security invoker set search_path=''
as $$select carlea_private.admin_enable_chat_intervention(p_session_id)$$;

create or replace function carlea_private.admin_send_moderation_message(p_session_id uuid,p_body text)
returns uuid language plpgsql security definer set search_path=''
as $$
declare cid uuid; mid uuid;
begin
  if not public.is_admin() then raise exception 'Solo administración activa'; end if;
  select conversation_id into cid from public.chat_moderation_sessions where id=p_session_id and admin_id=auth.uid() and can_intervene=true and left_at is null and expires_at>now();
  if cid is null then raise exception 'Intervención no habilitada'; end if;
  if length(btrim(coalesce(p_body,'')))<1 or length(p_body)>4000 then raise exception 'Mensaje inválido'; end if;
  insert into public.messages(conversation_id,sender_id,body,message_kind) values(cid,auth.uid(),btrim(p_body),'moderation') returning id into mid;
  insert into public.admin_audit(admin_id,action,target_id,reason) values(auth.uid(),'chat.moderation_message',cid,'Mensaje de Moderación CARLÉA');
  return mid;
end $$;
create or replace function public.admin_send_moderation_message(p_session_id uuid,p_body text)
returns uuid language sql security invoker set search_path=''
as $$select carlea_private.admin_send_moderation_message(p_session_id,p_body)$$;

create or replace function carlea_private.admin_leave_chat(p_session_id uuid)
returns void language plpgsql security definer set search_path=''
as $$
declare cid uuid;
begin
  if not public.is_admin() then raise exception 'Solo administración activa'; end if;
  update public.chat_moderation_sessions set left_at=coalesce(left_at,now()) where id=p_session_id and admin_id=auth.uid() returning conversation_id into cid;
  if cid is not null then insert into public.admin_audit(admin_id,action,target_id,reason) values(auth.uid(),'chat.moderation_leave',cid,'Salida de moderación'); end if;
end $$;
create or replace function public.admin_leave_chat(p_session_id uuid)
returns void language sql security invoker set search_path=''
as $$select carlea_private.admin_leave_chat(p_session_id)$$;

-- ---------------------------------------------------------------------------
-- 6) NOTIFICACIONES
-- ---------------------------------------------------------------------------

create or replace function carlea_private.notification_action(p_notification_id uuid,p_action text)
returns void language plpgsql security definer set search_path=''
as $$
begin
  if auth.uid() is null then raise exception 'Acceso requerido'; end if;
  if p_action='read' then
    update public.notifications set read_at=coalesce(read_at,now()) where id=p_notification_id and user_id=auth.uid();
  elsif p_action='dismiss' then
    update public.notifications set read_at=coalesce(read_at,now()),dismissed_at=coalesce(dismissed_at,now()) where id=p_notification_id and user_id=auth.uid();
  else raise exception 'Acción inválida'; end if;
end $$;
create or replace function public.notification_action(p_notification_id uuid,p_action text)
returns void language sql security invoker set search_path=''
as $$select carlea_private.notification_action(p_notification_id,p_action)$$;

create or replace function carlea_private.notification_bulk_action(p_action text)
returns integer language plpgsql security definer set search_path=''
as $$
declare n integer;
begin
  if auth.uid() is null then raise exception 'Acceso requerido'; end if;
  if p_action='read_all' then update public.notifications set read_at=coalesce(read_at,now()) where user_id=auth.uid() and dismissed_at is null and read_at is null;
  elsif p_action='dismiss_read' then update public.notifications set dismissed_at=coalesce(dismissed_at,now()) where user_id=auth.uid() and read_at is not null and dismissed_at is null;
  elsif p_action='dismiss_all' then update public.notifications set read_at=coalesce(read_at,now()),dismissed_at=coalesce(dismissed_at,now()) where user_id=auth.uid() and dismissed_at is null;
  else raise exception 'Acción inválida'; end if;
  get diagnostics n=row_count; return n;
end $$;
create or replace function public.notification_bulk_action(p_action text)
returns integer language sql security invoker set search_path=''
as $$select carlea_private.notification_bulk_action(p_action)$$;

-- ---------------------------------------------------------------------------
-- 7) CREADORAS: ALTA, CONTENIDO, EXPERIENCIAS, AGENDA
-- ---------------------------------------------------------------------------

create or replace function carlea_private.submit_creator_application(
  p_stage_name text,p_phone text,p_city text,p_birth_date date,
  p_document_front text,p_document_back text,p_selfie text,p_legal_version text)
returns uuid language plpgsql security definer set search_path=''
as $$
declare cid uuid; aid uuid; pay uuid; age_years integer;
begin
  if auth.uid() is null then raise exception 'Acceso requerido'; end if;
  if not carlea_private.legal_ready() then raise exception 'Datos legales del operador incompletos'; end if;
  age_years:=date_part('year',age(current_date,p_birth_date));
  if age_years<18 then raise exception 'Debes tener 18 años o más'; end if;
  if length(btrim(coalesce(p_stage_name,'')))<2 then raise exception 'Alias requerido'; end if;
  if p_document_front not like auth.uid()::text||'/%' or p_document_back not like auth.uid()::text||'/%' or p_selfie not like auth.uid()::text||'/%' then raise exception 'Rutas privadas inválidas'; end if;
  select id into cid from public.creators where user_id=auth.uid() limit 1;
  if cid is null then
    raise exception 'Tu cuenta de creadora aún no está vinculada. Cierra sesión, confirma tu correo e ingresa nuevamente antes de enviar los documentos.';
  end if;
  update public.creators set stage_name=btrim(p_stage_name),active=false,chat_open=false where id=cid;
  select id into pay from public.payment_requests
  where creator_id=cid and product_type='creator_membership' and status='pending'
  order by requested_at desc limit 1;
  if pay is null then
    insert into public.payment_requests(user_id,creator_id,product_type,product_ref,amount_cop,metadata)
      values(auth.uid(),cid,'creator_membership',cid,39900,jsonb_build_object('period','initial')) returning id into pay;
  end if;
  select id into aid from public.creator_applications
  where user_id=auth.uid() and creator_id=cid order by created_at desc limit 1 for update;
  if aid is null then
    insert into public.creator_applications(user_id,creator_id,document_path,document_back_path,selfie_path,consent_version,consent_at,status,
      stage_name,city,phone,birth_date,terms_version,privacy_version,sensitive_consent_at,creator_membership_payment_id,documents_purge_after)
    values(auth.uid(),cid,p_document_front,p_document_back,p_selfie,p_legal_version,now(),'pending',btrim(p_stage_name),btrim(coalesce(p_city,'')),btrim(coalesce(p_phone,'')),p_birth_date,
      p_legal_version,p_legal_version,now(),pay,now()+interval '30 days')
    returning id into aid;
  else
    update public.creator_applications set document_path=p_document_front,document_back_path=p_document_back,selfie_path=p_selfie,
      consent_version=p_legal_version,consent_at=now(),status='pending',reason=null,stage_name=btrim(p_stage_name),city=btrim(coalesce(p_city,'')),
      phone=btrim(coalesce(p_phone,'')),birth_date=p_birth_date,terms_version=p_legal_version,privacy_version=p_legal_version,sensitive_consent_at=now(),
      creator_membership_payment_id=pay,documents_purge_after=now()+interval '30 days',reviewed_by=null,reviewed_at=null
    where id=aid;
  end if;
  update public.profiles set onboarding_state='approval_pending',city=btrim(coalesce(p_city,'')),phone=btrim(coalesce(p_phone,'')) where id=auth.uid();
  insert into public.legal_acceptances(user_id,confirmed_adult,terms_version,privacy_version,acceptance_type,legal_version,source,evidence)
    values(auth.uid(),true,p_legal_version,p_legal_version,'creator_registration',p_legal_version,'creator_onboarding',jsonb_build_object('sensitive_data',true,'application_id',aid));
  return aid;
end $$;
create or replace function public.submit_creator_application(
  p_stage_name text,p_phone text,p_city text,p_birth_date date,
  p_document_front text,p_document_back text,p_selfie text,p_legal_version text)
returns uuid language sql security invoker set search_path=''
as $$select carlea_private.submit_creator_application(p_stage_name,p_phone,p_city,p_birth_date,p_document_front,p_document_back,p_selfie,p_legal_version)$$;

create or replace function carlea_private.admin_identity_access(p_application_id uuid)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare a public.creator_applications;
begin
  if not public.is_admin() then raise exception 'Solo administración activa'; end if;
  select * into a from public.creator_applications where id=p_application_id;
  if not found then raise exception 'Solicitud inexistente'; end if;
  insert into public.admin_audit(admin_id,action,target_id,reason) values(auth.uid(),'identity.document_access',a.id,'Acceso temporal para revisión de identidad');
  return jsonb_build_object('front',a.document_path,'back',a.document_back_path,'selfie',a.selfie_path,'purge_after',a.documents_purge_after);
end $$;
create or replace function public.admin_identity_access(p_application_id uuid)
returns jsonb language sql security invoker set search_path=''
as $$select carlea_private.admin_identity_access(p_application_id)$$;

-- Wrap the existing review flow to also advance onboarding / initialize creator membership.
create or replace function carlea_private.review_application_v4(p_application_id uuid,p_approve boolean,p_note text)
returns void language plpgsql security definer set search_path=''
as $$
declare a public.creator_applications;
begin
  if not public.is_admin() then raise exception 'Solo administración activa'; end if;
  select * into a from public.creator_applications where id=p_application_id for update;
  if not found or a.status<>'pending' then raise exception 'Solicitud no disponible'; end if;
  perform carlea_private.review_application(p_application_id,p_approve,p_note);
  if p_approve then
    update public.profiles set onboarding_state='active' where id=a.user_id;
    insert into public.creator_memberships(creator_id,status,payment_request_id)
      values(a.creator_id,'pending',a.creator_membership_payment_id)
      on conflict(creator_id) do update set payment_request_id=excluded.payment_request_id,updated_at=now();
  else
    update public.profiles set onboarding_state='approval_pending' where id=a.user_id;
  end if;
end $$;
create or replace function public.review_application_v4(p_application_id uuid,p_approve boolean,p_note text)
returns void language sql security invoker set search_path=''
as $$select carlea_private.review_application_v4(p_application_id,p_approve,p_note)$$;

create or replace function carlea_private.creator_resubmit_content(p_content_id uuid,p_caption text,p_audience text)
returns void language plpgsql security definer set search_path=''
as $$
declare cid uuid;
begin
  if auth.uid() is null or not public.is_active() then raise exception 'Cuenta activa requerida'; end if;
  select creator_id into cid from public.content where id=p_content_id;
  if cid is null or not public.owns_creator(cid) then raise exception 'Contenido no disponible'; end if;
  if p_audience not in ('public','premium','diamond') then raise exception 'Audiencia inválida'; end if;
  update public.content set caption=left(coalesce(p_caption,''),1200),audience=p_audience,
    visibility=case when p_audience='public' then 'public' else 'premium' end,status='pending',rejection_reason=null,resubmitted_at=now(),updated_at=now()
  where id=p_content_id;
end $$;
create or replace function public.creator_resubmit_content(p_content_id uuid,p_caption text,p_audience text)
returns void language sql security invoker set search_path=''
as $$select carlea_private.creator_resubmit_content(p_content_id,p_caption,p_audience)$$;

create or replace function carlea_private.creator_toggle_experience(p_experience_id uuid,p_enabled boolean)
returns void language plpgsql security definer set search_path=''
as $$
declare cid uuid;
begin
  select creator_id into cid from public.experiences where id=p_experience_id;
  if cid is null or not public.owns_creator(cid) or not public.is_active() then raise exception 'Experiencia no disponible'; end if;
  update public.experiences set active=p_enabled where id=p_experience_id;
end $$;
create or replace function public.creator_toggle_experience(p_experience_id uuid,p_enabled boolean)
returns void language sql security invoker set search_path=''
as $$select carlea_private.creator_toggle_experience(p_experience_id,p_enabled)$$;

create or replace function carlea_private.request_experience_scheduled(p_experience_id uuid,p_preferred_at timestamptz,p_notes text default null)
returns uuid language plpgsql security definer set search_path=''
as $$
declare rid uuid; cid uuid; amount integer; pay uuid;
begin
  if not public.is_active() then raise exception 'Cuenta activa requerida'; end if;
  if carlea_private.membership_tier(auth.uid())<1 then raise exception 'Membresía Premium vigente requerida'; end if;
  select creator_id,price_cop into cid,amount from public.experiences where id=p_experience_id and active=true;
  if cid is null then raise exception 'Experiencia no disponible'; end if;
  if p_preferred_at is null or p_preferred_at<now()+interval '30 minutes' then raise exception 'Selecciona una fecha futura válida'; end if;
  insert into public.experience_requests(user_id,creator_id,experience_id,user_notes,preferred_at,requested_at,payment_status)
    values(auth.uid(),cid,p_experience_id,left(coalesce(p_notes,''),2000),p_preferred_at,now(),'pending') returning id into rid;
  insert into public.payment_requests(user_id,creator_id,product_type,product_ref,amount_cop,metadata)
    values(auth.uid(),cid,'experience',rid,amount,jsonb_build_object('experience_id',p_experience_id,'preferred_at',p_preferred_at)) returning id into pay;
  update public.experience_requests set payment_request_id=pay where id=rid;
  insert into public.notifications(user_id,type,title,body,entity_type,entity_id)
    select x,'experience_request','Nueva solicitud de experiencia','Hay una solicitud esperando respuesta. El pago permanece pendiente de validación administrativa.','experience_request',rid
    from (select c.user_id x from public.creators c where c.id=cid union all select p.id from public.profiles p where p.role='admin' and p.status='active') q where x is not null;
  insert into public.notifications(user_id,type,title,body,entity_type,entity_id)
    values(auth.uid(),'payment','Solicitud de pago creada','En esta versión el pago será validado manualmente. La solicitud PENDIENTE no confirma el servicio.','payment',pay);
  return rid;
end $$;
create or replace function public.request_experience_scheduled(p_experience_id uuid,p_preferred_at timestamptz,p_notes text default null)
returns uuid language sql security invoker set search_path=''
as $$select carlea_private.request_experience_scheduled(p_experience_id,p_preferred_at,p_notes)$$;

create or replace function carlea_private.creator_respond_experience_v4(p_request_id uuid,p_decision text,p_proposed_at timestamptz default null,p_notes text default null)
returns void language plpgsql security definer set search_path=''
as $$
declare r public.experience_requests;
begin
  select * into r from public.experience_requests where id=p_request_id for update;
  if not found or not public.owns_creator(r.creator_id) or not public.is_active() then raise exception 'Solicitud no disponible'; end if;
  if p_decision not in ('accepted','rejected','proposed') then raise exception 'Decisión inválida'; end if;
  if p_decision='proposed' and (p_proposed_at is null or p_proposed_at<now()+interval '30 minutes') then raise exception 'Propón una fecha futura válida'; end if;
  update public.experience_requests set creator_responded_at=now(),response_kind=p_decision,proposed_at=case when p_decision='proposed' then p_proposed_at else proposed_at end,response_notes=left(coalesce(p_notes,''),2000),
    status=case when p_decision='accepted' then 'creator_accepted' when p_decision='rejected' then 'creator_rejected' else status end
  where id=p_request_id;
  insert into public.notifications(user_id,type,title,body,entity_type,entity_id)
    values(r.user_id,'experience_request','Actualización de tu experiencia',case p_decision when 'accepted' then 'La creadora aceptó la solicitud.' when 'rejected' then 'La creadora rechazó la solicitud.' else 'La creadora propuso un horario alternativo.' end,'experience_request',p_request_id);
end $$;
create or replace function public.creator_respond_experience_v4(p_request_id uuid,p_decision text,p_proposed_at timestamptz default null,p_notes text default null)
returns void language sql security invoker set search_path=''
as $$select carlea_private.creator_respond_experience_v4(p_request_id,p_decision,p_proposed_at,p_notes)$$;

create or replace function carlea_private.complete_experience_request(p_request_id uuid)
returns void language plpgsql security definer set search_path=''
as $$
declare r public.experience_requests; amount integer;
begin
  select * into r from public.experience_requests where id=p_request_id for update;
  if not found or not (public.is_admin() or public.owns_creator(r.creator_id)) then raise exception 'Solicitud no disponible'; end if;
  if r.response_kind<>'accepted' or r.payment_status<>'approved' then raise exception 'La experiencia debe estar aceptada y pagada antes de completarse'; end if;
  if r.completed_at is not null then return; end if;
  select price_cop into amount from public.experiences where id=r.experience_id;
  update public.experience_requests set completed_at=now() where id=r.id;
  insert into public.financial_ledger(creator_id,movement_type,source_type,source_id,gross_cop,platform_fee_cop,net_cop,status,created_by,metadata)
    values(r.creator_id,'experience','experience_request',r.id,amount,0,amount,'earned',auth.uid(),jsonb_build_object('experience_id',r.experience_id))
    on conflict(source_type,source_id,movement_type) where source_id is not null and movement_type <> 'adjustment' do nothing;
  insert into public.notifications(user_id,type,title,body,entity_type,entity_id)
    values(r.user_id,'experience_request','Experiencia completada','La experiencia fue marcada como completada.','experience_request',r.id);
end $$;
create or replace function public.complete_experience_request(p_request_id uuid)
returns void language sql security invoker set search_path=''
as $$select carlea_private.complete_experience_request(p_request_id)$$;

-- ---------------------------------------------------------------------------
-- 8) PAGOS SIMULADOS, VIDEOLLAMADAS Y LEDGER
-- ---------------------------------------------------------------------------

create or replace function carlea_private.request_client_membership(p_plan text)
returns uuid language plpgsql security definer set search_path=''
as $$
declare sid uuid; pay uuid; amount integer;
begin
  if auth.uid() is null or not public.is_active() then raise exception 'Cuenta activa requerida'; end if;
  if p_plan not in ('premium','diamond') then raise exception 'Plan no válido'; end if;
  amount:=case p_plan when 'premium' then 19900 else 39900 end;
  perform 1 from public.profiles where id=auth.uid() for update;
  if exists(select 1 from public.client_subscriptions where user_id=auth.uid() and status='active' and ends_at>now()) then raise exception 'Ya tienes una membresía vigente'; end if;
  select id into sid from public.client_subscriptions where user_id=auth.uid() and status='pending' and plan::text=p_plan order by created_at desc limit 1;
  if sid is not null then return sid; end if;
  if exists(select 1 from public.client_subscriptions where user_id=auth.uid() and status='pending') then raise exception 'Cancela primero tu solicitud pendiente'; end if;
  insert into public.payment_requests(user_id,product_type,amount_cop,metadata)
    values(auth.uid(),'client_membership',amount,jsonb_build_object('plan',p_plan)) returning id into pay;
  insert into public.client_subscriptions(user_id,plan,status,payment_request_id)
    values(auth.uid(),p_plan::public.user_plan,'pending',pay) returning id into sid;
  update public.payment_requests set product_ref=sid where id=pay;
  insert into public.notifications(user_id,type,title,body,entity_type,entity_id)
    values(auth.uid(),'payment','Solicitud de pago creada','En esta versión el pago será validado manualmente. Ningún beneficio se activa mientras esté pendiente.','payment',pay);
  return sid;
end $$;
create or replace function public.request_client_membership(p_plan text)
returns uuid language sql security invoker set search_path=''
as $$select carlea_private.request_client_membership(p_plan)$$;

create or replace function carlea_private.request_video_call_purchase(p_conversation_id uuid,p_duration_minutes integer,p_requested_start_at timestamptz default null)
returns uuid language plpgsql security definer set search_path=''
as $$
declare call_id uuid; pay uuid; amount integer; cid uuid;
begin
  if auth.uid() is null or not public.is_active() then raise exception 'Cuenta activa requerida'; end if;
  if not carlea_private.media_allowed(p_conversation_id) then raise exception 'Diamante vigente requerido'; end if;
  if not exists(select 1 from public.conversations where id=p_conversation_id and user_id=auth.uid()) then raise exception 'Solo el cliente puede solicitar la llamada'; end if;
  amount:=case p_duration_minutes when 30 then 49900 when 60 then 79900 when 90 then 99900 else null end;
  if amount is null then raise exception 'Duración no válida'; end if;
  if exists(select 1 from public.video_calls where conversation_id=p_conversation_id and status in ('requested','accepted')) then raise exception 'Ya hay una solicitud o llamada en curso'; end if;
  select creator_id into cid from public.conversations where id=p_conversation_id;
  insert into public.payment_requests(user_id,creator_id,product_type,amount_cop,metadata)
    values(auth.uid(),cid,'video_call',amount,jsonb_build_object('duration_minutes',p_duration_minutes)) returning id into pay;
  insert into public.video_calls(conversation_id,caller_id,status,duration_minutes,price_cop,platform_fee_cop,creator_net_cop,payment_status,payment_request_id,requested_start_at)
    values(p_conversation_id,auth.uid(),'requested',p_duration_minutes,amount,round(amount*0.20),amount-round(amount*0.20),'pending',pay,p_requested_start_at)
    returning id into call_id;
  update public.payment_requests set product_ref=call_id where id=pay;
  return call_id;
end $$;
create or replace function public.request_video_call_purchase(p_conversation_id uuid,p_duration_minutes integer,p_requested_start_at timestamptz default null)
returns uuid language sql security invoker set search_path=''
as $$select carlea_private.request_video_call_purchase(p_conversation_id,p_duration_minutes,p_requested_start_at)$$;

create or replace function carlea_private.admin_review_payment(p_payment_id uuid,p_approve boolean,p_reference text default null,p_notes text default null)
returns void language plpgsql security definer set search_path=''
as $$
declare pay public.payment_requests; s public.client_subscriptions; call public.video_calls; er public.experience_requests;
begin
  if not public.is_admin() then raise exception 'Solo administración activa'; end if;
  select * into pay from public.payment_requests where id=p_payment_id for update;
  if not found or pay.status<>'pending' then raise exception 'Solicitud de pago no disponible'; end if;
  if p_approve and (p_reference is null or length(btrim(p_reference))<5) then raise exception 'Registra una referencia verificada'; end if;
  if p_approve and exists(select 1 from public.payment_requests where id<>p_payment_id and external_reference=btrim(p_reference)) then raise exception 'Referencia ya utilizada'; end if;
  update public.payment_requests set status=case when p_approve then 'approved' else 'rejected' end,external_reference=case when p_approve then btrim(p_reference) else null end,
    reviewed_at=now(),reviewed_by=auth.uid(),notes=left(coalesce(p_notes,''),2000) where id=p_payment_id;
  if p_approve and pay.product_type='client_membership' then
    select * into s from public.client_subscriptions where id=pay.product_ref for update;
    if not found or s.status<>'pending' then raise exception 'Membresía no disponible'; end if;
    update public.client_subscriptions set status='active',starts_at=now(),ends_at=now()+interval '1 month',verified_at=now(),verified_by=auth.uid(),payment_reference=btrim(p_reference),updated_at=now() where id=s.id;
    insert into public.notifications(user_id,type,title,body,entity_type,entity_id) values(s.user_id,'payment','Membresía activada','El pago fue validado y tu membresía ya está activa.','payment',p_payment_id);
  elsif p_approve and pay.product_type='video_call' then
    select * into call from public.video_calls where id=pay.product_ref for update;
    update public.video_calls set payment_status='approved',updated_at=now() where id=call.id;
    insert into public.notifications(user_id,type,title,body,entity_type,entity_id)
      select c.user_id,'video_call','Videollamada pagada','Ya puedes revisar y responder la solicitud de videollamada.','video_call',call.id
      from public.conversations cv join public.creators c on c.id=cv.creator_id where cv.id=call.conversation_id;
  elsif p_approve and pay.product_type='experience' then
    select * into er from public.experience_requests where id=pay.product_ref for update;
    if not found then raise exception 'Solicitud de experiencia no disponible'; end if;
    update public.experience_requests set payment_status='approved' where id=er.id;
    insert into public.notifications(user_id,type,title,body,entity_type,entity_id)
      values(er.user_id,'payment','Pago de experiencia validado','El pago fue validado. La experiencia seguirá el flujo de aceptación y realización.','experience_request',er.id);
  elsif p_approve and pay.product_type='creator_membership' then
    insert into public.creator_memberships(creator_id,status,current_period_start,current_period_end,payment_request_id)
      values(pay.creator_id,'active',now(),now()+interval '1 month',p_payment_id)
      on conflict(creator_id) do update set status='active',current_period_start=now(),current_period_end=now()+interval '1 month',payment_request_id=p_payment_id,updated_at=now();
    update public.creators set active=true where id=pay.creator_id and verified=true;
  end if;
  insert into public.admin_audit(admin_id,action,target_id,reason)
    values(auth.uid(),case when p_approve then 'payment.approved' else 'payment.rejected' end,p_payment_id,coalesce(nullif(btrim(coalesce(p_notes,'')),''),coalesce(p_reference,'Sin observación')));
end $$;
create or replace function public.admin_review_payment(p_payment_id uuid,p_approve boolean,p_reference text default null,p_notes text default null)
returns void language sql security invoker set search_path=''
as $$select carlea_private.admin_review_payment(p_payment_id,p_approve,p_reference,p_notes)$$;

create or replace function carlea_private.creator_respond_video_call(p_call_id uuid,p_decision text,p_proposed_start_at timestamptz default null)
returns void language plpgsql security definer set search_path=''
as $$
declare v public.video_calls; cid uuid;
begin
  select * into v from public.video_calls where id=p_call_id for update;
  if not found then raise exception 'Llamada no disponible'; end if;
  select creator_id into cid from public.conversations where id=v.conversation_id;
  if v.id is null or not public.owns_creator(cid) or not public.is_active() then raise exception 'Llamada no disponible'; end if;
  if v.payment_status<>'approved' then raise exception 'El pago aún no está aprobado'; end if;
  if p_decision='accepted' then update public.video_calls set status='accepted',proposed_start_at=coalesce(p_proposed_start_at,requested_start_at),updated_at=now() where id=p_call_id;
  elsif p_decision='declined' then update public.video_calls set status='declined',updated_at=now() where id=p_call_id;
  elsif p_decision='proposed' then
    if p_proposed_start_at is null or p_proposed_start_at<now()+interval '15 minutes' then raise exception 'Horario propuesto inválido'; end if;
    update public.video_calls set proposed_start_at=p_proposed_start_at,updated_at=now() where id=p_call_id;
  else raise exception 'Decisión inválida'; end if;
  insert into public.notifications(user_id,type,title,body,entity_type,entity_id)
    values(v.caller_id,'video_call','Actualización de videollamada',case p_decision when 'accepted' then 'La creadora aceptó la videollamada.' when 'declined' then 'La creadora rechazó la videollamada.' else 'La creadora propuso otro horario.' end,'video_call',p_call_id);
end $$;
create or replace function public.creator_respond_video_call(p_call_id uuid,p_decision text,p_proposed_start_at timestamptz default null)
returns void language sql security invoker set search_path=''
as $$select carlea_private.creator_respond_video_call(p_call_id,p_decision,p_proposed_start_at)$$;

create or replace function carlea_private.start_video_call(p_call_id uuid)
returns timestamptz language plpgsql security definer set search_path=''
as $$
declare v public.video_calls;
begin
  select * into v from public.video_calls where id=p_call_id for update;
  if not found or v.status<>'accepted' or v.payment_status<>'approved' then raise exception 'Llamada no habilitada'; end if;
  if not carlea_private.participant(v.conversation_id) then raise exception 'Sin acceso'; end if;
  update public.video_calls set started_at=coalesce(started_at,now()),updated_at=now() where id=p_call_id;
  return coalesce(v.started_at,now());
end $$;
create or replace function public.start_video_call(p_call_id uuid)
returns timestamptz language sql security invoker set search_path=''
as $$select carlea_private.start_video_call(p_call_id)$$;

create or replace function carlea_private.finish_video_call(p_call_id uuid)
returns void language plpgsql security definer set search_path=''
as $$
declare v public.video_calls; cid uuid;
begin
  select * into v from public.video_calls where id=p_call_id for update;
  if not found then raise exception 'Llamada no disponible'; end if;
  select creator_id into cid from public.conversations where id=v.conversation_id;
  if v.id is null or not carlea_private.participant(v.conversation_id) then raise exception 'Sin acceso'; end if;
  if v.started_at is null then raise exception 'La llamada no ha iniciado'; end if;
  if v.ended_at is not null then return; end if;
  update public.video_calls set status='ended',ended_at=now(),updated_at=now() where id=p_call_id;
  insert into public.financial_ledger(creator_id,movement_type,source_type,source_id,gross_cop,platform_fee_cop,net_cop,status,created_by,metadata)
    values(cid,'video_call','video_call',p_call_id,v.price_cop,v.platform_fee_cop,v.creator_net_cop,'earned',auth.uid(),jsonb_build_object('duration_minutes',v.duration_minutes))
    on conflict(source_type,source_id,movement_type) where source_id is not null and movement_type <> 'adjustment' do nothing;
end $$;
create or replace function public.finish_video_call(p_call_id uuid)
returns void language sql security invoker set search_path=''
as $$select carlea_private.finish_video_call(p_call_id)$$;

create or replace function carlea_private.creator_earnings_summary(p_creator_id uuid)
returns jsonb language plpgsql stable security definer set search_path=''
as $$
declare result jsonb;
begin
  if auth.uid() is null or not (public.is_admin() or public.owns_creator(p_creator_id)) then raise exception 'Sin acceso'; end if;
  select jsonb_build_object(
    'month_earned',coalesce(sum(net_cop) filter(where occurred_at>=date_trunc('month',now()) and status in ('earned','available','paid')),0),
    'video_calls',coalesce(sum(net_cop) filter(where movement_type='video_call' and status in ('earned','available','paid')),0),
    'experiences',coalesce(sum(net_cop) filter(where movement_type='experience' and status in ('earned','available','paid')),0),
    'membership_fees',coalesce(sum(net_cop) filter(where movement_type='creator_membership'),0),
    'available',coalesce(sum(net_cop) filter(where status='available'),0),
    'pending',coalesce(sum(net_cop) filter(where status in ('pending','earned')),0),
    'paid',coalesce(sum(net_cop) filter(where status='paid'),0)
  ) into result from public.financial_ledger where creator_id=p_creator_id;
  return result;
end $$;
create or replace function public.creator_earnings_summary(p_creator_id uuid)
returns jsonb language sql security invoker set search_path=''
as $$select carlea_private.creator_earnings_summary(p_creator_id)$$;

create or replace function carlea_private.admin_run_creator_membership_cycle(p_creator_id uuid)
returns text language plpgsql security definer set search_path=''
as $$
declare balance integer; fee constant integer:=39900; lid uuid; pay uuid; owner uuid;
begin
  if not public.is_admin() then raise exception 'Solo administración activa'; end if;
  if exists(select 1 from public.creator_memberships where creator_id=p_creator_id and current_period_end>now() and status='active') then return 'already_active'; end if;
  select coalesce(sum(net_cop),0)::integer into balance from public.financial_ledger where creator_id=p_creator_id and status='available';
  select user_id into owner from public.creators where id=p_creator_id;
  if balance>=fee then
    insert into public.financial_ledger(creator_id,movement_type,source_type,gross_cop,platform_fee_cop,net_cop,status,created_by,metadata)
      values(p_creator_id,'creator_membership','monthly_fee',fee,0,-fee,'paid',auth.uid(),jsonb_build_object('period',to_char(now(),'YYYY-MM'))) returning id into lid;
    insert into public.creator_memberships(creator_id,status,current_period_start,current_period_end,last_charge_ledger_id)
      values(p_creator_id,'active',now(),now()+interval '1 month',lid)
      on conflict(creator_id) do update set status='active',current_period_start=now(),current_period_end=now()+interval '1 month',last_charge_ledger_id=lid,updated_at=now();
    return 'deducted_from_balance';
  end if;
  insert into public.payment_requests(user_id,creator_id,product_type,product_ref,amount_cop,metadata)
    values(owner,p_creator_id,'creator_membership',p_creator_id,fee,jsonb_build_object('period',to_char(now(),'YYYY-MM'))) returning id into pay;
  insert into public.creator_memberships(creator_id,status,payment_request_id)
    values(p_creator_id,'past_due',pay) on conflict(creator_id) do update set status='past_due',payment_request_id=pay,updated_at=now();
  return 'payment_required';
end $$;
create or replace function public.admin_run_creator_membership_cycle(p_creator_id uuid)
returns text language sql security invoker set search_path=''
as $$select carlea_private.admin_run_creator_membership_cycle(p_creator_id)$$;

-- ---------------------------------------------------------------------------
-- 9) ADMIN: MÉTRICAS, REPORTES, ELIMINACIÓN SEGURA
-- ---------------------------------------------------------------------------

create or replace function carlea_private.admin_metrics()
returns jsonb language plpgsql stable security definer set search_path=''
as $$
declare result jsonb;
begin
  if not public.is_admin() then raise exception 'Solo administración activa'; end if;
  select jsonb_build_object(
    'active_users',(select count(*) from public.profiles where role='user' and status='active'),
    'users_active',(select count(*) from public.profiles where role='user' and status='active'),
    'new_users_30d',(select count(*) from public.profiles where created_at>=now()-interval '30 days'),
    'active_creators',(select count(*) from public.creators where active=true),
    'creators_active',(select count(*) from public.creators where active=true),
    'pending_content',(select count(*) from public.content where status='pending'),
    'content_pending',(select count(*) from public.content where status='pending'),
    'pending_payments',(select count(*) from public.payment_requests where status='pending'),
    'payments_pending',(select count(*) from public.payment_requests where status='pending'),
    'experience_waiting',(select count(*) from public.experience_requests where creator_responded_at is null),
    'overdue_experiences',(select count(*) from public.experience_requests where creator_responded_at is null and coalesce(requested_at,created_at)<now()-interval '3 hours'),
    'video_waiting',(select count(*) from public.video_calls where payment_status='approved' and status='requested'),
    'open_moderation_alerts',(select count(*) from public.moderation_alerts where status in ('open','in_review')),
    'moderation_alerts',(select count(*) from public.moderation_alerts where status in ('open','in_review')),
    'open_reports',(select count(*) from public.reports where workflow_status in ('open','in_review')),
    'reports_open',(select count(*) from public.reports where workflow_status in ('open','in_review')),
    'gross_revenue',(select coalesce(sum(gross_cop),0) from public.financial_ledger where occurred_at>=date_trunc('month',now()) and status<>'void'),
    'platform_revenue',(select coalesce(sum(platform_fee_cop),0) from public.financial_ledger where occurred_at>=date_trunc('month',now()) and status<>'void'),
    'platform_commission_month',(select coalesce(sum(platform_fee_cop),0) from public.financial_ledger where occurred_at>=date_trunc('month',now()) and status<>'void'),
    'creator_net',(select coalesce(sum(net_cop),0) from public.financial_ledger where occurred_at>=date_trunc('month',now()) and status<>'void'),
    'creator_balances',(select coalesce(sum(net_cop),0) from public.financial_ledger where status in ('earned','available'))
  ) into result;
  return result;
end $$;
create or replace function public.admin_metrics()
returns jsonb language sql security invoker set search_path=''
as $$select carlea_private.admin_metrics()$$;

create or replace function carlea_private.admin_set_report_status(p_report_id uuid,p_status text,p_notes text default null)
returns void language plpgsql security definer set search_path=''
as $$
begin
  if not public.is_admin() then raise exception 'Solo administración activa'; end if;
  if p_status not in ('open','in_review','resolved','closed') then raise exception 'Estado inválido'; end if;
  update public.reports set workflow_status=p_status,updated_at=now() where id=p_report_id;
  if not found then raise exception 'Reporte inexistente'; end if;
  insert into public.admin_audit(admin_id,action,target_id,reason) values(auth.uid(),'report.status.'||p_status,p_report_id,coalesce(nullif(btrim(coalesce(p_notes,'')),''),'Cambio de estado'));
end $$;
create or replace function public.admin_set_report_status(p_report_id uuid,p_status text,p_notes text default null)
returns void language sql security invoker set search_path=''
as $$select carlea_private.admin_set_report_status(p_report_id,p_status,p_notes)$$;

create or replace function carlea_private.admin_prepare_account_removal(p_user_id uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare has_financial boolean; has_audit boolean; has_relations boolean;
begin
  if not public.is_admin() then raise exception 'Solo administración activa'; end if;
  if p_user_id=auth.uid() then raise exception 'No puedes eliminar tu propia cuenta'; end if;
  if length(btrim(coalesce(p_reason,'')))<5 then raise exception 'Motivo requerido'; end if;
  select exists(
    select 1 from public.financial_ledger l join public.creators c on c.id=l.creator_id where c.user_id=p_user_id
    union all select 1 from public.payment_requests where user_id=p_user_id or creator_id in (select id from public.creators where user_id=p_user_id)
  ) into has_financial;
  select exists(select 1 from public.admin_audit where target_id=p_user_id) into has_audit;
  select exists(
    select 1 from public.creators where user_id=p_user_id
    union all select 1 from public.conversations where user_id=p_user_id
    union all select 1 from public.messages where sender_id=p_user_id
    union all select 1 from public.reports where user_id=p_user_id or reported_user_id=p_user_id
    union all select 1 from public.experience_requests where user_id=p_user_id
  ) into has_relations;
  update public.profiles set status='suspended',onboarding_state='suspended',display_name='Cuenta eliminada',bio='',avatar_path=null,
    commercial_consent=false,phone='',city='',updated_at=now() where id=p_user_id;
  update public.creators set active=false,chat_open=false,bio='',links='' where user_id=p_user_id;
  insert into public.admin_audit(admin_id,action,target_id,reason) values(auth.uid(),'account.removal_prepared',p_user_id,btrim(p_reason));
  return jsonb_build_object(
    'mode',case when has_financial or has_audit or has_relations then 'anonymize_and_soft_delete' else 'hard_delete_candidate' end,
    'preserve_financial',has_financial,'preserve_audit',has_audit,'preserve_relations',has_relations
  );
end $$;
create or replace function public.admin_prepare_account_removal(p_user_id uuid,p_reason text)
returns jsonb language sql security invoker set search_path=''
as $$select carlea_private.admin_prepare_account_removal(p_user_id,p_reason)$$;

-- ---------------------------------------------------------------------------
-- 10) GRANTS DE RPC Y REALTIME
-- ---------------------------------------------------------------------------

revoke all on function
  public.touch_creator_activity(boolean),public.list_ranked_creators(),public.creator_content_manifest(uuid),public.mark_conversation_read(uuid),
  public.admin_enter_chat(uuid,text),public.admin_enable_chat_intervention(uuid),public.admin_send_moderation_message(uuid,text),public.admin_leave_chat(uuid),
  public.notification_action(uuid,text),public.notification_bulk_action(text),
  public.submit_creator_application(text,text,text,date,text,text,text,text),public.admin_identity_access(uuid),public.review_application_v4(uuid,boolean,text),
  public.creator_resubmit_content(uuid,text,text),public.creator_toggle_experience(uuid,boolean),public.request_experience_scheduled(uuid,timestamptz,text),
  public.creator_respond_experience_v4(uuid,text,timestamptz,text),public.complete_experience_request(uuid),public.request_video_call_purchase(uuid,integer,timestamptz),
  public.admin_review_payment(uuid,boolean,text,text),public.creator_respond_video_call(uuid,text,timestamptz),public.start_video_call(uuid),public.finish_video_call(uuid),
  public.creator_earnings_summary(uuid),public.admin_run_creator_membership_cycle(uuid),public.admin_metrics(),public.admin_set_report_status(uuid,text,text),public.admin_prepare_account_removal(uuid,text)
from public,anon;

grant execute on function public.list_ranked_creators(),public.creator_content_manifest(uuid) to anon,authenticated;
grant execute on function
  public.touch_creator_activity(boolean),public.mark_conversation_read(uuid),
  public.admin_enter_chat(uuid,text),public.admin_enable_chat_intervention(uuid),public.admin_send_moderation_message(uuid,text),public.admin_leave_chat(uuid),
  public.notification_action(uuid,text),public.notification_bulk_action(text),
  public.submit_creator_application(text,text,text,date,text,text,text,text),public.admin_identity_access(uuid),public.review_application_v4(uuid,boolean,text),
  public.creator_resubmit_content(uuid,text,text),public.creator_toggle_experience(uuid,boolean),public.request_experience_scheduled(uuid,timestamptz,text),
  public.creator_respond_experience_v4(uuid,text,timestamptz,text),public.complete_experience_request(uuid),public.request_video_call_purchase(uuid,integer,timestamptz),
  public.admin_review_payment(uuid,boolean,text,text),public.creator_respond_video_call(uuid,text,timestamptz),public.start_video_call(uuid),public.finish_video_call(uuid),
  public.creator_earnings_summary(uuid),public.admin_run_creator_membership_cycle(uuid),public.admin_metrics(),public.admin_set_report_status(uuid,text,text),public.admin_prepare_account_removal(uuid,text)
to authenticated;

-- Realtime additions are idempotent.
do $$
declare t text;
begin
  foreach t in array array['payment_requests','moderation_alerts','creator_activity','creator_availability','financial_ledger','chat_moderation_sessions'] loop
    if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t) then
      execute format('alter publication supabase_realtime add table public.%I',t);
    end if;
  end loop;
end $$;

notify pgrst,'reload schema';
commit;
