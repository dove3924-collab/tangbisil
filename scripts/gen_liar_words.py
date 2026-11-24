"""supabase/seed/liar_words.json → 0002_liar.sql 의 제시어 은행 블록을 다시 쓴다.
형식: "단어|별칭1|별칭2" (첫 번째가 정답 표기, 나머지는 정답으로 인정할 별칭)"""
import json
import pathlib
import re

root = pathlib.Path(__file__).resolve().parent.parent
data = json.loads((root / 'supabase/seed/liar_words.json').read_text(encoding='utf-8'))
sql_path = root / 'supabase/migrations/0002_liar.sql'


def q(s: str) -> str:
    return "'" + s.replace("'", "''") + "'"


rows = []
keys = []
for cat, words in data.items():
    for entry in words:
        word, *aliases = [p.strip() for p in entry.split('|')]
        arr = 'array[' + ', '.join(q(a) for a in aliases) + ']::text[]' if aliases else "'{}'::text[]"
        rows.append(f'  ({q(cat)}, {q(word)}, {arr})')
        keys.append((cat, word))

block = (
    '-- BEGIN WORDS\n'
    'insert into public.liar_words (category, word, aliases) values\n'
    + ',\n'.join(rows)
    + '\non conflict (category, word) do update set aliases = excluded.aliases;\n'
    + '-- 목록에서 빠진 단어는 지운다\n'
    + 'delete from public.liar_words w where not exists (select 1 from (values\n'
    + ',\n'.join(f'  ({q(c)}, {q(w)})' for c, w in keys)
    + '\n) k(category, word) where k.category = w.category and k.word = w.word);\n'
    '-- END WORDS'
)
sql = sql_path.read_text(encoding='utf-8')
sql = re.sub(r'-- BEGIN WORDS.*?-- END WORDS', lambda _: block, sql, flags=re.S)
sql_path.write_text(sql, encoding='utf-8')
print(f'{len(rows)} words')
