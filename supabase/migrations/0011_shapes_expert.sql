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
