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
