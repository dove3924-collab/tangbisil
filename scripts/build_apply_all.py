"""supabase/migrations/*.sql 을 순서대로 합쳐 supabase/apply_all.sql 을 만든다.
사용자는 Supabase SQL Editor 에 이 파일 하나만 붙여넣고 Run 하면 된다 (전부 여러 번 실행해도 안전)."""
import pathlib

root = pathlib.Path(__file__).resolve().parent.parent
files = sorted((root / 'supabase/migrations').glob('*.sql'))
out = ['-- 자동 생성 파일 (scripts/build_apply_all.py). 직접 고치지 말 것.',
       '-- Supabase SQL Editor 에 통째로 붙여넣고 Run. 여러 번 실행해도 안전하다.', '']
for f in files:
    out += [f'-- ════════ {f.name} ════════', f.read_text(encoding='utf-8'), '']
(root / 'supabase/apply_all.sql').write_text('\n'.join(out), encoding='utf-8')
print('wrote', len(files), 'files')
