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
