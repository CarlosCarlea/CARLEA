-- HISTORICAL ONLY. DO NOT APPLY WITH THE 3.2 REVIEW MIGRATION.
-- carlea_v3_roles_chat_verification
-- CARLÉA 3.0: additive changes, existing profiles and plans retained.
create schema if not exists carlea_private;
revoke all on schema carlea_private from public;
grant usage on schema carlea_private to authenticated;
alter table public.profiles add column if not exists bio text default '' check (length(bio)<=1200);
alter table public.creators add column if not exists verified boolean not null default false;
alter table public.creators add column if not exists links text default '' check (length(links)<=500);
alter table public.creators add column if not exists accent text not null default 'gold' check (accent in ('gold','rose','violet'));
alter table public.creators add column if not exists chat_open boolean not null default false;
alter table public.content add column if not exists audience text not null default 'diamond' check (audience in ('public','premium','diamond'));
update public.content set audience='public' where visibility='public';
alter table public.messages add column if not exists attachment_path text;
alter table public.messages add column if not exists attachment_kind text check(attachment_kind in ('image','audio','video'));
grant update(bio) on public.profiles to authenticated;
grant update(links,accent,chat_open) on public.creators to authenticated;
grant insert(audience),update(audience) on public.content to authenticated;
grant insert(attachment_path,attachment_kind) on public.messages to authenticated;
create table if not exists public.platform_settings(id boolean primary key default true check(id), operator_name text not null default '', tax_id text not null default '', address text not null default '', privacy_email text not null default '', retention_days integer not null default 30 check(retention_days between 1 and 365), updated_at timestamptz not null default now());
insert into public.platform_settings(id) values(true) on conflict do nothing;
create table if not exists public.creator_applications(id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id), creator_id uuid not null references public.creators(id), document_path text not null, selfie_path text not null, consent_version text not null, consent_at timestamptz not null default now(), status text not null default 'pending' check(status in ('pending','approved','rejected')), reason text, reviewed_by uuid references public.profiles(id), reviewed_at timestamptz, created_at timestamptz not null default now(), unique(user_id,creator_id));
create table if not exists public.creator_plans(id uuid primary key default gen_random_uuid(),creator_id uuid not null references public.creators(id), tier text not null check(tier in ('premium','diamond')),price_cop integer not null check(price_cop>=9900 and price_cop%10000=9900), description text not null default '', active boolean not null default true,unique(creator_id,tier));
insert into public.creator_plans(creator_id,tier,price_cop,description) select id,'premium',19900,'Chat de texto y publicaciones Premium' from public.creators on conflict do nothing;
insert into public.creator_plans(creator_id,tier,price_cop,description) select id,'diamond',39900,'Premium, multimedia y solicitudes de videollamada' from public.creators on conflict do nothing;
create table if not exists public.creator_subscriptions(id uuid primary key default gen_random_uuid(),user_id uuid not null references public.profiles(id),creator_id uuid not null references public.creators(id),tier text not null check(tier in ('premium','diamond')),status text not null default 'requested' check(status in ('requested','active','cancelled','expired')),expires_at timestamptz,created_at timestamptz not null default now(),unique(user_id,creator_id));
create table if not exists public.admin_audit(id uuid primary key default gen_random_uuid(),admin_id uuid not null references public.profiles(id),action text not null,target_id uuid,reason text not null,created_at timestamptz not null default now());
create table if not exists public.video_calls(id uuid primary key default gen_random_uuid(),conversation_id uuid not null references public.conversations(id),caller_id uuid not null references public.profiles(id),status text not null default 'requested' check(status in ('requested','accepted','declined','ended')),created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create unique index if not exists one_live_call on public.video_calls(conversation_id) where status in ('requested','accepted');
create table if not exists public.call_signals(id bigint generated always as identity primary key,call_id uuid not null references public.video_calls(id) on delete cascade,sender_id uuid not null references public.profiles(id),kind text not null check(kind in ('offer','answer','ice')),payload jsonb not null,created_at timestamptz not null default now());
create table if not exists public.reports(id uuid primary key default gen_random_uuid(),user_id uuid not null references public.profiles(id),creator_id uuid references public.creators(id),reason text not null check(length(reason) between 5 and 2000),status text not null default 'open' check(status in ('open','closed')),created_at timestamptz not null default now());
create or replace function carlea_private.tier(cid uuid) returns integer language sql stable security definer set search_path='' as $$
select case when auth.uid() is null or not public.is_active() then 0 when public.is_admin() or public.owns_creator(cid) then 2 else greatest(coalesce((select case plan when 'premium' then 2 when 'essential' then 1 else 0 end from public.profiles where id=auth.uid()),0),coalesce((select case tier when 'diamond' then 2 else 1 end from public.creator_subscriptions where user_id=auth.uid() and creator_id=cid and status='active' and expires_at>now()),0)) end $$;
create or replace function carlea_private.participant(cid uuid) returns boolean language sql stable security definer set search_path='' as $$
select auth.uid() is not null and public.is_active() and exists(select 1 from public.conversations cv join public.creators c on c.id=cv.creator_id join public.profiles p on p.id=cv.user_id where cv.id=cid and c.active and p.status='active' and (cv.user_id=auth.uid() or c.user_id=auth.uid()) and exists(select 1 from public.profiles cp where cp.id=c.user_id and cp.status='active')) $$;
create or replace function carlea_private.media_allowed(cid uuid) returns boolean language sql stable security definer set search_path='' as $$
select auth.uid() is not null and exists(select 1 from public.conversations cv join public.profiles p on p.id=cv.user_id where cv.id=cid and (p.plan='premium' or exists(select 1 from public.creator_subscriptions s where s.user_id=cv.user_id and s.creator_id=cv.creator_id and s.tier='diamond' and s.status='active' and s.expires_at>now()))) $$;
create or replace function carlea_private.can_chat(cid uuid) returns boolean language sql stable security definer set search_path='' as $$
select carlea_private.participant(cid) and exists(select 1 from public.conversations cv join public.profiles p on p.id=cv.user_id where cv.id=cid and (p.plan in ('essential','premium') or exists(select 1 from public.creator_subscriptions s where s.user_id=cv.user_id and s.creator_id=cv.creator_id and s.status='active' and s.expires_at>now()))) $$;
create or replace function carlea_private.admin_chat(cid uuid) returns boolean language sql stable security definer set search_path='' as $$ select auth.uid() is not null and public.is_admin() and exists(select 1 from public.admin_audit where admin_id=auth.uid() and action='chat_review' and target_id=cid and created_at>now()-interval '30 minutes') $$;
create or replace function carlea_private.legal_ready() returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.platform_settings where operator_name<>'' and tax_id<>'' and address<>'' and privacy_email like '%@%')$$;
revoke all on all functions in schema carlea_private from public;
grant execute on all functions in schema carlea_private to authenticated;
-- The public catalogue must also work without authentication.
grant usage on schema carlea_private to anon;
grant execute on function carlea_private.tier(uuid) to anon;
-- Tables use restrictive ownership policies; privileged operations use validated RPCs.
do $$ declare t text; begin foreach t in array array['platform_settings','creator_applications','creator_plans','creator_subscriptions','admin_audit','video_calls','call_signals','reports'] loop execute format('alter table public.%I enable row level security',t); execute format('grant select on public.%I to authenticated',t); end loop; end $$;
grant select on public.platform_settings,public.creator_plans to anon;
create policy settings_read on public.platform_settings for select using(true);
create policy settings_admin on public.platform_settings for update to authenticated using(public.is_admin()) with check(public.is_admin());
grant update(operator_name,tax_id,address,privacy_email,retention_days) on public.platform_settings to authenticated;
create policy plans_read on public.creator_plans for select using(active or public.is_admin() or public.owns_creator(creator_id));
create policy plans_edit on public.creator_plans for update to authenticated using(public.is_active() and (public.owns_creator(creator_id) or public.is_admin())) with check(public.is_active() and (public.owns_creator(creator_id) or public.is_admin()));
grant update(price_cop,description,active) on public.creator_plans to authenticated;
create policy applications_read on public.creator_applications for select to authenticated using(user_id=auth.uid() or public.is_admin());
create policy applications_submit on public.creator_applications for insert to authenticated with check(user_id=auth.uid() and status='pending' and reviewed_by is null and reviewed_at is null and consent_version='3.0' and carlea_private.legal_ready() and document_path like auth.uid()::text||'/%' and selfie_path like auth.uid()::text||'/%' and exists(select 1 from public.profiles where id=auth.uid() and status<>'suspended'));
grant insert(user_id,creator_id,document_path,selfie_path,consent_version) on public.creator_applications to authenticated;
create policy subscriptions_read on public.creator_subscriptions for select to authenticated using(user_id=auth.uid() or public.owns_creator(creator_id) or public.is_admin());
create policy subscriptions_request on public.creator_subscriptions for insert to authenticated with check(user_id=auth.uid() and public.is_active() and status='requested' and expires_at is null);
grant insert(user_id,creator_id,tier) on public.creator_subscriptions to authenticated;
create policy audit_admin_read on public.admin_audit for select to authenticated using(public.is_admin());
create policy reports_read on public.reports for select to authenticated using(user_id=auth.uid() or public.is_admin());
create policy reports_insert on public.reports for insert to authenticated with check(user_id=auth.uid() and status='open');
create policy reports_update on public.reports for update to authenticated using(public.is_admin()) with check(public.is_admin());
grant insert(user_id,creator_id,reason),update(status) on public.reports to authenticated;
-- Match publication audience to legacy visibility and stop forged approval on inserts.
create or replace function carlea_private.guard_content() returns trigger language plpgsql set search_path='' as $$ begin
 if TG_OP='INSERT' and not public.is_admin() then new.status:='pending';new.approved_by:=null;new.approved_at:=null;end if;
 new.visibility:=case when new.audience='public' then 'public'::public.content_visibility else 'premium'::public.content_visibility end;
 if new.storage_bucket<>'creator-content' or split_part(new.storage_path,'/',1)<>new.uploaded_by::text then raise exception 'Ruta no válida';end if;return new;end $$;
create trigger carlea_guard_content before insert or update on public.content for each row execute function carlea_private.guard_content();
drop policy content_authenticated_read on public.content;
create policy content_authenticated_read on public.content for select to authenticated using((uploaded_by=auth.uid() and public.is_active()) or public.is_admin() or (status='approved' and (audience='public' or (audience='premium' and carlea_private.tier(creator_id)>=1) or (audience='diamond' and carlea_private.tier(creator_id)>=2))));
drop policy creator_content_authenticated_read on storage.objects;
create policy creator_content_authenticated_read on storage.objects for select to authenticated using(bucket_id='creator-content' and (public.is_admin() or (public.is_active() and (storage.foldername(name))[1]=auth.uid()::text) or exists(select 1 from public.content ct where ct.storage_path=name and ct.storage_bucket=bucket_id and ct.status='approved' and (ct.audience='public' or (ct.audience='premium' and carlea_private.tier(ct.creator_id)>=1) or (ct.audience='diamond' and carlea_private.tier(ct.creator_id)>=2)))));
drop policy conversations_user_insert on public.conversations;
create policy conversations_user_insert on public.conversations for insert to authenticated with check(user_id=auth.uid() and carlea_private.tier(creator_id)>=1 and exists(select 1 from public.creators c join public.profiles p on p.id=c.user_id where c.id=creator_id and c.active and c.chat_open and p.status='active'));
drop policy messages_insert_participant on public.messages;
create policy messages_insert_participant on public.messages for insert to authenticated with check(sender_id=auth.uid() and carlea_private.can_chat(conversation_id) and ((attachment_path is null and attachment_kind is null) or (attachment_path is not null and attachment_kind is not null and carlea_private.media_allowed(conversation_id) and split_part(attachment_path,'/',1)=conversation_id::text and split_part(attachment_path,'/',2)=auth.uid()::text)));
drop policy messages_select_participants on public.messages;
create policy messages_select_participants on public.messages for select to authenticated using((carlea_private.can_chat(conversation_id) and (attachment_path is null or carlea_private.media_allowed(conversation_id))) or carlea_private.admin_chat(conversation_id));
-- No direct messages mutation except read acknowledgement.
create or replace function public.get_or_create_conversation(p_creator_id uuid) returns uuid language plpgsql security invoker set search_path='' as $$ declare v_id uuid;begin
 if carlea_private.tier(p_creator_id)<1 then raise exception 'Necesitas Premium o Diamante para esta creadora';end if;
 if not exists(select 1 from public.creators where id=p_creator_id and chat_open and active and user_id is not null and user_id<>auth.uid()) then raise exception 'La creadora no está disponible para chat';end if;
 select id into v_id from public.conversations where user_id=auth.uid() and creator_id=p_creator_id;
 if v_id is null then insert into public.conversations(user_id,creator_id) values(auth.uid(),p_creator_id) returning id into v_id;end if;return v_id;end $$;
-- Video signaling uses persisted authorized rows, never public broadcast rooms.
create policy calls_read on public.video_calls for select to authenticated using(carlea_private.can_chat(conversation_id) or public.is_admin());
create policy calls_insert on public.video_calls for insert to authenticated with check(caller_id=auth.uid() and status='requested' and carlea_private.can_chat(conversation_id) and carlea_private.media_allowed(conversation_id) and exists(select 1 from public.conversations where id=conversation_id and user_id=auth.uid()));
grant insert(conversation_id,caller_id) on public.video_calls to authenticated;
create policy signals_read on public.call_signals for select to authenticated using(exists(select 1 from public.video_calls vc where vc.id=call_id and vc.status='accepted' and carlea_private.can_chat(vc.conversation_id) and carlea_private.media_allowed(vc.conversation_id)));
create policy signals_insert on public.call_signals for insert to authenticated with check(sender_id=auth.uid() and length(payload::text)<20000 and exists(select 1 from public.video_calls vc where vc.id=call_id and vc.status='accepted' and carlea_private.can_chat(vc.conversation_id) and carlea_private.media_allowed(vc.conversation_id)));
grant insert(call_id,sender_id,kind,payload) on public.call_signals to authenticated;
grant usage on sequence public.call_signals_id_seq to authenticated;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('identity-private','identity-private',false,5242880,array['image/jpeg','image/png','image/webp']),('chat-private','chat-private',false,15728640,array['image/jpeg','image/png','image/webp','audio/webm','audio/ogg','audio/mp4','video/mp4','video/webm']),('avatars','avatars',false,3145728,array['image/jpeg','image/png','image/webp']) on conflict(id) do nothing;
create policy identity_upload on storage.objects for insert to authenticated with check(bucket_id='identity-private' and (storage.foldername(name))[1]=auth.uid()::text and carlea_private.legal_ready() and exists(select 1 from public.profiles where id=auth.uid() and status<>'suspended'));
create policy identity_read on storage.objects for select to authenticated using(bucket_id='identity-private' and (public.is_admin() or (storage.foldername(name))[1]=auth.uid()::text));
create policy identity_delete on storage.objects for delete to authenticated using(bucket_id='identity-private' and public.is_admin());
create policy avatar_insert on storage.objects for insert to authenticated with check(bucket_id='avatars' and public.is_active() and (storage.foldername(name))[1]=auth.uid()::text);
create policy avatar_read on storage.objects for select to authenticated using(bucket_id='avatars' and (public.is_admin() or (storage.foldername(name))[1]=auth.uid()::text));
create policy chat_upload on storage.objects for insert to authenticated with check(bucket_id='chat-private' and (storage.foldername(name))[2]=auth.uid()::text and exists(select 1 from public.conversations cv where cv.id::text=(storage.foldername(name))[1] and carlea_private.can_chat(cv.id) and carlea_private.media_allowed(cv.id)));
create policy chat_read on storage.objects for select to authenticated using(bucket_id='chat-private' and exists(select 1 from public.messages m where m.attachment_path=name and ((carlea_private.can_chat(m.conversation_id) and carlea_private.media_allowed(m.conversation_id)) or carlea_private.admin_chat(m.conversation_id))));
create policy chat_orphan_cleanup on storage.objects for delete to authenticated using(bucket_id='chat-private' and (storage.foldername(name))[2]=auth.uid()::text);
-- Private validated administrative operations, exposed through invoker wrappers.
create or replace function carlea_private.review_application(aid uuid,approve boolean,note text) returns void language plpgsql security definer set search_path='' as $$ declare a public.creator_applications;begin
 if auth.uid() is null or not public.is_admin() then raise exception 'Administrador requerido';end if;
 select * into a from public.creator_applications where id=aid and status='pending' for update;if not found then raise exception 'Solicitud no pendiente';end if;
 if approve then
 if not exists(select 1 from storage.objects where bucket_id='identity-private' and name=a.document_path) or not exists(select 1 from storage.objects where bucket_id='identity-private' and name=a.selfie_path) then raise exception 'Faltan documentos';end if;
 if exists(select 1 from public.creators where id=a.creator_id and user_id is not null and user_id<>a.user_id) then raise exception 'Perfil ya vinculado';end if;
 update public.creators set user_id=a.user_id,verified=true where id=a.creator_id;
 update public.profiles set role='creator',status='active' where id=a.user_id;
 end if;
 update public.creator_applications set status=case when approve then 'approved' else 'rejected' end,reason=note,reviewed_by=auth.uid(),reviewed_at=now() where id=aid;
 insert into public.admin_audit(admin_id,action,target_id,reason) values(auth.uid(),'identity_review',aid,coalesce(note,'Revisión de identidad'));
 insert into public.notifications(user_id,type,title,body) values(a.user_id,'verification',case when approve then 'Identidad aprobada' else 'Solicitud rechazada' end,note);
 end $$;
create or replace function public.review_application(aid uuid,approve boolean,note text) returns void language sql security invoker set search_path='' as $$select carlea_private.review_application(aid,approve,note)$$;
create or replace function carlea_private.review_chat(cid uuid,note text) returns void language plpgsql security definer set search_path='' as $$begin
 if auth.uid() is null or not public.is_admin() or length(trim(note))<5 then raise exception 'Indica un motivo de moderación';end if;
 insert into public.admin_audit(admin_id,action,target_id,reason) values(auth.uid(),'chat_review',cid,note);
 insert into public.notifications(user_id,type,title,body) select cv.user_id,'moderation','Administración revisó una conversación',note from public.conversations cv where cv.id=cid union all select c.user_id,'moderation','Administración revisó una conversación',note from public.conversations cv join public.creators c on c.id=cv.creator_id where cv.id=cid and c.user_id is not null;
 end $$;
create or replace function public.review_chat(cid uuid,note text) returns void language sql security invoker set search_path='' as $$select carlea_private.review_chat(cid,note)$$;
create or replace function carlea_private.respond_call(call uuid,decision text) returns void language plpgsql security definer set search_path='' as $$ declare v public.video_calls;begin
 select * into v from public.video_calls where id=call for update;
 if not found or auth.uid() is null or not carlea_private.can_chat(v.conversation_id) then raise exception 'Sin acceso';end if;
 if decision in ('accepted','declined') then
 if v.status<>'requested' or v.created_at<now()-interval '2 minutes' or not exists(select 1 from public.conversations cv join public.creators c on c.id=cv.creator_id where cv.id=v.conversation_id and c.user_id=auth.uid()) then raise exception 'Solo la creadora puede responder a una solicitud vigente';end if;
 if decision='accepted' and not carlea_private.media_allowed(v.conversation_id) then raise exception 'Diamante requerido';end if;
 elsif decision<>'ended' then raise exception 'Estado inválido';end if;
 update public.video_calls set status=decision,updated_at=now() where id=call;
 end $$;
create or replace function public.respond_call(call uuid,decision text) returns void language sql security invoker set search_path='' as $$select carlea_private.respond_call(call,decision)$$;
create or replace function carlea_private.subscription_action(sid uuid,decision text) returns void language plpgsql security definer set search_path='' as $$declare s public.creator_subscriptions;begin
 if auth.uid() is null then raise exception 'Acceso requerido';end if;
 select * into s from public.creator_subscriptions where id=sid for update;
 if not found then raise exception 'Suscripción no encontrada';end if;
 if decision='cancelled' and (s.user_id=auth.uid() or public.is_admin()) then update public.creator_subscriptions set status='cancelled' where id=sid;
 elsif decision='active' and public.is_admin() then
 if not exists(select 1 from public.creators where id=s.creator_id and verified) or (select count(distinct audience) from public.content where creator_id=s.creator_id and status='approved')<3 then raise exception 'La creadora debe estar verificada y publicar contenido Público, Premium y Diamante';end if;
 update public.creator_subscriptions set status='active',expires_at=now()+interval '1 month' where id=sid;
 insert into public.admin_audit(admin_id,action,target_id,reason) values(auth.uid(),'subscription_activation',sid,'Activación manual; verificar pago fuera de plataforma');
 else raise exception 'Acción no permitida';end if;end $$;
create or replace function public.subscription_action(sid uuid,decision text) returns void language sql security invoker set search_path='' as $$select carlea_private.subscription_action(sid,decision)$$;
-- Keep existing API, add safety and an audit trail for account changes.
create or replace function carlea_private.set_profile(uid uuid,r public.user_role,p public.user_plan,s public.account_status) returns void language plpgsql security definer set search_path='' as $$begin
 if auth.uid() is null or not public.is_admin() then raise exception 'Administrador requerido';end if;
 if uid=auth.uid() and (s<>'active' or r<>'admin') then raise exception 'No puedes bloquear ni degradar tu propia cuenta';end if;
 update public.profiles set role=r,plan=p,status=s,updated_at=now() where id=uid;
 if not found then raise exception 'Cuenta inexistente';end if;
 if s<>'active' then update public.creators set chat_open=false where user_id=uid;end if;
 insert into public.admin_audit(admin_id,action,target_id,reason) values(auth.uid(),'account_update',uid,concat(r,' / ',p,' / ',s));end $$;
create or replace function public.admin_set_profile(p_user_id uuid,p_role public.user_role,p_plan public.user_plan,p_status public.account_status) returns void language sql security invoker set search_path='' as $$select carlea_private.set_profile(p_user_id,p_role,p_plan,p_status)$$;
revoke all on all functions in schema carlea_private from public;
grant execute on all functions in schema carlea_private to authenticated;
grant execute on function carlea_private.tier(uuid) to anon;
do $$declare fn regprocedure;begin for fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('review_application','review_chat','respond_call','subscription_action','admin_set_profile','admin_link_creator','get_or_create_conversation') loop execute format('revoke all on function %s from public,anon',fn);execute format('grant execute on function %s to authenticated',fn);end loop;end $$;
-- Prevent using the legacy link endpoint to skip identity verification.
revoke execute on function public.admin_link_creator(uuid,uuid) from authenticated;
do $$declare t text;begin foreach t in array array['messages','notifications','video_calls','call_signals'] loop if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t) then execute format('alter publication supabase_realtime add table public.%I',t);end if;end loop;end $$;
;

-- carlea_v3_conversation_capabilities
create or replace function public.conversation_capabilities(cid uuid) returns jsonb language plpgsql security invoker set search_path='' as $$begin if not carlea_private.can_chat(cid) then raise exception 'Sin acceso a esta conversación';end if;return jsonb_build_object('media',carlea_private.media_allowed(cid));end$$;revoke all on function public.conversation_capabilities(uuid) from public,anon;grant execute on function public.conversation_capabilities(uuid) to authenticated;;

-- carlea_v3_private_helpers
do $$declare f record; def text;begin for f in select p.oid,p.proname,pg_get_function_arguments(p.oid) args,pg_get_function_result(p.oid) result from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('is_admin','is_active','current_app_role','current_app_plan','owns_creator','admin_moderate_content','admin_confirm_experience_request','creator_respond_experience_request','request_experience') loop def:=pg_get_functiondef(f.oid);def:=replace(def,'FUNCTION public.'||f.proname||'(','FUNCTION carlea_private.'||f.proname||'(');execute def;execute format('create or replace function public.%I(%s) returns %s language sql security invoker set search_path='''' as %L',f.proname,f.args,f.result,'select carlea_private.'||f.proname||'('||case f.proname when 'owns_creator' then '$1' when 'admin_moderate_content' then '$1,$2,$3' when 'admin_confirm_experience_request' then '$1,$2' when 'creator_respond_experience_request' then '$1,$2,$3' when 'request_experience' then '$1,$2' else '' end||')');end loop;end$$; revoke all on all functions in schema carlea_private from public;grant execute on all functions in schema carlea_private to authenticated;grant execute on function carlea_private.is_admin(),carlea_private.is_active(),carlea_private.current_app_role(),carlea_private.current_app_plan(),carlea_private.owns_creator(uuid),carlea_private.tier(uuid) to anon;;

-- carlea_v3_subscription_requests_and_guards
create or replace function carlea_private.request_subscription(cid uuid,t text) returns void language plpgsql security definer set search_path='' as $$begin if auth.uid() is null or not public.is_active() or t not in ('premium','diamond') then raise exception 'Cuenta activa y plan válido requeridos';end if;if exists(select 1 from public.creator_subscriptions where user_id=auth.uid() and creator_id=cid and status='active' and expires_at>now()) then raise exception 'Ya tienes un plan activo; contacta a administración para cambiarlo';end if;if not exists(select 1 from public.creator_plans where creator_id=cid and tier=t and active) then raise exception 'Plan no disponible';end if;insert into public.creator_subscriptions(user_id,creator_id,tier) values(auth.uid(),cid,t) on conflict(user_id,creator_id) do update set tier=excluded.tier,status='requested',expires_at=null;end$$;create or replace function public.request_subscription(cid uuid,t text) returns void language sql security invoker set search_path='' as $$select carlea_private.request_subscription(cid,t)$$;revoke all on function carlea_private.request_subscription(uuid,text),public.request_subscription(uuid,text) from public,anon;grant execute on function carlea_private.request_subscription(uuid,text),public.request_subscription(uuid,text) to authenticated;create or replace function carlea_private.guard_creator_update() returns trigger language plpgsql set search_path='' as $$begin if auth.uid() is not null and not public.is_active() then raise exception 'Cuenta activa requerida';end if;return new;end$$;create trigger creator_active_update before update on public.creators for each row execute function carlea_private.guard_creator_update();;

-- carlea_v3_experience_entitlements
do $$declare def text;begin def:=pg_get_functiondef('carlea_private.request_experience(uuid,text)'::regprocedure);def:=replace(def,'if public.current_app_plan() <> ''premium'' then','if coalesce((select carlea_private.tier(creator_id) from public.experiences where id=p_experience_id),0)<2 then');def:=replace(def,'premium_required','Diamante requerido para esta creadora');execute def;def:=pg_get_functiondef('carlea_private.creator_respond_experience_request(uuid,boolean,text)'::regprocedure);def:=replace(def,'if not public.owns_creator(v_creator_id) then','if not public.is_active() or not public.owns_creator(v_creator_id) then');execute def;end$$;;

-- carlea_v3_public_plan_read
grant execute on function public.is_admin(),public.owns_creator(uuid),public.is_active(),public.current_app_plan(),public.current_app_role() to anon;;

-- carlea_v3_chat_display_names
create or replace function carlea_private.conversation_capabilities(cid uuid) returns jsonb language plpgsql security definer set search_path='' as $$declare v jsonb;begin if auth.uid() is null or not carlea_private.can_chat(cid) then raise exception 'Sin acceso a esta conversación';end if;select jsonb_build_object('media',carlea_private.media_allowed(cid),'peer_name',case when cv.user_id=auth.uid() then c.stage_name else p.display_name end) into v from public.conversations cv join public.creators c on c.id=cv.creator_id join public.profiles p on p.id=cv.user_id where cv.id=cid;return v;end$$;create or replace function public.conversation_capabilities(cid uuid) returns jsonb language sql security invoker set search_path='' as $$select carlea_private.conversation_capabilities(cid)$$;revoke all on function carlea_private.conversation_capabilities(uuid) from public,anon;grant execute on function carlea_private.conversation_capabilities(uuid) to authenticated;;

-- carlea_v3_suspend_creator_catalog
DO $$DECLARE d text;BEGIN d:=pg_get_functiondef('carlea_private.set_profile(uuid,public.user_role,public.user_plan,public.account_status)'::regprocedure);d:=replace(d,'if s<>''active'' then update public.creators set chat_open=false where user_id=uid;end if;','update public.creators set active=(s=''active''),chat_open=case when s=''active'' then chat_open else false end where user_id=uid;');EXECUTE d;END$$;
