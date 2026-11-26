-- 자동 생성 파일 (scripts/build_apply_all.py). 직접 고치지 말 것.
-- Supabase SQL Editor 에 통째로 붙여넣고 Run. 여러 번 실행해도 안전하다.

-- ════════ 0001_rooms.sql ════════
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


-- ════════ 0002_liar.sql ════════
-- 월루: 라이어 게임
-- 0001_rooms.sql 다음에 실행. Supabase SQL Editor 에 통째로 붙여넣고 Run. 여러 번 실행해도 안전하다.
-- (수정되면 이 파일 전체를 다시 실행하면 된다: 함수는 덮어쓰고, 제시어 별칭은 갱신된다)
-- 비밀(라이어 정체, 제시어, 투표)은 클라이언트가 읽을 수 없는 테이블에 두고, 각자 자기 정보만 함수로 받는다.

-- ───────────── 테이블 ─────────────
create table if not exists public.liar_words (
  id        serial primary key,
  category  text not null,
  word      text not null,
  aliases   text[] not null default '{}',
  unique (category, word)
);

create table if not exists public.liar_games (
  room_code        text primary key references public.rooms(code) on delete cascade,
  round_no         int not null default 0,
  phase            text not null,              -- hint | discuss | vote | defense | revote | guess | result | appeal
  category         text not null,
  player_ids       uuid[] not null,            -- 힌트 순서
  turn_index       int not null default 0,     -- 0 .. hint_rounds*n-1
  hint_rounds      int not null,
  hint_seconds     int not null,
  discuss_seconds  int not null,
  deadline         timestamptz,
  discuss_done     uuid[] not null default '{}',
  result           jsonb,
  scores           jsonb not null default '{}'::jsonb,
  updated_at       timestamptz not null default now()
);

-- 이전 버전에서 만든 테이블에도 컬럼 추가
alter table public.liar_games add column if not exists tie_ids uuid[] not null default '{}';  -- 동점자 (재투표 대상)

create table if not exists public.liar_secrets (
  room_code  text primary key references public.rooms(code) on delete cascade,
  liar_id    uuid not null,
  word       text not null,
  aliases    text[] not null default '{}'
);

create table if not exists public.liar_votes (
  room_code  text not null references public.rooms(code) on delete cascade,
  voter      uuid not null,
  target     uuid not null,
  primary key (room_code, voter)
);

-- 라이어 이의 신청 시 정답 인정 투표 (라이어 제외 참가자)
create table if not exists public.liar_appeal_votes (
  room_code  text not null references public.rooms(code) on delete cascade,
  voter      uuid not null,
  accept     boolean not null,
  primary key (room_code, voter)
);

create table if not exists public.liar_messages (
  id          bigserial primary key,
  room_code   text not null references public.rooms(code) on delete cascade,
  round_no    int not null,
  kind        text not null,                   -- system | hint | timeout | chat | guess
  user_id     uuid,
  body        text not null,
  created_at  timestamptz not null default now()
);
create index if not exists liar_messages_room on public.liar_messages (room_code, id);

-- 힌트 말풍선 이모지 반응 (누르면 켜고 다시 누르면 끔)
create table if not exists public.liar_reactions (
  message_id  bigint not null references public.liar_messages(id) on delete cascade,
  room_code   text not null references public.rooms(code) on delete cascade,
  user_id     uuid not null,
  emoji       text not null,
  primary key (message_id, user_id, emoji)
);
create index if not exists liar_reactions_room on public.liar_reactions (room_code);

alter table public.liar_words    enable row level security;
alter table public.liar_games    enable row level security;
alter table public.liar_secrets  enable row level security;
alter table public.liar_votes    enable row level security;
alter table public.liar_appeal_votes enable row level security;
alter table public.liar_messages enable row level security;
alter table public.liar_reactions enable row level security;

drop policy if exists liar_games_read on public.liar_games;
create policy liar_games_read on public.liar_games for select to authenticated using (public.is_room_member(room_code));
drop policy if exists liar_messages_read on public.liar_messages;
create policy liar_messages_read on public.liar_messages for select to authenticated using (public.is_room_member(room_code));
drop policy if exists liar_reactions_read on public.liar_reactions;
create policy liar_reactions_read on public.liar_reactions for select to authenticated using (public.is_room_member(room_code));

alter table public.liar_games    replica identity full;
alter table public.liar_messages replica identity full;
alter table public.liar_reactions replica identity full;
do $$ begin
  begin alter publication supabase_realtime add table public.liar_games;    exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.liar_messages; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.liar_reactions; exception when duplicate_object then null; end;
end $$;

-- ───────────── 상수 ─────────────
create or replace function public._liar_vote_secs()  returns int language sql immutable as $$ select 30 $$;
create or replace function public._liar_guess_secs() returns int language sql immutable as $$ select 30 $$;
create or replace function public._liar_appeal_secs() returns int language sql immutable as $$ select 20 $$;
create or replace function public._liar_defense_secs() returns int language sql immutable as $$ select 20 $$;
create or replace function public._liar_revote_secs() returns int language sql immutable as $$ select 20 $$;

-- ───────────── 내부 도우미 ─────────────
create or replace function public._liar_norm(t text) returns text language sql immutable as $$
  select lower(regexp_replace(coalesce(t, ''), '[[:space:][:punct:]·]', '', 'g'))
$$;

-- 시민이 제시어(또는 다른 표기)를 그대로 쓰면 막는다. 라이어는 막지 않음 (막히는지로 제시어를 떠볼 수 있어서)
create or replace function public._liar_check_word(p_code text, p_uid uuid, p_phase text, p_text text) returns void
language plpgsql security definer set search_path = public as $$
declare s liar_secrets; t text := _liar_norm(p_text); w text;
begin
  if p_phase in ('result', 'appeal') then return; end if;
  select * into s from liar_secrets where room_code = p_code;
  if not found or s.liar_id = p_uid then return; end if;
  if not exists (select 1 from liar_games where room_code = p_code and p_uid = any(player_ids)) then return; end if;
  foreach w in array (array[s.word] || s.aliases) loop
    w := _liar_norm(w);
    -- 한 글자 제시어는 포함 검사 대신 통째로 같을 때만
    if (char_length(w) >= 2 and position(w in t) > 0) or (char_length(w) = 1 and t = w) then
      raise exception 'HAS_WORD';
    end if;
  end loop;
end $$;

create or replace function public._liar_name(p_code text, p_uid uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select nickname from room_players where room_code = p_code and user_id = p_uid), '?')
$$;

create or replace function public._liar_active(p_code text, p_uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from room_players where room_code = p_code and user_id = p_uid and left_at is null)
$$;

create or replace function public._liar_sys(p_code text, p_round int, p_body text) returns void
language sql security definer set search_path = public as $$
  insert into liar_messages (room_code, round_no, kind, body) values (p_code, p_round, 'system', p_body)
$$;

-- 게임 끝: 승자 기록, 점수 반영, 정답 공개
create or replace function public._liar_finish(p_code text, p_winner text, p_reason text, p_guess text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  g liar_games;
  s liar_secrets;
  sc jsonb;
  pid uuid;
begin
  select * into g from liar_games where room_code = p_code;
  select * into s from liar_secrets where room_code = p_code;
  sc := g.scores;
  foreach pid in array g.player_ids loop
    if (p_winner = 'liar' and pid = s.liar_id) or (p_winner = 'citizen' and pid <> s.liar_id) then
      sc := sc || jsonb_build_object(pid::text, coalesce((sc->>pid::text)::int, 0) + 1);
    end if;
  end loop;

  update liar_games set
    phase = 'result', deadline = null, scores = sc, updated_at = now(),
    result = coalesce(result, '{}'::jsonb) || jsonb_build_object(
      'winner', p_winner, 'reason', p_reason, 'liarId', s.liar_id, 'word', s.word, 'guess', p_guess)
  where room_code = p_code;

  perform _liar_sys(p_code, g.round_no, p_reason);
  perform _liar_sys(p_code, g.round_no,
    format('%s 승리! 라이어: %s님 · 제시어: %s',
           case when p_winner = 'liar' then '라이어' else '시민' end, _liar_name(p_code, s.liar_id), s.word));
end $$;

-- 다음 힌트 차례로 (나간 사람은 건너뜀). 다 돌면 토론으로.
create or replace function public._liar_next_turn(p_code text) returns void
language plpgsql security definer set search_path = public as $$
declare
  g liar_games;
  n int;
  t int;
begin
  select * into g from liar_games where room_code = p_code;
  n := array_length(g.player_ids, 1);
  t := g.turn_index + 1;
  while t < g.hint_rounds * n and not _liar_active(p_code, g.player_ids[(t % n) + 1]) loop
    t := t + 1;
  end loop;

  if t >= g.hint_rounds * n then
    update liar_games set phase = 'discuss', turn_index = t, discuss_done = '{}',
      deadline = now() + make_interval(secs => g.discuss_seconds), updated_at = now()
    where room_code = p_code;
    perform _liar_sys(p_code, g.round_no, format('토론을 시작합니다. 자유롭게 이야기하세요. (%s초)', g.discuss_seconds));
  else
    if t / n > g.turn_index / n then
      perform _liar_sys(p_code, g.round_no, format('힌트 %s바퀴째', t / n + 1));
    end if;
    update liar_games set turn_index = t,
      deadline = now() + make_interval(secs => g.hint_seconds), updated_at = now()
    where room_code = p_code;
  end if;
end $$;

create or replace function public._liar_open_vote(p_code text) returns void
language plpgsql security definer set search_path = public as $$
declare g liar_games;
begin
  select * into g from liar_games where room_code = p_code;
  update liar_games set phase = 'vote', deadline = now() + make_interval(secs => _liar_vote_secs()), updated_at = now()
   where room_code = p_code;
  perform _liar_sys(p_code, g.round_no, format('투표를 시작합니다. 라이어라고 생각하는 사람을 고르세요. (%s초)', _liar_vote_secs()));
end $$;

-- 동점자 해명이 끝나면 동점자끼리 재투표
create or replace function public._liar_open_revote(p_code text) returns void
language plpgsql security definer set search_path = public as $$
declare g liar_games;
begin
  select * into g from liar_games where room_code = p_code;
  delete from liar_votes where room_code = p_code;
  update liar_games set phase = 'revote', deadline = now() + make_interval(secs => _liar_revote_secs()), updated_at = now()
   where room_code = p_code;
  perform _liar_sys(p_code, g.round_no, format('재투표를 시작합니다. 동점자 중에서 고르세요. 이번에도 동점이면 라이어가 이깁니다. (%s초)', _liar_revote_secs()));
end $$;

-- 투표 마감: 집계 공개 → 라이어 지목이면 제시어 맞히기, 아니면 라이어 승
-- 첫 투표가 동점이면 해명 → 재투표, 재투표도 동점이면 라이어 승
create or replace function public._liar_resolve_vote(p_code text) returns void
language plpgsql security definer set search_path = public as $$
declare
  g liar_games;
  s liar_secrets;
  tally jsonb;
  detail jsonb;
  top_count int;
  top_n int;
  accused uuid;
begin
  select * into g from liar_games where room_code = p_code;
  select * into s from liar_secrets where room_code = p_code;

  select coalesce(jsonb_object_agg(target::text, c), '{}'::jsonb), max(c)
    into tally, top_count
    from (select target, count(*)::int c from liar_votes where room_code = p_code group by target) t;
  select coalesce(jsonb_agg(jsonb_build_object('voter', voter, 'target', target)), '[]'::jsonb)
    into detail from liar_votes where room_code = p_code;
  select count(*) into top_n
    from (select target from liar_votes where room_code = p_code group by target having count(*) = top_count) t;
  if top_n = 1 then
    select target into accused from liar_votes where room_code = p_code group by target having count(*) = top_count;
  end if;

  -- 첫 투표 동점 → 동점자 해명 후 재투표
  if g.phase = 'vote' and top_n > 1 then
    update liar_games set
      phase = 'defense', deadline = now() + make_interval(secs => _liar_defense_secs()), updated_at = now(),
      tie_ids = (select array_agg(target) from (select target from liar_votes where room_code = p_code
                   group by target having count(*) = top_count) t),
      result = jsonb_build_object('firstVotes', tally, 'firstVoteDetail', detail)
    where room_code = p_code;
    perform _liar_sys(p_code, g.round_no, format('%s님이 %s표로 동점입니다. 동점자의 해명을 듣고 다시 투표합니다. (%s초)',
      (select string_agg(_liar_name(p_code, target), '님, ') from (select target from liar_votes where room_code = p_code
         group by target having count(*) = top_count) t), top_count, _liar_defense_secs()));
    return;
  end if;

  update liar_games set result = coalesce(result, '{}'::jsonb) || jsonb_build_object('votes', tally, 'voteDetail', detail, 'accusedId', accused), updated_at = now()
   where room_code = p_code;

  if accused is null then
    perform _liar_finish(p_code, 'liar',
      case when top_count is null then '아무도 투표하지 않아 지목에 실패했습니다.'
           else '재투표도 동점이라 지목에 실패했습니다.' end);
  elsif accused <> s.liar_id then
    perform _liar_finish(p_code, 'liar', format('%s님이 지목되었지만 라이어가 아닙니다.', _liar_name(p_code, accused)));
  else
    update liar_games set phase = 'guess', deadline = now() + make_interval(secs => _liar_guess_secs()), updated_at = now()
     where room_code = p_code;
    perform _liar_sys(p_code, g.round_no,
      format('%s님이 지목되었습니다. %s님은 라이어입니다! 제시어를 맞히면 라이어가 이깁니다. (%s초)',
             _liar_name(p_code, accused), _liar_name(p_code, accused), _liar_guess_secs()));
  end if;
end $$;

-- 정답 인정 투표 마감: 라이어 제외 참가자의 과반이 인정하면 라이어 승으로 뒤집는다
create or replace function public._liar_resolve_appeal(p_code text) returns void
language plpgsql security definer set search_path = public as $$
declare
  g liar_games;
  s liar_secrets;
  eligible int;
  yes int;
  no_ int;
  accepted boolean;
  sc jsonb;
  pid uuid;
begin
  select * into g from liar_games where room_code = p_code;
  select * into s from liar_secrets where room_code = p_code;
  select count(*)::int into eligible from unnest(g.player_ids) x where x <> s.liar_id and _liar_active(p_code, x);
  select count(*) filter (where accept), count(*) filter (where not accept) into yes, no_
    from liar_appeal_votes where room_code = p_code;
  accepted := yes * 2 > eligible;

  sc := g.scores;
  if accepted then
    foreach pid in array g.player_ids loop
      sc := sc || jsonb_build_object(pid::text, greatest(coalesce((sc->>pid::text)::int, 0) + case when pid = s.liar_id then 1 else -1 end, 0));
    end loop;
  end if;

  update liar_games set
    phase = 'result', deadline = null, scores = sc, updated_at = now(),
    result = result || jsonb_build_object(
      'appeal', jsonb_build_object('accepted', accepted, 'yes', yes, 'no', no_, 'eligible', eligible))
      || case when accepted then jsonb_build_object('winner', 'liar', 'reason', '이의 신청이 받아들여져 정답으로 인정되었습니다.') else '{}'::jsonb end
  where room_code = p_code;

  perform _liar_sys(p_code, g.round_no,
    format('정답 인정 투표 결과: 인정 %s · 불인정 %s · 기권 %s (과반 %s표 필요)', yes, no_, eligible - yes - no_, eligible / 2 + 1));
  if accepted then
    perform _liar_sys(p_code, g.round_no, format('라이어 승리로 바뀌었습니다! 라이어: %s님 · 제시어: %s', _liar_name(p_code, s.liar_id), s.word));
  else
    perform _liar_sys(p_code, g.round_no, '이의 신청이 받아들여지지 않았습니다. 시민 승리 그대로입니다.');
  end if;
end $$;

create or replace function public._liar_eligible_count(p_code text) returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from liar_games g, unnest(g.player_ids) pid
   where g.room_code = p_code and _liar_active(p_code, pid)
$$;

create or replace function public._liar_lock(p_code text) returns liar_games
language plpgsql security definer set search_path = public as $$
declare g liar_games;
begin
  if not is_room_member(p_code) then raise exception 'NOT_MEMBER'; end if;
  select * into g from liar_games where room_code = p_code for update;
  if not found then raise exception 'NO_GAME'; end if;
  return g;
end $$;

-- ───────────── 공개 함수 (RPC) ─────────────

-- 게임 시작 / 다음 판 (방장)
create or replace function public.liar_start(p_code text) returns void
language plpgsql security definer set search_path = public as $$
declare
  r rooms;
  prev liar_games;
  players uuid[];
  n int;
  cat text;
  w liar_words;
  liar uuid;
  rnd int;
begin
  p_code := upper(p_code);
  r := _require_host(p_code);
  if r.game <> 'liar' then raise exception 'BAD_GAME'; end if;
  select * into prev from liar_games where room_code = p_code for update;
  if r.status <> 'waiting' and coalesce(prev.phase, '') <> 'result' then raise exception 'IN_PROGRESS'; end if;

  select array_agg(user_id order by random()) into players
    from room_players where room_code = p_code and left_at is null;
  n := coalesce(array_length(players, 1), 0);
  if n < 3 then raise exception 'NEED_PLAYERS'; end if;
  if n > 8 then raise exception 'ROOM_FULL'; end if;

  cat := r.settings->>'category';
  if cat is null or not exists (select 1 from liar_words where category = cat) then
    select category into cat from (select distinct category from liar_words) c order by random() limit 1;
  end if;
  select * into w from liar_words where category = cat order by random() limit 1;
  if not found then raise exception 'NO_WORDS'; end if;
  liar := players[1 + floor(random() * n)::int];
  rnd := coalesce(prev.round_no, 0) + 1;

  delete from liar_messages where room_code = p_code;
  delete from liar_votes where room_code = p_code;
  delete from liar_appeal_votes where room_code = p_code;
  insert into liar_secrets (room_code, liar_id, word, aliases) values (p_code, liar, w.word, w.aliases)
  on conflict (room_code) do update set liar_id = excluded.liar_id, word = excluded.word, aliases = excluded.aliases;

  insert into liar_games (room_code, round_no, phase, category, player_ids, turn_index,
                          hint_rounds, hint_seconds, discuss_seconds, deadline, discuss_done, result, scores)
  values (p_code, rnd, 'hint', cat, players, 0,
          coalesce((r.settings->>'hintRounds')::int, 2), coalesce((r.settings->>'hintSeconds')::int, 30),
          coalesce((r.settings->>'discussSeconds')::int, 90),
          now() + make_interval(secs => coalesce((r.settings->>'hintSeconds')::int, 30)), '{}', null,
          coalesce(prev.scores, '{}'::jsonb))
  on conflict (room_code) do update set
    round_no = excluded.round_no, phase = excluded.phase, category = excluded.category,
    player_ids = excluded.player_ids, turn_index = 0, hint_rounds = excluded.hint_rounds,
    hint_seconds = excluded.hint_seconds, discuss_seconds = excluded.discuss_seconds,
    deadline = excluded.deadline, discuss_done = '{}', tie_ids = '{}', result = null, updated_at = now();

  update rooms set status = 'playing', last_active_at = now() where code = p_code;

  perform _liar_sys(p_code, rnd, format('%s번째 게임을 시작합니다. 주제는 ''%s''입니다. 힌트 순서: %s',
    rnd, cat, (select string_agg(_liar_name(p_code, pid), ' → ' order by o) from unnest(players) with ordinality u(pid, o))));
end $$;

-- 내 화면에 필요한 상태 전부 (비밀은 내 것만)
create or replace function public.liar_state(p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := _require_uid();
  g liar_games;
  s liar_secrets;
  my_vote uuid;
begin
  p_code := upper(p_code);
  if not is_room_member(p_code) then raise exception 'NOT_MEMBER'; end if;
  select * into g from liar_games where room_code = p_code;
  if not found then return null; end if;
  select * into s from liar_secrets where room_code = p_code;
  select target into my_vote from liar_votes where room_code = p_code and voter = uid;

  return jsonb_build_object(
    'roundNo', g.round_no, 'phase', g.phase, 'category', g.category, 'playerIds', to_jsonb(g.player_ids),
    'turnIndex', g.turn_index, 'hintRounds', g.hint_rounds, 'hintSeconds', g.hint_seconds,
    'discussSeconds', g.discuss_seconds, 'deadline', g.deadline, 'now', now(),
    'discussDone', to_jsonb(g.discuss_done), 'tieIds', to_jsonb(g.tie_ids), 'result', g.result, 'scores', g.scores,
    'inGame', uid = any(g.player_ids),
    'role', case when not (uid = any(g.player_ids)) then null when uid = s.liar_id then 'liar' else 'citizen' end,
    'word', case when uid = any(g.player_ids) and uid <> s.liar_id then s.word
                 when g.phase in ('result', 'appeal') then s.word end,
    'liarId', case when g.phase in ('guess', 'result', 'appeal') then s.liar_id end,
    'appealVotedCount', (select count(*) from liar_appeal_votes where room_code = p_code),
    'myAppeal', (select accept from liar_appeal_votes where room_code = p_code and voter = uid),
    'myVote', my_vote,
    'votedCount', (select count(*) from liar_votes where room_code = p_code),
    'people', (select coalesce(jsonb_object_agg(user_id, jsonb_build_object('nickname', nickname, 'color', color)), '{}'::jsonb)
                 from room_players where room_code = p_code),
    'messages', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'kind', m.kind, 'userId', m.user_id, 'body', m.body, 'at', m.created_at,
               'reactions', (select jsonb_object_agg(x.emoji, x.users) from (
                  select emoji, jsonb_agg(user_id) users from liar_reactions where message_id = m.id group by emoji) x)) order by m.id)
        from (select * from liar_messages where room_code = p_code order by id desc limit 300) m), '[]'::jsonb));
end $$;

-- 마감 시간이 지났으면 다음 단계로 (누가 불러도 결과는 같다)
create or replace function public.liar_tick(p_code text) returns void
language plpgsql security definer set search_path = public as $$
declare g liar_games;
begin
  p_code := upper(p_code);
  g := _liar_lock(p_code);
  if g.deadline is null or now() < g.deadline then return; end if;
  if g.phase = 'hint' then
    insert into liar_messages (room_code, round_no, kind, user_id, body)
    values (p_code, g.round_no, 'timeout', g.player_ids[(g.turn_index % array_length(g.player_ids, 1)) + 1], '(시간 초과)');
    perform _liar_next_turn(p_code);
  elsif g.phase = 'discuss' then
    perform _liar_open_vote(p_code);
  elsif g.phase in ('vote', 'revote') then
    perform _liar_resolve_vote(p_code);
  elsif g.phase = 'defense' then
    perform _liar_open_revote(p_code);
  elsif g.phase = 'guess' then
    perform _liar_finish(p_code, 'citizen', '라이어가 시간 안에 제시어를 맞히지 못했습니다.');
  elsif g.phase = 'appeal' then
    perform _liar_resolve_appeal(p_code);
  end if;
end $$;

create or replace function public.liar_hint(p_code text, p_text text) returns void
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := _require_uid();
  g liar_games;
  t text := btrim(regexp_replace(coalesce(p_text, ''), '\s+', ' ', 'g'));
begin
  p_code := upper(p_code);
  g := _liar_lock(p_code);
  if g.phase <> 'hint' then raise exception 'WRONG_PHASE'; end if;
  if g.player_ids[(g.turn_index % array_length(g.player_ids, 1)) + 1] <> uid then raise exception 'NOT_YOUR_TURN'; end if;
  if char_length(t) < 1 or char_length(t) > 40 then raise exception 'BAD_TEXT'; end if;
  perform _liar_check_word(p_code, uid, g.phase, t);
  insert into liar_messages (room_code, round_no, kind, user_id, body) values (p_code, g.round_no, 'hint', uid, t);
  perform _liar_next_turn(p_code);
end $$;

create or replace function public.liar_chat(p_code text, p_text text) returns void
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := _require_uid();
  g liar_games;
  t text := btrim(coalesce(p_text, ''));
begin
  p_code := upper(p_code);
  if not is_room_member(p_code) then raise exception 'NOT_MEMBER'; end if;
  select * into g from liar_games where room_code = p_code;
  if not found then raise exception 'WRONG_PHASE'; end if;  -- 게임 중엔 언제든 대화 가능
  if char_length(t) < 1 or char_length(t) > 200 then raise exception 'BAD_TEXT'; end if;
  if exists (select 1 from liar_messages where room_code = p_code and user_id = uid and kind = 'chat'
               and created_at > clock_timestamp() - interval '800 milliseconds') then
    raise exception 'TOO_FAST';
  end if;
  perform _liar_check_word(p_code, uid, g.phase, t);
  insert into liar_messages (room_code, round_no, kind, user_id, body, created_at)
  values (p_code, g.round_no, 'chat', uid, t, clock_timestamp());
end $$;

-- 힌트에 이모지 반응 (토글)
create or replace function public.liar_react(p_code text, p_msg bigint, p_emoji text) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := _require_uid();
begin
  p_code := upper(p_code);
  if not is_room_member(p_code) then raise exception 'NOT_MEMBER'; end if;
  if p_emoji not in ('😂', '🤔', '👀', '🙄') then raise exception 'BAD_TEXT'; end if;
  if not exists (select 1 from liar_messages where id = p_msg and room_code = p_code and kind = 'hint') then
    raise exception 'WRONG_PHASE';
  end if;
  delete from liar_reactions where message_id = p_msg and user_id = uid and emoji = p_emoji;
  if not found then
    insert into liar_reactions (message_id, room_code, user_id, emoji) values (p_msg, p_code, uid, p_emoji);
  end if;
end $$;

-- 토론 끝내기: 남아 있는 참가자 전원이 누르면 바로 투표
create or replace function public.liar_end_discussion(p_code text) returns void
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := _require_uid();
  g liar_games;
  done uuid[];
begin
  p_code := upper(p_code);
  g := _liar_lock(p_code);
  if g.phase <> 'discuss' then raise exception 'WRONG_PHASE'; end if;
  if not (uid = any(g.player_ids)) then raise exception 'NOT_PLAYER'; end if;
  if uid = any(g.discuss_done) then return; end if;
  done := g.discuss_done || uid;
  update liar_games set discuss_done = done, updated_at = now() where room_code = p_code;
  if (select count(*) from unnest(g.player_ids) pid where _liar_active(p_code, pid) and not (pid = any(done))) = 0 then
    perform _liar_open_vote(p_code);
  end if;
end $$;

create or replace function public.liar_vote(p_code text, p_target uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := _require_uid();
  g liar_games;
begin
  p_code := upper(p_code);
  g := _liar_lock(p_code);
  if g.phase not in ('vote', 'revote') then raise exception 'WRONG_PHASE'; end if;
  if not (uid = any(g.player_ids)) then raise exception 'NOT_PLAYER'; end if;
  if p_target = uid or not (p_target = any(g.player_ids)) then raise exception 'BAD_TARGET'; end if;
  if g.phase = 'revote' and not (p_target = any(g.tie_ids)) then raise exception 'BAD_TARGET'; end if;
  insert into liar_votes (room_code, voter, target) values (p_code, uid, p_target)
  on conflict (room_code, voter) do update set target = excluded.target;
  update liar_games set updated_at = now() where room_code = p_code;
  if (select count(*) from liar_votes where room_code = p_code) >= _liar_eligible_count(p_code) then
    perform _liar_resolve_vote(p_code);
  end if;
end $$;

create or replace function public.liar_guess(p_code text, p_text text) returns void
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := _require_uid();
  g liar_games;
  s liar_secrets;
  t text := btrim(coalesce(p_text, ''));
  ok boolean;
begin
  p_code := upper(p_code);
  g := _liar_lock(p_code);
  if g.phase <> 'guess' then raise exception 'WRONG_PHASE'; end if;
  select * into s from liar_secrets where room_code = p_code;
  if uid <> s.liar_id then raise exception 'NOT_LIAR'; end if;
  if char_length(t) < 1 or char_length(t) > 40 then raise exception 'BAD_TEXT'; end if;

  insert into liar_messages (room_code, round_no, kind, user_id, body) values (p_code, g.round_no, 'guess', uid, t);
  ok := _liar_norm(t) = _liar_norm(s.word)
        or exists (select 1 from unnest(s.aliases) a where _liar_norm(a) = _liar_norm(t));
  if ok then
    perform _liar_finish(p_code, 'liar', format('라이어가 제시어를 맞혔습니다. (답: %s)', t), t);
  else
    perform _liar_finish(p_code, 'citizen', format('라이어가 제시어를 틀렸습니다. (답: %s)', t), t);
  end if;
end $$;

-- 라이어 이의 신청: 제시어를 틀렸을 때 한 번, 정답 인정 투표를 연다
create or replace function public.liar_appeal(p_code text) returns void
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := _require_uid();
  g liar_games;
  s liar_secrets;
begin
  p_code := upper(p_code);
  g := _liar_lock(p_code);
  select * into s from liar_secrets where room_code = p_code;
  if uid <> s.liar_id then raise exception 'NOT_LIAR'; end if;
  if g.phase <> 'result' or g.result->>'winner' <> 'citizen' or g.result->>'guess' is null then raise exception 'CANNOT_APPEAL'; end if;
  if g.result ? 'appeal' then raise exception 'ALREADY_APPEALED'; end if;

  delete from liar_appeal_votes where room_code = p_code;
  update liar_games set phase = 'appeal', deadline = now() + make_interval(secs => _liar_appeal_secs()),
    result = result || jsonb_build_object('appeal', jsonb_build_object('open', true)), updated_at = now()
  where room_code = p_code;
  perform _liar_sys(p_code, g.round_no,
    format('라이어가 이의 신청했습니다. 답: %s · 제시어: %s — 정답으로 인정할지 투표하세요. 라이어를 뺀 참가자 과반이 인정하면 라이어 승리로 바뀝니다. (%s초)',
           g.result->>'guess', s.word, _liar_appeal_secs()));
end $$;

create or replace function public.liar_appeal_vote(p_code text, p_accept boolean) returns void
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := _require_uid();
  g liar_games;
  s liar_secrets;
begin
  p_code := upper(p_code);
  g := _liar_lock(p_code);
  if g.phase <> 'appeal' then raise exception 'WRONG_PHASE'; end if;
  select * into s from liar_secrets where room_code = p_code;
  if not (uid = any(g.player_ids)) or uid = s.liar_id then raise exception 'NOT_PLAYER'; end if;
  insert into liar_appeal_votes (room_code, voter, accept) values (p_code, uid, coalesce(p_accept, false))
  on conflict (room_code, voter) do update set accept = excluded.accept;
  update liar_games set updated_at = now() where room_code = p_code;
  if (select count(*) from liar_appeal_votes where room_code = p_code)
     >= (select count(*) from unnest(g.player_ids) pid where pid <> s.liar_id and _liar_active(p_code, pid)) then
    perform _liar_resolve_appeal(p_code);
  end if;
end $$;

-- 결과 화면에서 대기실로 (방장) — 새 사람이 들어올 수 있게
create or replace function public.liar_to_waiting(p_code text) returns void
language plpgsql security definer set search_path = public as $$
declare
  r rooms;
  g liar_games;
begin
  p_code := upper(p_code);
  r := _require_host(p_code);
  select * into g from liar_games where room_code = p_code;
  if found and g.phase <> 'result' then raise exception 'IN_PROGRESS'; end if;
  update rooms set status = 'waiting', last_active_at = now() where code = p_code;
end $$;

-- ───────────── 권한 ─────────────
do $$
declare f text;
begin
  foreach f in array array[
    '_liar_name(text, uuid)', '_liar_active(text, uuid)', '_liar_sys(text, int, text)',
    '_liar_finish(text, text, text, text)', '_liar_next_turn(text)', '_liar_open_vote(text)', '_liar_open_revote(text)',
    '_liar_resolve_vote(text)', '_liar_resolve_appeal(text)', '_liar_eligible_count(text)', '_liar_lock(text)', '_liar_check_word(text, uuid, text, text)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
  foreach f in array array[
    'liar_start(text)', 'liar_state(text)', 'liar_tick(text)', 'liar_hint(text, text)', 'liar_chat(text, text)',
    'liar_end_discussion(text)', 'liar_vote(text, uuid)', 'liar_guess(text, text)', 'liar_to_waiting(text)',
    'liar_appeal(text)', 'liar_appeal_vote(text, boolean)', 'liar_react(text, bigint, text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- ───────────── 제시어 은행 (supabase/seed/liar_words.json 에서 생성: python3 scripts/gen_liar_words.py) ─────────────
-- BEGIN WORDS
insert into public.liar_words (category, word, aliases) values
  ('음식', '김치찌개', array['김치찌게', 'kimchi stew', 'kimchijjigae']::text[]),
  ('음식', '된장찌개', array['된장찌게']::text[]),
  ('음식', '떡볶이', array['떡뽁이', '떡복이', 'tteokbokki']::text[]),
  ('음식', '짜장면', array['자장면', 'jjajangmyeon']::text[]),
  ('음식', '짬뽕', array['jjamppong']::text[]),
  ('음식', '삼겹살', array['samgyeopsal', 'pork belly']::text[]),
  ('음식', '치킨', array['통닭', 'chicken']::text[]),
  ('음식', '피자', array['pizza']::text[]),
  ('음식', '햄버거', array['버거', 'hamburger', 'burger']::text[]),
  ('음식', '라면', array['ramen', 'ramyeon']::text[]),
  ('음식', '김밥', array['gimbap', 'kimbap']::text[]),
  ('음식', '비빔밥', array['bibimbap']::text[]),
  ('음식', '제육볶음', array['제육', '제육덮밥']::text[]),
  ('음식', '돈가스', array['돈까스', '돈카츠', 'tonkatsu', 'donkatsu']::text[]),
  ('음식', '초밥', array['스시', 'sushi']::text[]),
  ('음식', '냉면', array['naengmyeon']::text[]),
  ('음식', '국밥', '{}'::text[]),
  ('음식', '칼국수', '{}'::text[]),
  ('음식', '마라탕', array['malatang']::text[]),
  ('음식', '샐러드', array['salad']::text[]),
  ('음식', '순대', '{}'::text[]),
  ('음식', '족발', '{}'::text[]),
  ('음식', '보쌈', '{}'::text[]),
  ('음식', '쌀국수', array['pho']::text[]),
  ('음식', '샌드위치', array['sandwich']::text[]),
  ('음식', '떡국', '{}'::text[]),
  ('음식', '갈비탕', '{}'::text[]),
  ('음식', '부대찌개', array['부대찌게']::text[]),
  ('음식', '삼계탕', '{}'::text[]),
  ('음식', '오므라이스', array['omurice', 'omelette rice']::text[]),
  ('음식', '불고기', array['bulgogi']::text[]),
  ('음식', '갈비', array['galbi']::text[]),
  ('음식', '잡채', array['japchae']::text[]),
  ('음식', '순두부찌개', array['순두부', '순두부찌게']::text[]),
  ('음식', '감자탕', '{}'::text[]),
  ('음식', '닭갈비', array['dakgalbi']::text[]),
  ('음식', '곱창', '{}'::text[]),
  ('음식', '수제비', '{}'::text[]),
  ('음식', '만두', array['dumpling', '교자']::text[]),
  ('음식', '우동', array['udon']::text[]),
  ('음식', '파스타', array['스파게티', 'pasta', 'spaghetti']::text[]),
  ('음식', '스테이크', array['steak']::text[]),
  ('음식', '카레', array['카레라이스', 'curry']::text[]),
  ('음식', '볶음밥', array['fried rice']::text[]),
  ('음식', '탕수육', '{}'::text[]),
  ('음식', '양꼬치', '{}'::text[]),
  ('음식', '훠궈', array['hotpot']::text[]),
  ('음식', '타코', array['taco']::text[]),
  ('음식', '핫도그', array['hot dog']::text[]),
  ('음식', '토스트', array['toast']::text[]),
  ('음식', '김치볶음밥', '{}'::text[]),
  ('음식', '닭강정', '{}'::text[]),
  ('음식', '회', array['생선회', 'sashimi']::text[]),
  ('음식', '해장국', '{}'::text[]),
  ('음식', '콩국수', '{}'::text[]),
  ('음식', '어묵', array['오뎅']::text[]),
  ('음식', '계란말이', array['달걀말이']::text[]),
  ('음식', '파전', array['부침개']::text[]),
  ('음식', '육회', '{}'::text[]),
  ('음식', '막국수', '{}'::text[]),
  ('음료', '아메리카노', array['아아', '아이스아메리카노', '뜨아', 'americano']::text[]),
  ('음료', '카페라테', array['라떼', '카페라떼', '라테', 'latte', 'cafe latte', 'caffe latte']::text[]),
  ('음료', '콜라', array['cola', 'coke']::text[]),
  ('음료', '사이다', array['cider', 'sprite']::text[]),
  ('음료', '녹차', array['green tea']::text[]),
  ('음료', '우유', array['milk']::text[]),
  ('음료', '바나나우유', array['바나나맛우유', 'banana milk']::text[]),
  ('음료', '식혜', array['sikhye']::text[]),
  ('음료', '오렌지주스', array['오렌지쥬스', 'orange juice']::text[]),
  ('음료', '핫초코', array['코코아', 'hot chocolate', 'hot choco', 'cocoa']::text[]),
  ('음료', '밀크티', array['milk tea']::text[]),
  ('음료', '레모네이드', array['레몬에이드', 'lemonade']::text[]),
  ('음료', '에너지드링크', array['에너지음료', 'energy drink']::text[]),
  ('음료', '생수', array['물', 'water']::text[]),
  ('음료', '보리차', '{}'::text[]),
  ('음료', '유자차', '{}'::text[]),
  ('음료', '탄산수', array['sparkling water', 'soda water']::text[]),
  ('음료', '아이스티', array['iced tea', 'ice tea']::text[]),
  ('음료', '카푸치노', array['cappuccino']::text[]),
  ('음료', '에스프레소', array['espresso']::text[]),
  ('음료', '스무디', array['smoothie']::text[]),
  ('음료', '두유', array['soy milk']::text[]),
  ('음료', '요구르트', array['요쿠르트', '야쿠르트', 'yogurt', 'yoghurt']::text[]),
  ('음료', '이온음료', array['sports drink']::text[]),
  ('음료', '수정과', '{}'::text[]),
  ('음료', '카페모카', array['모카', 'mocha']::text[]),
  ('음료', '바닐라라테', array['바닐라라떼', 'vanilla latte']::text[]),
  ('음료', '콜드브루', array['cold brew']::text[]),
  ('음료', '아인슈페너', array['einspanner']::text[]),
  ('음료', '플랫화이트', array['flat white']::text[]),
  ('음료', '버블티', array['bubble tea']::text[]),
  ('음료', '자몽에이드', array['grapefruit ade']::text[]),
  ('음료', '청포도에이드', '{}'::text[]),
  ('음료', '딸기라테', array['딸기라떼', 'strawberry latte']::text[]),
  ('음료', '말차라테', array['녹차라떼', '녹차라테', '말차라떼', 'matcha latte']::text[]),
  ('음료', '고구마라테', array['고구마라떼']::text[]),
  ('음료', '초코우유', array['chocolate milk']::text[]),
  ('음료', '커피우유', '{}'::text[]),
  ('음료', '진저에일', array['ginger ale']::text[]),
  ('음료', '콤부차', array['kombucha']::text[]),
  ('음료', '매실차', '{}'::text[]),
  ('음료', '대추차', '{}'::text[]),
  ('음료', '생강차', array['ginger tea']::text[]),
  ('음료', '캐모마일', array['chamomile']::text[]),
  ('음료', '페퍼민트', array['peppermint']::text[]),
  ('음료', '홍차', array['black tea']::text[]),
  ('음료', '우롱차', array['oolong']::text[]),
  ('음료', '보이차', '{}'::text[]),
  ('음료', '옥수수수염차', '{}'::text[]),
  ('음료', '아이스초코', array['초코라테', '초코라떼']::text[]),
  ('음료', '레몬티', array['lemon tea']::text[]),
  ('음료', '쌍화차', '{}'::text[]),
  ('음료', '미숫가루', '{}'::text[]),
  ('음료', '율무차', '{}'::text[]),
  ('음료', '아몬드우유', array['almond milk']::text[]),
  ('음료', '오트밀크', array['귀리우유', 'oat milk']::text[]),
  ('음료', '토마토주스', array['tomato juice']::text[]),
  ('음료', '사과주스', array['apple juice']::text[]),
  ('음료', '포도주스', array['grape juice']::text[]),
  ('음료', '코코넛워터', array['coconut water']::text[]),
  ('과일', '사과', array['apple']::text[]),
  ('과일', '배', array['pear']::text[]),
  ('과일', '바나나', array['banana']::text[]),
  ('과일', '딸기', array['strawberry']::text[]),
  ('과일', '포도', array['grape', 'grapes']::text[]),
  ('과일', '수박', array['watermelon']::text[]),
  ('과일', '참외', array['korean melon']::text[]),
  ('과일', '귤', array['감귤', 'tangerine', 'mandarin']::text[]),
  ('과일', '오렌지', array['orange']::text[]),
  ('과일', '복숭아', array['peach']::text[]),
  ('과일', '자두', array['plum']::text[]),
  ('과일', '키위', array['kiwi']::text[]),
  ('과일', '망고', array['mango']::text[]),
  ('과일', '파인애플', array['pineapple']::text[]),
  ('과일', '체리', array['cherry']::text[]),
  ('과일', '블루베리', array['blueberry']::text[]),
  ('과일', '레몬', array['lemon']::text[]),
  ('과일', '감', array['홍시', 'persimmon']::text[]),
  ('과일', '석류', array['pomegranate']::text[]),
  ('과일', '멜론', array['melon']::text[]),
  ('과일', '아보카도', array['avocado']::text[]),
  ('과일', '무화과', array['fig']::text[]),
  ('과일', '샤인머스캣', array['샤인머스켓', 'shine muscat']::text[]),
  ('과일', '한라봉', '{}'::text[]),
  ('과일', '코코넛', array['coconut']::text[]),
  ('과일', '두리안', array['durian']::text[]),
  ('과일', '리치', array['lychee', 'litchi']::text[]),
  ('과일', '라임', array['lime']::text[]),
  ('과일', '용과', array['dragon fruit']::text[]),
  ('과일', '대추', array['jujube']::text[]),
  ('과일', '청포도', array['green grape']::text[]),
  ('과일', '거봉', '{}'::text[]),
  ('과일', '금귤', array['낑깡', 'kumquat']::text[]),
  ('과일', '유자', array['yuzu']::text[]),
  ('과일', '모과', array['quince']::text[]),
  ('과일', '살구', array['apricot']::text[]),
  ('과일', '매실', '{}'::text[]),
  ('과일', '앵두', '{}'::text[]),
  ('과일', '오디', array['mulberry']::text[]),
  ('과일', '산딸기', array['라즈베리', 'raspberry']::text[]),
  ('과일', '크랜베리', array['cranberry']::text[]),
  ('과일', '아로니아', array['aronia']::text[]),
  ('과일', '구아바', array['guava']::text[]),
  ('과일', '패션프루트', array['백향과', 'passion fruit']::text[]),
  ('과일', '파파야', array['papaya']::text[]),
  ('과일', '망고스틴', array['mangosteen']::text[]),
  ('과일', '람부탄', array['rambutan']::text[]),
  ('과일', '자몽', array['grapefruit']::text[]),
  ('과일', '천혜향', '{}'::text[]),
  ('과일', '레드향', '{}'::text[]),
  ('과일', '황도', '{}'::text[]),
  ('과일', '백도', '{}'::text[]),
  ('과일', '단감', '{}'::text[]),
  ('과일', '곶감', '{}'::text[]),
  ('과일', '블랙베리', array['blackberry']::text[]),
  ('과일', '구기자', '{}'::text[]),
  ('과일', '스타프루트', array['star fruit']::text[]),
  ('과일', '머루', '{}'::text[]),
  ('과일', '다래', '{}'::text[]),
  ('과일', '비파', array['loquat']::text[]),
  ('동물', '강아지', array['개', 'dog', 'puppy']::text[]),
  ('동물', '고양이', array['cat']::text[]),
  ('동물', '호랑이', array['tiger']::text[]),
  ('동물', '사자', array['lion']::text[]),
  ('동물', '코끼리', array['elephant']::text[]),
  ('동물', '기린', array['giraffe']::text[]),
  ('동물', '원숭이', array['monkey']::text[]),
  ('동물', '판다', array['panda']::text[]),
  ('동물', '펭귄', array['penguin']::text[]),
  ('동물', '토끼', array['rabbit', 'bunny']::text[]),
  ('동물', '거북이', array['거북', 'turtle', 'tortoise']::text[]),
  ('동물', '다람쥐', array['squirrel']::text[]),
  ('동물', '햄스터', array['hamster']::text[]),
  ('동물', '여우', array['fox']::text[]),
  ('동물', '늑대', array['wolf']::text[]),
  ('동물', '곰', array['bear']::text[]),
  ('동물', '돼지', array['pig']::text[]),
  ('동물', '소', array['젖소', 'cow']::text[]),
  ('동물', '말', array['horse']::text[]),
  ('동물', '양', array['sheep']::text[]),
  ('동물', '닭', array['chicken', 'hen']::text[]),
  ('동물', '오리', array['duck']::text[]),
  ('동물', '독수리', array['eagle']::text[]),
  ('동물', '부엉이', array['owl']::text[]),
  ('동물', '상어', array['shark']::text[]),
  ('동물', '고래', array['whale']::text[]),
  ('동물', '문어', array['octopus']::text[]),
  ('동물', '뱀', array['snake']::text[]),
  ('동물', '악어', array['crocodile', 'alligator']::text[]),
  ('동물', '캥거루', array['kangaroo']::text[]),
  ('동물', '하마', array['hippo', 'hippopotamus']::text[]),
  ('동물', '코뿔소', array['rhino']::text[]),
  ('동물', '얼룩말', array['zebra']::text[]),
  ('동물', '낙타', array['camel']::text[]),
  ('동물', '고릴라', array['gorilla']::text[]),
  ('동물', '침팬지', array['chimpanzee']::text[]),
  ('동물', '북극곰', array['polar bear']::text[]),
  ('동물', '너구리', array['raccoon']::text[]),
  ('동물', '수달', array['otter']::text[]),
  ('동물', '고슴도치', array['hedgehog']::text[]),
  ('동물', '사슴', array['deer']::text[]),
  ('동물', '염소', array['goat']::text[]),
  ('동물', '알파카', array['alpaca']::text[]),
  ('동물', '두더지', array['mole']::text[]),
  ('동물', '박쥐', array['bat']::text[]),
  ('동물', '비둘기', array['pigeon', 'dove']::text[]),
  ('동물', '까치', array['magpie']::text[]),
  ('동물', '참새', array['sparrow']::text[]),
  ('동물', '앵무새', array['parrot']::text[]),
  ('동물', '갈매기', array['seagull']::text[]),
  ('동물', '백조', array['swan']::text[]),
  ('동물', '플라밍고', array['홍학', 'flamingo']::text[]),
  ('동물', '개구리', array['frog']::text[]),
  ('동물', '도마뱀', array['lizard']::text[]),
  ('동물', '카멜레온', array['chameleon']::text[]),
  ('동물', '해파리', array['jellyfish']::text[]),
  ('동물', '오징어', array['squid']::text[]),
  ('동물', '게', array['꽃게', 'crab']::text[]),
  ('동물', '돌고래', array['dolphin']::text[]),
  ('동물', '코알라', array['koala']::text[]),
  ('직업', '의사', array['doctor']::text[]),
  ('직업', '간호사', array['nurse']::text[]),
  ('직업', '경찰', array['경찰관', 'police', 'police officer']::text[]),
  ('직업', '소방관', array['firefighter', 'fireman']::text[]),
  ('직업', '선생님', array['교사', 'teacher']::text[]),
  ('직업', '변호사', array['lawyer']::text[]),
  ('직업', '요리사', array['셰프', '쉐프', 'chef', 'cook']::text[]),
  ('직업', '기자', array['reporter', 'journalist']::text[]),
  ('직업', '가수', array['singer']::text[]),
  ('직업', '배우', array['actor', 'actress']::text[]),
  ('직업', '운동선수', array['athlete']::text[]),
  ('직업', '프로그래머', array['개발자', 'programmer', 'developer']::text[]),
  ('직업', '디자이너', array['designer']::text[]),
  ('직업', '회계사', array['accountant']::text[]),
  ('직업', '약사', array['pharmacist']::text[]),
  ('직업', '택배기사', array['택배원', 'delivery driver', 'courier']::text[]),
  ('직업', '바리스타', array['barista']::text[]),
  ('직업', '미용사', array['헤어디자이너', 'hairdresser']::text[]),
  ('직업', '파일럿', array['조종사', 'pilot']::text[]),
  ('직업', '승무원', array['flight attendant']::text[]),
  ('직업', '군인', array['soldier']::text[]),
  ('직업', '판사', array['judge']::text[]),
  ('직업', '유튜버', array['youtuber']::text[]),
  ('직업', '농부', array['farmer']::text[]),
  ('직업', '어부', array['fisherman']::text[]),
  ('직업', '건축가', array['architect']::text[]),
  ('직업', '사진작가', array['사진가', 'photographer']::text[]),
  ('직업', '번역가', array['translator']::text[]),
  ('직업', '은행원', array['banker', 'bank teller']::text[]),
  ('직업', '웹툰작가', array['만화가', 'webtoon artist', 'cartoonist']::text[]),
  ('직업', '치과의사', array['dentist']::text[]),
  ('직업', '수의사', array['vet', 'veterinarian']::text[]),
  ('직업', '교수', array['professor']::text[]),
  ('직업', '연구원', array['researcher']::text[]),
  ('직업', '과학자', array['scientist']::text[]),
  ('직업', '엔지니어', array['engineer']::text[]),
  ('직업', '공무원', array['civil servant']::text[]),
  ('직업', '정치인', array['politician']::text[]),
  ('직업', '대통령', array['president']::text[]),
  ('직업', '작가', array['소설가', 'writer', 'author']::text[]),
  ('직업', '화가', array['painter']::text[]),
  ('직업', '음악가', array['musician']::text[]),
  ('직업', '댄서', array['무용가', 'dancer']::text[]),
  ('직업', '아나운서', array['announcer']::text[]),
  ('직업', '기상캐스터', '{}'::text[]),
  ('직업', '개그맨', array['코미디언', 'comedian']::text[]),
  ('직업', '모델', array['model']::text[]),
  ('직업', '매니저', array['manager']::text[]),
  ('직업', '마술사', array['마법사', 'magician']::text[]),
  ('직업', '탐정', array['detective']::text[]),
  ('직업', '우주비행사', array['astronaut']::text[]),
  ('직업', '선장', array['captain']::text[]),
  ('직업', '버스기사', array['bus driver']::text[]),
  ('직업', '택시기사', array['taxi driver']::text[]),
  ('직업', '배달원', array['라이더', 'delivery rider']::text[]),
  ('직업', '경비원', array['security guard']::text[]),
  ('직업', '환경미화원', array['청소부', 'cleaner']::text[]),
  ('직업', '목수', array['carpenter']::text[]),
  ('직업', '정비사', array['mechanic']::text[]),
  ('직업', '제빵사', array['파티시에', 'baker']::text[]),
  ('장소', '회사', array['사무실', 'office', 'company']::text[]),
  ('장소', '학교', array['school']::text[]),
  ('장소', '병원', array['hospital']::text[]),
  ('장소', '공항', array['airport']::text[]),
  ('장소', '지하철역', array['역', 'subway station', 'station']::text[]),
  ('장소', '편의점', array['convenience store']::text[]),
  ('장소', '카페', array['커피숍', 'cafe', 'coffee shop']::text[]),
  ('장소', '도서관', array['library']::text[]),
  ('장소', '영화관', array['극장', 'cinema', 'movie theater', 'theater']::text[]),
  ('장소', '놀이공원', array['놀이동산', 'amusement park', 'theme park']::text[]),
  ('장소', '수영장', array['swimming pool', 'pool']::text[]),
  ('장소', '헬스장', array['체육관', 'gym']::text[]),
  ('장소', '찜질방', array['jjimjilbang', 'sauna']::text[]),
  ('장소', '노래방', array['karaoke']::text[]),
  ('장소', '피시방', array['pc방', 'pc bang', 'internet cafe']::text[]),
  ('장소', '해수욕장', array['바다', 'beach']::text[]),
  ('장소', '캠핑장', array['campsite', 'campground']::text[]),
  ('장소', '백화점', array['department store']::text[]),
  ('장소', '마트', array['mart', 'supermarket']::text[]),
  ('장소', '은행', array['bank']::text[]),
  ('장소', '우체국', array['post office']::text[]),
  ('장소', '경찰서', array['police station']::text[]),
  ('장소', '동물원', array['zoo']::text[]),
  ('장소', '미용실', array['hair salon', 'salon']::text[]),
  ('장소', '결혼식장', array['예식장', 'wedding hall']::text[]),
  ('장소', '교회', array['church']::text[]),
  ('장소', '공원', array['park']::text[]),
  ('장소', '호텔', array['hotel']::text[]),
  ('장소', '식당', array['restaurant']::text[]),
  ('장소', '화장실', array['restroom', 'toilet', 'bathroom']::text[]),
  ('장소', '대학교', array['university', 'college']::text[]),
  ('장소', '유치원', array['kindergarten']::text[]),
  ('장소', '약국', array['pharmacy']::text[]),
  ('장소', '서점', array['bookstore']::text[]),
  ('장소', '빵집', array['베이커리', 'bakery']::text[]),
  ('장소', '시장', array['재래시장', 'market']::text[]),
  ('장소', '주차장', array['parking lot']::text[]),
  ('장소', '주유소', array['gas station']::text[]),
  ('장소', '버스정류장', array['정류장', 'bus stop']::text[]),
  ('장소', '기차역', array['train station']::text[]),
  ('장소', '항구', array['port', 'harbor']::text[]),
  ('장소', '박물관', array['museum']::text[]),
  ('장소', '미술관', array['art museum', 'gallery']::text[]),
  ('장소', '공연장', array['콘서트홀', 'concert hall']::text[]),
  ('장소', '경기장', array['stadium']::text[]),
  ('장소', '스키장', array['ski resort']::text[]),
  ('장소', '워터파크', array['water park']::text[]),
  ('장소', '산', array['mountain']::text[]),
  ('장소', '계곡', array['valley']::text[]),
  ('장소', '섬', array['island']::text[]),
  ('장소', '사막', array['desert']::text[]),
  ('장소', '놀이터', array['playground']::text[]),
  ('장소', '법원', array['court']::text[]),
  ('장소', '소방서', array['fire station']::text[]),
  ('장소', '시청', array['city hall']::text[]),
  ('장소', '성당', array['cathedral']::text[]),
  ('장소', '절', array['사찰', 'temple']::text[]),
  ('장소', '목욕탕', array['bathhouse']::text[]),
  ('장소', '세탁소', array['laundry']::text[]),
  ('장소', '엘리베이터', array['elevator']::text[]),
  ('스포츠', '축구', array['soccer', 'football']::text[]),
  ('스포츠', '야구', array['baseball']::text[]),
  ('스포츠', '농구', array['basketball']::text[]),
  ('스포츠', '배구', array['volleyball']::text[]),
  ('스포츠', '테니스', array['tennis']::text[]),
  ('스포츠', '탁구', array['table tennis', 'ping pong']::text[]),
  ('스포츠', '배드민턴', array['badminton']::text[]),
  ('스포츠', '골프', array['golf']::text[]),
  ('스포츠', '볼링', array['bowling']::text[]),
  ('스포츠', '수영', array['swimming']::text[]),
  ('스포츠', '마라톤', array['marathon']::text[]),
  ('스포츠', '태권도', array['taekwondo']::text[]),
  ('스포츠', '유도', array['judo']::text[]),
  ('스포츠', '복싱', array['권투', 'boxing']::text[]),
  ('스포츠', '스키', array['ski', 'skiing']::text[]),
  ('스포츠', '스노보드', array['snowboard', 'snowboarding']::text[]),
  ('스포츠', '피겨스케이팅', array['피겨', 'figure skating']::text[]),
  ('스포츠', '쇼트트랙', array['short track']::text[]),
  ('스포츠', '클라이밍', array['climbing']::text[]),
  ('스포츠', '요가', array['yoga']::text[]),
  ('스포츠', '필라테스', array['pilates']::text[]),
  ('스포츠', '펜싱', array['fencing']::text[]),
  ('스포츠', '양궁', array['archery']::text[]),
  ('스포츠', '사격', array['shooting']::text[]),
  ('스포츠', '당구', array['billiards', 'pool']::text[]),
  ('스포츠', '컬링', array['curling']::text[]),
  ('스포츠', '서핑', array['surfing']::text[]),
  ('스포츠', '사이클', array['자전거', 'cycling']::text[]),
  ('스포츠', '씨름', array['ssireum']::text[]),
  ('스포츠', '핸드볼', array['handball']::text[]),
  ('스포츠', '럭비', array['rugby']::text[]),
  ('스포츠', '미식축구', array['american football']::text[]),
  ('스포츠', '아이스하키', array['하키', 'ice hockey', 'hockey']::text[]),
  ('스포츠', '크리켓', array['cricket']::text[]),
  ('스포츠', '스케이트보드', array['skateboard']::text[]),
  ('스포츠', '인라인스케이트', array['인라인', 'inline skating']::text[]),
  ('스포츠', '승마', array['horse riding']::text[]),
  ('스포츠', '조정', array['rowing']::text[]),
  ('스포츠', '카누', array['canoe']::text[]),
  ('스포츠', '카약', array['kayak']::text[]),
  ('스포츠', '수상스키', array['water ski']::text[]),
  ('스포츠', '다이빙', array['diving']::text[]),
  ('스포츠', '레슬링', array['wrestling']::text[]),
  ('스포츠', '역도', array['weightlifting']::text[]),
  ('스포츠', '체조', array['gymnastics']::text[]),
  ('스포츠', '리듬체조', array['rhythmic gymnastics']::text[]),
  ('스포츠', '트라이애슬론', array['철인3종', 'triathlon']::text[]),
  ('스포츠', '줄넘기', array['jump rope']::text[]),
  ('스포츠', '등산', array['hiking']::text[]),
  ('스포츠', '낚시', array['fishing']::text[]),
  ('스포츠', '족구', array['jokgu']::text[]),
  ('스포츠', '피구', array['dodgeball']::text[]),
  ('스포츠', '소프트볼', array['softball']::text[]),
  ('스포츠', '스쿼시', array['squash']::text[]),
  ('스포츠', '크로스핏', array['crossfit']::text[]),
  ('스포츠', '주짓수', array['jiu-jitsu']::text[]),
  ('스포츠', '검도', array['kendo']::text[]),
  ('스포츠', '합기도', array['hapkido']::text[]),
  ('스포츠', '봅슬레이', array['bobsleigh']::text[]),
  ('스포츠', '스카이다이빙', array['skydiving']::text[]),
  ('사무용품', '스테이플러', array['호치키스', '스태플러', 'stapler']::text[]),
  ('사무용품', '포스트잇', array['접착메모지', 'post-it', 'post it', 'sticky note']::text[]),
  ('사무용품', '볼펜', array['ballpoint pen', 'pen']::text[]),
  ('사무용품', '연필', array['pencil']::text[]),
  ('사무용품', '지우개', array['eraser']::text[]),
  ('사무용품', '형광펜', array['highlighter']::text[]),
  ('사무용품', '가위', array['scissors']::text[]),
  ('사무용품', '풀', array['glue']::text[]),
  ('사무용품', '테이프', array['스카치테이프', 'tape']::text[]),
  ('사무용품', '클립', array['clip', 'paper clip']::text[]),
  ('사무용품', '계산기', array['calculator']::text[]),
  ('사무용품', '키보드', array['keyboard']::text[]),
  ('사무용품', '마우스', array['mouse']::text[]),
  ('사무용품', '모니터', array['monitor']::text[]),
  ('사무용품', '노트북', array['laptop', 'notebook']::text[]),
  ('사무용품', '프린터', array['printer']::text[]),
  ('사무용품', '복합기', array['copier', 'multifunction printer']::text[]),
  ('사무용품', '파쇄기', array['문서세단기', '세단기', 'shredder']::text[]),
  ('사무용품', '화이트보드', array['whiteboard']::text[]),
  ('사무용품', '명함', array['business card']::text[]),
  ('사무용품', '사원증', array['id card', 'employee id']::text[]),
  ('사무용품', '다이어리', array['diary', 'planner']::text[]),
  ('사무용품', '서류봉투', array['envelope']::text[]),
  ('사무용품', '바인더', array['파일철', 'binder']::text[]),
  ('사무용품', '수정테이프', array['correction tape']::text[]),
  ('사무용품', '자', array['ruler']::text[]),
  ('사무용품', '커터칼', array['칼', 'cutter', 'box cutter']::text[]),
  ('사무용품', '마우스패드', array['mouse pad']::text[]),
  ('사무용품', '헤드셋', array['headset']::text[]),
  ('사무용품', '달력', array['calendar']::text[]),
  ('사무용품', '연필꽂이', array['펜꽂이']::text[]),
  ('사무용품', '샤프', array['샤프펜슬', 'mechanical pencil']::text[]),
  ('사무용품', '사인펜', array['네임펜']::text[]),
  ('사무용품', '매직', array['매직펜', 'marker']::text[]),
  ('사무용품', '압정', array['thumbtack']::text[]),
  ('사무용품', '고무줄', array['rubber band']::text[]),
  ('사무용품', '집게', array['binder clip']::text[]),
  ('사무용품', '펀치', array['hole punch']::text[]),
  ('사무용품', '라벨기', array['label maker']::text[]),
  ('사무용품', '도장', array['stamp']::text[]),
  ('사무용품', '인주', '{}'::text[]),
  ('사무용품', '메모지', array['memo pad']::text[]),
  ('사무용품', '공책', '{}'::text[]),
  ('사무용품', '수첩', '{}'::text[]),
  ('사무용품', '결재판', array['clipboard']::text[]),
  ('사무용품', '서류함', '{}'::text[]),
  ('사무용품', '책상', array['desk']::text[]),
  ('사무용품', '의자', array['chair']::text[]),
  ('사무용품', '스탠드', array['desk lamp']::text[]),
  ('사무용품', '전화기', array['phone', 'telephone']::text[]),
  ('사무용품', '웹캠', array['webcam']::text[]),
  ('사무용품', 'USB', array['유에스비', 'usb메모리']::text[]),
  ('사무용품', '외장하드', array['external hard drive']::text[]),
  ('사무용품', '충전기', array['charger']::text[]),
  ('사무용품', '멀티탭', array['power strip']::text[]),
  ('사무용품', '스캐너', array['scanner']::text[]),
  ('사무용품', '프로젝터', array['빔프로젝터', 'projector']::text[]),
  ('사무용품', '칠판', array['blackboard']::text[]),
  ('사무용품', '커피포트', array['kettle']::text[]),
  ('사무용품', '텀블러', array['tumbler']::text[]),
  ('나라', '한국', array['대한민국', 'korea', 'south korea']::text[]),
  ('나라', '일본', array['japan']::text[]),
  ('나라', '중국', array['china']::text[]),
  ('나라', '미국', array['usa', 'america', 'us']::text[]),
  ('나라', '영국', array['uk', 'england', 'britain']::text[]),
  ('나라', '프랑스', array['france']::text[]),
  ('나라', '독일', array['germany']::text[]),
  ('나라', '이탈리아', array['italy']::text[]),
  ('나라', '스페인', array['spain']::text[]),
  ('나라', '러시아', array['russia']::text[]),
  ('나라', '캐나다', array['canada']::text[]),
  ('나라', '브라질', array['brazil']::text[]),
  ('나라', '호주', array['australia']::text[]),
  ('나라', '인도', array['india']::text[]),
  ('나라', '베트남', array['vietnam']::text[]),
  ('나라', '태국', array['thailand']::text[]),
  ('나라', '필리핀', array['philippines']::text[]),
  ('나라', '멕시코', array['mexico']::text[]),
  ('나라', '이집트', array['egypt']::text[]),
  ('나라', '튀르키예', array['터키', 'turkey', 'turkiye']::text[]),
  ('나라', '그리스', array['greece']::text[]),
  ('나라', '스위스', array['switzerland']::text[]),
  ('나라', '네덜란드', array['netherlands', 'holland']::text[]),
  ('나라', '몽골', array['mongolia']::text[]),
  ('나라', '싱가포르', array['singapore']::text[]),
  ('나라', '아르헨티나', array['argentina']::text[]),
  ('나라', '뉴질랜드', array['new zealand']::text[]),
  ('나라', '대만', array['taiwan']::text[]),
  ('나라', '사우디아라비아', array['사우디', 'saudi arabia', 'saudi']::text[]),
  ('나라', '남아프리카공화국', array['남아공', 'south africa']::text[]),
  ('나라', '인도네시아', array['indonesia']::text[]),
  ('나라', '말레이시아', array['malaysia']::text[]),
  ('나라', '캄보디아', array['cambodia']::text[]),
  ('나라', '라오스', array['laos']::text[]),
  ('나라', '미얀마', array['myanmar']::text[]),
  ('나라', '네팔', array['nepal']::text[]),
  ('나라', '파키스탄', array['pakistan']::text[]),
  ('나라', '이란', array['iran']::text[]),
  ('나라', '이라크', array['iraq']::text[]),
  ('나라', '이스라엘', array['israel']::text[]),
  ('나라', '아랍에미리트', array['uae']::text[]),
  ('나라', '카타르', array['qatar']::text[]),
  ('나라', '우크라이나', array['ukraine']::text[]),
  ('나라', '폴란드', array['poland']::text[]),
  ('나라', '스웨덴', array['sweden']::text[]),
  ('나라', '노르웨이', array['norway']::text[]),
  ('나라', '덴마크', array['denmark']::text[]),
  ('나라', '핀란드', array['finland']::text[]),
  ('나라', '아이슬란드', array['iceland']::text[]),
  ('나라', '오스트리아', array['austria']::text[]),
  ('나라', '벨기에', array['belgium']::text[]),
  ('나라', '포르투갈', array['portugal']::text[]),
  ('나라', '아일랜드', array['ireland']::text[]),
  ('나라', '체코', array['czech']::text[]),
  ('나라', '헝가리', array['hungary']::text[]),
  ('나라', '칠레', array['chile']::text[]),
  ('나라', '페루', array['peru']::text[]),
  ('나라', '콜롬비아', array['colombia']::text[]),
  ('나라', '쿠바', array['cuba']::text[]),
  ('나라', '케냐', array['kenya']::text[]),
  ('회사 생활', '월급날', array['payday']::text[]),
  ('회사 생활', '야근', array['overtime']::text[]),
  ('회사 생활', '회식', array['company dinner']::text[]),
  ('회사 생활', '연차', array['annual leave', 'day off']::text[]),
  ('회사 생활', '출근', array['commute']::text[]),
  ('회사 생활', '퇴근', '{}'::text[]),
  ('회사 생활', '점심시간', array['lunch time', 'lunchtime']::text[]),
  ('회사 생활', '회의', array['meeting']::text[]),
  ('회사 생활', '보고서', array['report']::text[]),
  ('회사 생활', '결재', array['approval']::text[]),
  ('회사 생활', '엑셀', array['excel']::text[]),
  ('회사 생활', '메신저', array['messenger']::text[]),
  ('회사 생활', '탕비실', '{}'::text[]),
  ('회사 생활', '워크숍', array['워크샵', 'workshop']::text[]),
  ('회사 생활', '승진', array['promotion']::text[]),
  ('회사 생활', '연봉협상', '{}'::text[]),
  ('회사 생활', '송년회', '{}'::text[]),
  ('회사 생활', '재택근무', array['재택', 'work from home', 'wfh', 'remote work']::text[]),
  ('회사 생활', '출장', array['business trip']::text[]),
  ('회사 생활', '명절선물', '{}'::text[]),
  ('회사 생활', '칼퇴', '{}'::text[]),
  ('회사 생활', '월요병', array['monday blues']::text[]),
  ('회사 생활', '사내식당', array['구내식당']::text[]),
  ('회사 생활', '인사평가', array['performance review']::text[]),
  ('회사 생활', '신입사원', array['신입', 'new employee', 'rookie']::text[]),
  ('회사 생활', '부장님', array['부장']::text[]),
  ('회사 생활', '반차', '{}'::text[]),
  ('회사 생활', '이메일', array['메일', 'email', 'e-mail']::text[]),
  ('회사 생활', '퇴사', array['resignation']::text[]),
  ('회사 생활', '커피타임', array['coffee break', 'coffee time']::text[]),
  ('회사 생활', '보너스', array['상여금', 'bonus']::text[]),
  ('회사 생활', '성과급', array['incentive']::text[]),
  ('회사 생활', '연말정산', '{}'::text[]),
  ('회사 생활', '법인카드', array['corporate card']::text[]),
  ('회사 생활', '야식', '{}'::text[]),
  ('회사 생활', '주말출근', array['주말근무']::text[]),
  ('회사 생활', '조퇴', '{}'::text[]),
  ('회사 생활', '지각', '{}'::text[]),
  ('회사 생활', '병가', array['sick leave']::text[]),
  ('회사 생활', '육아휴직', '{}'::text[]),
  ('회사 생활', '휴가', array['vacation']::text[]),
  ('회사 생활', '팀장님', array['팀장']::text[]),
  ('회사 생활', '사장님', array['사장', 'ceo']::text[]),
  ('회사 생활', '인턴', array['intern']::text[]),
  ('회사 생활', '경력직', '{}'::text[]),
  ('회사 생활', '면접', array['interview']::text[]),
  ('회사 생활', '이직', '{}'::text[]),
  ('회사 생활', '사직서', '{}'::text[]),
  ('회사 생활', '계약서', array['contract']::text[]),
  ('회사 생활', '기획안', array['proposal']::text[]),
  ('회사 생활', '프레젠테이션', array['피피티', 'ppt', 'presentation']::text[]),
  ('회사 생활', '마감', array['deadline']::text[]),
  ('회사 생활', '회의실', array['meeting room']::text[]),
  ('회사 생활', '출장비', '{}'::text[]),
  ('회사 생활', '경조사', '{}'::text[]),
  ('회사 생활', '체육대회', '{}'::text[]),
  ('회사 생활', '시무식', '{}'::text[]),
  ('회사 생활', '야유회', '{}'::text[]),
  ('회사 생활', '출근길', '{}'::text[]),
  ('회사 생활', '퇴근길', '{}'::text[])
on conflict (category, word) do update set aliases = excluded.aliases;
-- 목록에서 빠진 단어는 지운다
delete from public.liar_words w where not exists (select 1 from (values
  ('음식', '김치찌개'),
  ('음식', '된장찌개'),
  ('음식', '떡볶이'),
  ('음식', '짜장면'),
  ('음식', '짬뽕'),
  ('음식', '삼겹살'),
  ('음식', '치킨'),
  ('음식', '피자'),
  ('음식', '햄버거'),
  ('음식', '라면'),
  ('음식', '김밥'),
  ('음식', '비빔밥'),
  ('음식', '제육볶음'),
  ('음식', '돈가스'),
  ('음식', '초밥'),
  ('음식', '냉면'),
  ('음식', '국밥'),
  ('음식', '칼국수'),
  ('음식', '마라탕'),
  ('음식', '샐러드'),
  ('음식', '순대'),
  ('음식', '족발'),
  ('음식', '보쌈'),
  ('음식', '쌀국수'),
  ('음식', '샌드위치'),
  ('음식', '떡국'),
  ('음식', '갈비탕'),
  ('음식', '부대찌개'),
  ('음식', '삼계탕'),
  ('음식', '오므라이스'),
  ('음식', '불고기'),
  ('음식', '갈비'),
  ('음식', '잡채'),
  ('음식', '순두부찌개'),
  ('음식', '감자탕'),
  ('음식', '닭갈비'),
  ('음식', '곱창'),
  ('음식', '수제비'),
  ('음식', '만두'),
  ('음식', '우동'),
  ('음식', '파스타'),
  ('음식', '스테이크'),
  ('음식', '카레'),
  ('음식', '볶음밥'),
  ('음식', '탕수육'),
  ('음식', '양꼬치'),
  ('음식', '훠궈'),
  ('음식', '타코'),
  ('음식', '핫도그'),
  ('음식', '토스트'),
  ('음식', '김치볶음밥'),
  ('음식', '닭강정'),
  ('음식', '회'),
  ('음식', '해장국'),
  ('음식', '콩국수'),
  ('음식', '어묵'),
  ('음식', '계란말이'),
  ('음식', '파전'),
  ('음식', '육회'),
  ('음식', '막국수'),
  ('음료', '아메리카노'),
  ('음료', '카페라테'),
  ('음료', '콜라'),
  ('음료', '사이다'),
  ('음료', '녹차'),
  ('음료', '우유'),
  ('음료', '바나나우유'),
  ('음료', '식혜'),
  ('음료', '오렌지주스'),
  ('음료', '핫초코'),
  ('음료', '밀크티'),
  ('음료', '레모네이드'),
  ('음료', '에너지드링크'),
  ('음료', '생수'),
  ('음료', '보리차'),
  ('음료', '유자차'),
  ('음료', '탄산수'),
  ('음료', '아이스티'),
  ('음료', '카푸치노'),
  ('음료', '에스프레소'),
  ('음료', '스무디'),
  ('음료', '두유'),
  ('음료', '요구르트'),
  ('음료', '이온음료'),
  ('음료', '수정과'),
  ('음료', '카페모카'),
  ('음료', '바닐라라테'),
  ('음료', '콜드브루'),
  ('음료', '아인슈페너'),
  ('음료', '플랫화이트'),
  ('음료', '버블티'),
  ('음료', '자몽에이드'),
  ('음료', '청포도에이드'),
  ('음료', '딸기라테'),
  ('음료', '말차라테'),
  ('음료', '고구마라테'),
  ('음료', '초코우유'),
  ('음료', '커피우유'),
  ('음료', '진저에일'),
  ('음료', '콤부차'),
  ('음료', '매실차'),
  ('음료', '대추차'),
  ('음료', '생강차'),
  ('음료', '캐모마일'),
  ('음료', '페퍼민트'),
  ('음료', '홍차'),
  ('음료', '우롱차'),
  ('음료', '보이차'),
  ('음료', '옥수수수염차'),
  ('음료', '아이스초코'),
  ('음료', '레몬티'),
  ('음료', '쌍화차'),
  ('음료', '미숫가루'),
  ('음료', '율무차'),
  ('음료', '아몬드우유'),
  ('음료', '오트밀크'),
  ('음료', '토마토주스'),
  ('음료', '사과주스'),
  ('음료', '포도주스'),
  ('음료', '코코넛워터'),
  ('과일', '사과'),
  ('과일', '배'),
  ('과일', '바나나'),
  ('과일', '딸기'),
  ('과일', '포도'),
  ('과일', '수박'),
  ('과일', '참외'),
  ('과일', '귤'),
  ('과일', '오렌지'),
  ('과일', '복숭아'),
  ('과일', '자두'),
  ('과일', '키위'),
  ('과일', '망고'),
  ('과일', '파인애플'),
  ('과일', '체리'),
  ('과일', '블루베리'),
  ('과일', '레몬'),
  ('과일', '감'),
  ('과일', '석류'),
  ('과일', '멜론'),
  ('과일', '아보카도'),
  ('과일', '무화과'),
  ('과일', '샤인머스캣'),
  ('과일', '한라봉'),
  ('과일', '코코넛'),
  ('과일', '두리안'),
  ('과일', '리치'),
  ('과일', '라임'),
  ('과일', '용과'),
  ('과일', '대추'),
  ('과일', '청포도'),
  ('과일', '거봉'),
  ('과일', '금귤'),
  ('과일', '유자'),
  ('과일', '모과'),
  ('과일', '살구'),
  ('과일', '매실'),
  ('과일', '앵두'),
  ('과일', '오디'),
  ('과일', '산딸기'),
  ('과일', '크랜베리'),
  ('과일', '아로니아'),
  ('과일', '구아바'),
  ('과일', '패션프루트'),
  ('과일', '파파야'),
  ('과일', '망고스틴'),
  ('과일', '람부탄'),
  ('과일', '자몽'),
  ('과일', '천혜향'),
  ('과일', '레드향'),
  ('과일', '황도'),
  ('과일', '백도'),
  ('과일', '단감'),
  ('과일', '곶감'),
  ('과일', '블랙베리'),
  ('과일', '구기자'),
  ('과일', '스타프루트'),
  ('과일', '머루'),
  ('과일', '다래'),
  ('과일', '비파'),
  ('동물', '강아지'),
  ('동물', '고양이'),
  ('동물', '호랑이'),
  ('동물', '사자'),
  ('동물', '코끼리'),
  ('동물', '기린'),
  ('동물', '원숭이'),
  ('동물', '판다'),
  ('동물', '펭귄'),
  ('동물', '토끼'),
  ('동물', '거북이'),
  ('동물', '다람쥐'),
  ('동물', '햄스터'),
  ('동물', '여우'),
  ('동물', '늑대'),
  ('동물', '곰'),
  ('동물', '돼지'),
  ('동물', '소'),
  ('동물', '말'),
  ('동물', '양'),
  ('동물', '닭'),
  ('동물', '오리'),
  ('동물', '독수리'),
  ('동물', '부엉이'),
  ('동물', '상어'),
  ('동물', '고래'),
  ('동물', '문어'),
  ('동물', '뱀'),
  ('동물', '악어'),
  ('동물', '캥거루'),
  ('동물', '하마'),
  ('동물', '코뿔소'),
  ('동물', '얼룩말'),
  ('동물', '낙타'),
  ('동물', '고릴라'),
  ('동물', '침팬지'),
  ('동물', '북극곰'),
  ('동물', '너구리'),
  ('동물', '수달'),
  ('동물', '고슴도치'),
  ('동물', '사슴'),
  ('동물', '염소'),
  ('동물', '알파카'),
  ('동물', '두더지'),
  ('동물', '박쥐'),
  ('동물', '비둘기'),
  ('동물', '까치'),
  ('동물', '참새'),
  ('동물', '앵무새'),
  ('동물', '갈매기'),
  ('동물', '백조'),
  ('동물', '플라밍고'),
  ('동물', '개구리'),
  ('동물', '도마뱀'),
  ('동물', '카멜레온'),
  ('동물', '해파리'),
  ('동물', '오징어'),
  ('동물', '게'),
  ('동물', '돌고래'),
  ('동물', '코알라'),
  ('직업', '의사'),
  ('직업', '간호사'),
  ('직업', '경찰'),
  ('직업', '소방관'),
  ('직업', '선생님'),
  ('직업', '변호사'),
  ('직업', '요리사'),
  ('직업', '기자'),
  ('직업', '가수'),
  ('직업', '배우'),
  ('직업', '운동선수'),
  ('직업', '프로그래머'),
  ('직업', '디자이너'),
  ('직업', '회계사'),
  ('직업', '약사'),
  ('직업', '택배기사'),
  ('직업', '바리스타'),
  ('직업', '미용사'),
  ('직업', '파일럿'),
  ('직업', '승무원'),
  ('직업', '군인'),
  ('직업', '판사'),
  ('직업', '유튜버'),
  ('직업', '농부'),
  ('직업', '어부'),
  ('직업', '건축가'),
  ('직업', '사진작가'),
  ('직업', '번역가'),
  ('직업', '은행원'),
  ('직업', '웹툰작가'),
  ('직업', '치과의사'),
  ('직업', '수의사'),
  ('직업', '교수'),
  ('직업', '연구원'),
  ('직업', '과학자'),
  ('직업', '엔지니어'),
  ('직업', '공무원'),
  ('직업', '정치인'),
  ('직업', '대통령'),
  ('직업', '작가'),
  ('직업', '화가'),
  ('직업', '음악가'),
  ('직업', '댄서'),
  ('직업', '아나운서'),
  ('직업', '기상캐스터'),
  ('직업', '개그맨'),
  ('직업', '모델'),
  ('직업', '매니저'),
  ('직업', '마술사'),
  ('직업', '탐정'),
  ('직업', '우주비행사'),
  ('직업', '선장'),
  ('직업', '버스기사'),
  ('직업', '택시기사'),
  ('직업', '배달원'),
  ('직업', '경비원'),
  ('직업', '환경미화원'),
  ('직업', '목수'),
  ('직업', '정비사'),
  ('직업', '제빵사'),
  ('장소', '회사'),
  ('장소', '학교'),
  ('장소', '병원'),
  ('장소', '공항'),
  ('장소', '지하철역'),
  ('장소', '편의점'),
  ('장소', '카페'),
  ('장소', '도서관'),
  ('장소', '영화관'),
  ('장소', '놀이공원'),
  ('장소', '수영장'),
  ('장소', '헬스장'),
  ('장소', '찜질방'),
  ('장소', '노래방'),
  ('장소', '피시방'),
  ('장소', '해수욕장'),
  ('장소', '캠핑장'),
  ('장소', '백화점'),
  ('장소', '마트'),
  ('장소', '은행'),
  ('장소', '우체국'),
  ('장소', '경찰서'),
  ('장소', '동물원'),
  ('장소', '미용실'),
  ('장소', '결혼식장'),
  ('장소', '교회'),
  ('장소', '공원'),
  ('장소', '호텔'),
  ('장소', '식당'),
  ('장소', '화장실'),
  ('장소', '대학교'),
  ('장소', '유치원'),
  ('장소', '약국'),
  ('장소', '서점'),
  ('장소', '빵집'),
  ('장소', '시장'),
  ('장소', '주차장'),
  ('장소', '주유소'),
  ('장소', '버스정류장'),
  ('장소', '기차역'),
  ('장소', '항구'),
  ('장소', '박물관'),
  ('장소', '미술관'),
  ('장소', '공연장'),
  ('장소', '경기장'),
  ('장소', '스키장'),
  ('장소', '워터파크'),
  ('장소', '산'),
  ('장소', '계곡'),
  ('장소', '섬'),
  ('장소', '사막'),
  ('장소', '놀이터'),
  ('장소', '법원'),
  ('장소', '소방서'),
  ('장소', '시청'),
  ('장소', '성당'),
  ('장소', '절'),
  ('장소', '목욕탕'),
  ('장소', '세탁소'),
  ('장소', '엘리베이터'),
  ('스포츠', '축구'),
  ('스포츠', '야구'),
  ('스포츠', '농구'),
  ('스포츠', '배구'),
  ('스포츠', '테니스'),
  ('스포츠', '탁구'),
  ('스포츠', '배드민턴'),
  ('스포츠', '골프'),
  ('스포츠', '볼링'),
  ('스포츠', '수영'),
  ('스포츠', '마라톤'),
  ('스포츠', '태권도'),
  ('스포츠', '유도'),
  ('스포츠', '복싱'),
  ('스포츠', '스키'),
  ('스포츠', '스노보드'),
  ('스포츠', '피겨스케이팅'),
  ('스포츠', '쇼트트랙'),
  ('스포츠', '클라이밍'),
  ('스포츠', '요가'),
  ('스포츠', '필라테스'),
  ('스포츠', '펜싱'),
  ('스포츠', '양궁'),
  ('스포츠', '사격'),
  ('스포츠', '당구'),
  ('스포츠', '컬링'),
  ('스포츠', '서핑'),
  ('스포츠', '사이클'),
  ('스포츠', '씨름'),
  ('스포츠', '핸드볼'),
  ('스포츠', '럭비'),
  ('스포츠', '미식축구'),
  ('스포츠', '아이스하키'),
  ('스포츠', '크리켓'),
  ('스포츠', '스케이트보드'),
  ('스포츠', '인라인스케이트'),
  ('스포츠', '승마'),
  ('스포츠', '조정'),
  ('스포츠', '카누'),
  ('스포츠', '카약'),
  ('스포츠', '수상스키'),
  ('스포츠', '다이빙'),
  ('스포츠', '레슬링'),
  ('스포츠', '역도'),
  ('스포츠', '체조'),
  ('스포츠', '리듬체조'),
  ('스포츠', '트라이애슬론'),
  ('스포츠', '줄넘기'),
  ('스포츠', '등산'),
  ('스포츠', '낚시'),
  ('스포츠', '족구'),
  ('스포츠', '피구'),
  ('스포츠', '소프트볼'),
  ('스포츠', '스쿼시'),
  ('스포츠', '크로스핏'),
  ('스포츠', '주짓수'),
  ('스포츠', '검도'),
  ('스포츠', '합기도'),
  ('스포츠', '봅슬레이'),
  ('스포츠', '스카이다이빙'),
  ('사무용품', '스테이플러'),
  ('사무용품', '포스트잇'),
  ('사무용품', '볼펜'),
  ('사무용품', '연필'),
  ('사무용품', '지우개'),
  ('사무용품', '형광펜'),
  ('사무용품', '가위'),
  ('사무용품', '풀'),
  ('사무용품', '테이프'),
  ('사무용품', '클립'),
  ('사무용품', '계산기'),
  ('사무용품', '키보드'),
  ('사무용품', '마우스'),
  ('사무용품', '모니터'),
  ('사무용품', '노트북'),
  ('사무용품', '프린터'),
  ('사무용품', '복합기'),
  ('사무용품', '파쇄기'),
  ('사무용품', '화이트보드'),
  ('사무용품', '명함'),
  ('사무용품', '사원증'),
  ('사무용품', '다이어리'),
  ('사무용품', '서류봉투'),
  ('사무용품', '바인더'),
  ('사무용품', '수정테이프'),
  ('사무용품', '자'),
  ('사무용품', '커터칼'),
  ('사무용품', '마우스패드'),
  ('사무용품', '헤드셋'),
  ('사무용품', '달력'),
  ('사무용품', '연필꽂이'),
  ('사무용품', '샤프'),
  ('사무용품', '사인펜'),
  ('사무용품', '매직'),
  ('사무용품', '압정'),
  ('사무용품', '고무줄'),
  ('사무용품', '집게'),
  ('사무용품', '펀치'),
  ('사무용품', '라벨기'),
  ('사무용품', '도장'),
  ('사무용품', '인주'),
  ('사무용품', '메모지'),
  ('사무용품', '공책'),
  ('사무용품', '수첩'),
  ('사무용품', '결재판'),
  ('사무용품', '서류함'),
  ('사무용품', '책상'),
  ('사무용품', '의자'),
  ('사무용품', '스탠드'),
  ('사무용품', '전화기'),
  ('사무용품', '웹캠'),
  ('사무용품', 'USB'),
  ('사무용품', '외장하드'),
  ('사무용품', '충전기'),
  ('사무용품', '멀티탭'),
  ('사무용품', '스캐너'),
  ('사무용품', '프로젝터'),
  ('사무용품', '칠판'),
  ('사무용품', '커피포트'),
  ('사무용품', '텀블러'),
  ('나라', '한국'),
  ('나라', '일본'),
  ('나라', '중국'),
  ('나라', '미국'),
  ('나라', '영국'),
  ('나라', '프랑스'),
  ('나라', '독일'),
  ('나라', '이탈리아'),
  ('나라', '스페인'),
  ('나라', '러시아'),
  ('나라', '캐나다'),
  ('나라', '브라질'),
  ('나라', '호주'),
  ('나라', '인도'),
  ('나라', '베트남'),
  ('나라', '태국'),
  ('나라', '필리핀'),
  ('나라', '멕시코'),
  ('나라', '이집트'),
  ('나라', '튀르키예'),
  ('나라', '그리스'),
  ('나라', '스위스'),
  ('나라', '네덜란드'),
  ('나라', '몽골'),
  ('나라', '싱가포르'),
  ('나라', '아르헨티나'),
  ('나라', '뉴질랜드'),
  ('나라', '대만'),
  ('나라', '사우디아라비아'),
  ('나라', '남아프리카공화국'),
  ('나라', '인도네시아'),
  ('나라', '말레이시아'),
  ('나라', '캄보디아'),
  ('나라', '라오스'),
  ('나라', '미얀마'),
  ('나라', '네팔'),
  ('나라', '파키스탄'),
  ('나라', '이란'),
  ('나라', '이라크'),
  ('나라', '이스라엘'),
  ('나라', '아랍에미리트'),
  ('나라', '카타르'),
  ('나라', '우크라이나'),
  ('나라', '폴란드'),
  ('나라', '스웨덴'),
  ('나라', '노르웨이'),
  ('나라', '덴마크'),
  ('나라', '핀란드'),
  ('나라', '아이슬란드'),
  ('나라', '오스트리아'),
  ('나라', '벨기에'),
  ('나라', '포르투갈'),
  ('나라', '아일랜드'),
  ('나라', '체코'),
  ('나라', '헝가리'),
  ('나라', '칠레'),
  ('나라', '페루'),
  ('나라', '콜롬비아'),
  ('나라', '쿠바'),
  ('나라', '케냐'),
  ('회사 생활', '월급날'),
  ('회사 생활', '야근'),
  ('회사 생활', '회식'),
  ('회사 생활', '연차'),
  ('회사 생활', '출근'),
  ('회사 생활', '퇴근'),
  ('회사 생활', '점심시간'),
  ('회사 생활', '회의'),
  ('회사 생활', '보고서'),
  ('회사 생활', '결재'),
  ('회사 생활', '엑셀'),
  ('회사 생활', '메신저'),
  ('회사 생활', '탕비실'),
  ('회사 생활', '워크숍'),
  ('회사 생활', '승진'),
  ('회사 생활', '연봉협상'),
  ('회사 생활', '송년회'),
  ('회사 생활', '재택근무'),
  ('회사 생활', '출장'),
  ('회사 생활', '명절선물'),
  ('회사 생활', '칼퇴'),
  ('회사 생활', '월요병'),
  ('회사 생활', '사내식당'),
  ('회사 생활', '인사평가'),
  ('회사 생활', '신입사원'),
  ('회사 생활', '부장님'),
  ('회사 생활', '반차'),
  ('회사 생활', '이메일'),
  ('회사 생활', '퇴사'),
  ('회사 생활', '커피타임'),
  ('회사 생활', '보너스'),
  ('회사 생활', '성과급'),
  ('회사 생활', '연말정산'),
  ('회사 생활', '법인카드'),
  ('회사 생활', '야식'),
  ('회사 생활', '주말출근'),
  ('회사 생활', '조퇴'),
  ('회사 생활', '지각'),
  ('회사 생활', '병가'),
  ('회사 생활', '육아휴직'),
  ('회사 생활', '휴가'),
  ('회사 생활', '팀장님'),
  ('회사 생활', '사장님'),
  ('회사 생활', '인턴'),
  ('회사 생활', '경력직'),
  ('회사 생활', '면접'),
  ('회사 생활', '이직'),
  ('회사 생활', '사직서'),
  ('회사 생활', '계약서'),
  ('회사 생활', '기획안'),
  ('회사 생활', '프레젠테이션'),
  ('회사 생활', '마감'),
  ('회사 생활', '회의실'),
  ('회사 생활', '출장비'),
  ('회사 생활', '경조사'),
  ('회사 생활', '체육대회'),
  ('회사 생활', '시무식'),
  ('회사 생활', '야유회'),
  ('회사 생활', '출근길'),
  ('회사 생활', '퇴근길')
) k(category, word) where k.category = w.category and k.word = w.word);
-- END WORDS


-- ════════ 0003_bingo.sql ════════
-- 월루: 빙고
-- 0001, 0002 다음에 실행. 여러 번 실행해도 안전하다. 단어 목록은 라이어 게임 제시어 은행(liar_words)을 그대로 쓴다.
-- 각자의 빙고판은 서버만 알고, 본인 판만 받는다. 끝나면 모두 공개.

create table if not exists public.bingo_games (
  room_code     text primary key references public.rooms(code) on delete cascade,
  round_no      int not null default 0,
  phase         text not null,               -- fill | call | result
  category      text not null,
  size          int not null,                -- 4 | 5
  lines_to_win  int not null,
  custom_max    int not null,                -- 직접 입력 가능한 칸 수
  player_ids    uuid[] not null,             -- 부르기 순서
  turn_index    int not null default 0,
  deadline      timestamptz,
  ready         uuid[] not null default '{}',
  winner        uuid,
  result        jsonb,
  scores        jsonb not null default '{}'::jsonb,
  updated_at    timestamptz not null default now()
);

-- 이번 판에 보여줄 단어 목록 (2명이면 주제 단어 중 50개만 뽑아 겹치게, 3명 이상이면 전부)
alter table public.bingo_games add column if not exists words text[];

create table if not exists public.bingo_boards (
  room_code  text not null references public.rooms(code) on delete cascade,
  user_id    uuid not null,
  cells      text[] not null default '{}',
  custom     boolean[] not null default '{}',
  primary key (room_code, user_id)
);

create table if not exists public.bingo_calls (
  id          bigserial primary key,
  room_code   text not null references public.rooms(code) on delete cascade,
  round_no    int not null,
  user_id     uuid not null,
  word        text not null,
  norm        text not null,
  auto        boolean not null default false,
  custom      boolean not null default false,
  tongs       uuid[] not null default '{}',  -- 직접 쓴 단어가 겹친 사람들 ("통했다!")
  created_at  timestamptz not null default now()
);
create index if not exists bingo_calls_room on public.bingo_calls (room_code, id);

-- 게임 중 대화
create table if not exists public.bingo_chats (
  id          bigserial primary key,
  room_code   text not null references public.rooms(code) on delete cascade,
  user_id     uuid not null,
  body        text not null,
  created_at  timestamptz not null default now()
);
create index if not exists bingo_chats_room on public.bingo_chats (room_code, id);

alter table public.bingo_games  enable row level security;
alter table public.bingo_boards enable row level security;
alter table public.bingo_calls  enable row level security;
alter table public.bingo_chats  enable row level security;

drop policy if exists bingo_games_read on public.bingo_games;
create policy bingo_games_read on public.bingo_games for select to authenticated using (public.is_room_member(room_code));
drop policy if exists bingo_calls_read on public.bingo_calls;
create policy bingo_calls_read on public.bingo_calls for select to authenticated using (public.is_room_member(room_code));
drop policy if exists bingo_chats_read on public.bingo_chats;
create policy bingo_chats_read on public.bingo_chats for select to authenticated using (public.is_room_member(room_code));

alter table public.bingo_games replica identity full;
alter table public.bingo_calls replica identity full;
alter table public.bingo_chats replica identity full;
do $$ begin
  begin alter publication supabase_realtime add table public.bingo_games; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.bingo_calls; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.bingo_chats; exception when duplicate_object then null; end;
end $$;

create or replace function public._bingo_fill_secs() returns int language sql immutable as $$ select 120 $$;
create or replace function public._bingo_call_secs() returns int language sql immutable as $$ select 15 $$;
-- 인원별 단어 목록 크기 (null = 주제 단어 전부)
create or replace function public._bingo_pool_size(p_players int) returns int language sql immutable as $$
  select case when p_players <= 2 then 50 else null end
$$;

-- ───────────── 내부 도우미 ─────────────

-- 이 주제의 단어 (정답 표기 → 정규화 키). 별칭도 같은 단어로 본다.
create or replace function public._bingo_canon(p_cat text, p_text text) returns text
language sql stable security definer set search_path = public as $$
  select w.word from liar_words w
   where w.category = p_cat
     and (_liar_norm(w.word) = _liar_norm(p_text) or exists (select 1 from unnest(w.aliases) a where _liar_norm(a) = _liar_norm(p_text)))
   limit 1
$$;

-- 판에서 완성된 줄 수
create or replace function public._bingo_lines(p_cells text[], p_size int, p_called text[]) returns int
language plpgsql immutable as $$
declare
  n int := 0; ok boolean; i int; j int;
begin
  if p_cells is null or array_length(p_cells, 1) is distinct from p_size * p_size then return 0; end if;
  for i in 0..p_size - 1 loop
    ok := true; for j in 0..p_size - 1 loop if not (_liar_norm(p_cells[i * p_size + j + 1]) = any(p_called)) then ok := false; end if; end loop;
    if ok then n := n + 1; end if;
    ok := true; for j in 0..p_size - 1 loop if not (_liar_norm(p_cells[j * p_size + i + 1]) = any(p_called)) then ok := false; end if; end loop;
    if ok then n := n + 1; end if;
  end loop;
  ok := true; for i in 0..p_size - 1 loop if not (_liar_norm(p_cells[i * p_size + i + 1]) = any(p_called)) then ok := false; end if; end loop;
  if ok then n := n + 1; end if;
  ok := true; for i in 0..p_size - 1 loop if not (_liar_norm(p_cells[i * p_size + (p_size - 1 - i) + 1]) = any(p_called)) then ok := false; end if; end loop;
  if ok then n := n + 1; end if;
  return n;
end $$;

create or replace function public._bingo_called(p_code text) returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(norm), '{}') from bingo_calls where room_code = p_code
$$;

-- 빈 칸을 단어 목록에서 무작위로 채운다
create or replace function public._bingo_autofill(p_code text) returns void
language plpgsql security definer set search_path = public as $$
declare
  g bingo_games; b bingo_boards; pid uuid; cells text[]; custom boolean[]; i int; w text;
begin
  select * into g from bingo_games where room_code = p_code;
  foreach pid in array g.player_ids loop
    select * into b from bingo_boards where room_code = p_code and user_id = pid;
    cells := coalesce(b.cells, '{}'); custom := coalesce(b.custom, '{}');
    for i in 1..g.size * g.size loop
      if coalesce(btrim(cells[i]), '') = '' then
        select word into w from liar_words where category = g.category
          and (g.words is null or word = any(g.words))
          and not (_liar_norm(word) = any(select _liar_norm(x) from unnest(cells) x where x is not null))
          order by random() limit 1;
        cells[i] := w; custom[i] := false;
      end if;
    end loop;
    insert into bingo_boards (room_code, user_id, cells, custom) values (p_code, pid, cells[1:g.size * g.size], custom[1:g.size * g.size])
    on conflict (room_code, user_id) do update set cells = excluded.cells, custom = excluded.custom;
  end loop;
end $$;

-- 부를 수 있는 단어가 남은 다음 사람으로 차례 넘기기
create or replace function public._bingo_next_turn(p_code text, p_from int) returns void
language plpgsql security definer set search_path = public as $$
declare
  g bingo_games; n int; k int; t int; pid uuid; called text[] := _bingo_called(p_code);
begin
  select * into g from bingo_games where room_code = p_code;
  n := array_length(g.player_ids, 1);
  for k in 1..n loop
    t := (p_from + k) % n;
    pid := g.player_ids[t + 1];
    if _liar_active(p_code, pid) and exists (
         select 1 from bingo_boards b, unnest(b.cells) c where b.room_code = p_code and b.user_id = pid and not (_liar_norm(c) = any(called))) then
      update bingo_games set turn_index = t, deadline = now() + make_interval(secs => _bingo_call_secs()), updated_at = now() where room_code = p_code;
      return;
    end if;
  end loop;
  -- 아무도 부를 단어가 없음: 빙고 버튼만 남음
  update bingo_games set deadline = null, updated_at = now() where room_code = p_code;
end $$;

create or replace function public._bingo_begin_call(p_code text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _bingo_autofill(p_code);
  update bingo_games set phase = 'call', ready = '{}', updated_at = now() where room_code = p_code;
  perform _bingo_next_turn(p_code, -1);
end $$;

-- 단어 부르기 (내부): 판에 있고 아직 안 불린 단어
create or replace function public._bingo_do_call(p_code text, p_uid uuid, p_word text, p_auto boolean) returns void
language plpgsql security definer set search_path = public as $$
declare
  g bingo_games; b bingo_boards; nrm text := _liar_norm(p_word); idx int; word text; is_custom boolean; tongs uuid[];
begin
  select * into g from bingo_games where room_code = p_code;
  select * into b from bingo_boards where room_code = p_code and user_id = p_uid;
  select i into idx from generate_subscripts(b.cells, 1) i where _liar_norm(b.cells[i]) = nrm limit 1;
  if idx is null then raise exception 'NOT_ON_BOARD'; end if;
  if nrm = any(_bingo_called(p_code)) then raise exception 'ALREADY_CALLED'; end if;
  word := b.cells[idx]; is_custom := coalesce(b.custom[idx], false);
  if is_custom then
    select coalesce(array_agg(o.user_id), '{}') into tongs from bingo_boards o
     where o.room_code = p_code and o.user_id <> p_uid and exists (select 1 from unnest(o.cells) c where _liar_norm(c) = nrm);
  end if;
  insert into bingo_calls (room_code, round_no, user_id, word, norm, auto, custom, tongs)
  values (p_code, g.round_no, p_uid, word, nrm, p_auto, is_custom, coalesce(tongs, '{}'));
  perform _bingo_next_turn(p_code, g.turn_index);
end $$;

create or replace function public._bingo_lock(p_code text) returns bingo_games
language plpgsql security definer set search_path = public as $$
declare g bingo_games;
begin
  if not is_room_member(p_code) then raise exception 'NOT_MEMBER'; end if;
  select * into g from bingo_games where room_code = p_code for update;
  if not found then raise exception 'NO_GAME'; end if;
  return g;
end $$;

-- ───────────── 공개 함수 (RPC) ─────────────

create or replace function public.bingo_start(p_code text) returns void
language plpgsql security definer set search_path = public as $$
declare
  r rooms; prev bingo_games; players uuid[]; n int; cat text; sz int; ln int; pool text[];
begin
  p_code := upper(p_code);
  r := _require_host(p_code);
  if r.game <> 'bingo' then raise exception 'BAD_GAME'; end if;
  select * into prev from bingo_games where room_code = p_code for update;
  if r.status <> 'waiting' and coalesce(prev.phase, '') <> 'result' then raise exception 'IN_PROGRESS'; end if;

  select array_agg(user_id order by random()) into players from room_players where room_code = p_code and left_at is null;
  n := coalesce(array_length(players, 1), 0);
  if n < 2 then raise exception 'NEED_PLAYERS_2'; end if;
  if n > 8 then raise exception 'ROOM_FULL'; end if;

  cat := r.settings->>'category';
  if cat is null or not exists (select 1 from liar_words where category = cat) then
    select category into cat from (select distinct category from liar_words) c order by random() limit 1;
  end if;
  sz := coalesce((r.settings->>'size')::int, 5); if sz not in (4, 5) then sz := 5; end if;
  ln := coalesce((r.settings->>'lines')::int, case when sz = 4 then 2 else 3 end); if ln not between 1 and 3 then ln := 3; end if;

  if _bingo_pool_size(n) is not null then
    select array_agg(word) into pool from (select word from liar_words where category = cat order by random() limit _bingo_pool_size(n)) x;
  end if;

  delete from bingo_calls where room_code = p_code;
  delete from bingo_boards where room_code = p_code;
  delete from bingo_chats where room_code = p_code;
  insert into bingo_games (room_code, round_no, phase, category, size, lines_to_win, custom_max, player_ids, turn_index, deadline, ready, winner, result, scores, words)
  values (p_code, coalesce(prev.round_no, 0) + 1, 'fill', cat, sz, ln, case when sz = 4 then 3 else 4 end, players, 0,
          now() + make_interval(secs => _bingo_fill_secs()), '{}', null, null, coalesce(prev.scores, '{}'::jsonb), pool)
  on conflict (room_code) do update set
    round_no = excluded.round_no, phase = 'fill', category = excluded.category, size = excluded.size, lines_to_win = excluded.lines_to_win, words = excluded.words,
    custom_max = excluded.custom_max, player_ids = excluded.player_ids, turn_index = 0, deadline = excluded.deadline,
    ready = '{}', winner = null, result = null, updated_at = now();
  update rooms set status = 'playing', last_active_at = now() where code = p_code;
end $$;

-- 내 판 저장 (채우는 중에 수시로). p_ready = true 면 준비 완료. 전원 준비되면 바로 부르기 시작
create or replace function public.bingo_set_board(p_code text, p_cells text[], p_ready boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := _require_uid(); g bingo_games; total int; cells text[] := '{}'; custom boolean[] := '{}';
  i int; t text; canon text; seen text[] := '{}'; ncustom int := 0; rd uuid[];
begin
  p_code := upper(p_code);
  g := _bingo_lock(p_code);
  if g.phase <> 'fill' then raise exception 'WRONG_PHASE'; end if;
  if not (uid = any(g.player_ids)) then raise exception 'NOT_PLAYER'; end if;
  total := g.size * g.size;
  if coalesce(array_length(p_cells, 1), 0) <> total then raise exception 'BAD_BOARD'; end if;
  for i in 1..total loop
    t := btrim(regexp_replace(coalesce(p_cells[i], ''), '\s+', ' ', 'g'));
    if char_length(t) > 10 then raise exception 'BAD_TEXT'; end if;
    if t = '' then cells[i] := ''; custom[i] := false; continue; end if;
    canon := _bingo_canon(g.category, t);
    if canon is not null and g.words is not null and not (canon = any(g.words)) then canon := null; end if; -- 이번 판 목록에 없으면 직접 입력
    if canon is not null then t := canon; custom[i] := false; else custom[i] := true; ncustom := ncustom + 1; end if;
    if _liar_norm(t) = '' then raise exception 'BAD_TEXT'; end if;
    if _liar_norm(t) = any(seen) then raise exception 'DUPLICATE_WORD'; end if;
    seen := seen || _liar_norm(t);
    cells[i] := t;
  end loop;
  if ncustom > g.custom_max then raise exception 'TOO_MANY_CUSTOM'; end if;
  if p_ready and array_length(seen, 1) is distinct from total then raise exception 'BOARD_NOT_FULL'; end if;

  insert into bingo_boards (room_code, user_id, cells, custom) values (p_code, uid, cells, custom)
  on conflict (room_code, user_id) do update set cells = excluded.cells, custom = excluded.custom;

  rd := g.ready;
  if p_ready and not (uid = any(rd)) then rd := rd || uid; end if;
  if not p_ready then rd := array_remove(rd, uid); end if;
  update bingo_games set ready = rd, updated_at = now() where room_code = p_code;

  if (select count(*) from unnest(g.player_ids) pid where _liar_active(p_code, pid) and not (pid = any(rd))) = 0 then
    perform _bingo_begin_call(p_code);
  end if;
end $$;

create or replace function public.bingo_call(p_code text, p_word text) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := _require_uid(); g bingo_games;
begin
  p_code := upper(p_code);
  g := _bingo_lock(p_code);
  if g.phase <> 'call' then raise exception 'WRONG_PHASE'; end if;
  if g.deadline is null or g.player_ids[g.turn_index + 1] <> uid then raise exception 'NOT_YOUR_TURN'; end if;
  perform _bingo_do_call(p_code, uid, p_word, false);
end $$;

-- 빙고! 먼저 누른 사람이 승리 (완성됐을 때만)
create or replace function public.bingo_claim(p_code text) returns void
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := _require_uid(); g bingo_games; called text[]; boards jsonb; sc jsonb;
begin
  p_code := upper(p_code);
  g := _bingo_lock(p_code);
  if g.phase <> 'call' then raise exception 'WRONG_PHASE'; end if;
  if not (uid = any(g.player_ids)) then raise exception 'NOT_PLAYER'; end if;
  called := _bingo_called(p_code);
  if _bingo_lines((select cells from bingo_boards where room_code = p_code and user_id = uid), g.size, called) < g.lines_to_win then
    raise exception 'NOT_BINGO';
  end if;
  select jsonb_object_agg(b.user_id, jsonb_build_object('cells', to_jsonb(b.cells), 'custom', to_jsonb(b.custom),
           'lines', _bingo_lines(b.cells, g.size, called)))
    into boards from bingo_boards b where b.room_code = p_code;
  sc := g.scores || jsonb_build_object(uid::text, coalesce((g.scores->>uid::text)::int, 0) + 1);
  update bingo_games set phase = 'result', deadline = null, winner = uid, scores = sc, updated_at = now(),
    result = jsonb_build_object('boards', boards, 'calls', (select count(*) from bingo_calls where room_code = p_code))
  where room_code = p_code;
end $$;

create or replace function public.bingo_tick(p_code text) returns void
language plpgsql security definer set search_path = public as $$
declare g bingo_games; pid uuid; w text; called text[];
begin
  p_code := upper(p_code);
  g := _bingo_lock(p_code);
  if g.deadline is null or now() < g.deadline then return; end if;
  if g.phase = 'fill' then
    perform _bingo_begin_call(p_code);
  elsif g.phase = 'call' then
    pid := g.player_ids[g.turn_index + 1];
    called := _bingo_called(p_code);
    select c into w from bingo_boards b, unnest(b.cells) c
     where b.room_code = p_code and b.user_id = pid and not (_liar_norm(c) = any(called)) order by random() limit 1;
    if w is null then perform _bingo_next_turn(p_code, g.turn_index);
    else perform _bingo_do_call(p_code, pid, w, true); end if;
  end if;
end $$;

create or replace function public.bingo_state(p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := _require_uid(); g bingo_games; mine bingo_boards;
begin
  p_code := upper(p_code);
  if not is_room_member(p_code) then raise exception 'NOT_MEMBER'; end if;
  select * into g from bingo_games where room_code = p_code;
  if not found then return null; end if;
  select * into mine from bingo_boards where room_code = p_code and user_id = uid;
  return jsonb_build_object(
    'roundNo', g.round_no, 'phase', g.phase, 'category', g.category, 'size', g.size, 'linesToWin', g.lines_to_win,
    'customMax', g.custom_max, 'playerIds', to_jsonb(g.player_ids), 'turnIndex', g.turn_index,
    'deadline', g.deadline, 'now', now(), 'ready', to_jsonb(g.ready), 'winner', g.winner, 'result', g.result, 'scores', g.scores,
    'inGame', uid = any(g.player_ids),
    'words', (select coalesce(jsonb_agg(word order by id), '[]'::jsonb) from liar_words where category = g.category and (g.words is null or word = any(g.words))),
    'myCells', to_jsonb(coalesce(mine.cells, '{}')), 'myCustom', to_jsonb(coalesce(mine.custom, '{}')),
    'calls', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'userId', c.user_id, 'word', c.word, 'auto', c.auto,
                'custom', c.custom, 'tongs', to_jsonb(c.tongs), 'at', c.created_at) order by c.id), '[]'::jsonb)
                from bingo_calls c where c.room_code = p_code),
    'chats', (select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'userId', m.user_id, 'body', m.body, 'at', m.created_at) order by m.id), '[]'::jsonb)
                from (select * from bingo_chats where room_code = p_code order by id desc limit 150) m),
    'people', (select coalesce(jsonb_object_agg(user_id, jsonb_build_object('nickname', nickname, 'color', color)), '{}'::jsonb)
                 from room_players where room_code = p_code));
end $$;

-- 게임 중 대화 (어느 단계에서나)
create or replace function public.bingo_chat(p_code text, p_text text) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := _require_uid(); t text := btrim(coalesce(p_text, ''));
begin
  p_code := upper(p_code);
  if not is_room_member(p_code) then raise exception 'NOT_MEMBER'; end if;
  if not exists (select 1 from bingo_games where room_code = p_code) then raise exception 'NO_GAME'; end if;
  if char_length(t) < 1 or char_length(t) > 200 then raise exception 'BAD_TEXT'; end if;
  insert into bingo_chats (room_code, user_id, body) values (p_code, uid, t);
end $$;

create or replace function public.bingo_to_waiting(p_code text) returns void
language plpgsql security definer set search_path = public as $$
declare r rooms; g bingo_games;
begin
  p_code := upper(p_code);
  r := _require_host(p_code);
  select * into g from bingo_games where room_code = p_code;
  if found and g.phase <> 'result' then raise exception 'IN_PROGRESS'; end if;
  update rooms set status = 'waiting', last_active_at = now() where code = p_code;
end $$;

-- ───────────── 권한 ─────────────
do $$
declare f text;
begin
  foreach f in array array['_bingo_canon(text, text)', '_bingo_called(text)', '_bingo_autofill(text)', '_bingo_next_turn(text, int)',
    '_bingo_begin_call(text)', '_bingo_do_call(text, uuid, text, boolean)', '_bingo_lock(text)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
  foreach f in array array['bingo_start(text)', 'bingo_set_board(text, text[], boolean)', 'bingo_call(text, text)',
    'bingo_claim(text)', 'bingo_tick(text)', 'bingo_state(text)', 'bingo_to_waiting(text)', 'bingo_chat(text, text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;


-- ════════ 0004_bell.sql ════════
-- 월루: 5건 승인 (카드 뒤집고 같은 아이콘 합계 5면 먼저 승인)
-- 0001~0003 다음에 실행. 여러 번 실행해도 안전하다.
-- 2~4명. 덱 내용은 서버만 알고, 펼친 카드 맨 위만 모두에게 보인다.

-- 게임별 최대 인원 (5건 승인은 4명)
create or replace function public._max_players_for(p_game text) returns int language sql immutable as $$
  select case when p_game = 'bell' then 4 else 8 end
$$;

-- 방 만들기·조회·입장: 새 게임 허용, 게임별 최대 인원
create or replace function public.create_room(p_game text) returns text
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := _require_uid();
  chars text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  c text;
  i int;
begin
  if p_game not in ('liar', 'bingo', 'bell') then raise exception 'BAD_GAME'; end if;

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
            when 'bell' then jsonb_build_object('limitMin', 10)
            else jsonb_build_object('category', 'random', 'hintRounds', 2, 'hintSeconds', 30, 'discussSeconds', 90)
          end);
  insert into room_secrets (code) values (c);
  return c;
end $$;

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
      'playerCount', cnt, 'maxPlayers', _max_players_for(r.game),
      'hasEntryCode', r.has_entry_code and r.host_id <> uid,
      'isHost', r.host_id = uid, 'member', false);
  end if;

  return jsonb_build_object(
    'code', r.code, 'game', r.game, 'status', r.status, 'settings', r.settings,
    'hostId', r.host_id, 'hasEntryCode', r.has_entry_code,
    'entryCode', case when r.host_id = uid then (select entry_code from room_secrets where code = p_code) end,
    'maxPlayers', _max_players_for(r.game), 'member', true, 'me', uid,
    'players', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', p.user_id, 'nickname', p.nickname, 'color', p.color,
               'online', p.last_seen_at >= now() - make_interval(secs => _online_secs()))
             order by p.joined_at)
        from room_players p where p.room_code = p_code and p.left_at is null), '[]'::jsonb));
end $$;

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
  if (select count(*) from room_players where room_code = p_code and left_at is null) >= _max_players_for(r.game) then
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

-- 방 설정: 5건 승인 제한 시간 추가
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
  -- 5건 승인
  if (p_settings->>'limitMin')       in ('0','5','10','15')  then s := s || jsonb_build_object('limitMin',       (p_settings->>'limitMin')::int); end if;
  update rooms set settings = s, last_active_at = now() where code = r.code;
end $$;

-- ───────────── 게임 데이터 ─────────────
-- 카드 = 종류*10 + 개수 (종류 0 인원 · 1 실적 · 2 아이디어 · 3 목표, 개수 1~5)
-- 종류마다 1×5장 2×3장 3×3장 4×2장 5×1장 = 14장, 모두 56장

create table if not exists public.bell_games (
  room_code    text primary key references public.rooms(code) on delete cascade,
  round_no     int not null default 0,
  phase        text not null,               -- play | result
  player_ids   uuid[] not null,             -- 차례 순서
  turn_index   int not null default 0,
  deadline     timestamptz,                 -- 지금 차례 마감 (5초)
  ends_at      timestamptz,                 -- 판 전체 제한 시간 (null = 없음)
  version      int not null default 0,      -- 카드가 바뀔 때마다 +1 (늦은 승인 구분)
  won          jsonb not null default '{}'::jsonb,   -- 사람별 획득 장수
  rings        jsonb not null default '{}'::jsonb,   -- 사람별 {ok, bad}
  last         jsonb,                       -- 마지막 사건 (flip / ring)
  winner       uuid,
  result       jsonb,
  scores       jsonb not null default '{}'::jsonb,
  updated_at   timestamptz not null default now()
);

-- 덱·펼친 더미 (클라이언트가 직접 못 읽음: 다음 카드가 새지 않게)
create table if not exists public.bell_hands (
  room_code  text not null references public.rooms(code) on delete cascade,
  user_id    uuid not null,
  deck       int[] not null default '{}',   -- [1] = 맨 위
  face       int[] not null default '{}',   -- 마지막 = 맨 위 (보이는 카드)
  primary key (room_code, user_id)
);

create table if not exists public.bell_chats (
  id          bigserial primary key,
  room_code   text not null references public.rooms(code) on delete cascade,
  user_id     uuid,                          -- null = 진행 알림
  body        text not null,
  created_at  timestamptz not null default now()
);
create index if not exists bell_chats_room on public.bell_chats (room_code, id);

alter table public.bell_games enable row level security;
alter table public.bell_hands enable row level security;
alter table public.bell_chats enable row level security;
drop policy if exists bell_games_read on public.bell_games;
create policy bell_games_read on public.bell_games for select to authenticated using (public.is_room_member(room_code));
drop policy if exists bell_chats_read on public.bell_chats;
create policy bell_chats_read on public.bell_chats for select to authenticated using (public.is_room_member(room_code));

alter table public.bell_games replica identity full;
alter table public.bell_chats replica identity full;
do $$ begin
  begin alter publication supabase_realtime add table public.bell_games; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.bell_chats; exception when duplicate_object then null; end;
end $$;

create or replace function public._bell_turn_secs() returns int language sql immutable as $$ select 5 $$;
create or replace function public._bell_kind_name(k int) returns text language sql immutable as $$
  select (array['인원', '실적', '아이디어', '목표'])[k + 1]
$$;

-- ───────────── 내부 도우미 ─────────────

create or replace function public._bell_lock(p_code text) returns bell_games
language plpgsql security definer set search_path = public as $$
declare g bell_games;
begin
  if not is_room_member(p_code) then raise exception 'NOT_MEMBER'; end if;
  select * into g from bell_games where room_code = p_code for update;
  if not found then raise exception 'NO_GAME'; end if;
  return g;
end $$;

create or replace function public._bell_name(p_code text, p_uid uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select nickname from room_players where room_code = p_code and user_id = p_uid), '?')
$$;

create or replace function public._bell_sys(p_code text, p_body text) returns void
language sql security definer set search_path = public as $$
  insert into bell_chats (room_code, user_id, body) values (p_code, null, p_body)
$$;

-- 아직 게임에 남아 있는 사람 (방에 있고 카드가 있음)
create or replace function public._bell_alive(p_code text, p_uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select _liar_active(p_code, p_uid) and exists (
    select 1 from bell_hands h where h.room_code = p_code and h.user_id = p_uid
       and coalesce(array_length(h.deck, 1), 0) + coalesce(array_length(h.face, 1), 0) > 0)
$$;

-- 판 끝내기: 덱 + 펼친 카드가 가장 많은 사람이 승리
create or replace function public._bell_finish(p_code text, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare g bell_games; w uuid; res jsonb; sc jsonb;
begin
  select * into g from bell_games where room_code = p_code;
  if g.phase <> 'play' then return; end if;
  select jsonb_object_agg(h.user_id, jsonb_build_object(
           'cards', coalesce(array_length(h.deck, 1), 0) + coalesce(array_length(h.face, 1), 0),
           'won', coalesce((g.won->>h.user_id::text)::int, 0),
           'ok', coalesce((g.rings->h.user_id::text->>'ok')::int, 0),
           'bad', coalesce((g.rings->h.user_id::text->>'bad')::int, 0)))
    into res from bell_hands h where h.room_code = p_code and h.user_id = any(g.player_ids);
  select h.user_id into w from bell_hands h where h.room_code = p_code and h.user_id = any(g.player_ids) and _liar_active(p_code, h.user_id)
   order by coalesce(array_length(h.deck, 1), 0) + coalesce(array_length(h.face, 1), 0) desc,
            coalesce((g.won->>h.user_id::text)::int, 0) desc limit 1;
  sc := g.scores;
  if w is not null then sc := sc || jsonb_build_object(w::text, coalesce((g.scores->>w::text)::int, 0) + 1); end if;
  update bell_games set phase = 'result', deadline = null, winner = w, scores = sc, updated_at = now(),
    result = jsonb_build_object('players', res, 'reason', p_reason, 'endedAt', now())
  where room_code = p_code;
  perform _bell_sys(p_code, '판이 끝났어요 · ' || case when w is null then '승자 없음' else _bell_name(p_code, w) || ' 님 승리' end);
end $$;

-- 끝날 조건: 카드가 남은 사람이 1명 이하이거나, 덱이 남은 사람이 없거나, 제한 시간 지남
create or replace function public._bell_check_end(p_code text) returns boolean
language plpgsql security definer set search_path = public as $$
declare g bell_games; alive int; decks int;
begin
  select * into g from bell_games where room_code = p_code;
  if g.phase <> 'play' then return true; end if;
  select count(*) into alive from unnest(g.player_ids) pid where _bell_alive(p_code, pid);
  select count(*) into decks from bell_hands h where h.room_code = p_code and h.user_id = any(g.player_ids)
     and _liar_active(p_code, h.user_id) and coalesce(array_length(h.deck, 1), 0) > 0;
  if alive <= 1 then perform _bell_finish(p_code, 'last'); return true; end if;
  if decks = 0 then perform _bell_finish(p_code, 'nodeck'); return true; end if;
  if g.ends_at is not null and now() >= g.ends_at then perform _bell_finish(p_code, 'time'); return true; end if;
  return false;
end $$;

-- p_from 다음부터 덱이 남은 사람에게 차례 (p_self = true 면 p_from 본인부터)
create or replace function public._bell_next_turn(p_code text, p_from int, p_self boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare g bell_games; n int; k int; t int; pid uuid;
begin
  if _bell_check_end(p_code) then return; end if;
  select * into g from bell_games where room_code = p_code;
  n := array_length(g.player_ids, 1);
  for k in (case when p_self then 0 else 1 end)..n loop
    t := ((p_from + k) % n + n) % n;
    pid := g.player_ids[t + 1];
    if _liar_active(p_code, pid) and exists (select 1 from bell_hands h where h.room_code = p_code and h.user_id = pid and coalesce(array_length(h.deck, 1), 0) > 0) then
      update bell_games set turn_index = t, deadline = now() + make_interval(secs => _bell_turn_secs()), updated_at = now() where room_code = p_code;
      return;
    end if;
  end loop;
  perform _bell_finish(p_code, 'nodeck');
end $$;

create or replace function public._bell_do_flip(p_code text, p_uid uuid, p_auto boolean) returns void
language plpgsql security definer set search_path = public as $$
declare g bell_games; h bell_hands; c int;
begin
  select * into g from bell_games where room_code = p_code;
  select * into h from bell_hands where room_code = p_code and user_id = p_uid for update;
  if coalesce(array_length(h.deck, 1), 0) = 0 then perform _bell_next_turn(p_code, g.turn_index); return; end if;
  c := h.deck[1];
  update bell_hands set deck = h.deck[2:], face = h.face || c where room_code = p_code and user_id = p_uid;
  update bell_games set version = version + 1, updated_at = now(),
    last = jsonb_build_object('type', 'flip', 'by', p_uid, 'card', c, 'auto', p_auto, 'at', now())
  where room_code = p_code;
  perform _bell_next_turn(p_code, g.turn_index);
end $$;

-- ───────────── 공개 함수 (RPC) ─────────────

create or replace function public.bell_start(p_code text) returns void
language plpgsql security definer set search_path = public as $$
declare
  r rooms; prev bell_games; players uuid[]; n int; cards int[] := '{}'; k int; c int; per int; i int; lim int;
  counts int[] := array[1,1,1,1,1,2,2,2,3,3,3,4,4,5];
begin
  p_code := upper(p_code);
  r := _require_host(p_code);
  if r.game <> 'bell' then raise exception 'BAD_GAME'; end if;
  select * into prev from bell_games where room_code = p_code for update;
  if r.status <> 'waiting' and coalesce(prev.phase, '') <> 'result' then raise exception 'IN_PROGRESS'; end if;

  select array_agg(user_id order by random()) into players from room_players where room_code = p_code and left_at is null;
  n := coalesce(array_length(players, 1), 0);
  if n < 2 then raise exception 'NEED_PLAYERS_2'; end if;
  if n > 4 then raise exception 'MAX_PLAYERS_4'; end if;

  for k in 0..3 loop foreach c in array counts loop cards := cards || (k * 10 + c); end loop; end loop;
  select array_agg(x order by random()) into cards from unnest(cards) x;
  per := 56 / n;

  delete from bell_hands where room_code = p_code;
  delete from bell_chats where room_code = p_code;
  for i in 1..n loop
    insert into bell_hands (room_code, user_id, deck, face) values (p_code, players[i], cards[(i - 1) * per + 1 : i * per], '{}');
  end loop;

  lim := coalesce((r.settings->>'limitMin')::int, 10);
  if lim not in (0, 5, 10, 15) then lim := 10; end if;

  insert into bell_games (room_code, round_no, phase, player_ids, turn_index, deadline, ends_at, version, won, rings, last, winner, result, scores)
  values (p_code, coalesce(prev.round_no, 0) + 1, 'play', players, 0, now() + make_interval(secs => _bell_turn_secs() + 2),
          case when lim > 0 then now() + make_interval(mins => lim) end, 0, '{}', '{}', null, null, null, coalesce(prev.scores, '{}'::jsonb))
  on conflict (room_code) do update set
    round_no = excluded.round_no, phase = 'play', player_ids = excluded.player_ids, turn_index = 0, deadline = excluded.deadline,
    ends_at = excluded.ends_at, version = 0, won = '{}', rings = '{}', last = null, winner = null, result = null, updated_at = now();
  update rooms set status = 'playing', last_active_at = now() where code = p_code;
  perform _bell_sys(p_code, '시작! 1인당 ' || per || '장 · 첫 차례 ' || _bell_name(p_code, players[1]) || ' 님');
end $$;

-- 내 차례에 덱 맨 위 카드 뒤집기
create or replace function public.bell_flip(p_code text) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := _require_uid(); g bell_games;
begin
  p_code := upper(p_code);
  g := _bell_lock(p_code);
  if g.phase <> 'play' then raise exception 'WRONG_PHASE'; end if;
  if g.deadline is null or g.player_ids[g.turn_index + 1] <> uid then raise exception 'NOT_YOUR_TURN'; end if;
  perform _bell_do_flip(p_code, uid, false);
end $$;

-- 승인(벨). p_seen = 누를 때 내가 보던 version. 그 사이 카드가 바뀌었으면 벌칙 없이 무시
create or replace function public.bell_ring(p_code text, p_seen int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := _require_uid(); g bell_games; h bell_hands; sums int[] := array[0,0,0,0]; k int; hit int := null;
  pile int[] := '{}'; mine bell_hands; given int := 0; pid uuid; rg jsonb; rk text;
begin
  p_code := upper(p_code);
  g := _bell_lock(p_code);
  if g.phase <> 'play' then raise exception 'WRONG_PHASE'; end if;
  if not (uid = any(g.player_ids)) then raise exception 'NOT_PLAYER'; end if;
  if not _bell_alive(p_code, uid) then raise exception 'OUT'; end if;
  if g.version <> p_seen then return jsonb_build_object('late', true); end if;

  for h in select * from bell_hands where room_code = p_code and user_id = any(g.player_ids) loop
    if coalesce(array_length(h.face, 1), 0) > 0 then
      k := h.face[array_length(h.face, 1)] / 10;
      sums[k + 1] := sums[k + 1] + h.face[array_length(h.face, 1)] % 10;
    end if;
  end loop;
  for k in 0..3 loop if sums[k + 1] = 5 then hit := k; end if; end loop;

  rk := uid::text;
  rg := coalesce(g.rings->rk, '{"ok":0,"bad":0}'::jsonb);
  if hit is not null then
    -- 맞음: 모두의 펼친 카드를 내 덱 아래로
    for h in select * from bell_hands where room_code = p_code and user_id = any(g.player_ids) order by user_id loop
      pile := pile || h.face;
    end loop;
    select array_agg(x order by random()) into pile from unnest(pile) x;
    update bell_hands set face = '{}' where room_code = p_code;
    update bell_hands set deck = deck || coalesce(pile, '{}') where room_code = p_code and user_id = uid;
    rg := jsonb_set(rg, '{ok}', to_jsonb((rg->>'ok')::int + 1));
    update bell_games set version = version + 1, updated_at = now(),
      won = won || jsonb_build_object(rk, coalesce((won->>rk)::int, 0) + coalesce(array_length(pile, 1), 0)),
      rings = rings || jsonb_build_object(rk, rg),
      last = jsonb_build_object('type', 'ring', 'ok', true, 'by', uid, 'kind', hit, 'gained', coalesce(array_length(pile, 1), 0), 'at', now())
    where room_code = p_code;
    perform _bell_sys(p_code, _bell_name(p_code, uid) || ' 님 승인 · ' || _bell_kind_name(hit) || ' 5 · +' || coalesce(array_length(pile, 1), 0) || '장');
    -- 승인한 사람부터 다시 (덱이 없으면 다음 사람)
    perform _bell_next_turn(p_code, array_position(g.player_ids, uid) - 1, true);
  else
    -- 틀림: 내 덱에서 다른 사람들에게 1장씩
    foreach pid in array g.player_ids loop
      if pid <> uid and _bell_alive(p_code, pid) then
        select * into mine from bell_hands where room_code = p_code and user_id = uid;
        exit when coalesce(array_length(mine.deck, 1), 0) = 0;
        update bell_hands set deck = mine.deck[2:] where room_code = p_code and user_id = uid;
        update bell_hands set deck = deck || mine.deck[1] where room_code = p_code and user_id = pid;
        given := given + 1;
      end if;
    end loop;
    rg := jsonb_set(rg, '{bad}', to_jsonb((rg->>'bad')::int + 1));
    update bell_games set version = version + 1, updated_at = now(), rings = rings || jsonb_build_object(rk, rg),
      last = jsonb_build_object('type', 'ring', 'ok', false, 'by', uid, 'given', given, 'at', now())
    where room_code = p_code;
    perform _bell_sys(p_code, _bell_name(p_code, uid) || ' 님 반려 · ' || given || '장 지급');
    perform _bell_check_end(p_code);
  end if;
  return jsonb_build_object('late', false, 'ok', hit is not null);
end $$;

-- 마감 처리: 차례 시간이 지나면 자동으로 뒤집기, 판 시간이 지나면 끝
create or replace function public.bell_tick(p_code text) returns void
language plpgsql security definer set search_path = public as $$
declare g bell_games;
begin
  p_code := upper(p_code);
  g := _bell_lock(p_code);
  if g.phase <> 'play' then return; end if;
  if _bell_check_end(p_code) then return; end if;
  if g.deadline is not null and now() >= g.deadline then
    if _liar_active(p_code, g.player_ids[g.turn_index + 1]) then
      perform _bell_do_flip(p_code, g.player_ids[g.turn_index + 1], true);
    else
      perform _bell_next_turn(p_code, g.turn_index);
    end if;
  end if;
end $$;

create or replace function public.bell_state(p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := _require_uid(); g bell_games;
begin
  p_code := upper(p_code);
  if not is_room_member(p_code) then raise exception 'NOT_MEMBER'; end if;
  select * into g from bell_games where room_code = p_code;
  if not found then return null; end if;
  return jsonb_build_object(
    'roundNo', g.round_no, 'phase', g.phase, 'playerIds', to_jsonb(g.player_ids), 'turnIndex', g.turn_index,
    'deadline', g.deadline, 'endsAt', g.ends_at, 'now', now(), 'version', g.version, 'last', g.last,
    'winner', g.winner, 'result', g.result, 'scores', g.scores, 'inGame', uid = any(g.player_ids),
    'hands', (select coalesce(jsonb_object_agg(h.user_id, jsonb_build_object(
                'deck', coalesce(array_length(h.deck, 1), 0), 'face', coalesce(array_length(h.face, 1), 0),
                'top', case when coalesce(array_length(h.face, 1), 0) > 0 then h.face[array_length(h.face, 1)] end,
                'won', coalesce((g.won->>h.user_id::text)::int, 0),
                'ok', coalesce((g.rings->h.user_id::text->>'ok')::int, 0),
                'bad', coalesce((g.rings->h.user_id::text->>'bad')::int, 0))), '{}'::jsonb)
              from bell_hands h where h.room_code = p_code),
    'chats', (select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'userId', m.user_id, 'body', m.body, 'at', m.created_at) order by m.id), '[]'::jsonb)
                from (select * from bell_chats where room_code = p_code order by id desc limit 120) m),
    'people', (select coalesce(jsonb_object_agg(user_id, jsonb_build_object('nickname', nickname, 'color', color)), '{}'::jsonb)
                 from room_players where room_code = p_code));
end $$;

create or replace function public.bell_chat(p_code text, p_text text) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := _require_uid(); t text := btrim(coalesce(p_text, ''));
begin
  p_code := upper(p_code);
  if not is_room_member(p_code) then raise exception 'NOT_MEMBER'; end if;
  if not exists (select 1 from bell_games where room_code = p_code) then raise exception 'NO_GAME'; end if;
  if char_length(t) < 1 or char_length(t) > 200 then raise exception 'BAD_TEXT'; end if;
  insert into bell_chats (room_code, user_id, body) values (p_code, uid, t);
end $$;

create or replace function public.bell_to_waiting(p_code text) returns void
language plpgsql security definer set search_path = public as $$
declare r rooms; g bell_games;
begin
  p_code := upper(p_code);
  r := _require_host(p_code);
  select * into g from bell_games where room_code = p_code;
  if found and g.phase <> 'result' then raise exception 'IN_PROGRESS'; end if;
  update rooms set status = 'waiting', last_active_at = now() where code = p_code;
end $$;

-- ───────────── 권한 ─────────────
do $$
declare f text;
begin
  foreach f in array array['_bell_lock(text)', '_bell_name(text, uuid)', '_bell_sys(text, text)', '_bell_alive(text, uuid)',
    '_bell_finish(text, text)', '_bell_check_end(text)', '_bell_next_turn(text, int, boolean)', '_bell_do_flip(text, uuid, boolean)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
  foreach f in array array['bell_start(text)', 'bell_flip(text)', 'bell_ring(text, int)', 'bell_tick(text)', 'bell_state(text)',
    'bell_chat(text, text)', 'bell_to_waiting(text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;


-- ════════ 0005_bell_fair.sql ════════
-- 월루: 할리갈리 공정성 (2026-11-16)
-- 1) 뒤집은 카드는 0.7초 뒤 모두에게 동시에 공개 (뒤집은 사람만 먼저 보는 문제). 공개 전 승인은 벌칙 없이 무시
-- 2) 승인 성공 시 맞힌 카드(tops)를 2.5초 보여주고 다음 차례 시작
alter table public.bell_games add column if not exists hold_until timestamptz;

create or replace function public._bell_reveal_ms() returns int language sql immutable as $$ select 700 $$;
create or replace function public._bell_pause_ms() returns int language sql immutable as $$ select 2500 $$;

create or replace function public._bell_do_flip(p_code text, p_uid uuid, p_auto boolean) returns void
language plpgsql security definer set search_path = public as $$
declare g bell_games; h bell_hands; c int; prev int; ru timestamptz := now() + make_interval(secs => _bell_reveal_ms() / 1000.0);
begin
  select * into g from bell_games where room_code = p_code;
  select * into h from bell_hands where room_code = p_code and user_id = p_uid for update;
  if coalesce(array_length(h.deck, 1), 0) = 0 then perform _bell_next_turn(p_code, g.turn_index); return; end if;
  c := h.deck[1];
  if coalesce(array_length(h.face, 1), 0) > 0 then prev := h.face[array_length(h.face, 1)]; end if;
  update bell_hands set deck = h.deck[2:], face = h.face || c where room_code = p_code and user_id = p_uid;
  update bell_games set version = version + 1, updated_at = now(),
    last = jsonb_build_object('type', 'flip', 'by', p_uid, 'card', c, 'prev', prev, 'auto', p_auto, 'at', now(), 'until', ru), hold_until = ru
  where room_code = p_code;
  perform _bell_next_turn(p_code, g.turn_index);
  -- 다음 차례 5초는 카드가 모두에게 공개된 뒤부터
  update bell_games set deadline = deadline + make_interval(secs => _bell_reveal_ms() / 1000.0)
   where room_code = p_code and phase = 'play' and deadline is not null;
end $$;

create or replace function public.bell_flip(p_code text) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := _require_uid(); g bell_games;
begin
  p_code := upper(p_code);
  g := _bell_lock(p_code);
  if g.phase <> 'play' then raise exception 'WRONG_PHASE'; end if;
  if g.deadline is null or g.player_ids[g.turn_index + 1] <> uid then raise exception 'NOT_YOUR_TURN'; end if;
  if g.hold_until is not null and now() < g.hold_until then return; end if; -- 공개·멈춤 중엔 무시
  perform _bell_do_flip(p_code, uid, false);
end $$;

create or replace function public.bell_ring(p_code text, p_seen int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := _require_uid(); g bell_games; h bell_hands; sums int[] := array[0,0,0,0]; k int; hit int := null;
  pile int[] := '{}'; tops jsonb := '{}'; ru timestamptz := now() + make_interval(secs => _bell_pause_ms() / 1000.0); mine bell_hands; given int := 0; pid uuid; rg jsonb; rk text;
begin
  p_code := upper(p_code);
  g := _bell_lock(p_code);
  if g.phase <> 'play' then raise exception 'WRONG_PHASE'; end if;
  if not (uid = any(g.player_ids)) then raise exception 'NOT_PLAYER'; end if;
  if not _bell_alive(p_code, uid) then raise exception 'OUT'; end if;
  if g.version <> p_seen then return jsonb_build_object('late', true); end if;
  if g.hold_until is not null and now() < g.hold_until then return jsonb_build_object('late', true); end if; -- 아직 공개 전

  for h in select * from bell_hands where room_code = p_code and user_id = any(g.player_ids) loop
    if coalesce(array_length(h.face, 1), 0) > 0 then
      tops := tops || jsonb_build_object(h.user_id::text, h.face[array_length(h.face, 1)]);
      k := h.face[array_length(h.face, 1)] / 10;
      sums[k + 1] := sums[k + 1] + h.face[array_length(h.face, 1)] % 10;
    end if;
  end loop;
  for k in 0..3 loop if sums[k + 1] = 5 then hit := k; end if; end loop;

  rk := uid::text;
  rg := coalesce(g.rings->rk, '{"ok":0,"bad":0}'::jsonb);
  if hit is not null then
    -- 맞음: 모두의 펼친 카드를 내 덱 아래로
    for h in select * from bell_hands where room_code = p_code and user_id = any(g.player_ids) order by user_id loop
      pile := pile || h.face;
    end loop;
    select array_agg(x order by random()) into pile from unnest(pile) x;
    update bell_hands set face = '{}' where room_code = p_code;
    update bell_hands set deck = deck || coalesce(pile, '{}') where room_code = p_code and user_id = uid;
    rg := jsonb_set(rg, '{ok}', to_jsonb((rg->>'ok')::int + 1));
    update bell_games set version = version + 1, updated_at = now(),
      won = won || jsonb_build_object(rk, coalesce((won->>rk)::int, 0) + coalesce(array_length(pile, 1), 0)),
      rings = rings || jsonb_build_object(rk, rg),
      last = jsonb_build_object('type', 'ring', 'ok', true, 'by', uid, 'kind', hit, 'gained', coalesce(array_length(pile, 1), 0), 'at', now(), 'tops', tops, 'until', ru), hold_until = ru
    where room_code = p_code;
    perform _bell_sys(p_code, _bell_name(p_code, uid) || ' 님 승인 · ' || _bell_kind_name(hit) || ' 5 · +' || coalesce(array_length(pile, 1), 0) || '장');
    -- 승인한 사람부터 다시 (덱이 없으면 다음 사람)
    perform _bell_next_turn(p_code, array_position(g.player_ids, uid) - 1, true);
    -- 맞힌 카드를 모두가 볼 수 있게 잠깐 멈춤
    update bell_games set deadline = deadline + make_interval(secs => _bell_pause_ms() / 1000.0)
     where room_code = p_code and phase = 'play' and deadline is not null;
  else
    -- 틀림: 내 덱에서 다른 사람들에게 1장씩
    foreach pid in array g.player_ids loop
      if pid <> uid and _bell_alive(p_code, pid) then
        select * into mine from bell_hands where room_code = p_code and user_id = uid;
        exit when coalesce(array_length(mine.deck, 1), 0) = 0;
        update bell_hands set deck = mine.deck[2:] where room_code = p_code and user_id = uid;
        update bell_hands set deck = deck || mine.deck[1] where room_code = p_code and user_id = pid;
        given := given + 1;
      end if;
    end loop;
    rg := jsonb_set(rg, '{bad}', to_jsonb((rg->>'bad')::int + 1));
    update bell_games set version = version + 1, updated_at = now(), rings = rings || jsonb_build_object(rk, rg),
      last = jsonb_build_object('type', 'ring', 'ok', false, 'by', uid, 'given', given, 'at', now())
    where room_code = p_code;
    perform _bell_sys(p_code, _bell_name(p_code, uid) || ' 님 반려 · ' || given || '장 지급');
    perform _bell_check_end(p_code);
  end if;
  return jsonb_build_object('late', false, 'ok', hit is not null);
end $$;


-- ════════ 0006_bell_3min.sql ════════
-- 월루: 할리갈리 제한 시간에 3분 추가 (2026-11-17)

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
  -- 5건 승인
  if (p_settings->>'limitMin')       in ('0','3','5','10','15')  then s := s || jsonb_build_object('limitMin',       (p_settings->>'limitMin')::int); end if;
  update rooms set settings = s, last_active_at = now() where code = r.code;
end $$;

create or replace function public.bell_start(p_code text) returns void
language plpgsql security definer set search_path = public as $$
declare
  r rooms; prev bell_games; players uuid[]; n int; cards int[] := '{}'; k int; c int; per int; i int; lim int;
  counts int[] := array[1,1,1,1,1,2,2,2,3,3,3,4,4,5];
begin
  p_code := upper(p_code);
  r := _require_host(p_code);
  if r.game <> 'bell' then raise exception 'BAD_GAME'; end if;
  select * into prev from bell_games where room_code = p_code for update;
  if r.status <> 'waiting' and coalesce(prev.phase, '') <> 'result' then raise exception 'IN_PROGRESS'; end if;

  select array_agg(user_id order by random()) into players from room_players where room_code = p_code and left_at is null;
  n := coalesce(array_length(players, 1), 0);
  if n < 2 then raise exception 'NEED_PLAYERS_2'; end if;
  if n > 4 then raise exception 'MAX_PLAYERS_4'; end if;

  for k in 0..3 loop foreach c in array counts loop cards := cards || (k * 10 + c); end loop; end loop;
  select array_agg(x order by random()) into cards from unnest(cards) x;
  per := 56 / n;

  delete from bell_hands where room_code = p_code;
  delete from bell_chats where room_code = p_code;
  for i in 1..n loop
    insert into bell_hands (room_code, user_id, deck, face) values (p_code, players[i], cards[(i - 1) * per + 1 : i * per], '{}');
  end loop;

  lim := coalesce((r.settings->>'limitMin')::int, 10);
  if lim not in (0, 3, 5, 10, 15) then lim := 10; end if;

  insert into bell_games (room_code, round_no, phase, player_ids, turn_index, deadline, ends_at, version, won, rings, last, winner, result, scores)
  values (p_code, coalesce(prev.round_no, 0) + 1, 'play', players, 0, now() + make_interval(secs => _bell_turn_secs() + 2),
          case when lim > 0 then now() + make_interval(mins => lim) end, 0, '{}', '{}', null, null, null, coalesce(prev.scores, '{}'::jsonb))
  on conflict (room_code) do update set
    round_no = excluded.round_no, phase = 'play', player_ids = excluded.player_ids, turn_index = 0, deadline = excluded.deadline,
    ends_at = excluded.ends_at, version = 0, won = '{}', rings = '{}', last = null, winner = null, result = null, updated_at = now();
  update rooms set status = 'playing', last_active_at = now() where code = p_code;
  perform _bell_sys(p_code, '시작! 1인당 ' || per || '장 · 첫 차례 ' || _bell_name(p_code, players[1]) || ' 님');
end $$;


-- ════════ 0007_puzzle_records.sql ════════
-- 월루: 퍼즐 전사 기록 (스도쿠·지뢰찾기, 난이도별 TOP 5) (2026-11-17)
-- 한 사람(익명 로그인 id) 한 줄 = 그 난이도 최고 기록. 이름이 없으면 순위표에 안 보임(hidden)

create table if not exists public.puzzle_records (
  game       text not null,
  level      text not null,
  user_id    uuid not null,
  nickname   text,
  ms         int  not null,
  hidden     boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (game, level, user_id)
);
create index if not exists puzzle_records_rank on public.puzzle_records (game, level, ms, created_at);
alter table public.puzzle_records enable row level security; -- 읽기 정책 없음 = RPC로만

-- 너무 빠른 기록은 거절 (밀리초)
create or replace function public._puzzle_min_ms(p_game text, p_level text) returns int language sql immutable as $$
  select case p_game
    when 'sudoku' then case p_level when 'easy' then 15000 when 'normal' then 20000 else 30000 end
    when 'mines'  then case p_level when 'easy' then 1000  when 'normal' then 5000  else 15000 end
  end
$$;

create or replace function public._puzzle_name(p_name text) returns text language plpgsql immutable as $$
declare t text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
begin
  if t = '' then return null; end if;
  return left(t, 10);
end $$;

-- 순위 (보이는 기록 중 나보다 빠른 수 + 1. 동점이면 먼저 세운 사람이 위)
create or replace function public._puzzle_rank(p_game text, p_level text, p_ms int, p_at timestamptz, p_uid uuid) returns int
language sql stable security definer set search_path = public as $$
  select 1 + count(*)::int from puzzle_records r
   where r.game = p_game and r.level = p_level and not r.hidden and r.user_id <> p_uid
     and (r.ms < p_ms or (r.ms = p_ms and r.created_at < p_at))
$$;

-- 한 난이도의 TOP 5 + 내 기록
create or replace function public._puzzle_board(p_game text, p_level text, p_uid uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'top', coalesce((select jsonb_agg(jsonb_build_object('name', t.nickname, 'ms', t.ms, 'at', t.created_at, 'me', t.user_id = p_uid) order by t.ms, t.created_at)
                       from (select * from puzzle_records where game = p_game and level = p_level and not hidden
                              order by ms, created_at limit 5) t), '[]'::jsonb),
    'me', (select jsonb_build_object('ms', m.ms, 'name', m.nickname, 'hidden', m.hidden, 'rank', _puzzle_rank(p_game, p_level, m.ms, m.created_at, p_uid))
             from puzzle_records m where m.game = p_game and m.level = p_level and m.user_id = p_uid))
$$;

-- 세 난이도 순위표 한 번에
create or replace function public.puzzle_top(p_game text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare uid uuid := _require_uid();
begin
  if p_game not in ('sudoku', 'mines') then raise exception 'BAD_GAME'; end if;
  return jsonb_build_object(
    'easy', _puzzle_board(p_game, 'easy', uid),
    'normal', _puzzle_board(p_game, 'normal', uid),
    'hard', _puzzle_board(p_game, 'hard', uid));
end $$;

-- 깬 기록 올리기. 더 좋을 때만 바뀜. 이름을 주면 순위표에 보임
create or replace function public.puzzle_submit(p_game text, p_level text, p_ms int, p_name text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := _require_uid(); nm text := _puzzle_name(p_name); prev puzzle_records; better boolean;
begin
  if p_game not in ('sudoku', 'mines') then raise exception 'BAD_GAME'; end if;
  if p_level not in ('easy', 'normal', 'hard') then raise exception 'BAD_LEVEL'; end if;
  if p_ms is null or p_ms < _puzzle_min_ms(p_game, p_level) or p_ms > 4 * 3600 * 1000 then raise exception 'BAD_TIME'; end if;
  select * into prev from puzzle_records where game = p_game and level = p_level and user_id = uid for update;
  better := not found or p_ms < prev.ms;
  if not found then
    insert into puzzle_records (game, level, user_id, nickname, ms, hidden) values (p_game, p_level, uid, nm, p_ms, nm is null);
  elsif better then
    update puzzle_records set ms = p_ms, created_at = now(), nickname = coalesce(nm, nickname), hidden = (coalesce(nm, nickname) is null)
     where game = p_game and level = p_level and user_id = uid;
  elsif nm is not null then
    update puzzle_records set nickname = nm, hidden = false where game = p_game and level = p_level and user_id = uid;
  end if;
  return _puzzle_board(p_game, p_level, uid) || jsonb_build_object('better', better);
end $$;

-- 이름 정하기 (null = 이 난이도 순위표에서 숨김). 이미 보이는 내 기록들도 같은 이름으로
create or replace function public.puzzle_name(p_game text, p_level text, p_name text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := _require_uid(); nm text := _puzzle_name(p_name);
begin
  if nm is null then
    update puzzle_records set hidden = true where game = p_game and level = p_level and user_id = uid;
  else
    update puzzle_records set nickname = nm where user_id = uid and not hidden; -- 보이는 기록은 이름 통일
    update puzzle_records set nickname = nm, hidden = false where game = p_game and level = p_level and user_id = uid;
  end if;
  return _puzzle_board(p_game, p_level, uid);
end $$;

do $$
declare f text;
begin
  foreach f in array array['puzzle_top(text)', 'puzzle_submit(text, text, int, text)', 'puzzle_name(text, text, text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  foreach f in array array['_puzzle_rank(text, text, int, timestamptz, uuid)', '_puzzle_board(text, text, uuid)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
end $$;


-- ════════ 0008_shapes_battle.sql ════════
-- 월루: 도형 배치 대결 (2~4명, 같은 판 동시에 · 먼저 다 채우면 1점) (2026-11-19)
-- 판은 방장 브라우저가 미리 만들어 올린다 (정답 없이). 남의 진행은 채운 칸 번호만 공개

create or replace function public._max_players_for(p_game text) returns int language sql immutable as $$
  select case when p_game in ('bell', 'shapevs') then 4 else 8 end
$$;

create or replace function public.create_room(p_game text) returns text
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := _require_uid();
  chars text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  c text;
  i int;
begin
  if p_game not in ('liar', 'bingo', 'bell', 'shapevs') then raise exception 'BAD_GAME'; end if;

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
            when 'bell' then jsonb_build_object('limitMin', 10)
            when 'shapevs' then jsonb_build_object('shLevel', 'normal', 'shTarget', 3, 'shSec', 90)
            else jsonb_build_object('category', 'random', 'hintRounds', 2, 'hintSeconds', 30, 'discussSeconds', 90)
          end);
  insert into room_secrets (code) values (c);
  return c;
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
  -- 5건 승인
  if (p_settings->>'limitMin')       in ('0','3','5','10','15')  then s := s || jsonb_build_object('limitMin',       (p_settings->>'limitMin')::int); end if;
  -- 도형 배치 대결
  if (p_settings->>'shLevel')        in ('easy','normal','hard') then s := s || jsonb_build_object('shLevel', p_settings->>'shLevel'); end if;
  if (p_settings->>'shTarget')       in ('3','5')            then s := s || jsonb_build_object('shTarget',       (p_settings->>'shTarget')::int); end if;
  if (p_settings->>'shSec')          in ('0','60','90')      then s := s || jsonb_build_object('shSec',          (p_settings->>'shSec')::int); end if;
  update rooms set settings = s, last_active_at = now() where code = r.code;
end $$;

create table if not exists public.shv_games (
  room_code   text primary key references public.rooms(code) on delete cascade,
  round_no    int not null default 0,                 -- 몇 번째 대결
  phase       text not null,                          -- play | result
  player_ids  uuid[] not null,
  level       text not null,
  target      int not null,                           -- 이 점수 먼저 얻으면 승리
  sec         int not null,                           -- 라운드 제한 (0 = 없음)
  puzzles     jsonb not null,                         -- 판 목록 (정답 없음)
  round       int not null default 1,
  started_at  timestamptz not null,                   -- 이 라운드 시작 (카운트다운 뒤)
  deadline    timestamptz,
  progress    jsonb not null default '{}'::jsonb,     -- {uid: {filled: [칸], placed: n}}
  points      jsonb not null default '{}'::jsonb,     -- 이번 대결 점수
  stats       jsonb not null default '{}'::jsonb,     -- {uid: {best: ms, n: 1등 횟수, sum: ms 합}}
  last        jsonb,                                  -- 지난 라운드 결과
  winner      uuid,
  result      jsonb,
  scores      jsonb not null default '{}'::jsonb,     -- 대결 승리 누적 (다시 하기에도 유지)
  version     int not null default 0,
  updated_at  timestamptz not null default now()
);

create table if not exists public.shv_chats (
  id          bigserial primary key,
  room_code   text not null references public.rooms(code) on delete cascade,
  user_id     uuid,
  body        text not null,
  created_at  timestamptz not null default now()
);
create index if not exists shv_chats_room on public.shv_chats (room_code, id);

alter table public.shv_games enable row level security;
alter table public.shv_chats enable row level security;
drop policy if exists shv_games_read on public.shv_games;
create policy shv_games_read on public.shv_games for select to authenticated using (public.is_room_member(room_code));
drop policy if exists shv_chats_read on public.shv_chats;
create policy shv_chats_read on public.shv_chats for select to authenticated using (public.is_room_member(room_code));
alter table public.shv_games replica identity full;
alter table public.shv_chats replica identity full;
do $$ begin
  begin alter publication supabase_realtime add table public.shv_games; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.shv_chats; exception when duplicate_object then null; end;
end $$;

-- ───────────── 내부 도우미 ─────────────

create or replace function public._shv_lock(p_code text) returns shv_games
language plpgsql security definer set search_path = public as $$
declare g shv_games;
begin
  if not is_room_member(p_code) then raise exception 'NOT_MEMBER'; end if;
  select * into g from shv_games where room_code = p_code for update;
  if not found then raise exception 'NO_GAME'; end if;
  return g;
end $$;

create or replace function public._shv_sys(p_code text, p_body text) returns void
language sql security definer set search_path = public as $$
  insert into shv_chats (room_code, user_id, body) values (p_code, null, p_body)
$$;

create or replace function public._shv_name(p_code text, p_uid uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select nickname from room_players where room_code = p_code and user_id = p_uid), '?')
$$;

create or replace function public._shv_puzzle(g shv_games, p_round int) returns jsonb
language sql immutable as $$
  select g.puzzles -> ((p_round - 1) % jsonb_array_length(g.puzzles))
$$;

-- 대결 끝: 점수 순 (같으면 1등 횟수 같음 → 최고 기록 빠른 순)
create or replace function public._shv_finish(p_code text, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare g shv_games; w uuid; players jsonb := '{}'::jsonb; pid uuid;
begin
  select * into g from shv_games where room_code = p_code;
  if g.phase <> 'play' then return; end if;
  foreach pid in array g.player_ids loop
    players := players || jsonb_build_object(pid::text, jsonb_build_object(
      'points', coalesce((g.points->>pid::text)::int, 0),
      'best', g.stats->pid::text->'best',
      'avg', case when coalesce((g.stats->pid::text->>'n')::int, 0) > 0 then ((g.stats->pid::text->>'sum')::int / (g.stats->pid::text->>'n')::int) end));
  end loop;
  select pid2 into w from unnest(g.player_ids) pid2
   where _liar_active(p_code, pid2)
   order by coalesce((g.points->>pid2::text)::int, 0) desc, coalesce((g.stats->pid2::text->>'best')::int, 2147483647) limit 1;
  update shv_games set phase = 'result', winner = w, deadline = null, version = version + 1, updated_at = now(),
    result = jsonb_build_object('reason', p_reason, 'players', players, 'rounds', g.round),
    scores = case when w is null then scores else scores || jsonb_build_object(w::text, coalesce((scores->>w::text)::int, 0) + 1) end
  where room_code = p_code;
  perform _shv_sys(p_code, '대결 끝! ' || coalesce(_shv_name(p_code, w) || ' 님 1위', '승자 없음'));
end $$;

-- 라운드 끝: 점수 주고 다음 라운드 (5초 뒤 시작, 그동안 완성본 공개) 또는 대결 끝
create or replace function public._shv_end_round(p_code text, p_winner uuid, p_ms int, p_reason text, p_occ jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare g shv_games; pts int; st jsonb; ranks jsonb; next_start timestamptz := now() + interval '5 seconds';
begin
  select * into g from shv_games where room_code = p_code;
  select coalesce(jsonb_agg(jsonb_build_object('id', pid, 'placed', coalesce((g.progress->pid::text->>'placed')::int, 0),
           'cells', coalesce(jsonb_array_length(g.progress->pid::text->'filled'), 0))), '[]'::jsonb)
    into ranks from unnest(g.player_ids) pid;
  if p_winner is not null then
    pts := coalesce((g.points->>p_winner::text)::int, 0) + 1;
    st := coalesce(g.stats->p_winner::text, '{}'::jsonb);
    if p_ms is not null then
      st := jsonb_build_object('best', least(coalesce((st->>'best')::int, p_ms), p_ms), 'n', coalesce((st->>'n')::int, 0) + 1, 'sum', coalesce((st->>'sum')::int, 0) + p_ms);
    end if;
    update shv_games set points = points || jsonb_build_object(p_winner::text, pts), stats = stats || jsonb_build_object(p_winner::text, st) where room_code = p_code;
  end if;
  update shv_games set version = version + 1, updated_at = now(),
    last = jsonb_build_object('round', g.round, 'winner', p_winner, 'ms', p_ms, 'reason', p_reason, 'occ', p_occ, 'ranks', ranks,
                              'puzzle', _shv_puzzle(g, g.round), 'at', now())
  where room_code = p_code;
  perform _shv_sys(p_code, g.round || '라운드 · ' || case when p_winner is null then '무승부' else _shv_name(p_code, p_winner) || ' 님 +1점' end);
  if p_winner is not null and pts >= g.target then perform _shv_finish(p_code, 'target'); return; end if;
  update shv_games set round = g.round + 1, progress = '{}'::jsonb, started_at = next_start,
    deadline = case when g.sec > 0 then next_start + make_interval(secs => g.sec) end
  where room_code = p_code;
end $$;

-- 남은 사람이 1명 이하면 끝
create or replace function public._shv_check_alone(p_code text) returns boolean
language plpgsql security definer set search_path = public as $$
declare g shv_games; n int;
begin
  select * into g from shv_games where room_code = p_code;
  if g.phase <> 'play' then return true; end if;
  select count(*) into n from unnest(g.player_ids) pid where _liar_active(p_code, pid);
  if n <= 1 then perform _shv_finish(p_code, 'alone'); return true; end if;
  return false;
end $$;

-- ───────────── 공개 함수 (RPC) ─────────────

create or replace function public.shv_start(p_code text, p_puzzles jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare r rooms; prev shv_games; players uuid[]; n int; lv text; tg int; sc int; st timestamptz := now() + interval '3 seconds';
begin
  p_code := upper(p_code);
  r := _require_host(p_code);
  if r.game <> 'shapevs' then raise exception 'BAD_GAME'; end if;
  select * into prev from shv_games where room_code = p_code for update;
  if r.status <> 'waiting' and coalesce(prev.phase, '') <> 'result' then raise exception 'IN_PROGRESS'; end if;
  if jsonb_typeof(p_puzzles) <> 'array' or jsonb_array_length(p_puzzles) < 1 or jsonb_array_length(p_puzzles) > 40 or length(p_puzzles::text) > 200000 then raise exception 'BAD_PUZZLE'; end if;

  select array_agg(user_id order by joined_at) into players from room_players where room_code = p_code and left_at is null;
  n := coalesce(array_length(players, 1), 0);
  if n < 2 then raise exception 'NEED_PLAYERS_2'; end if;
  if n > 4 then raise exception 'MAX_PLAYERS_4'; end if;
  lv := coalesce(r.settings->>'shLevel', 'normal'); if lv not in ('easy', 'normal', 'hard') then lv := 'normal'; end if;
  tg := coalesce((r.settings->>'shTarget')::int, 3); if tg not in (3, 5) then tg := 3; end if;
  sc := coalesce((r.settings->>'shSec')::int, 90); if sc not in (0, 60, 90) then sc := 90; end if;

  delete from shv_chats where room_code = p_code;
  insert into shv_games (room_code, round_no, phase, player_ids, level, target, sec, puzzles, round, started_at, deadline, progress, points, stats, last, winner, result, scores, version)
  values (p_code, coalesce(prev.round_no, 0) + 1, 'play', players, lv, tg, sc, p_puzzles, 1, st,
          case when sc > 0 then st + make_interval(secs => sc) end, '{}', '{}', '{}', null, null, null, coalesce(prev.scores, '{}'::jsonb), 0)
  on conflict (room_code) do update set
    round_no = excluded.round_no, phase = 'play', player_ids = excluded.player_ids, level = lv, target = tg, sec = sc, puzzles = p_puzzles,
    round = 1, started_at = st, deadline = excluded.deadline, progress = '{}', points = '{}', stats = '{}', last = null, winner = null, result = null,
    version = 0, updated_at = now();
  update rooms set status = 'playing', last_active_at = now() where code = p_code;
  perform _shv_sys(p_code, '시작! ' || tg || '점 먼저 · ' || case lv when 'easy' then '초급' when 'normal' then '중급' else '고급' end);
end $$;

-- 내 진행 (채운 칸 번호들, 놓은 도형 수)
create or replace function public.shv_progress(p_code text, p_round int, p_filled int[], p_placed int) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := _require_uid(); g shv_games;
begin
  p_code := upper(p_code);
  g := _shv_lock(p_code);
  if g.phase <> 'play' or g.round <> p_round or now() < g.started_at or not (uid = any(g.player_ids)) then return; end if;
  if coalesce(array_length(p_filled, 1), 0) > 100 then return; end if;
  update shv_games set progress = progress || jsonb_build_object(uid::text, jsonb_build_object('filled', to_jsonb(coalesce(p_filled, '{}'::int[])), 'placed', greatest(0, least(p_placed, 5)))),
    version = version + 1, updated_at = now()
  where room_code = p_code;
end $$;

-- 다 채움. p_occ = 칸마다 조각 번호 (-1 = 판 밖). 맞으면 이 라운드 1등
create or replace function public.shv_done(p_code text, p_round int, p_occ int[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := _require_uid(); g shv_games; pz jsonb; hw int; i int; m boolean; k int; cnt int[]; need int; ms int;
begin
  p_code := upper(p_code);
  g := _shv_lock(p_code);
  if g.phase <> 'play' or not (uid = any(g.player_ids)) then return jsonb_build_object('ok', false, 'late', true); end if;
  if g.round <> p_round or now() < g.started_at then return jsonb_build_object('ok', false, 'late', true); end if;
  pz := _shv_puzzle(g, g.round);
  hw := (pz->>'h')::int * (pz->>'w')::int;
  if coalesce(array_length(p_occ, 1), 0) <> hw then raise exception 'BAD_LAYOUT'; end if;
  cnt := array_fill(0, array[jsonb_array_length(pz->'pieces')]);
  for i in 1..hw loop
    m := (pz->'mask'->>(i - 1))::boolean;
    k := p_occ[i];
    if m and (k is null or k < 0 or k >= jsonb_array_length(pz->'pieces')) then raise exception 'BAD_LAYOUT'; end if;
    if not m and k <> -1 then raise exception 'BAD_LAYOUT'; end if;
    if m then cnt[k + 1] := cnt[k + 1] + 1; end if;
  end loop;
  for k in 0..jsonb_array_length(pz->'pieces') - 1 loop
    need := right(pz->'pieces'->k->>'shape', 1)::int; -- I3 → 3, F5 → 5
    if cnt[k + 1] <> need then raise exception 'BAD_LAYOUT'; end if;
  end loop;
  ms := (extract(epoch from now() - g.started_at) * 1000)::int;
  update shv_games set progress = progress || jsonb_build_object(uid::text, jsonb_build_object('filled', (select jsonb_agg(x - 1) from generate_series(1, hw) x where p_occ[x] >= 0), 'placed', jsonb_array_length(pz->'pieces')))
   where room_code = p_code;
  perform _shv_end_round(p_code, uid, ms, 'done', to_jsonb(p_occ));
  return jsonb_build_object('ok', true, 'ms', ms);
end $$;

-- 라운드 제한 시간이 지나면: 가장 많이 채운 사람 +1 (같으면 무승부)
create or replace function public.shv_tick(p_code text) returns void
language plpgsql security definer set search_path = public as $$
declare g shv_games; best int; who uuid; ties int;
begin
  p_code := upper(p_code);
  g := _shv_lock(p_code);
  if _shv_check_alone(p_code) then return; end if;
  if g.deadline is null or now() < g.deadline then return; end if;
  select max(coalesce(jsonb_array_length(g.progress->pid::text->'filled'), 0)) into best from unnest(g.player_ids) pid where _liar_active(p_code, pid);
  select count(*) into ties from unnest(g.player_ids) pid where _liar_active(p_code, pid) and coalesce(jsonb_array_length(g.progress->pid::text->'filled'), 0) = best;
  if best > 0 and ties = 1 then
    select pid into who from unnest(g.player_ids) pid where _liar_active(p_code, pid) and coalesce(jsonb_array_length(g.progress->pid::text->'filled'), 0) = best;
    perform _shv_end_round(p_code, who, null, 'time', null);
  else
    perform _shv_end_round(p_code, null, null, 'draw', null);
  end if;
end $$;

create or replace function public.shv_state(p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := _require_uid(); g shv_games;
begin
  p_code := upper(p_code);
  if not is_room_member(p_code) then raise exception 'NOT_MEMBER'; end if;
  select * into g from shv_games where room_code = p_code;
  if not found then return null; end if;
  return jsonb_build_object(
    'roundNo', g.round_no, 'phase', g.phase, 'playerIds', to_jsonb(g.player_ids), 'level', g.level, 'target', g.target, 'sec', g.sec,
    'round', g.round, 'startedAt', g.started_at, 'deadline', g.deadline, 'now', now(), 'version', g.version,
    'puzzle', case when g.phase = 'play' then _shv_puzzle(g, g.round) end,
    -- 남의 진행은 놓은 도형 수만 (어느 칸인지는 비공개)
    'progress', (select coalesce(jsonb_object_agg(k, jsonb_build_object('placed', coalesce((v->>'placed')::int, 0))), '{}'::jsonb) from jsonb_each(g.progress) e(k, v)),
    'points', g.points, 'last', g.last, 'winner', g.winner, 'result', g.result, 'scores', g.scores,
    'inGame', uid = any(g.player_ids),
    'chats', (select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'userId', m.user_id, 'body', m.body, 'at', m.created_at) order by m.id), '[]'::jsonb)
                from (select * from shv_chats where room_code = p_code order by id desc limit 120) m),
    'people', (select coalesce(jsonb_object_agg(user_id, jsonb_build_object('nickname', nickname, 'color', color)), '{}'::jsonb)
                 from room_players where room_code = p_code));
end $$;

create or replace function public.shv_chat(p_code text, p_text text) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := _require_uid(); t text := btrim(coalesce(p_text, ''));
begin
  p_code := upper(p_code);
  if not is_room_member(p_code) then raise exception 'NOT_MEMBER'; end if;
  if not exists (select 1 from shv_games where room_code = p_code) then raise exception 'NO_GAME'; end if;
  if char_length(t) < 1 or char_length(t) > 200 then raise exception 'BAD_TEXT'; end if;
  insert into shv_chats (room_code, user_id, body) values (p_code, uid, t);
end $$;

create or replace function public.shv_to_waiting(p_code text) returns void
language plpgsql security definer set search_path = public as $$
declare r rooms; g shv_games;
begin
  p_code := upper(p_code);
  r := _require_host(p_code);
  select * into g from shv_games where room_code = p_code;
  if found and g.phase <> 'result' then raise exception 'IN_PROGRESS'; end if;
  update rooms set status = 'waiting', last_active_at = now() where code = p_code;
end $$;

-- ───────────── 권한 ─────────────
do $$
declare f text;
begin
  foreach f in array array['_shv_lock(text)', '_shv_sys(text, text)', '_shv_name(text, uuid)', '_shv_finish(text, text)',
    '_shv_end_round(text, uuid, int, text, jsonb)', '_shv_check_alone(text)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
  foreach f in array array['shv_start(text, jsonb)', 'shv_progress(text, int, int[], int)', 'shv_done(text, int, int[])', 'shv_tick(text)',
    'shv_state(text)', 'shv_chat(text, text)', 'shv_to_waiting(text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;


-- ════════ 0009_shapes_skip.sql ════════
-- 월루: 도형 배치 대결 — 라운드 시간 제한 없앰, 대신 '넘기기' (2026-11-19)
-- 한 명이 넘기기를 제안하고 남은 사람이 모두 동의하면 정답을 공개하고 다음 라운드 (점수 없음)
-- 정답은 방장 브라우저가 판과 함께 올리고, 플레이어는 못 읽는 표에 둔다

alter table public.shv_games add column if not exists skip_votes uuid[] not null default '{}';
create table if not exists public.shv_answers (
  room_code text not null references public.rooms(code) on delete cascade,
  idx       int not null,
  occ       int[] not null,
  primary key (room_code, idx)
);
alter table public.shv_answers enable row level security; -- 읽기 정책 없음
drop function if exists public.shv_start(text, jsonb);

create or replace function public.shv_start(p_code text, p_puzzles jsonb, p_answers jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare r rooms; prev shv_games; players uuid[]; n int; lv text; tg int; sc int; st timestamptz := now() + interval '3 seconds';
begin
  p_code := upper(p_code);
  r := _require_host(p_code);
  if r.game <> 'shapevs' then raise exception 'BAD_GAME'; end if;
  select * into prev from shv_games where room_code = p_code for update;
  if r.status <> 'waiting' and coalesce(prev.phase, '') <> 'result' then raise exception 'IN_PROGRESS'; end if;
  if jsonb_typeof(p_puzzles) <> 'array' or jsonb_array_length(p_puzzles) < 1 or jsonb_array_length(p_puzzles) > 40 or length(p_puzzles::text) > 200000 then raise exception 'BAD_PUZZLE'; end if;

  select array_agg(user_id order by joined_at) into players from room_players where room_code = p_code and left_at is null;
  n := coalesce(array_length(players, 1), 0);
  if n < 2 then raise exception 'NEED_PLAYERS_2'; end if;
  if n > 4 then raise exception 'MAX_PLAYERS_4'; end if;
  lv := coalesce(r.settings->>'shLevel', 'normal'); if lv not in ('easy', 'normal', 'hard') then lv := 'normal'; end if;
  tg := coalesce((r.settings->>'shTarget')::int, 3); if tg not in (3, 5) then tg := 3; end if;
  sc := 0; -- 라운드 시간 제한 없음 (못 풀면 넘기기)
  if jsonb_typeof(p_answers) <> 'array' or jsonb_array_length(p_answers) <> jsonb_array_length(p_puzzles) then raise exception 'BAD_PUZZLE'; end if;

  delete from shv_chats where room_code = p_code;
  delete from shv_answers where room_code = p_code;
  insert into shv_answers (room_code, idx, occ) select p_code, (o - 1)::int, array(select jsonb_array_elements_text(a)::int) from jsonb_array_elements(p_answers) with ordinality t(a, o);
  insert into shv_games (room_code, round_no, phase, player_ids, level, target, sec, puzzles, round, started_at, deadline, progress, points, stats, last, winner, result, scores, version)
  values (p_code, coalesce(prev.round_no, 0) + 1, 'play', players, lv, tg, sc, p_puzzles, 1, st,
          case when sc > 0 then st + make_interval(secs => sc) end, '{}', '{}', '{}', null, null, null, coalesce(prev.scores, '{}'::jsonb), 0)
  on conflict (room_code) do update set
    round_no = excluded.round_no, phase = 'play', player_ids = excluded.player_ids, level = lv, target = tg, sec = sc, puzzles = p_puzzles,
    round = 1, started_at = st, deadline = excluded.deadline, progress = '{}', points = '{}', stats = '{}', last = null, winner = null, result = null,
    version = 0, skip_votes = '{}', updated_at = now();
  update rooms set status = 'playing', last_active_at = now() where code = p_code;
  perform _shv_sys(p_code, '시작! ' || tg || '점 먼저 · ' || case lv when 'easy' then '초급' when 'normal' then '중급' else '고급' end);
end $$;

create or replace function public._shv_end_round(p_code text, p_winner uuid, p_ms int, p_reason text, p_occ jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare g shv_games; pts int; st jsonb; ranks jsonb; next_start timestamptz := now() + interval '5 seconds';
begin
  select * into g from shv_games where room_code = p_code;
  select coalesce(jsonb_agg(jsonb_build_object('id', pid, 'placed', coalesce((g.progress->pid::text->>'placed')::int, 0),
           'cells', coalesce(jsonb_array_length(g.progress->pid::text->'filled'), 0))), '[]'::jsonb)
    into ranks from unnest(g.player_ids) pid;
  if p_winner is not null then
    pts := coalesce((g.points->>p_winner::text)::int, 0) + 1;
    st := coalesce(g.stats->p_winner::text, '{}'::jsonb);
    if p_ms is not null then
      st := jsonb_build_object('best', least(coalesce((st->>'best')::int, p_ms), p_ms), 'n', coalesce((st->>'n')::int, 0) + 1, 'sum', coalesce((st->>'sum')::int, 0) + p_ms);
    end if;
    update shv_games set points = points || jsonb_build_object(p_winner::text, pts), stats = stats || jsonb_build_object(p_winner::text, st) where room_code = p_code;
  end if;
  update shv_games set version = version + 1, updated_at = now(),
    last = jsonb_build_object('round', g.round, 'winner', p_winner, 'ms', p_ms, 'reason', p_reason, 'occ', p_occ, 'ranks', ranks,
                              'puzzle', _shv_puzzle(g, g.round), 'at', now())
  where room_code = p_code;
  perform _shv_sys(p_code, g.round || '라운드 · ' || case when p_winner is not null then _shv_name(p_code, p_winner) || ' 님 +1점' when p_reason = 'skip' then '넘기기 (정답 공개)' else '무승부' end);
  if p_winner is not null and pts >= g.target then perform _shv_finish(p_code, 'target'); return; end if;
  update shv_games set round = g.round + 1, progress = '{}'::jsonb, skip_votes = '{}', started_at = next_start,
    deadline = case when g.sec > 0 then next_start + make_interval(secs => g.sec) end
  where room_code = p_code;
end $$;

create or replace function public.shv_tick(p_code text) returns void
language plpgsql security definer set search_path = public as $$
declare g shv_games;
begin
  p_code := upper(p_code);
  g := _shv_lock(p_code);
  perform _shv_check_alone(p_code);
end $$;

create or replace function public.shv_state(p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := _require_uid(); g shv_games;
begin
  p_code := upper(p_code);
  if not is_room_member(p_code) then raise exception 'NOT_MEMBER'; end if;
  select * into g from shv_games where room_code = p_code;
  if not found then return null; end if;
  return jsonb_build_object(
    'roundNo', g.round_no, 'phase', g.phase, 'playerIds', to_jsonb(g.player_ids), 'level', g.level, 'target', g.target, 'sec', g.sec,
    'round', g.round, 'startedAt', g.started_at, 'deadline', g.deadline, 'now', now(), 'version', g.version,
    'puzzle', case when g.phase = 'play' then _shv_puzzle(g, g.round) end,
    -- 남의 진행은 놓은 도형 수만 (어느 칸인지는 비공개)
    'progress', (select coalesce(jsonb_object_agg(k, jsonb_build_object('placed', coalesce((v->>'placed')::int, 0))), '{}'::jsonb) from jsonb_each(g.progress) e(k, v)),
    'points', g.points, 'last', g.last, 'winner', g.winner, 'result', g.result, 'scores', g.scores,
    'inGame', uid = any(g.player_ids), 'skipVotes', to_jsonb(g.skip_votes),
    'chats', (select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'userId', m.user_id, 'body', m.body, 'at', m.created_at) order by m.id), '[]'::jsonb)
                from (select * from shv_chats where room_code = p_code order by id desc limit 120) m),
    'people', (select coalesce(jsonb_object_agg(user_id, jsonb_build_object('nickname', nickname, 'color', color)), '{}'::jsonb)
                 from room_players where room_code = p_code));
end $$;

-- 넘기기: p_vote = true 제안·동의, false = 계속 하자 (표 모두 취소)
create or replace function public.shv_skip(p_code text, p_round int, p_vote boolean) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := _require_uid(); g shv_games; votes uuid[]; need int; ans int[];
begin
  p_code := upper(p_code);
  g := _shv_lock(p_code);
  if g.phase <> 'play' or g.round <> p_round or now() < g.started_at or not (uid = any(g.player_ids)) then return; end if;
  if not p_vote then
    if coalesce(array_length(g.skip_votes, 1), 0) > 0 then
      update shv_games set skip_votes = '{}', version = version + 1, updated_at = now() where room_code = p_code;
      perform _shv_sys(p_code, _shv_name(p_code, uid) || ' 님: 계속 해볼게요');
    end if;
    return;
  end if;
  if uid = any(g.skip_votes) then return; end if;
  votes := g.skip_votes || uid;
  update shv_games set skip_votes = votes, version = version + 1, updated_at = now() where room_code = p_code;
  if array_length(votes, 1) = 1 then perform _shv_sys(p_code, _shv_name(p_code, uid) || ' 님이 이 판 넘기기를 제안했어요'); end if;
  select count(*) into need from unnest(g.player_ids) pid where _liar_active(p_code, pid) and not (pid = any(votes));
  if need = 0 then
    select occ into ans from shv_answers where room_code = p_code and idx = (g.round - 1) % jsonb_array_length(g.puzzles);
    perform _shv_end_round(p_code, null, null, 'skip', to_jsonb(ans));
  end if;
end $$;

do $$
declare f text;
begin
  foreach f in array array['shv_start(text, jsonb, jsonb)', 'shv_skip(text, int, boolean)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;


-- ════════ 0010_alkkagi.sql ════════
-- 월루: 알까기 (2명, PPT 원형 도형 튕기기) (2026-11-20)
-- 물리는 브라우저가 계산 (같은 입력 → 같은 결과). 쏜 사람이 결과 위치를 올리고 서버가 기준으로 저장
-- 자율 배치는 서로 못 보게 alk_place (읽기 정책 없음) 에 두었다가 동시에 공개

create or replace function public._max_players_for(p_game text) returns int language sql immutable as $$
  select case when p_game = 'alkkagi' then 2 when p_game in ('bell', 'shapevs') then 4 else 8 end
$$;

create or replace function public.create_room(p_game text) returns text
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := _require_uid();
  chars text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  c text;
  i int;
begin
  if p_game not in ('liar', 'bingo', 'bell', 'shapevs', 'alkkagi') then raise exception 'BAD_GAME'; end if;

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
            when 'bell' then jsonb_build_object('limitMin', 10)
            when 'shapevs' then jsonb_build_object('shLevel', 'normal', 'shTarget', 3, 'shSec', 90)
            when 'alkkagi' then jsonb_build_object('alkN', 5, 'alkTarget', 2, 'alkSec', 15, 'alkPlace', 'free')
            else jsonb_build_object('category', 'random', 'hintRounds', 2, 'hintSeconds', 30, 'discussSeconds', 90)
          end);
  insert into room_secrets (code) values (c);
  return c;
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
  -- 5건 승인
  if (p_settings->>'limitMin')       in ('0','3','5','10','15')  then s := s || jsonb_build_object('limitMin',       (p_settings->>'limitMin')::int); end if;
  -- 도형 배치 대결
  if (p_settings->>'shLevel')        in ('easy','normal','hard') then s := s || jsonb_build_object('shLevel', p_settings->>'shLevel'); end if;
  if (p_settings->>'shTarget')       in ('3','5')            then s := s || jsonb_build_object('shTarget',       (p_settings->>'shTarget')::int); end if;
  if (p_settings->>'shSec')          in ('0','60','90')      then s := s || jsonb_build_object('shSec',          (p_settings->>'shSec')::int); end if;
  -- 알까기
  if (p_settings->>'alkN')           in ('3','5','7')        then s := s || jsonb_build_object('alkN',           (p_settings->>'alkN')::int); end if;
  if (p_settings->>'alkTarget')      in ('1','2','3')        then s := s || jsonb_build_object('alkTarget',      (p_settings->>'alkTarget')::int); end if;
  if (p_settings->>'alkSec')         in ('0','15','30')      then s := s || jsonb_build_object('alkSec',         (p_settings->>'alkSec')::int); end if;
  if (p_settings->>'alkPlace')       in ('free','line')      then s := s || jsonb_build_object('alkPlace', p_settings->>'alkPlace'); end if;
  update rooms set settings = s, last_active_at = now() where code = r.code;
end $$;

create table if not exists public.alk_games (
  room_code   text primary key references public.rooms(code) on delete cascade,
  game_no     int not null default 0,
  phase       text not null,                       -- place | play | between | result
  player_ids  uuid[] not null,                     -- [1] 아래(파랑) · [2] 위(주황)
  n           int not null,                        -- 1인 돌 수
  target      int not null,                        -- 이 판 수 먼저 이기면 승리
  turn_sec    int not null,                        -- 0 = 없음
  place_mode  text not null,                       -- free | line
  round       int not null default 1,
  first       int not null default 0,              -- 이번 판 먼저 쏘는 사람 (0/1)
  turn        int not null default 0,
  deadline    timestamptz,
  stones      jsonb not null default '[]'::jsonb,  -- [{id, owner, x, y, out}]
  seq         int not null default 0,              -- 쏠 때마다 +1 (늦은 발사 구분)
  last        jsonb,                               -- 마지막 발사 {seq, by, stone, vx, vy, before, after} 또는 {seq, skip}
  place_done  jsonb not null default '{}'::jsonb,
  wins        jsonb not null default '{}'::jsonb,
  stats       jsonb not null default '{}'::jsonb,  -- {uid: {knocked, lost, shots, hits}}
  round_end   jsonb,                               -- 지난 판 결과 {round, winner}
  winner      uuid,
  result      jsonb,
  scores      jsonb not null default '{}'::jsonb,  -- 대결 우승 누적
  version     int not null default 0,
  updated_at  timestamptz not null default now()
);
create table if not exists public.alk_place (
  room_code text not null references public.rooms(code) on delete cascade,
  user_id   uuid not null,
  round     int not null,
  pos       jsonb not null,                        -- [[x, y], ...]
  primary key (room_code, user_id)
);
create table if not exists public.alk_chats (
  id          bigserial primary key,
  room_code   text not null references public.rooms(code) on delete cascade,
  user_id     uuid,
  body        text not null,
  created_at  timestamptz not null default now()
);
create index if not exists alk_chats_room on public.alk_chats (room_code, id);

alter table public.alk_games enable row level security;
alter table public.alk_place enable row level security; -- 읽기 정책 없음 (상대 배치 비공개)
alter table public.alk_chats enable row level security;
drop policy if exists alk_games_read on public.alk_games;
create policy alk_games_read on public.alk_games for select to authenticated using (public.is_room_member(room_code));
drop policy if exists alk_chats_read on public.alk_chats;
create policy alk_chats_read on public.alk_chats for select to authenticated using (public.is_room_member(room_code));
alter table public.alk_games replica identity full;
alter table public.alk_chats replica identity full;
do $$ begin
  begin alter publication supabase_realtime add table public.alk_games; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.alk_chats; exception when duplicate_object then null; end;
end $$;

-- ───────────── 내부 도우미 ─────────────
create or replace function public._alk_vmax() returns float8 language sql immutable as $$ select sqrt(2 * 7 * 27.0) $$;
create or replace function public._alk_place_secs() returns int language sql immutable as $$ select 30 $$;

create or replace function public._alk_lock(p_code text) returns alk_games
language plpgsql security definer set search_path = public as $$
declare g alk_games;
begin
  if not is_room_member(p_code) then raise exception 'NOT_MEMBER'; end if;
  select * into g from alk_games where room_code = p_code for update;
  if not found then raise exception 'NO_GAME'; end if;
  return g;
end $$;

create or replace function public._alk_sys(p_code text, p_body text) returns void
language sql security definer set search_path = public as $$
  insert into alk_chats (room_code, user_id, body) values (p_code, null, p_body)
$$;

create or replace function public._alk_name(p_code text, p_uid uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select nickname from room_players where room_code = p_code and user_id = p_uid), '?')
$$;

-- 기본 배치: 4번째 줄, 2칸 간격
create or replace function public._alk_line(p_n int, p_owner int) returns jsonb
language sql immutable as $$
  select jsonb_agg(jsonb_build_array(9 + (i - (p_n - 1) / 2.0) * 2, case when p_owner = 0 then 15 else 3 end) order by i)
  from generate_series(0, p_n - 1) i
$$;

-- 배치 검사: 개수·진영·간격
create or replace function public._alk_valid_place(p_pos jsonb, p_n int, p_owner int) returns boolean
language plpgsql immutable as $$
declare i int; j int; x float8; y float8;
begin
  if jsonb_typeof(p_pos) <> 'array' or jsonb_array_length(p_pos) <> p_n then return false; end if;
  for i in 0..p_n - 1 loop
    x := (p_pos->i->>0)::float8; y := (p_pos->i->>1)::float8;
    if x is null or y is null or x < 0 or x > 18 then return false; end if;
    if p_owner = 0 and (y < 10 or y > 18) then return false; end if;
    if p_owner = 1 and (y < 0 or y > 8) then return false; end if;
    for j in 0..i - 1 loop
      if sqrt(power(x - (p_pos->j->>0)::float8, 2) + power(y - (p_pos->j->>1)::float8, 2)) < 0.99 then return false; end if;
    end loop;
  end loop;
  return true;
end $$;

-- 덜 놓은 배치 채우기: 기본 위치 중 겹치지 않는 곳부터, 그래도 모자라면 진영 안 빈 칸
create or replace function public._alk_fill(p_pos jsonb, p_n int, p_owner int) returns jsonb
language plpgsql immutable as $$
declare out jsonb := '[]'::jsonb; e jsonb; c jsonb; x float8; y float8; ok boolean; cands jsonb;
begin
  if jsonb_typeof(p_pos) <> 'array' then p_pos := '[]'::jsonb; end if;
  for e in select * from jsonb_array_elements(p_pos) loop
    if jsonb_array_length(out) < p_n and _alk_valid_place(out || jsonb_build_array(e), jsonb_array_length(out) + 1, p_owner) then out := out || jsonb_build_array(e); end if;
  end loop;
  cands := _alk_line(p_n, p_owner) || (select jsonb_agg(jsonb_build_array(xx, case when p_owner = 0 then yy else 18 - yy end)) from generate_series(1, 17, 2) xx, generate_series(11, 17, 2) yy);
  for c in select * from jsonb_array_elements(cands) loop
    exit when jsonb_array_length(out) >= p_n;
    x := (c->>0)::float8; y := (c->>1)::float8; ok := true;
    for e in select * from jsonb_array_elements(out) loop
      if sqrt(power(x - (e->>0)::float8, 2) + power(y - (e->>1)::float8, 2)) < 1.0 then ok := false; end if;
    end loop;
    if ok then out := out || jsonb_build_array(c); end if;
  end loop;
  return out;
end $$;

-- 배치 공개 → 판 시작
create or replace function public._alk_begin_play(p_code text) returns void
language plpgsql security definer set search_path = public as $$
declare g alk_games; st jsonb := '[]'::jsonb; k int; pos jsonb; pid uuid;
begin
  select * into g from alk_games where room_code = p_code;
  for k in 0..1 loop
    pid := g.player_ids[k + 1];
    pos := null;
    if g.place_mode = 'free' then
      select p.pos into pos from alk_place p where p.room_code = p_code and p.user_id = pid and p.round = g.round;
    end if;
    pos := _alk_fill(coalesce(pos, '[]'::jsonb), g.n, k); -- 다 못 놓았으면 남은 돌은 기본 위치에
    if not _alk_valid_place(pos, g.n, k) then pos := _alk_line(g.n, k); end if;
    select st || coalesce(jsonb_agg(jsonb_build_object('id', k * g.n + (o - 1), 'owner', k, 'x', (e->>0)::float8, 'y', (e->>1)::float8, 'out', false) order by o), '[]'::jsonb)
      into st from jsonb_array_elements(pos) with ordinality t(e, o);
  end loop;
  update alk_games set phase = 'play', stones = st, turn = g.first, seq = g.seq + 1, last = null,
    deadline = case when g.turn_sec > 0 then now() + make_interval(secs => g.turn_sec) end, version = version + 1, updated_at = now()
  where room_code = p_code;
  perform _alk_sys(p_code, g.round || '판 시작 · ' || _alk_name(p_code, g.player_ids[g.first + 1]) || ' 님 먼저');
end $$;

-- 판 준비 (배치 시간 또는 바로 시작)
create or replace function public._alk_start_round(p_code text) returns void
language plpgsql security definer set search_path = public as $$
declare g alk_games;
begin
  select * into g from alk_games where room_code = p_code;
  delete from alk_place where room_code = p_code;
  if g.place_mode = 'free' then
    update alk_games set phase = 'place', place_done = '{}', stones = '[]', last = null,
      deadline = now() + make_interval(secs => _alk_place_secs()), version = version + 1, updated_at = now()
    where room_code = p_code;
    perform _alk_sys(p_code, g.round || '판 · 배치 시간 ' || _alk_place_secs() || '초');
  else
    perform _alk_begin_play(p_code);
  end if;
end $$;

create or replace function public._alk_finish(p_code text, p_reason text, p_winner uuid) returns void
language plpgsql security definer set search_path = public as $$
declare g alk_games; players jsonb := '{}'::jsonb; pid uuid;
begin
  select * into g from alk_games where room_code = p_code;
  if g.phase = 'result' then return; end if;
  foreach pid in array g.player_ids loop
    players := players || jsonb_build_object(pid::text, coalesce(g.stats->pid::text, '{}'::jsonb) || jsonb_build_object('wins', coalesce((g.wins->>pid::text)::int, 0)));
  end loop;
  update alk_games set phase = 'result', winner = p_winner, deadline = null, version = version + 1, updated_at = now(),
    result = jsonb_build_object('reason', p_reason, 'players', players, 'rounds', g.round),
    scores = case when p_winner is null then scores else scores || jsonb_build_object(p_winner::text, coalesce((scores->>p_winner::text)::int, 0) + 1) end
  where room_code = p_code;
  perform _alk_sys(p_code, '대결 끝! ' || coalesce(_alk_name(p_code, p_winner) || ' 님 승리', '무승부'));
end $$;

-- 한 판 끝: 승수 올리고 3.5초 뒤 다음 판 (또는 대결 끝)
create or replace function public._alk_end_round(p_code text, p_winner uuid) returns void
language plpgsql security definer set search_path = public as $$
declare g alk_games; w int;
begin
  select * into g from alk_games where room_code = p_code;
  if p_winner is not null then
    w := coalesce((g.wins->>p_winner::text)::int, 0) + 1;
    update alk_games set wins = wins || jsonb_build_object(p_winner::text, w) where room_code = p_code;
  end if;
  update alk_games set round_end = jsonb_build_object('round', g.round, 'winner', p_winner, 'at', now()), version = version + 1, updated_at = now() where room_code = p_code;
  perform _alk_sys(p_code, g.round || '판 · ' || coalesce(_alk_name(p_code, p_winner) || ' 님 승리', '무승부'));
  if p_winner is not null and w >= g.target then perform _alk_finish(p_code, 'target', p_winner); return; end if;
  update alk_games set phase = 'between', deadline = now() + interval '3.5 seconds' where room_code = p_code;
end $$;

create or replace function public._alk_check_alone(p_code text) returns boolean
language plpgsql security definer set search_path = public as $$
declare g alk_games; left_pid uuid; n int;
begin
  select * into g from alk_games where room_code = p_code;
  if g.phase = 'result' then return true; end if;
  select count(*) into n from unnest(g.player_ids) pid where _liar_active(p_code, pid);
  if n <= 1 then
    select pid into left_pid from unnest(g.player_ids) pid where _liar_active(p_code, pid) limit 1;
    perform _alk_finish(p_code, 'alone', left_pid);
    return true;
  end if;
  return false;
end $$;

-- ───────────── 공개 함수 (RPC) ─────────────

create or replace function public.alk_start(p_code text) returns void
language plpgsql security definer set search_path = public as $$
declare r rooms; prev alk_games; players uuid[]; n int; nn int; tg int; sc int; pm text;
begin
  p_code := upper(p_code);
  r := _require_host(p_code);
  if r.game <> 'alkkagi' then raise exception 'BAD_GAME'; end if;
  select * into prev from alk_games where room_code = p_code for update;
  if r.status <> 'waiting' and coalesce(prev.phase, '') <> 'result' then raise exception 'IN_PROGRESS'; end if;
  select array_agg(user_id order by joined_at) into players from room_players where room_code = p_code and left_at is null;
  n := coalesce(array_length(players, 1), 0);
  if n <> 2 then raise exception 'NEED_PLAYERS_EXACT_2'; end if;
  -- 대결마다 아래·위 자리 바꾸기
  if prev.game_no is not null and prev.game_no % 2 = 1 then players := array[players[2], players[1]]; end if;
  nn := coalesce((r.settings->>'alkN')::int, 5); if nn not in (3, 5, 7) then nn := 5; end if;
  tg := coalesce((r.settings->>'alkTarget')::int, 2); if tg not in (1, 2, 3) then tg := 2; end if;
  sc := coalesce((r.settings->>'alkSec')::int, 15); if sc not in (0, 15, 30) then sc := 15; end if;
  pm := coalesce(r.settings->>'alkPlace', 'free'); if pm not in ('free', 'line') then pm := 'free'; end if;
  delete from alk_chats where room_code = p_code;
  insert into alk_games (room_code, game_no, phase, player_ids, n, target, turn_sec, place_mode, round, first, turn, stones, seq, wins, stats, scores, version)
  values (p_code, coalesce(prev.game_no, 0) + 1, 'place', players, nn, tg, sc, pm, 1, 0, 0, '[]', 0, '{}', '{}', coalesce(prev.scores, '{}'::jsonb), 0)
  on conflict (room_code) do update set
    game_no = excluded.game_no, phase = 'place', player_ids = excluded.player_ids, n = nn, target = tg, turn_sec = sc, place_mode = pm,
    round = 1, first = 0, turn = 0, deadline = null, stones = '[]', seq = 0, last = null, place_done = '{}', wins = '{}', stats = '{}',
    round_end = null, winner = null, result = null, version = 0, updated_at = now();
  update rooms set status = 'playing', last_active_at = now() where code = p_code;
  perform _alk_start_round(p_code);
end $$;

-- 배치 저장 (p_done = 완료)
create or replace function public.alk_place(p_code text, p_round int, p_pos jsonb, p_done boolean) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := _require_uid(); g alk_games; k int; done jsonb;
begin
  p_code := upper(p_code);
  g := _alk_lock(p_code);
  if g.phase <> 'place' or g.round <> p_round then return; end if;
  k := array_position(g.player_ids, uid) - 1;
  if k is null then raise exception 'NOT_PLAYER'; end if;
  if (g.place_done->>uid::text)::boolean is true then return; end if; -- 이미 완료했으면 고칠 수 없음
  if jsonb_typeof(p_pos) <> 'array' or jsonb_array_length(p_pos) > g.n then raise exception 'BAD_PLACE'; end if;
  if p_done and not _alk_valid_place(p_pos, g.n, k) then raise exception 'BAD_PLACE'; end if;
  insert into alk_place (room_code, user_id, round, pos) values (p_code, uid, g.round, p_pos)
  on conflict (room_code, user_id) do update set round = excluded.round, pos = excluded.pos;
  done := g.place_done || jsonb_build_object(uid::text, p_done);
  update alk_games set place_done = done, version = version + 1, updated_at = now() where room_code = p_code;
  if (done->>g.player_ids[1]::text)::boolean is true and (done->>g.player_ids[2]::text)::boolean is true then
    perform _alk_begin_play(p_code);
  end if;
end $$;

-- 발사. p_after = 쏜 사람 브라우저가 계산한 결과 위치
create or replace function public.alk_shoot(p_code text, p_seq int, p_stone int, p_vx float8, p_vy float8, p_after jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := _require_uid(); g alk_games; k int; s jsonb; a jsonb; i int; knocked int := 0; lost int := 0;
  act0 int := 0; act1 int := 0; st jsonb; uk text;
begin
  p_code := upper(p_code);
  g := _alk_lock(p_code);
  if g.phase <> 'play' or g.seq <> p_seq then return jsonb_build_object('ok', false, 'late', true); end if;
  k := array_position(g.player_ids, uid) - 1;
  if k is null or g.turn <> k then return jsonb_build_object('ok', false, 'late', true); end if;
  s := (select e from jsonb_array_elements(g.stones) e where (e->>'id')::int = p_stone);
  if s is null or (s->>'owner')::int <> k or (s->>'out')::boolean then raise exception 'BAD_SHOT'; end if;
  if sqrt(p_vx * p_vx + p_vy * p_vy) > _alk_vmax() * 1.01 then raise exception 'BAD_SHOT'; end if;
  if jsonb_typeof(p_after) <> 'array' or jsonb_array_length(p_after) <> jsonb_array_length(g.stones) then raise exception 'BAD_SHOT'; end if;
  for i in 0..jsonb_array_length(g.stones) - 1 loop
    s := g.stones->i;
    a := (select e from jsonb_array_elements(p_after) e where (e->>'id')::int = (s->>'id')::int);
    if a is null then raise exception 'BAD_SHOT'; end if;
    if (s->>'out')::boolean and not (a->>'out')::boolean then raise exception 'BAD_SHOT'; end if; -- 떨어진 돌은 돌아오지 않음
    if not (s->>'out')::boolean and (a->>'out')::boolean then
      if (s->>'owner')::int = k then lost := lost + 1; else knocked := knocked + 1; end if;
    end if;
    if not (a->>'out')::boolean then
      if (a->>'owner')::int = 0 then act0 := act0 + 1; else act1 := act1 + 1; end if;
    end if;
  end loop;
  uk := uid::text;
  st := coalesce(g.stats->uk, '{}'::jsonb);
  st := jsonb_build_object('knocked', coalesce((st->>'knocked')::int, 0) + knocked, 'lost', coalesce((st->>'lost')::int, 0) + lost,
                           'shots', coalesce((st->>'shots')::int, 0) + 1, 'hits', coalesce((st->>'hits')::int, 0) + case when knocked > 0 then 1 else 0 end);
  update alk_games set stones = p_after, seq = g.seq + 1, turn = 1 - k, stats = stats || jsonb_build_object(uk, st),
    last = jsonb_build_object('seq', g.seq + 1, 'by', uid, 'stone', p_stone, 'vx', p_vx, 'vy', p_vy, 'before', g.stones, 'after', p_after, 'knocked', knocked, 'lost', lost),
    deadline = case when g.turn_sec > 0 then now() + make_interval(secs => g.turn_sec) + interval '3 seconds' end, -- 굴러가는 시간 여유
    version = version + 1, updated_at = now()
  where room_code = p_code;
  if act0 = 0 or act1 = 0 then
    perform _alk_end_round(p_code, case when act0 = 0 and act1 = 0 then null when act0 = 0 then g.player_ids[2] else g.player_ids[1] end);
  end if;
  return jsonb_build_object('ok', true, 'knocked', knocked, 'lost', lost);
end $$;

-- 시간 처리: 배치 시간 끝 → 시작, 차례 시간 끝 → 넘김, 판 사이 → 다음 판, 혼자 남음 → 끝
create or replace function public.alk_tick(p_code text) returns void
language plpgsql security definer set search_path = public as $$
declare g alk_games;
begin
  p_code := upper(p_code);
  g := _alk_lock(p_code);
  if _alk_check_alone(p_code) then return; end if;
  if g.deadline is null or now() < g.deadline then return; end if;
  if g.phase = 'place' then perform _alk_begin_play(p_code);
  elsif g.phase = 'play' then
    update alk_games set turn = 1 - g.turn, seq = g.seq + 1, last = jsonb_build_object('seq', g.seq + 1, 'skip', true, 'by', g.player_ids[g.turn + 1]),
      deadline = now() + make_interval(secs => g.turn_sec), version = version + 1, updated_at = now() where room_code = p_code;
  elsif g.phase = 'between' then
    update alk_games set round = g.round + 1, first = 1 - g.first, round_end = round_end where room_code = p_code;
    perform _alk_start_round(p_code);
  end if;
end $$;

-- 항복: 상대가 대결 승리
create or replace function public.alk_resign(p_code text) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := _require_uid(); g alk_games; k int;
begin
  p_code := upper(p_code);
  g := _alk_lock(p_code);
  if g.phase = 'result' then return; end if;
  k := array_position(g.player_ids, uid) - 1;
  if k is null then raise exception 'NOT_PLAYER'; end if;
  perform _alk_sys(p_code, _alk_name(p_code, uid) || ' 님 항복');
  perform _alk_finish(p_code, 'resign', g.player_ids[2 - k]);
end $$;

create or replace function public.alk_state(p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := _require_uid(); g alk_games;
begin
  p_code := upper(p_code);
  if not is_room_member(p_code) then raise exception 'NOT_MEMBER'; end if;
  select * into g from alk_games where room_code = p_code;
  if not found then return null; end if;
  return jsonb_build_object(
    'gameNo', g.game_no, 'phase', g.phase, 'playerIds', to_jsonb(g.player_ids), 'n', g.n, 'target', g.target, 'turnSec', g.turn_sec,
    'placeMode', g.place_mode, 'round', g.round, 'first', g.first, 'turn', g.turn, 'deadline', g.deadline, 'now', now(),
    'stones', g.stones, 'seq', g.seq, 'last', g.last, 'placeDone', g.place_done, 'wins', g.wins, 'stats', g.stats,
    'roundEnd', g.round_end, 'winner', g.winner, 'result', g.result, 'scores', g.scores, 'version', g.version,
    'me', array_position(g.player_ids, uid) - 1,
    'myPlace', (select p.pos from alk_place p where p.room_code = p_code and p.user_id = uid and p.round = g.round),
    'chats', (select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'userId', m.user_id, 'body', m.body, 'at', m.created_at) order by m.id), '[]'::jsonb)
                from (select * from alk_chats where room_code = p_code order by id desc limit 120) m),
    'people', (select coalesce(jsonb_object_agg(user_id, jsonb_build_object('nickname', nickname, 'color', color)), '{}'::jsonb)
                 from room_players where room_code = p_code));
end $$;

create or replace function public.alk_chat(p_code text, p_text text) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := _require_uid(); t text := btrim(coalesce(p_text, ''));
begin
  p_code := upper(p_code);
  if not is_room_member(p_code) then raise exception 'NOT_MEMBER'; end if;
  if not exists (select 1 from alk_games where room_code = p_code) then raise exception 'NO_GAME'; end if;
  if char_length(t) < 1 or char_length(t) > 200 then raise exception 'BAD_TEXT'; end if;
  insert into alk_chats (room_code, user_id, body) values (p_code, uid, t);
end $$;

create or replace function public.alk_to_waiting(p_code text) returns void
language plpgsql security definer set search_path = public as $$
declare r rooms; g alk_games;
begin
  p_code := upper(p_code);
  r := _require_host(p_code);
  select * into g from alk_games where room_code = p_code;
  if found and g.phase <> 'result' then raise exception 'IN_PROGRESS'; end if;
  update rooms set status = 'waiting', last_active_at = now() where code = p_code;
end $$;

do $$
declare f text;
begin
  foreach f in array array['_alk_lock(text)', '_alk_sys(text, text)', '_alk_name(text, uuid)', '_alk_begin_play(text)', '_alk_start_round(text)',
    '_alk_finish(text, text, uuid)', '_alk_end_round(text, uuid)', '_alk_check_alone(text)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
  foreach f in array array['alk_start(text)', 'alk_place(text, int, jsonb, boolean)', 'alk_shoot(text, int, int, float8, float8, jsonb)',
    'alk_tick(text)', 'alk_resign(text)', 'alk_state(text)', 'alk_chat(text, text)', 'alk_to_waiting(text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;


-- ════════ 0011_shapes_expert.sql ════════
-- 월루: 도형 배치 대결에 '전문가'(도형 6개) 난이도 (2026-11-23)

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
  -- 5건 승인
  if (p_settings->>'limitMin')       in ('0','3','5','10','15')  then s := s || jsonb_build_object('limitMin',       (p_settings->>'limitMin')::int); end if;
  -- 도형 배치 대결
  if (p_settings->>'shLevel')        in ('easy','normal','hard','expert') then s := s || jsonb_build_object('shLevel', p_settings->>'shLevel'); end if;
  if (p_settings->>'shTarget')       in ('3','5')            then s := s || jsonb_build_object('shTarget',       (p_settings->>'shTarget')::int); end if;
  if (p_settings->>'shSec')          in ('0','60','90')      then s := s || jsonb_build_object('shSec',          (p_settings->>'shSec')::int); end if;
  -- 알까기
  if (p_settings->>'alkN')           in ('3','5','7')        then s := s || jsonb_build_object('alkN',           (p_settings->>'alkN')::int); end if;
  if (p_settings->>'alkTarget')      in ('1','2','3')        then s := s || jsonb_build_object('alkTarget',      (p_settings->>'alkTarget')::int); end if;
  if (p_settings->>'alkSec')         in ('0','15','30')      then s := s || jsonb_build_object('alkSec',         (p_settings->>'alkSec')::int); end if;
  if (p_settings->>'alkPlace')       in ('free','line')      then s := s || jsonb_build_object('alkPlace', p_settings->>'alkPlace'); end if;
  update rooms set settings = s, last_active_at = now() where code = r.code;
end $$;

create or replace function public.shv_start(p_code text, p_puzzles jsonb, p_answers jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare r rooms; prev shv_games; players uuid[]; n int; lv text; tg int; sc int; st timestamptz := now() + interval '3 seconds';
begin
  p_code := upper(p_code);
  r := _require_host(p_code);
  if r.game <> 'shapevs' then raise exception 'BAD_GAME'; end if;
  select * into prev from shv_games where room_code = p_code for update;
  if r.status <> 'waiting' and coalesce(prev.phase, '') <> 'result' then raise exception 'IN_PROGRESS'; end if;
  if jsonb_typeof(p_puzzles) <> 'array' or jsonb_array_length(p_puzzles) < 1 or jsonb_array_length(p_puzzles) > 40 or length(p_puzzles::text) > 200000 then raise exception 'BAD_PUZZLE'; end if;

  select array_agg(user_id order by joined_at) into players from room_players where room_code = p_code and left_at is null;
  n := coalesce(array_length(players, 1), 0);
  if n < 2 then raise exception 'NEED_PLAYERS_2'; end if;
  if n > 4 then raise exception 'MAX_PLAYERS_4'; end if;
  lv := coalesce(r.settings->>'shLevel', 'normal'); if lv not in ('easy', 'normal', 'hard', 'expert') then lv := 'normal'; end if;
  tg := coalesce((r.settings->>'shTarget')::int, 3); if tg not in (3, 5) then tg := 3; end if;
  sc := 0; -- 라운드 시간 제한 없음 (못 풀면 넘기기)
  if jsonb_typeof(p_answers) <> 'array' or jsonb_array_length(p_answers) <> jsonb_array_length(p_puzzles) then raise exception 'BAD_PUZZLE'; end if;

  delete from shv_chats where room_code = p_code;
  delete from shv_answers where room_code = p_code;
  insert into shv_answers (room_code, idx, occ) select p_code, (o - 1)::int, array(select jsonb_array_elements_text(a)::int) from jsonb_array_elements(p_answers) with ordinality t(a, o);
  insert into shv_games (room_code, round_no, phase, player_ids, level, target, sec, puzzles, round, started_at, deadline, progress, points, stats, last, winner, result, scores, version)
  values (p_code, coalesce(prev.round_no, 0) + 1, 'play', players, lv, tg, sc, p_puzzles, 1, st,
          case when sc > 0 then st + make_interval(secs => sc) end, '{}', '{}', '{}', null, null, null, coalesce(prev.scores, '{}'::jsonb), 0)
  on conflict (room_code) do update set
    round_no = excluded.round_no, phase = 'play', player_ids = excluded.player_ids, level = lv, target = tg, sec = sc, puzzles = p_puzzles,
    round = 1, started_at = st, deadline = excluded.deadline, progress = '{}', points = '{}', stats = '{}', last = null, winner = null, result = null,
    version = 0, skip_votes = '{}', updated_at = now();
  update rooms set status = 'playing', last_active_at = now() where code = p_code;
  perform _shv_sys(p_code, '시작! ' || tg || '점 먼저 · ' || case lv when 'easy' then '초급' when 'normal' then '중급' when 'hard' then '고급' else '전문가' end);
end $$;


-- ════════ 0012_cable_battle.sql ════════
-- 월루: 케이블 연결 대결 (2~4명, 같은 구성도 동시에 · 먼저 다 이으면 1점 · 넘기기) (2026-11-23)
-- 「도형 배치 대결」(shv_*)과 같은 구조. 판은 방장 브라우저가 섞인 상태로 올리고 정답은 cbv_answers(읽기 정책 없음)에
-- 남의 진행은 연결된 PC 수만 공개

create or replace function public._max_players_for(p_game text) returns int language sql immutable as $$
  select case when p_game = 'alkkagi' then 2 when p_game in ('bell', 'shapevs', 'cablevs') then 4 else 8 end
$$;

create or replace function public.create_room(p_game text) returns text
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := _require_uid();
  chars text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  c text;
  i int;
begin
  if p_game not in ('liar', 'bingo', 'bell', 'shapevs', 'alkkagi', 'cablevs') then raise exception 'BAD_GAME'; end if;

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
            when 'bell' then jsonb_build_object('limitMin', 10)
            when 'shapevs' then jsonb_build_object('shLevel', 'normal', 'shTarget', 3, 'shSec', 90)
            when 'cablevs' then jsonb_build_object('cbLevel', 'normal', 'cbTarget', 3)
            when 'alkkagi' then jsonb_build_object('alkN', 5, 'alkTarget', 2, 'alkSec', 15, 'alkPlace', 'free')
            else jsonb_build_object('category', 'random', 'hintRounds', 2, 'hintSeconds', 30, 'discussSeconds', 90)
          end);
  insert into room_secrets (code) values (c);
  return c;
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
  -- 5건 승인
  if (p_settings->>'limitMin')       in ('0','3','5','10','15')  then s := s || jsonb_build_object('limitMin',       (p_settings->>'limitMin')::int); end if;
  -- 도형 배치 대결
  if (p_settings->>'shLevel')        in ('easy','normal','hard','expert') then s := s || jsonb_build_object('shLevel', p_settings->>'shLevel'); end if;
  if (p_settings->>'shTarget')       in ('3','5')            then s := s || jsonb_build_object('shTarget',       (p_settings->>'shTarget')::int); end if;
  if (p_settings->>'shSec')          in ('0','60','90')      then s := s || jsonb_build_object('shSec',          (p_settings->>'shSec')::int); end if;
  -- 알까기
  if (p_settings->>'alkN')           in ('3','5','7')        then s := s || jsonb_build_object('alkN',           (p_settings->>'alkN')::int); end if;
  if (p_settings->>'alkTarget')      in ('1','2','3')        then s := s || jsonb_build_object('alkTarget',      (p_settings->>'alkTarget')::int); end if;
  if (p_settings->>'alkSec')         in ('0','15','30')      then s := s || jsonb_build_object('alkSec',         (p_settings->>'alkSec')::int); end if;
  if (p_settings->>'alkPlace')       in ('free','line')      then s := s || jsonb_build_object('alkPlace', p_settings->>'alkPlace'); end if;
  -- 케이블 연결 대결
  if (p_settings->>'cbLevel')        in ('easy','normal','hard') then s := s || jsonb_build_object('cbLevel', p_settings->>'cbLevel'); end if;
  if (p_settings->>'cbTarget')       in ('3','5')            then s := s || jsonb_build_object('cbTarget',       (p_settings->>'cbTarget')::int); end if;
  update rooms set settings = s, last_active_at = now() where code = r.code;
end $$;

create table if not exists public.cbv_games (
  room_code   text primary key references public.rooms(code) on delete cascade,
  round_no    int not null default 0,
  phase       text not null,
  player_ids  uuid[] not null,
  level       text not null,
  target      int not null,
  sec         int not null default 0,
  puzzles     jsonb not null,                         -- [{w, h, server, cells(섞인 상태)}]
  round       int not null default 1,
  started_at  timestamptz not null,
  deadline    timestamptz,
  progress    jsonb not null default '{}'::jsonb,     -- {uid: {placed: 연결된 PC 수}}
  points      jsonb not null default '{}'::jsonb,
  stats       jsonb not null default '{}'::jsonb,
  last        jsonb,
  winner      uuid,
  result      jsonb,
  scores      jsonb not null default '{}'::jsonb,
  skip_votes  uuid[] not null default '{}',
  version     int not null default 0,
  updated_at  timestamptz not null default now()
);
create table if not exists public.cbv_answers (
  room_code text not null references public.rooms(code) on delete cascade,
  idx       int not null,
  occ       int[] not null,                            -- 정답 칸 모양
  primary key (room_code, idx)
);
create table if not exists public.cbv_chats (
  id          bigserial primary key,
  room_code   text not null references public.rooms(code) on delete cascade,
  user_id     uuid,
  body        text not null,
  created_at  timestamptz not null default now()
);
create index if not exists cbv_chats_room on public.cbv_chats (room_code, id);
alter table public.cbv_games enable row level security;
alter table public.cbv_answers enable row level security;
alter table public.cbv_chats enable row level security;
drop policy if exists cbv_games_read on public.cbv_games;
create policy cbv_games_read on public.cbv_games for select to authenticated using (public.is_room_member(room_code));
drop policy if exists cbv_chats_read on public.cbv_chats;
create policy cbv_chats_read on public.cbv_chats for select to authenticated using (public.is_room_member(room_code));
alter table public.cbv_games replica identity full;
alter table public.cbv_chats replica identity full;
do $$ begin
  begin alter publication supabase_realtime add table public.cbv_games; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.cbv_chats; exception when duplicate_object then null; end;
end $$;

create or replace function public._cbv_lock(p_code text) returns cbv_games
language plpgsql security definer set search_path = public as $$
declare g cbv_games;
begin
  if not is_room_member(p_code) then raise exception 'NOT_MEMBER'; end if;
  select * into g from cbv_games where room_code = p_code for update;
  if not found then raise exception 'NO_GAME'; end if;
  return g;
end $$;

create or replace function public._cbv_sys(p_code text, p_body text) returns void
language sql security definer set search_path = public as $$
  insert into cbv_chats (room_code, user_id, body) values (p_code, null, p_body)
$$;

create or replace function public._cbv_name(p_code text, p_uid uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select nickname from room_players where room_code = p_code and user_id = p_uid), '?')
$$;

create or replace function public._cbv_puzzle(g cbv_games, p_round int) returns jsonb
language sql immutable as $$
  select g.puzzles -> ((p_round - 1) % jsonb_array_length(g.puzzles))
$$;

-- 대결 끝: 점수 순 (같으면 1등 횟수 같음 → 최고 기록 빠른 순)
create or replace function public._cbv_finish(p_code text, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare g cbv_games; w uuid; players jsonb := '{}'::jsonb; pid uuid;
begin
  select * into g from cbv_games where room_code = p_code;
  if g.phase <> 'play' then return; end if;
  foreach pid in array g.player_ids loop
    players := players || jsonb_build_object(pid::text, jsonb_build_object(
      'points', coalesce((g.points->>pid::text)::int, 0),
      'best', g.stats->pid::text->'best',
      'avg', case when coalesce((g.stats->pid::text->>'n')::int, 0) > 0 then ((g.stats->pid::text->>'sum')::int / (g.stats->pid::text->>'n')::int) end));
  end loop;
  select pid2 into w from unnest(g.player_ids) pid2
   where _liar_active(p_code, pid2)
   order by coalesce((g.points->>pid2::text)::int, 0) desc, coalesce((g.stats->pid2::text->>'best')::int, 2147483647) limit 1;
  update cbv_games set phase = 'result', winner = w, deadline = null, version = version + 1, updated_at = now(),
    result = jsonb_build_object('reason', p_reason, 'players', players, 'rounds', g.round),
    scores = case when w is null then scores else scores || jsonb_build_object(w::text, coalesce((scores->>w::text)::int, 0) + 1) end
  where room_code = p_code;
  perform _cbv_sys(p_code, '대결 끝! ' || coalesce(_cbv_name(p_code, w) || ' 님 1위', '승자 없음'));
end $$;

create or replace function public._cbv_finish(p_code text, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare g cbv_games; w uuid; players jsonb := '{}'::jsonb; pid uuid;
begin
  select * into g from cbv_games where room_code = p_code;
  if g.phase <> 'play' then return; end if;
  foreach pid in array g.player_ids loop
    players := players || jsonb_build_object(pid::text, jsonb_build_object(
      'points', coalesce((g.points->>pid::text)::int, 0),
      'best', g.stats->pid::text->'best',
      'avg', case when coalesce((g.stats->pid::text->>'n')::int, 0) > 0 then ((g.stats->pid::text->>'sum')::int / (g.stats->pid::text->>'n')::int) end));
  end loop;
  select pid2 into w from unnest(g.player_ids) pid2
   where _liar_active(p_code, pid2)
   order by coalesce((g.points->>pid2::text)::int, 0) desc, coalesce((g.stats->pid2::text->>'best')::int, 2147483647) limit 1;
  update cbv_games set phase = 'result', winner = w, deadline = null, version = version + 1, updated_at = now(),
    result = jsonb_build_object('reason', p_reason, 'players', players, 'rounds', g.round),
    scores = case when w is null then scores else scores || jsonb_build_object(w::text, coalesce((scores->>w::text)::int, 0) + 1) end
  where room_code = p_code;
  perform _cbv_sys(p_code, '대결 끝! ' || coalesce(_cbv_name(p_code, w) || ' 님 1위', '승자 없음'));
end $$;

create or replace function public._cbv_end_round(p_code text, p_winner uuid, p_ms int, p_reason text, p_occ jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare g cbv_games; pts int; st jsonb; ranks jsonb; next_start timestamptz := now() + interval '5 seconds';
begin
  select * into g from cbv_games where room_code = p_code;
  select coalesce(jsonb_agg(jsonb_build_object('id', pid, 'placed', coalesce((g.progress->pid::text->>'placed')::int, 0),
           'cells', coalesce(jsonb_array_length(g.progress->pid::text->'filled'), 0))), '[]'::jsonb)
    into ranks from unnest(g.player_ids) pid;
  if p_winner is not null then
    pts := coalesce((g.points->>p_winner::text)::int, 0) + 1;
    st := coalesce(g.stats->p_winner::text, '{}'::jsonb);
    if p_ms is not null then
      st := jsonb_build_object('best', least(coalesce((st->>'best')::int, p_ms), p_ms), 'n', coalesce((st->>'n')::int, 0) + 1, 'sum', coalesce((st->>'sum')::int, 0) + p_ms);
    end if;
    update cbv_games set points = points || jsonb_build_object(p_winner::text, pts), stats = stats || jsonb_build_object(p_winner::text, st) where room_code = p_code;
  end if;
  update cbv_games set version = version + 1, updated_at = now(),
    last = jsonb_build_object('round', g.round, 'winner', p_winner, 'ms', p_ms, 'reason', p_reason, 'occ', p_occ, 'ranks', ranks,
                              'puzzle', _cbv_puzzle(g, g.round), 'at', now())
  where room_code = p_code;
  perform _cbv_sys(p_code, g.round || '라운드 · ' || case when p_winner is not null then _cbv_name(p_code, p_winner) || ' 님 +1점' when p_reason = 'skip' then '넘기기 (정답 공개)' else '무승부' end);
  if p_winner is not null and pts >= g.target then perform _cbv_finish(p_code, 'target'); return; end if;
  update cbv_games set round = g.round + 1, progress = '{}'::jsonb, skip_votes = '{}', started_at = next_start,
    deadline = case when g.sec > 0 then next_start + make_interval(secs => g.sec) end
  where room_code = p_code;
end $$;

create or replace function public._cbv_check_alone(p_code text) returns boolean
language plpgsql security definer set search_path = public as $$
declare g cbv_games; n int;
begin
  select * into g from cbv_games where room_code = p_code;
  if g.phase <> 'play' then return true; end if;
  select count(*) into n from unnest(g.player_ids) pid where _liar_active(p_code, pid);
  if n <= 1 then perform _cbv_finish(p_code, 'alone'); return true; end if;
  return false;
end $$;

create or replace function public.cbv_start(p_code text, p_puzzles jsonb, p_answers jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare r rooms; prev cbv_games; players uuid[]; n int; lv text; tg int; sc int; st timestamptz := now() + interval '3 seconds';
begin
  p_code := upper(p_code);
  r := _require_host(p_code);
  if r.game <> 'cablevs' then raise exception 'BAD_GAME'; end if;
  select * into prev from cbv_games where room_code = p_code for update;
  if r.status <> 'waiting' and coalesce(prev.phase, '') <> 'result' then raise exception 'IN_PROGRESS'; end if;
  if jsonb_typeof(p_puzzles) <> 'array' or jsonb_array_length(p_puzzles) < 1 or jsonb_array_length(p_puzzles) > 40 or length(p_puzzles::text) > 200000 then raise exception 'BAD_PUZZLE'; end if;

  select array_agg(user_id order by joined_at) into players from room_players where room_code = p_code and left_at is null;
  n := coalesce(array_length(players, 1), 0);
  if n < 2 then raise exception 'NEED_PLAYERS_2'; end if;
  if n > 4 then raise exception 'MAX_PLAYERS_4'; end if;
  lv := coalesce(r.settings->>'cbLevel', 'normal'); if lv not in ('easy', 'normal', 'hard') then lv := 'normal'; end if;
  tg := coalesce((r.settings->>'cbTarget')::int, 3); if tg not in (3, 5) then tg := 3; end if;
  sc := 0; -- 라운드 시간 제한 없음 (못 풀면 넘기기)
  if jsonb_typeof(p_answers) <> 'array' or jsonb_array_length(p_answers) <> jsonb_array_length(p_puzzles) then raise exception 'BAD_PUZZLE'; end if;

  delete from cbv_chats where room_code = p_code;
  delete from cbv_answers where room_code = p_code;
  insert into cbv_answers (room_code, idx, occ) select p_code, (o - 1)::int, array(select jsonb_array_elements_text(a)::int) from jsonb_array_elements(p_answers) with ordinality t(a, o);
  insert into cbv_games (room_code, round_no, phase, player_ids, level, target, sec, puzzles, round, started_at, deadline, progress, points, stats, last, winner, result, scores, version)
  values (p_code, coalesce(prev.round_no, 0) + 1, 'play', players, lv, tg, sc, p_puzzles, 1, st,
          case when sc > 0 then st + make_interval(secs => sc) end, '{}', '{}', '{}', null, null, null, coalesce(prev.scores, '{}'::jsonb), 0)
  on conflict (room_code) do update set
    round_no = excluded.round_no, phase = 'play', player_ids = excluded.player_ids, level = lv, target = tg, sec = sc, puzzles = p_puzzles,
    round = 1, started_at = st, deadline = excluded.deadline, progress = '{}', points = '{}', stats = '{}', last = null, winner = null, result = null,
    version = 0, skip_votes = '{}', updated_at = now();
  update rooms set status = 'playing', last_active_at = now() where code = p_code;
  perform _cbv_sys(p_code, '시작! ' || tg || '점 먼저 · ' || case lv when 'easy' then '초급' when 'normal' then '중급' else '고급' end);
end $$;

create or replace function public.cbv_tick(p_code text) returns void
language plpgsql security definer set search_path = public as $$
declare g cbv_games;
begin
  p_code := upper(p_code);
  g := _cbv_lock(p_code);
  perform _cbv_check_alone(p_code);
end $$;

create or replace function public.cbv_state(p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := _require_uid(); g cbv_games;
begin
  p_code := upper(p_code);
  if not is_room_member(p_code) then raise exception 'NOT_MEMBER'; end if;
  select * into g from cbv_games where room_code = p_code;
  if not found then return null; end if;
  return jsonb_build_object(
    'roundNo', g.round_no, 'phase', g.phase, 'playerIds', to_jsonb(g.player_ids), 'level', g.level, 'target', g.target, 'sec', g.sec,
    'round', g.round, 'startedAt', g.started_at, 'deadline', g.deadline, 'now', now(), 'version', g.version,
    'puzzle', case when g.phase = 'play' then _cbv_puzzle(g, g.round) end,
    -- 남의 진행은 놓은 도형 수만 (어느 칸인지는 비공개)
    'progress', (select coalesce(jsonb_object_agg(k, jsonb_build_object('placed', coalesce((v->>'placed')::int, 0))), '{}'::jsonb) from jsonb_each(g.progress) e(k, v)),
    'points', g.points, 'last', g.last, 'winner', g.winner, 'result', g.result, 'scores', g.scores,
    'inGame', uid = any(g.player_ids), 'skipVotes', to_jsonb(g.skip_votes),
    'chats', (select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'userId', m.user_id, 'body', m.body, 'at', m.created_at) order by m.id), '[]'::jsonb)
                from (select * from cbv_chats where room_code = p_code order by id desc limit 120) m),
    'people', (select coalesce(jsonb_object_agg(user_id, jsonb_build_object('nickname', nickname, 'color', color)), '{}'::jsonb)
                 from room_players where room_code = p_code));
end $$;

create or replace function public.cbv_skip(p_code text, p_round int, p_vote boolean) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := _require_uid(); g cbv_games; votes uuid[]; need int; ans int[];
begin
  p_code := upper(p_code);
  g := _cbv_lock(p_code);
  if g.phase <> 'play' or g.round <> p_round or now() < g.started_at or not (uid = any(g.player_ids)) then return; end if;
  if not p_vote then
    if coalesce(array_length(g.skip_votes, 1), 0) > 0 then
      update cbv_games set skip_votes = '{}', version = version + 1, updated_at = now() where room_code = p_code;
      perform _cbv_sys(p_code, _cbv_name(p_code, uid) || ' 님: 계속 해볼게요');
    end if;
    return;
  end if;
  if uid = any(g.skip_votes) then return; end if;
  votes := g.skip_votes || uid;
  update cbv_games set skip_votes = votes, version = version + 1, updated_at = now() where room_code = p_code;
  if array_length(votes, 1) = 1 then perform _cbv_sys(p_code, _cbv_name(p_code, uid) || ' 님이 이 판 넘기기를 제안했어요'); end if;
  select count(*) into need from unnest(g.player_ids) pid where _liar_active(p_code, pid) and not (pid = any(votes));
  if need = 0 then
    select occ into ans from cbv_answers where room_code = p_code and idx = (g.round - 1) % jsonb_array_length(g.puzzles);
    perform _cbv_end_round(p_code, null, null, 'skip', to_jsonb(ans));
  end if;
end $$;

create or replace function public.cbv_chat(p_code text, p_text text) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := _require_uid(); t text := btrim(coalesce(p_text, ''));
begin
  p_code := upper(p_code);
  if not is_room_member(p_code) then raise exception 'NOT_MEMBER'; end if;
  if not exists (select 1 from cbv_games where room_code = p_code) then raise exception 'NO_GAME'; end if;
  if char_length(t) < 1 or char_length(t) > 200 then raise exception 'BAD_TEXT'; end if;
  insert into cbv_chats (room_code, user_id, body) values (p_code, uid, t);
end $$;

create or replace function public.cbv_to_waiting(p_code text) returns void
language plpgsql security definer set search_path = public as $$
declare r rooms; g cbv_games;
begin
  p_code := upper(p_code);
  r := _require_host(p_code);
  select * into g from cbv_games where room_code = p_code;
  if found and g.phase <> 'result' then raise exception 'IN_PROGRESS'; end if;
  update rooms set status = 'waiting', last_active_at = now() where code = p_code;
end $$;

-- 내 진행: 연결된 PC 수
create or replace function public.cbv_progress(p_code text, p_round int, p_pcs int) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := _require_uid(); g cbv_games;
begin
  p_code := upper(p_code);
  g := _cbv_lock(p_code);
  if g.phase <> 'play' or g.round <> p_round or now() < g.started_at or not (uid = any(g.player_ids)) then return; end if;
  update cbv_games set progress = progress || jsonb_build_object(uid::text, jsonb_build_object('placed', greatest(0, least(coalesce(p_pcs, 0), 200)))),
    version = version + 1, updated_at = now()
  where room_code = p_code;
end $$;

-- 칸 모양 돌리기 (위1 오른쪽2 아래4 왼쪽8)
create or replace function public._cbv_rot(m int) returns int language sql immutable as $$ select ((m << 1) | (m >> 3)) & 15 $$;

-- 다 이음. p_cells = 내 판의 칸 모양들. 서버가 검사: 처음 모양을 돌린 것인지 + 모두 이어지고 허공으로 뻗은 선 없음
create or replace function public.cbv_done(p_code text, p_round int, p_cells int[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := _require_uid(); g cbv_games; pz jsonb; w int; h int; n int; srv int; i int; o int; m int; x int; y int; j int;
  seen boolean[]; q int[]; qi int; cnt int; ms int;
begin
  p_code := upper(p_code);
  g := _cbv_lock(p_code);
  if g.phase <> 'play' or not (uid = any(g.player_ids)) or g.round <> p_round or now() < g.started_at then return jsonb_build_object('ok', false, 'late', true); end if;
  pz := _cbv_puzzle(g, g.round);
  w := (pz->>'w')::int; h := (pz->>'h')::int; n := w * h; srv := (pz->>'server')::int;
  if coalesce(array_length(p_cells, 1), 0) <> n then raise exception 'BAD_LAYOUT'; end if;
  for i in 1..n loop
    o := (pz->'cells'->>(i - 1))::int; m := p_cells[i];
    if m is null or not (m = o or m = _cbv_rot(o) or m = _cbv_rot(_cbv_rot(o)) or m = _cbv_rot(_cbv_rot(_cbv_rot(o)))) then raise exception 'BAD_LAYOUT'; end if;
    x := (i - 1) % w; y := (i - 1) / w;
    -- 뻗은 선마다 옆 칸이 받아줘야 함
    if m & 1 > 0 and (y = 0 or p_cells[i - w] & 4 = 0) then raise exception 'BAD_LAYOUT'; end if;
    if m & 2 > 0 and (x = w - 1 or p_cells[i + 1] & 8 = 0) then raise exception 'BAD_LAYOUT'; end if;
    if m & 4 > 0 and (y = h - 1 or p_cells[i + w] & 1 = 0) then raise exception 'BAD_LAYOUT'; end if;
    if m & 8 > 0 and (x = 0 or p_cells[i - 1] & 2 = 0) then raise exception 'BAD_LAYOUT'; end if;
  end loop;
  -- 서버에서 모든 칸이 이어지는지
  seen := array_fill(false, array[n]); seen[srv + 1] := true; q := array[srv]; qi := 1; cnt := 1;
  while qi <= array_length(q, 1) loop
    i := q[qi]; qi := qi + 1; m := p_cells[i + 1];
    foreach j in array array[case when m & 1 > 0 then i - w end, case when m & 2 > 0 then i + 1 end, case when m & 4 > 0 then i + w end, case when m & 8 > 0 then i - 1 end] loop
      if j is not null and not seen[j + 1] then seen[j + 1] := true; q := q || j; cnt := cnt + 1; end if;
    end loop;
  end loop;
  if cnt <> n then raise exception 'BAD_LAYOUT'; end if;
  ms := (extract(epoch from now() - g.started_at) * 1000)::int;
  update cbv_games set progress = progress || jsonb_build_object(uid::text, jsonb_build_object('placed', 999)) where room_code = p_code;
  perform _cbv_end_round(p_code, uid, ms, 'done', to_jsonb(p_cells));
  return jsonb_build_object('ok', true, 'ms', ms);
end $$;

do $$
declare f text;
begin
  foreach f in array array['_cbv_lock(text)', '_cbv_sys(text, text)', '_cbv_name(text, uuid)', '_cbv_finish(text, text)',
    '_cbv_end_round(text, uuid, int, text, jsonb)', '_cbv_check_alone(text)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
  foreach f in array array['cbv_start(text, jsonb, jsonb)', 'cbv_progress(text, int, int)', 'cbv_done(text, int, int[])', 'cbv_tick(text)',
    'cbv_skip(text, int, boolean)', 'cbv_state(text)', 'cbv_chat(text, text)', 'cbv_to_waiting(text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;


-- ════════ 0013_battle_target_1to5.sql ════════
-- 월루: 도형 배치 대결·케이블 연결 대결 승리 조건에 1~5점 모두 선택 가능하게 (2026-11-23)

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
  -- 5건 승인
  if (p_settings->>'limitMin')       in ('0','3','5','10','15')  then s := s || jsonb_build_object('limitMin',       (p_settings->>'limitMin')::int); end if;
  -- 도형 배치 대결
  if (p_settings->>'shLevel')        in ('easy','normal','hard','expert') then s := s || jsonb_build_object('shLevel', p_settings->>'shLevel'); end if;
  if (p_settings->>'shTarget')       in ('1','2','3','4','5')            then s := s || jsonb_build_object('shTarget',       (p_settings->>'shTarget')::int); end if;
  if (p_settings->>'shSec')          in ('0','60','90')      then s := s || jsonb_build_object('shSec',          (p_settings->>'shSec')::int); end if;
  -- 알까기
  if (p_settings->>'alkN')           in ('3','5','7')        then s := s || jsonb_build_object('alkN',           (p_settings->>'alkN')::int); end if;
  if (p_settings->>'alkTarget')      in ('1','2','3')        then s := s || jsonb_build_object('alkTarget',      (p_settings->>'alkTarget')::int); end if;
  if (p_settings->>'alkSec')         in ('0','15','30')      then s := s || jsonb_build_object('alkSec',         (p_settings->>'alkSec')::int); end if;
  if (p_settings->>'alkPlace')       in ('free','line')      then s := s || jsonb_build_object('alkPlace', p_settings->>'alkPlace'); end if;
  -- 케이블 연결 대결
  if (p_settings->>'cbLevel')        in ('easy','normal','hard') then s := s || jsonb_build_object('cbLevel', p_settings->>'cbLevel'); end if;
  if (p_settings->>'cbTarget')       in ('1','2','3','4','5')            then s := s || jsonb_build_object('cbTarget',       (p_settings->>'cbTarget')::int); end if;
  update rooms set settings = s, last_active_at = now() where code = r.code;
end $$;

create or replace function public.shv_start(p_code text, p_puzzles jsonb, p_answers jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare r rooms; prev shv_games; players uuid[]; n int; lv text; tg int; sc int; st timestamptz := now() + interval '3 seconds';
begin
  p_code := upper(p_code);
  r := _require_host(p_code);
  if r.game <> 'shapevs' then raise exception 'BAD_GAME'; end if;
  select * into prev from shv_games where room_code = p_code for update;
  if r.status <> 'waiting' and coalesce(prev.phase, '') <> 'result' then raise exception 'IN_PROGRESS'; end if;
  if jsonb_typeof(p_puzzles) <> 'array' or jsonb_array_length(p_puzzles) < 1 or jsonb_array_length(p_puzzles) > 40 or length(p_puzzles::text) > 200000 then raise exception 'BAD_PUZZLE'; end if;

  select array_agg(user_id order by joined_at) into players from room_players where room_code = p_code and left_at is null;
  n := coalesce(array_length(players, 1), 0);
  if n < 2 then raise exception 'NEED_PLAYERS_2'; end if;
  if n > 4 then raise exception 'MAX_PLAYERS_4'; end if;
  lv := coalesce(r.settings->>'shLevel', 'normal'); if lv not in ('easy', 'normal', 'hard', 'expert') then lv := 'normal'; end if;
  tg := coalesce((r.settings->>'shTarget')::int, 3); if tg not between 1 and 5 then tg := 3; end if;
  sc := 0; -- 라운드 시간 제한 없음 (못 풀면 넘기기)
  if jsonb_typeof(p_answers) <> 'array' or jsonb_array_length(p_answers) <> jsonb_array_length(p_puzzles) then raise exception 'BAD_PUZZLE'; end if;

  delete from shv_chats where room_code = p_code;
  delete from shv_answers where room_code = p_code;
  insert into shv_answers (room_code, idx, occ) select p_code, (o - 1)::int, array(select jsonb_array_elements_text(a)::int) from jsonb_array_elements(p_answers) with ordinality t(a, o);
  insert into shv_games (room_code, round_no, phase, player_ids, level, target, sec, puzzles, round, started_at, deadline, progress, points, stats, last, winner, result, scores, version)
  values (p_code, coalesce(prev.round_no, 0) + 1, 'play', players, lv, tg, sc, p_puzzles, 1, st,
          case when sc > 0 then st + make_interval(secs => sc) end, '{}', '{}', '{}', null, null, null, coalesce(prev.scores, '{}'::jsonb), 0)
  on conflict (room_code) do update set
    round_no = excluded.round_no, phase = 'play', player_ids = excluded.player_ids, level = lv, target = tg, sec = sc, puzzles = p_puzzles,
    round = 1, started_at = st, deadline = excluded.deadline, progress = '{}', points = '{}', stats = '{}', last = null, winner = null, result = null,
    version = 0, skip_votes = '{}', updated_at = now();
  update rooms set status = 'playing', last_active_at = now() where code = p_code;
  perform _shv_sys(p_code, '시작! ' || tg || '점 먼저 · ' || case lv when 'easy' then '초급' when 'normal' then '중급' when 'hard' then '고급' else '전문가' end);
end $$;

create or replace function public.cbv_start(p_code text, p_puzzles jsonb, p_answers jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare r rooms; prev cbv_games; players uuid[]; n int; lv text; tg int; sc int; st timestamptz := now() + interval '3 seconds';
begin
  p_code := upper(p_code);
  r := _require_host(p_code);
  if r.game <> 'cablevs' then raise exception 'BAD_GAME'; end if;
  select * into prev from cbv_games where room_code = p_code for update;
  if r.status <> 'waiting' and coalesce(prev.phase, '') <> 'result' then raise exception 'IN_PROGRESS'; end if;
  if jsonb_typeof(p_puzzles) <> 'array' or jsonb_array_length(p_puzzles) < 1 or jsonb_array_length(p_puzzles) > 40 or length(p_puzzles::text) > 200000 then raise exception 'BAD_PUZZLE'; end if;

  select array_agg(user_id order by joined_at) into players from room_players where room_code = p_code and left_at is null;
  n := coalesce(array_length(players, 1), 0);
  if n < 2 then raise exception 'NEED_PLAYERS_2'; end if;
  if n > 4 then raise exception 'MAX_PLAYERS_4'; end if;
  lv := coalesce(r.settings->>'cbLevel', 'normal'); if lv not in ('easy', 'normal', 'hard') then lv := 'normal'; end if;
  tg := coalesce((r.settings->>'cbTarget')::int, 3); if tg not between 1 and 5 then tg := 3; end if;
  sc := 0; -- 라운드 시간 제한 없음 (못 풀면 넘기기)
  if jsonb_typeof(p_answers) <> 'array' or jsonb_array_length(p_answers) <> jsonb_array_length(p_puzzles) then raise exception 'BAD_PUZZLE'; end if;

  delete from cbv_chats where room_code = p_code;
  delete from cbv_answers where room_code = p_code;
  insert into cbv_answers (room_code, idx, occ) select p_code, (o - 1)::int, array(select jsonb_array_elements_text(a)::int) from jsonb_array_elements(p_answers) with ordinality t(a, o);
  insert into cbv_games (room_code, round_no, phase, player_ids, level, target, sec, puzzles, round, started_at, deadline, progress, points, stats, last, winner, result, scores, version)
  values (p_code, coalesce(prev.round_no, 0) + 1, 'play', players, lv, tg, sc, p_puzzles, 1, st,
          case when sc > 0 then st + make_interval(secs => sc) end, '{}', '{}', '{}', null, null, null, coalesce(prev.scores, '{}'::jsonb), 0)
  on conflict (room_code) do update set
    round_no = excluded.round_no, phase = 'play', player_ids = excluded.player_ids, level = lv, target = tg, sec = sc, puzzles = p_puzzles,
    round = 1, started_at = st, deadline = excluded.deadline, progress = '{}', points = '{}', stats = '{}', last = null, winner = null, result = null,
    version = 0, skip_votes = '{}', updated_at = now();
  update rooms set status = 'playing', last_active_at = now() where code = p_code;
  perform _cbv_sys(p_code, '시작! ' || tg || '점 먼저 · ' || case lv when 'easy' then '초급' when 'normal' then '중급' else '고급' end);
end $$;


-- ════════ 0014_link_battle.sql ════════
-- 월루: 셀 링크 대결 (2~4명, 같은 판 동시에 · 먼저 다 채우면 1점 · 넘기기) (2026-11-26)
-- 「케이블 연결 대결」(cbv_*)과 같은 구조. 판(끝점)은 방장 브라우저가 올리고 정답 경로는 lkv_answers(읽기 정책 없음)에
-- 남의 진행은 연결한 쌍 수·칸 채움 %만 공개. 완료는 서버가 경로를 직접 검사

create or replace function public._max_players_for(p_game text) returns int language sql immutable as $$
  select case when p_game = 'alkkagi' then 2 when p_game in ('bell', 'shapevs', 'cablevs', 'linkvs') then 4 else 8 end
$$;

create or replace function public.create_room(p_game text) returns text
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := _require_uid();
  chars text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  c text;
  i int;
begin
  if p_game not in ('liar', 'bingo', 'bell', 'shapevs', 'alkkagi', 'cablevs', 'linkvs') then raise exception 'BAD_GAME'; end if;

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
            when 'bell' then jsonb_build_object('limitMin', 10)
            when 'shapevs' then jsonb_build_object('shLevel', 'normal', 'shTarget', 3, 'shSec', 90)
            when 'cablevs' then jsonb_build_object('cbLevel', 'normal', 'cbTarget', 3)
            when 'linkvs' then jsonb_build_object('lkLevel', 'normal', 'lkTarget', 3)
            when 'alkkagi' then jsonb_build_object('alkN', 5, 'alkTarget', 2, 'alkSec', 15, 'alkPlace', 'free')
            else jsonb_build_object('category', 'random', 'hintRounds', 2, 'hintSeconds', 30, 'discussSeconds', 90)
          end);
  insert into room_secrets (code) values (c);
  return c;
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
  -- 5건 승인
  if (p_settings->>'limitMin')       in ('0','3','5','10','15')  then s := s || jsonb_build_object('limitMin',       (p_settings->>'limitMin')::int); end if;
  -- 도형 배치 대결
  if (p_settings->>'shLevel')        in ('easy','normal','hard','expert') then s := s || jsonb_build_object('shLevel', p_settings->>'shLevel'); end if;
  if (p_settings->>'shTarget')       in ('1','2','3','4','5')            then s := s || jsonb_build_object('shTarget',       (p_settings->>'shTarget')::int); end if;
  if (p_settings->>'shSec')          in ('0','60','90')      then s := s || jsonb_build_object('shSec',          (p_settings->>'shSec')::int); end if;
  -- 알까기
  if (p_settings->>'alkN')           in ('3','5','7')        then s := s || jsonb_build_object('alkN',           (p_settings->>'alkN')::int); end if;
  if (p_settings->>'alkTarget')      in ('1','2','3')        then s := s || jsonb_build_object('alkTarget',      (p_settings->>'alkTarget')::int); end if;
  if (p_settings->>'alkSec')         in ('0','15','30')      then s := s || jsonb_build_object('alkSec',         (p_settings->>'alkSec')::int); end if;
  if (p_settings->>'alkPlace')       in ('free','line')      then s := s || jsonb_build_object('alkPlace', p_settings->>'alkPlace'); end if;
  -- 케이블 연결 대결
  if (p_settings->>'cbLevel')        in ('easy','normal','hard') then s := s || jsonb_build_object('cbLevel', p_settings->>'cbLevel'); end if;
  if (p_settings->>'cbTarget')       in ('1','2','3','4','5')            then s := s || jsonb_build_object('cbTarget',       (p_settings->>'cbTarget')::int); end if;
  -- 셀 링크 대결
  if (p_settings->>'lkLevel')        in ('easy','normal','hard') then s := s || jsonb_build_object('lkLevel', p_settings->>'lkLevel'); end if;
  if (p_settings->>'lkTarget')       in ('1','2','3','4','5')            then s := s || jsonb_build_object('lkTarget',       (p_settings->>'lkTarget')::int); end if;
  update rooms set settings = s, last_active_at = now() where code = r.code;
end $$;

create table if not exists public.lkv_games (
  room_code   text primary key references public.rooms(code) on delete cascade,
  round_no    int not null default 0,
  phase       text not null,
  player_ids  uuid[] not null,
  level       text not null,
  target      int not null,
  sec         int not null default 0,
  puzzles     jsonb not null,                         -- [{n, ends: [[a,b], ...]}]
  round       int not null default 1,
  started_at  timestamptz not null,
  deadline    timestamptz,
  progress    jsonb not null default '{}'::jsonb,     -- {uid: {placed: 연결한 쌍 수, pct: 칸 채움 %}}
  points      jsonb not null default '{}'::jsonb,
  stats       jsonb not null default '{}'::jsonb,
  last        jsonb,
  winner      uuid,
  result      jsonb,
  scores      jsonb not null default '{}'::jsonb,
  skip_votes  uuid[] not null default '{}',
  version     int not null default 0,
  updated_at  timestamptz not null default now()
);
create table if not exists public.lkv_answers (
  room_code text not null references public.rooms(code) on delete cascade,
  idx       int not null,
  sol       jsonb not null,                            -- 정답 경로 [[칸...], ...]
  primary key (room_code, idx)
);
create table if not exists public.lkv_chats (
  id          bigserial primary key,
  room_code   text not null references public.rooms(code) on delete cascade,
  user_id     uuid,
  body        text not null,
  created_at  timestamptz not null default now()
);
create index if not exists lkv_chats_room on public.lkv_chats (room_code, id);
alter table public.lkv_games enable row level security;
alter table public.lkv_answers enable row level security;
alter table public.lkv_chats enable row level security;
drop policy if exists lkv_games_read on public.lkv_games;
create policy lkv_games_read on public.lkv_games for select to authenticated using (public.is_room_member(room_code));
drop policy if exists lkv_chats_read on public.lkv_chats;
create policy lkv_chats_read on public.lkv_chats for select to authenticated using (public.is_room_member(room_code));
alter table public.lkv_games replica identity full;
alter table public.lkv_chats replica identity full;
do $$ begin
  begin alter publication supabase_realtime add table public.lkv_games; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.lkv_chats; exception when duplicate_object then null; end;
end $$;

create or replace function public._lkv_lock(p_code text) returns lkv_games
language plpgsql security definer set search_path = public as $$
declare g lkv_games;
begin
  if not is_room_member(p_code) then raise exception 'NOT_MEMBER'; end if;
  select * into g from lkv_games where room_code = p_code for update;
  if not found then raise exception 'NO_GAME'; end if;
  return g;
end $$;

create or replace function public._lkv_sys(p_code text, p_body text) returns void
language sql security definer set search_path = public as $$
  insert into lkv_chats (room_code, user_id, body) values (p_code, null, p_body)
$$;

create or replace function public._lkv_name(p_code text, p_uid uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select nickname from room_players where room_code = p_code and user_id = p_uid), '?')
$$;

create or replace function public._lkv_puzzle(g lkv_games, p_round int) returns jsonb
language sql immutable as $$
  select g.puzzles -> ((p_round - 1) % jsonb_array_length(g.puzzles))
$$;

-- 대결 끝: 점수 순 (같으면 최고 기록 빠른 순)
create or replace function public._lkv_finish(p_code text, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare g lkv_games; w uuid; players jsonb := '{}'::jsonb; pid uuid;
begin
  select * into g from lkv_games where room_code = p_code;
  if g.phase <> 'play' then return; end if;
  foreach pid in array g.player_ids loop
    players := players || jsonb_build_object(pid::text, jsonb_build_object(
      'points', coalesce((g.points->>pid::text)::int, 0),
      'best', g.stats->pid::text->'best',
      'avg', case when coalesce((g.stats->pid::text->>'n')::int, 0) > 0 then ((g.stats->pid::text->>'sum')::int / (g.stats->pid::text->>'n')::int) end));
  end loop;
  select pid2 into w from unnest(g.player_ids) pid2
   where _liar_active(p_code, pid2)
   order by coalesce((g.points->>pid2::text)::int, 0) desc, coalesce((g.stats->pid2::text->>'best')::int, 2147483647) limit 1;
  update lkv_games set phase = 'result', winner = w, deadline = null, version = version + 1, updated_at = now(),
    result = jsonb_build_object('reason', p_reason, 'players', players, 'rounds', g.round),
    scores = case when w is null then scores else scores || jsonb_build_object(w::text, coalesce((scores->>w::text)::int, 0) + 1) end
  where room_code = p_code;
  perform _lkv_sys(p_code, '대결 끝! ' || coalesce(_lkv_name(p_code, w) || ' 님 1위', '승자 없음'));
end $$;

create or replace function public._lkv_end_round(p_code text, p_winner uuid, p_ms int, p_reason text, p_paths jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare g lkv_games; pts int; st jsonb; ranks jsonb; next_start timestamptz := now() + interval '5 seconds';
begin
  select * into g from lkv_games where room_code = p_code;
  select coalesce(jsonb_agg(jsonb_build_object('id', pid, 'placed', coalesce((g.progress->pid::text->>'placed')::int, 0),
           'pct', coalesce((g.progress->pid::text->>'pct')::int, 0))), '[]'::jsonb)
    into ranks from unnest(g.player_ids) pid;
  if p_winner is not null then
    pts := coalesce((g.points->>p_winner::text)::int, 0) + 1;
    st := coalesce(g.stats->p_winner::text, '{}'::jsonb);
    if p_ms is not null then
      st := jsonb_build_object('best', least(coalesce((st->>'best')::int, p_ms), p_ms), 'n', coalesce((st->>'n')::int, 0) + 1, 'sum', coalesce((st->>'sum')::int, 0) + p_ms);
    end if;
    update lkv_games set points = points || jsonb_build_object(p_winner::text, pts), stats = stats || jsonb_build_object(p_winner::text, st) where room_code = p_code;
  end if;
  update lkv_games set version = version + 1, updated_at = now(),
    last = jsonb_build_object('round', g.round, 'winner', p_winner, 'ms', p_ms, 'reason', p_reason, 'paths', p_paths, 'ranks', ranks,
                              'puzzle', _lkv_puzzle(g, g.round), 'at', now())
  where room_code = p_code;
  perform _lkv_sys(p_code, g.round || '라운드 · ' || case when p_winner is not null then _lkv_name(p_code, p_winner) || ' 님 +1점' when p_reason = 'skip' then '넘기기 (정답 공개)' else '무승부' end);
  if p_winner is not null and pts >= g.target then perform _lkv_finish(p_code, 'target'); return; end if;
  update lkv_games set round = g.round + 1, progress = '{}'::jsonb, skip_votes = '{}', started_at = next_start,
    deadline = case when g.sec > 0 then next_start + make_interval(secs => g.sec) end
  where room_code = p_code;
end $$;

create or replace function public._lkv_check_alone(p_code text) returns boolean
language plpgsql security definer set search_path = public as $$
declare g lkv_games; n int;
begin
  select * into g from lkv_games where room_code = p_code;
  if g.phase <> 'play' then return true; end if;
  select count(*) into n from unnest(g.player_ids) pid where _liar_active(p_code, pid);
  if n <= 1 then perform _lkv_finish(p_code, 'alone'); return true; end if;
  return false;
end $$;

create or replace function public.lkv_start(p_code text, p_puzzles jsonb, p_answers jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare r rooms; prev lkv_games; players uuid[]; n int; lv text; tg int; sc int; st timestamptz := now() + interval '3 seconds';
begin
  p_code := upper(p_code);
  r := _require_host(p_code);
  if r.game <> 'linkvs' then raise exception 'BAD_GAME'; end if;
  select * into prev from lkv_games where room_code = p_code for update;
  if r.status <> 'waiting' and coalesce(prev.phase, '') <> 'result' then raise exception 'IN_PROGRESS'; end if;
  if jsonb_typeof(p_puzzles) <> 'array' or jsonb_array_length(p_puzzles) < 1 or jsonb_array_length(p_puzzles) > 40 or length(p_puzzles::text) > 200000 then raise exception 'BAD_PUZZLE'; end if;
  if jsonb_typeof(p_answers) <> 'array' or jsonb_array_length(p_answers) <> jsonb_array_length(p_puzzles) or length(p_answers::text) > 400000 then raise exception 'BAD_PUZZLE'; end if;

  select array_agg(user_id order by joined_at) into players from room_players where room_code = p_code and left_at is null;
  n := coalesce(array_length(players, 1), 0);
  if n < 2 then raise exception 'NEED_PLAYERS_2'; end if;
  if n > 4 then raise exception 'MAX_PLAYERS_4'; end if;
  lv := coalesce(r.settings->>'lkLevel', 'normal'); if lv not in ('easy', 'normal', 'hard') then lv := 'normal'; end if;
  tg := coalesce((r.settings->>'lkTarget')::int, 3); if tg not between 1 and 5 then tg := 3; end if;
  sc := 0; -- 라운드 시간 제한 없음 (못 풀면 넘기기)

  delete from lkv_chats where room_code = p_code;
  delete from lkv_answers where room_code = p_code;
  insert into lkv_answers (room_code, idx, sol) select p_code, (o - 1)::int, a from jsonb_array_elements(p_answers) with ordinality t(a, o);
  insert into lkv_games (room_code, round_no, phase, player_ids, level, target, sec, puzzles, round, started_at, deadline, progress, points, stats, last, winner, result, scores, version)
  values (p_code, coalesce(prev.round_no, 0) + 1, 'play', players, lv, tg, sc, p_puzzles, 1, st,
          case when sc > 0 then st + make_interval(secs => sc) end, '{}', '{}', '{}', null, null, null, coalesce(prev.scores, '{}'::jsonb), 0)
  on conflict (room_code) do update set
    round_no = excluded.round_no, phase = 'play', player_ids = excluded.player_ids, level = lv, target = tg, sec = sc, puzzles = p_puzzles,
    round = 1, started_at = st, deadline = excluded.deadline, progress = '{}', points = '{}', stats = '{}', last = null, winner = null, result = null,
    version = 0, skip_votes = '{}', updated_at = now();
  update rooms set status = 'playing', last_active_at = now() where code = p_code;
  perform _lkv_sys(p_code, '시작! ' || tg || '점 먼저 · ' || case lv when 'easy' then '초급' when 'normal' then '중급' else '고급' end);
end $$;

create or replace function public.lkv_tick(p_code text) returns void
language plpgsql security definer set search_path = public as $$
declare g lkv_games;
begin
  p_code := upper(p_code);
  g := _lkv_lock(p_code);
  perform _lkv_check_alone(p_code);
end $$;

create or replace function public.lkv_state(p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := _require_uid(); g lkv_games;
begin
  p_code := upper(p_code);
  if not is_room_member(p_code) then raise exception 'NOT_MEMBER'; end if;
  select * into g from lkv_games where room_code = p_code;
  if not found then return null; end if;
  return jsonb_build_object(
    'roundNo', g.round_no, 'phase', g.phase, 'playerIds', to_jsonb(g.player_ids), 'level', g.level, 'target', g.target, 'sec', g.sec,
    'round', g.round, 'startedAt', g.started_at, 'deadline', g.deadline, 'now', now(), 'version', g.version,
    'puzzle', case when g.phase = 'play' then _lkv_puzzle(g, g.round) end,
    -- 남의 진행은 연결한 쌍 수·칸 채움 %만 (어느 칸인지는 비공개)
    'progress', (select coalesce(jsonb_object_agg(k, jsonb_build_object('placed', coalesce((v->>'placed')::int, 0), 'pct', coalesce((v->>'pct')::int, 0))), '{}'::jsonb) from jsonb_each(g.progress) e(k, v)),
    'points', g.points, 'last', g.last, 'winner', g.winner, 'result', g.result, 'scores', g.scores,
    'inGame', uid = any(g.player_ids), 'skipVotes', to_jsonb(g.skip_votes),
    'chats', (select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'userId', m.user_id, 'body', m.body, 'at', m.created_at) order by m.id), '[]'::jsonb)
                from (select * from lkv_chats where room_code = p_code order by id desc limit 120) m),
    'people', (select coalesce(jsonb_object_agg(user_id, jsonb_build_object('nickname', nickname, 'color', color)), '{}'::jsonb)
                 from room_players where room_code = p_code));
end $$;

create or replace function public.lkv_skip(p_code text, p_round int, p_vote boolean) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := _require_uid(); g lkv_games; votes uuid[]; need int; ans jsonb;
begin
  p_code := upper(p_code);
  g := _lkv_lock(p_code);
  if g.phase <> 'play' or g.round <> p_round or now() < g.started_at or not (uid = any(g.player_ids)) then return; end if;
  if not p_vote then
    if coalesce(array_length(g.skip_votes, 1), 0) > 0 then
      update lkv_games set skip_votes = '{}', version = version + 1, updated_at = now() where room_code = p_code;
      perform _lkv_sys(p_code, _lkv_name(p_code, uid) || ' 님: 계속 해볼게요');
    end if;
    return;
  end if;
  if uid = any(g.skip_votes) then return; end if;
  votes := g.skip_votes || uid;
  update lkv_games set skip_votes = votes, version = version + 1, updated_at = now() where room_code = p_code;
  if array_length(votes, 1) = 1 then perform _lkv_sys(p_code, _lkv_name(p_code, uid) || ' 님이 이 판 넘기기를 제안했어요'); end if;
  select count(*) into need from unnest(g.player_ids) pid where _liar_active(p_code, pid) and not (pid = any(votes));
  if need = 0 then
    select sol into ans from lkv_answers where room_code = p_code and idx = (g.round - 1) % jsonb_array_length(g.puzzles);
    perform _lkv_end_round(p_code, null, null, 'skip', ans);
  end if;
end $$;

create or replace function public.lkv_chat(p_code text, p_text text) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := _require_uid(); t text := btrim(coalesce(p_text, ''));
begin
  p_code := upper(p_code);
  if not is_room_member(p_code) then raise exception 'NOT_MEMBER'; end if;
  if not exists (select 1 from lkv_games where room_code = p_code) then raise exception 'NO_GAME'; end if;
  if char_length(t) < 1 or char_length(t) > 200 then raise exception 'BAD_TEXT'; end if;
  insert into lkv_chats (room_code, user_id, body) values (p_code, uid, t);
end $$;

create or replace function public.lkv_to_waiting(p_code text) returns void
language plpgsql security definer set search_path = public as $$
declare r rooms; g lkv_games;
begin
  p_code := upper(p_code);
  r := _require_host(p_code);
  select * into g from lkv_games where room_code = p_code;
  if found and g.phase <> 'result' then raise exception 'IN_PROGRESS'; end if;
  update rooms set status = 'waiting', last_active_at = now() where code = p_code;
end $$;

-- 내 진행: 연결한 쌍 수 · 칸 채움 %
create or replace function public.lkv_progress(p_code text, p_round int, p_linked int, p_pct int) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := _require_uid(); g lkv_games;
begin
  p_code := upper(p_code);
  g := _lkv_lock(p_code);
  if g.phase <> 'play' or g.round <> p_round or now() < g.started_at or not (uid = any(g.player_ids)) then return; end if;
  update lkv_games set progress = progress || jsonb_build_object(uid::text, jsonb_build_object(
      'placed', greatest(0, least(coalesce(p_linked, 0), 20)), 'pct', greatest(0, least(coalesce(p_pct, 0), 100)))),
    version = version + 1, updated_at = now()
  where room_code = p_code;
end $$;

-- 다 채움. p_paths = 색마다 칸 목록. 서버가 검사: 끝점끼리 이어짐 · 옆 칸으로만 · 칸 중복 없음 · 판 전체를 채움
create or replace function public.lkv_done(p_code text, p_round int, p_paths jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := _require_uid(); g lkv_games; pz jsonb; n int; k int; c int; i int; len int; a int; b int; f int; l int; cell int; prev int;
  seen boolean[]; cnt int := 0; path jsonb; ms int;
begin
  p_code := upper(p_code);
  g := _lkv_lock(p_code);
  if g.phase <> 'play' or not (uid = any(g.player_ids)) or g.round <> p_round or now() < g.started_at then return jsonb_build_object('ok', false, 'late', true); end if;
  pz := _lkv_puzzle(g, g.round);
  n := (pz->>'n')::int; k := jsonb_array_length(pz->'ends');
  if jsonb_typeof(p_paths) <> 'array' or jsonb_array_length(p_paths) <> k then raise exception 'BAD_LAYOUT'; end if;
  seen := array_fill(false, array[n * n]);
  for c in 0..k - 1 loop
    path := p_paths->c;
    if jsonb_typeof(path) <> 'array' then raise exception 'BAD_LAYOUT'; end if;
    len := jsonb_array_length(path);
    if len < 2 then raise exception 'BAD_LAYOUT'; end if;
    a := (pz->'ends'->c->>0)::int; b := (pz->'ends'->c->>1)::int;
    f := (path->>0)::int; l := (path->>(len - 1))::int;
    if not ((f = a and l = b) or (f = b and l = a)) then raise exception 'BAD_LAYOUT'; end if;
    prev := null;
    for i in 0..len - 1 loop
      cell := (path->>i)::int;
      if cell is null or cell < 0 or cell >= n * n or seen[cell + 1] then raise exception 'BAD_LAYOUT'; end if;
      if prev is not null and not (abs(cell - prev) = n or (abs(cell - prev) = 1 and cell / n = prev / n)) then raise exception 'BAD_LAYOUT'; end if;
      seen[cell + 1] := true; cnt := cnt + 1; prev := cell;
    end loop;
  end loop;
  if cnt <> n * n then raise exception 'BAD_LAYOUT'; end if;
  ms := (extract(epoch from now() - g.started_at) * 1000)::int;
  update lkv_games set progress = progress || jsonb_build_object(uid::text, jsonb_build_object('placed', k, 'pct', 100)) where room_code = p_code;
  perform _lkv_end_round(p_code, uid, ms, 'done', p_paths);
  return jsonb_build_object('ok', true, 'ms', ms);
end $$;

do $$
declare f text;
begin
  foreach f in array array['_lkv_lock(text)', '_lkv_sys(text, text)', '_lkv_name(text, uuid)', '_lkv_finish(text, text)',
    '_lkv_end_round(text, uuid, int, text, jsonb)', '_lkv_check_alone(text)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
  foreach f in array array['lkv_start(text, jsonb, jsonb)', 'lkv_progress(text, int, int, int)', 'lkv_done(text, int, jsonb)', 'lkv_tick(text)',
    'lkv_skip(text, int, boolean)', 'lkv_state(text)', 'lkv_chat(text, text)', 'lkv_to_waiting(text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

