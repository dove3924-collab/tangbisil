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
