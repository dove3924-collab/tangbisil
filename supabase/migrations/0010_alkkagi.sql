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
