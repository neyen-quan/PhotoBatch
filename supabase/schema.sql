-- PhotoBatch only: rkuaogjbzuwxprkaxugd. Deployed as shared_counters_v1.
-- No media, filenames, paths, passwords or session tokens are stored here.
create schema if not exists photobatch_private;
revoke all on schema photobatch_private from public, anon;
grant usage on schema photobatch_private to authenticated;

create table public.counters (
  user_id uuid primary key references auth.users(id) on delete cascade,
  photo_last bigint not null default -1 check (photo_last between -1 and 999999999),
  video_last bigint not null default 14098 check (video_last between 14098 and 999999999),
  updated_at timestamptz not null default now()
);
create table public.number_reservations (
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  kind text not null check (kind in ('photo','video')),
  range_start bigint not null check (range_start between 0 and 999999999),
  range_end bigint not null check (range_end between range_start and 999999999),
  created_at timestamptz not null default now(),
  primary key (user_id, request_id)
);
alter table public.counters enable row level security;
alter table public.number_reservations enable row level security;
revoke all on public.counters, public.number_reservations from anon, authenticated;
grant select on public.counters, public.number_reservations to authenticated;
create policy own_counters on public.counters for select to authenticated
  using (user_id = (select auth.uid()));
create policy own_reservations on public.number_reservations for select to authenticated
  using (user_id = (select auth.uid()));

-- The only writes are through bounded, authenticated operations. Callers cannot
-- supply an owner, lower a counter, delete a reservation or modify its range.
create function photobatch_private.sync_counters(p_photo bigint, p_video bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_row public.counters;
begin
  if v_uid is null then raise exception 'Iniciá sesión en PhotoBatch.' using errcode='42501'; end if;
  if p_photo is null or p_video is null or p_photo not between -1 and 999999999
     or p_video not between 14098 and 999999999 then raise exception 'Numeración inválida.'; end if;
  insert into public.counters(user_id, photo_last, video_last) values(v_uid,p_photo,p_video)
    on conflict(user_id) do update set
      photo_last=greatest(counters.photo_last,excluded.photo_last),
      video_last=greatest(counters.video_last,excluded.video_last),
      updated_at=case when excluded.photo_last>counters.photo_last or excluded.video_last>counters.video_last
        then now() else counters.updated_at end
    returning * into v_row;
  return jsonb_build_object('photo',v_row.photo_last,'video',v_row.video_last);
end $$;

create function photobatch_private.reserve_numbers(p_request uuid, p_kind text, p_start bigint, p_end bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_last bigint; v_row public.counters; v_existing public.number_reservations;
begin
  if v_uid is null then raise exception 'Iniciá sesión en PhotoBatch.' using errcode='42501'; end if;
  if p_request is null or p_kind is null or p_kind not in ('photo','video') or p_start is null or p_end is null
    or p_start<0 or p_end<p_start or p_end>999999999 or (p_kind='video' and p_start<14099)
    then raise exception 'Reserva inválida.'; end if;
  insert into public.counters(user_id) values(v_uid) on conflict do nothing;
  -- Serialize ALL writers for this user, including the first use on two devices.
  select * into v_row from public.counters where user_id=v_uid for update;
  select * into v_existing from public.number_reservations where user_id=v_uid and request_id=p_request;
  if found then
    if v_existing.kind<>p_kind or v_existing.range_start<>p_start or v_existing.range_end<>p_end
      then raise exception 'La solicitud ya existe con otra numeración.'; end if;
    return jsonb_build_object('start',p_start,'end',p_end,'photo',v_row.photo_last,'video',v_row.video_last);
  end if;
  v_last := case when p_kind='photo' then v_row.photo_last else v_row.video_last end;
  if p_start<=v_last then
    raise exception 'La numeración avanzó en otro equipo. Sincronizá y generá una nueva vista previa. Siguiente: %.',v_last+1
      using errcode='P0001';
  end if;
  insert into public.number_reservations(user_id,request_id,kind,range_start,range_end)
    values(v_uid,p_request,p_kind,p_start,p_end);
  update public.counters set photo_last=case when p_kind='photo' then p_end else photo_last end,
    video_last=case when p_kind='video' then p_end else video_last end,updated_at=now()
    where user_id=v_uid returning * into v_row;
  return jsonb_build_object('start',p_start,'end',p_end,'photo',v_row.photo_last,'video',v_row.video_last);
end $$;

revoke all on function photobatch_private.sync_counters(bigint,bigint) from public, anon;
revoke all on function photobatch_private.reserve_numbers(uuid,text,bigint,bigint) from public, anon;
grant execute on function photobatch_private.sync_counters(bigint,bigint) to authenticated;
grant execute on function photobatch_private.reserve_numbers(uuid,text,bigint,bigint) to authenticated;

create function public.sync_counters(p_photo bigint default -1, p_video bigint default 14098)
returns jsonb language sql security invoker set search_path = '' as $$
  select photobatch_private.sync_counters(p_photo,p_video);
$$;
create function public.reserve_numbers(p_request uuid, p_kind text, p_start bigint, p_end bigint)
returns jsonb language sql security invoker set search_path = '' as $$
  select photobatch_private.reserve_numbers(p_request,p_kind,p_start,p_end);
$$;
revoke all on function public.sync_counters(bigint,bigint) from public, anon;
revoke all on function public.reserve_numbers(uuid,text,bigint,bigint) from public, anon;
grant execute on function public.sync_counters(bigint,bigint) to authenticated;
grant execute on function public.reserve_numbers(uuid,text,bigint,bigint) to authenticated;
