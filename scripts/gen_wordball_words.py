"""영단어 야구 단어 목록 생성.

입력 (저장소에 넣지 않음, 직접 받아서 경로를 넘긴다):
  - ENABLE 단어 목록 enable1.txt  (Public Domain)  https://raw.githubusercontent.com/dolph/dictionary/master/enable1.txt
  - SCOWL 2020.12.07 의 final/ 폴더 (© Kevin Atkinson, 허용적 라이선스)
    https://downloads.sourceforge.net/project/wordlist/SCOWL/2020.12.07/scowl-2020.12.07.tar.gz

출력: src/wordball/words.ts
  - ANSWERS: SCOWL 크기 10·20(가장 흔한 단어) 중 ENABLE 에도 있는 5글자, 복수형·과거형·비속어·같은 알파벳 반복 단어 제외
  (입력은 아무 5글자나 허용하므로 입력 허용 사전은 만들지 않음 — 2026-11-12 사용자 결정)

사용: python3 scripts/gen_wordball_words.py <enable1.txt> <scowl final 폴더>
"""
import re
import sys
from pathlib import Path

enable_path, scowl_dir = Path(sys.argv[1]), Path(sys.argv[2])
FIVE = re.compile(r'[a-z]{5}')

def scowl(*names):
    out = set()
    for n in names:
        out |= {w.strip() for w in (scowl_dir / n).read_text(encoding='latin-1').splitlines()}
    return out

enable = {w.strip() for w in enable_path.read_text().splitlines()}
enable5 = {w for w in enable if FIVE.fullmatch(w)}
common = {w for w in scowl('english-words.10', 'english-words.20', 'american-words.10', 'american-words.20') if FIVE.fullmatch(w)}
base = {w for w in scowl(*[f'{v}-words.{n}' for v in ('english', 'american') for n in (10, 20, 35, 50)]) if w.isalpha()}

def inflected(w):
    """복수형·과거형 (정답으로 쓰기엔 재미없음)"""
    if w.endswith('s') and not w.endswith('ss') and (w[:-1] in base or (w.endswith('es') and w[:-2] in base) or (w.endswith('ies') and w[:-3] + 'y' in base)):
        return True
    if w.endswith('ed') and (w[:-2] in base or w[:-1] in base or (w[-3] == w[-4] and w[:-3] in base) or (w.endswith('ied') and w[:-3] + 'y' in base)):
        return True
    return False

# 정답에서 뺄 단어: 비하·민감한 말, 영국식/어색한 형태
EXCLUDE = set('''
bigot idiot moron slave vomit naked drunk crass deity bible abuse dying
pends datum fiver lorry pence lager maize vicar unset inter circa suing tying undid goody whoop leach roman
'''.split())

# 같은 알파벳이 두 번 이상 나오는 단어(TOTAL, APPLE 등)는 정답에서 뺀다 (2026-11-12 사용자 결정)
answers = sorted(w for w in common if w in enable5 and not inflected(w) and w not in EXCLUDE and len(set(w)) == 5)

ts = f'''/* 자동 생성 파일 (scripts/gen_wordball_words.py). 직접 고치지 말 것.
 * 단어 출처
 *  - ENABLE word list (Public Domain) — M. Cooper, Alan Beale 외. "Please mention the source and credit us as originators of the list."
 *  - SCOWL (Spell Checker Oriented Word Lists) 2020.12.07 — Copyright 2000-2018 by Kevin Atkinson.
 *    Permission to use, copy, modify, distribute and sell these word lists, the associated scripts, the output created
 *    from the scripts, and its documentation for any purpose is hereby granted without fee, provided that the above
 *    copyright notice appears in all copies and that both that copyright notice and this permission notice appear in
 *    supporting documentation. Kevin Atkinson makes no representations about the suitability of this array for any
 *    purpose. It is provided "as is" without express or implied warranty.
 * 정답 {len(answers)}개. 5글자씩 이어 붙인 문자열.
 */
export const ANSWERS = '{''.join(answers)}'
'''
Path('src/wordball/words.ts').write_text(ts)
print('answers', len(answers))
