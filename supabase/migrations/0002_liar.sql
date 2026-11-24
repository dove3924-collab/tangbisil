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
