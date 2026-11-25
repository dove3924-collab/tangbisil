-- 월루 → 탕비실 퍼즐 기록(스도쿠·지뢰찾기 전체 순위) 옮기기
--
-- 1) 월루 Supabase(ezxplcypivheguphrxmi) SQL Editor 에서 아래 select 를 실행
-- 2) 결과 칸(insert ... 로 시작하는 긴 글자) 전체를 복사
-- 3) 탕비실 Supabase(cjeinykdiveakcdilrml) SQL Editor 에 붙여 넣고 실행
--    (같은 사람·같은 난이도 기록이 이미 있으면 건너뜀, 여러 번 실행해도 안전)

select 'insert into public.puzzle_records (game, level, user_id, nickname, ms, hidden, created_at) values '
    || string_agg(format('(%L, %L, %L, %L, %s, %s, %L)', game, level, user_id, nickname, ms, hidden, created_at), ', ')
    || ' on conflict (game, level, user_id) do nothing;' as copy_this
  from public.puzzle_records;
