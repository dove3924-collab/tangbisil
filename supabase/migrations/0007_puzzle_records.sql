-- 월루: 퍼즐 전사 기록 (스도쿠·지뢰찾기, 난이도별 TOP 5) (2026-11-17)
-- 한 사람(익명 로그인 id) 한 줄 = 그 난이도 최고 기록. 이름이 없으면 순위표에 안 보임(hidden)

create table if not exists public.puzzle_records (
  game       text not null,
  level      text not null,
  user_id    uuid not null,
  nickname   text,
  ms         int  not null,
  hidden     boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (game, level, user_id)
);
create index if not exists puzzle_records_rank on public.puzzle_records (game, level, ms, created_at);
alter table public.puzzle_records enable row level security; -- 읽기 정책 없음 = RPC로만

-- 너무 빠른 기록은 거절 (밀리초)
create or replace function public._puzzle_min_ms(p_game text, p_level text) returns int language sql immutable as $$
  select case p_game
    when 'sudoku' then case p_level when 'easy' then 15000 when 'normal' then 20000 else 30000 end
    when 'mines'  then case p_level when 'easy' then 1000  when 'normal' then 5000  else 15000 end
  end
$$;

create or replace function public._puzzle_name(p_name text) returns text language plpgsql immutable as $$
declare t text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
begin
  if t = '' then return null; end if;
  return left(t, 10);
end $$;

-- 순위 (보이는 기록 중 나보다 빠른 수 + 1. 동점이면 먼저 세운 사람이 위)
create or replace function public._puzzle_rank(p_game text, p_level text, p_ms int, p_at timestamptz, p_uid uuid) returns int
language sql stable security definer set search_path = public as $$
  select 1 + count(*)::int from puzzle_records r
   where r.game = p_game and r.level = p_level and not r.hidden and r.user_id <> p_uid
     and (r.ms < p_ms or (r.ms = p_ms and r.created_at < p_at))
$$;

-- 한 난이도의 TOP 5 + 내 기록
create or replace function public._puzzle_board(p_game text, p_level text, p_uid uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'top', coalesce((select jsonb_agg(jsonb_build_object('name', t.nickname, 'ms', t.ms, 'at', t.created_at, 'me', t.user_id = p_uid) order by t.ms, t.created_at)
                       from (select * from puzzle_records where game = p_game and level = p_level and not hidden
                              order by ms, created_at limit 5) t), '[]'::jsonb),
    'me', (select jsonb_build_object('ms', m.ms, 'name', m.nickname, 'hidden', m.hidden, 'rank', _puzzle_rank(p_game, p_level, m.ms, m.created_at, p_uid))
             from puzzle_records m where m.game = p_game and m.level = p_level and m.user_id = p_uid))
$$;

-- 세 난이도 순위표 한 번에
create or replace function public.puzzle_top(p_game text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare uid uuid := _require_uid();
begin
  if p_game not in ('sudoku', 'mines') then raise exception 'BAD_GAME'; end if;
  return jsonb_build_object(
    'easy', _puzzle_board(p_game, 'easy', uid),
    'normal', _puzzle_board(p_game, 'normal', uid),
    'hard', _puzzle_board(p_game, 'hard', uid));
end $$;

-- 깬 기록 올리기. 더 좋을 때만 바뀜. 이름을 주면 순위표에 보임
create or replace function public.puzzle_submit(p_game text, p_level text, p_ms int, p_name text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := _require_uid(); nm text := _puzzle_name(p_name); prev puzzle_records; better boolean;
begin
  if p_game not in ('sudoku', 'mines') then raise exception 'BAD_GAME'; end if;
  if p_level not in ('easy', 'normal', 'hard') then raise exception 'BAD_LEVEL'; end if;
  if p_ms is null or p_ms < _puzzle_min_ms(p_game, p_level) or p_ms > 4 * 3600 * 1000 then raise exception 'BAD_TIME'; end if;
  select * into prev from puzzle_records where game = p_game and level = p_level and user_id = uid for update;
  better := not found or p_ms < prev.ms;
  if not found then
    insert into puzzle_records (game, level, user_id, nickname, ms, hidden) values (p_game, p_level, uid, nm, p_ms, nm is null);
  elsif better then
    update puzzle_records set ms = p_ms, created_at = now(), nickname = coalesce(nm, nickname), hidden = (coalesce(nm, nickname) is null)
     where game = p_game and level = p_level and user_id = uid;
  elsif nm is not null then
    update puzzle_records set nickname = nm, hidden = false where game = p_game and level = p_level and user_id = uid;
  end if;
  return _puzzle_board(p_game, p_level, uid) || jsonb_build_object('better', better);
end $$;

-- 이름 정하기 (null = 이 난이도 순위표에서 숨김). 이미 보이는 내 기록들도 같은 이름으로
create or replace function public.puzzle_name(p_game text, p_level text, p_name text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := _require_uid(); nm text := _puzzle_name(p_name);
begin
  if nm is null then
    update puzzle_records set hidden = true where game = p_game and level = p_level and user_id = uid;
  else
    update puzzle_records set nickname = nm where user_id = uid and not hidden; -- 보이는 기록은 이름 통일
    update puzzle_records set nickname = nm, hidden = false where game = p_game and level = p_level and user_id = uid;
  end if;
  return _puzzle_board(p_game, p_level, uid);
end $$;

do $$
declare f text;
begin
  foreach f in array array['puzzle_top(text)', 'puzzle_submit(text, text, int, text)', 'puzzle_name(text, text, text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  foreach f in array array['_puzzle_rank(text, text, int, timestamptz, uuid)', '_puzzle_board(text, text, uuid)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
end $$;
