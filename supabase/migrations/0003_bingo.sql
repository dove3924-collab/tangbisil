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
