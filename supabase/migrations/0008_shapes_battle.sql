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
