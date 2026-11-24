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
