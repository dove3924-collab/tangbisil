-- 월루: 방 / 대기실
-- Supabase 대시보드 → SQL Editor 에 통째로 붙여넣고 Run. 여러 번 실행해도 안전하다.
-- 클라이언트는 테이블에 직접 쓰지 못하고, 아래 함수(RPC)로만 바꾼다. 읽기는 같은 방 사람만.

create table if not exists public.rooms (
  code            text primary key,
  game            text not null,
  host_id         uuid not null,
  status          text not null default 'waiting',
  settings        jsonb not null default '{}'::jsonb,
  has_entry_code  boolean not null default false,
  created_at      timestamptz not null default now(),
  last_active_at  timestamptz not null default now()
);

-- 입장 코드는 아무도 직접 못 읽게 별도 테이블 (정책 없음 = 클라이언트 접근 불가)
create table if not exists public.room_secrets (
  code        text primary key references public.rooms(code) on delete cascade,
  entry_code  text
);

create table if not exists public.room_players (
  room_code     text not null references public.rooms(code) on delete cascade,
  user_id       uuid not null,
  nickname      text not null,
  color         int  not null default 0,
  joined_at     timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  left_at       timestamptz,
  primary key (room_code, user_id)
);
create index if not exists room_players_active on public.room_players (room_code) where left_at is null;

alter table public.rooms        enable row level security;
alter table public.room_secrets enable row level security;
alter table public.room_players enable row level security;

-- 실시간 변경 알림 (DELETE 대신 left_at 업데이트를 써서 방 코드로 필터 가능)
alter table public.rooms        replica identity full;
alter table public.room_players replica identity full;
do $$ begin
  begin alter publication supabase_realtime add table public.rooms;        exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.room_players; exception when duplicate_object then null; end;
end $$;

-- ───────────── 상수 ─────────────
create or replace function public._max_players() returns int language sql immutable as $$ select 8 $$;
create or replace function public._online_secs() returns int language sql immutable as $$ select 40 $$;   -- 이 시간 동안 신호 없으면 접속 끊김
create or replace function public._drop_secs()   returns int language sql immutable as $$ select 300 $$;  -- 대기 중 이 시간 넘게 끊기면 퇴장 처리

-- ───────────── 읽기 권한 ─────────────
create or replace function public.is_room_member(p_code text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from room_players
                 where room_code = p_code and user_id = auth.uid() and left_at is null)
$$;

drop policy if exists rooms_read on public.rooms;
create policy rooms_read on public.rooms for select to authenticated using (public.is_room_member(code));
drop policy if exists players_read on public.room_players;
create policy players_read on public.room_players for select to authenticated using (public.is_room_member(room_code));

-- ───────────── 내부 도우미 ─────────────
-- 방장이 없거나 끊겼으면 접속 중인 사람 중 가장 먼저 들어온 사람에게 위임.
-- 대기 중 오래 끊긴 사람은 퇴장 처리, 아무도 없으면 방 삭제.
create or replace function public._room_maintain(p_code text) returns void
language plpgsql security definer set search_path = public as $$
declare
  r rooms;
  next_host uuid;
begin
  select * into r from rooms where code = p_code for update;
  if not found then return; end if;

  if r.status = 'waiting' then
    update room_players set left_at = now()
     where room_code = p_code and left_at is null
       and last_seen_at < now() - make_interval(secs => _drop_secs());
  end if;

  if not exists (select 1 from room_players where room_code = p_code and left_at is null) then
    -- 아직 아무도 안 들어온 새 방은 10분 동안 유지
    if r.created_at < now() - interval '10 minutes'
       or exists (select 1 from room_players where room_code = p_code) then
      delete from rooms where code = p_code;
    end if;
    return;
  end if;

  if not exists (select 1 from room_players
                  where room_code = p_code and user_id = r.host_id and left_at is null
                    and last_seen_at >= now() - make_interval(secs => _online_secs())) then
    select user_id into next_host from room_players
     where room_code = p_code and left_at is null
       and last_seen_at >= now() - make_interval(secs => _online_secs())
     order by joined_at limit 1;
    if next_host is not null and next_host <> r.host_id then
      update rooms set host_id = next_host where code = p_code;
    end if;
  end if;
end $$;

create or replace function public._require_uid() returns uuid
language plpgsql stable as $$
begin
  if auth.uid() is null then raise exception 'NOT_SIGNED_IN'; end if;
  return auth.uid();
end $$;

-- ───────────── 공개 함수 (RPC) ─────────────

-- 방 만들기: 코드 반환. 만든 사람이 방장(닉네임은 입장할 때 입력)
create or replace function public.create_room(p_game text) returns text
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := _require_uid();
  chars text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  c text;
  i int;
begin
  if p_game not in ('liar', 'bingo') then raise exception 'BAD_GAME'; end if;

  -- 오래된 방 정리 (마지막 활동 후 2시간)
  delete from rooms where last_active_at < now() - interval '2 hours';

  loop
    c := '';
    for i in 1..4 loop
      c := c || substr(chars, 1 + floor(random() * length(chars))::int, 1);
    end loop;
    exit when not exists (select 1 from rooms where code = c);
  end loop;

  insert into rooms (code, game, host_id, settings)
  values (c, p_game, uid,
          case p_game
            when 'bingo' then jsonb_build_object('category', 'random', 'size', 5, 'lines', 3)
            else jsonb_build_object('category', 'random', 'hintRounds', 2, 'hintSeconds', 30, 'discussSeconds', 90)
          end);
  insert into room_secrets (code) values (c);
  return c;
end $$;

-- 방 상태 조회. 멤버가 아니면 입장 화면에 필요한 공개 정보만.
create or replace function public.get_room(p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := _require_uid();
  r rooms;
  me room_players;
  cnt int;
begin
  p_code := upper(p_code);
  perform _room_maintain(p_code);
  select * into r from rooms where code = p_code;
  if not found then return null; end if;

  select * into me from room_players where room_code = p_code and user_id = uid and left_at is null;
  select count(*) into cnt from room_players where room_code = p_code and left_at is null;

  if me.user_id is null then
    return jsonb_build_object(
      'code', r.code, 'game', r.game, 'status', r.status,
      'playerCount', cnt, 'maxPlayers', _max_players(),
      'hasEntryCode', r.has_entry_code and r.host_id <> uid,
      'isHost', r.host_id = uid, 'member', false);
  end if;

  return jsonb_build_object(
    'code', r.code, 'game', r.game, 'status', r.status, 'settings', r.settings,
    'hostId', r.host_id, 'hasEntryCode', r.has_entry_code,
    'entryCode', case when r.host_id = uid then (select entry_code from room_secrets where code = p_code) end,
    'maxPlayers', _max_players(), 'member', true, 'me', uid,
    'players', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', p.user_id, 'nickname', p.nickname, 'color', p.color,
               'online', p.last_seen_at >= now() - make_interval(secs => _online_secs()))
             order by p.joined_at)
        from room_players p where p.room_code = p_code and p.left_at is null), '[]'::jsonb));
end $$;

-- 입장 (이미 들어와 있으면 닉네임만 갱신)
create or replace function public.join_room(p_code text, p_nickname text, p_entry_code text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := _require_uid();
  r rooms;
  nick text := btrim(regexp_replace(coalesce(p_nickname, ''), '\s+', ' ', 'g'));
  existing room_players;
  used int[];
  col int;
begin
  p_code := upper(p_code);
  perform _room_maintain(p_code);
  select * into r from rooms where code = p_code for update;
  if not found then raise exception 'NO_ROOM'; end if;
  if char_length(nick) < 1 or char_length(nick) > 10 then raise exception 'BAD_NICKNAME'; end if;

  select * into existing from room_players where room_code = p_code and user_id = uid;

  if exists (select 1 from room_players where room_code = p_code and left_at is null
               and user_id <> uid and lower(nickname) = lower(nick)) then
    raise exception 'NICKNAME_TAKEN';
  end if;

  if existing.user_id is not null and existing.left_at is null then
    update room_players set nickname = nick, last_seen_at = now() where room_code = p_code and user_id = uid;
    return;
  end if;

  if r.status <> 'waiting' then raise exception 'IN_PROGRESS'; end if;
  if (select count(*) from room_players where room_code = p_code and left_at is null) >= _max_players() then
    raise exception 'ROOM_FULL';
  end if;
  if r.has_entry_code and r.host_id <> uid
     and coalesce((select entry_code from room_secrets where code = p_code), '') <> coalesce(btrim(p_entry_code), '') then
    raise exception 'BAD_ENTRY_CODE';
  end if;

  select array_agg(color) into used from room_players where room_code = p_code and left_at is null;
  select g into col from generate_series(0, 7) g where not (g = any(coalesce(used, '{}'))) order by g limit 1;

  insert into room_players (room_code, user_id, nickname, color)
  values (p_code, uid, nick, coalesce(col, 0))
  on conflict (room_code, user_id) do update
    set nickname = excluded.nickname, color = excluded.color,
        joined_at = now(), last_seen_at = now(), left_at = null;

  update rooms set last_active_at = now() where code = p_code;
  -- 방장 자리가 비어 있었으면 채움
  perform _room_maintain(p_code);
end $$;

-- 접속 신호 (15초마다)
create or replace function public.heartbeat(p_code text) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := _require_uid();
begin
  p_code := upper(p_code);
  update room_players set last_seen_at = now()
   where room_code = p_code and user_id = uid and left_at is null;
  if found then
    update rooms set last_active_at = now() where code = p_code;
  end if;
  perform _room_maintain(p_code);
end $$;

create or replace function public.leave_room(p_code text) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := _require_uid();
begin
  p_code := upper(p_code);
  update room_players set left_at = now() where room_code = p_code and user_id = uid and left_at is null;
  -- 나간 사람은 바로 '끊김'으로 취급되도록
  update room_players set last_seen_at = now() - interval '1 day' where room_code = p_code and user_id = uid;
  perform _room_maintain(p_code);
end $$;

create or replace function public._require_host(p_code text) returns rooms
language plpgsql security definer set search_path = public as $$
declare r rooms;
begin
  select * into r from rooms where code = p_code for update;
  if not found then raise exception 'NO_ROOM'; end if;
  if r.host_id <> _require_uid() then raise exception 'NOT_HOST'; end if;
  return r;
end $$;

create or replace function public.update_room_settings(p_code text, p_settings jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  r rooms := _require_host(upper(p_code));
  s jsonb := r.settings;
begin
  if p_settings ? 'category' and jsonb_typeof(p_settings->'category') = 'string'
     and char_length(p_settings->>'category') <= 20 then
    s := s || jsonb_build_object('category', p_settings->'category');
  end if;
  if (p_settings->>'hintRounds')     in ('1','2','3')        then s := s || jsonb_build_object('hintRounds',     (p_settings->>'hintRounds')::int); end if;
  if (p_settings->>'hintSeconds')    in ('20','30','45')     then s := s || jsonb_build_object('hintSeconds',    (p_settings->>'hintSeconds')::int); end if;
  if (p_settings->>'discussSeconds') in ('60','90','120')    then s := s || jsonb_build_object('discussSeconds', (p_settings->>'discussSeconds')::int); end if;
  -- 빙고
  if (p_settings->>'size')           in ('4','5')            then s := s || jsonb_build_object('size',           (p_settings->>'size')::int); end if;
  if (p_settings->>'lines')          in ('1','2','3')        then s := s || jsonb_build_object('lines',          (p_settings->>'lines')::int); end if;
  update rooms set settings = s, last_active_at = now() where code = r.code;
end $$;

-- 입장 코드 켜기/끄기. 켜면 4자리 숫자 생성해서 반환
create or replace function public.set_entry_code(p_code text, p_enabled boolean) returns text
language plpgsql security definer set search_path = public as $$
declare
  r rooms := _require_host(upper(p_code));
  ec text := case when p_enabled then lpad(floor(random() * 10000)::int::text, 4, '0') end;
begin
  update room_secrets set entry_code = ec where code = r.code;
  update rooms set has_entry_code = p_enabled, last_active_at = now() where code = r.code;
  return ec;
end $$;

-- 권한: 내부 함수는 막고 공개 함수만 로그인(익명 포함) 사용자에게
revoke all on function public._room_maintain(text), public._require_host(text) from public, anon, authenticated;
revoke all on function public.create_room(text), public.get_room(text), public.join_room(text, text, text),
  public.heartbeat(text), public.leave_room(text), public.update_room_settings(text, jsonb),
  public.set_entry_code(text, boolean) from public, anon;
grant execute on function public.create_room(text), public.get_room(text), public.join_room(text, text, text),
  public.heartbeat(text), public.leave_room(text), public.update_room_settings(text, jsonb),
  public.set_entry_code(text, boolean) to authenticated;
