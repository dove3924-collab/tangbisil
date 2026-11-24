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
