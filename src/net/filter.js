// 기본 욕설 필터: 글자 사이에 띄어쓰기/숫자/특수문자를 끼워 넣은 변형까지 잡아서 *로 바꾼다.
// 완벽하지 않으므로 놓친 표현은 WORDS 에 추가한다.
const WORDS = [
  '시발', '씨발', '씨빨', '시빨', '쉬발', '슈발', '십발', '시바', '씨바', 'ㅅㅂ', 'ㅆㅂ', 'ㅅ ㅂ', 'ㅆㅃ',
  '병신', '븅신', '빙신', 'ㅂㅅ', '개새끼', '개새기', '개색기', '개색끼', '새끼', '쌔끼', '색히', 'ㅅㄲ',
  '좆', '존나', '졸라', '존니', 'ㅈㄴ', '지랄', 'ㅈㄹ', '염병', '옘병', '미친놈', '미친년', '미친새', '미친',
  '닥쳐', '꺼져', '엿먹', '애미', '애비', '느금', '니미', '니애미', '느개비', '등신', '썅', '씹', '창녀', '걸레',
  'fuck', 'fck', 'shit', 'bitch', 'asshole', 'motherfucker',
];
const GAP = '[\\s0-9._\\-~!@#$%^&*()+=|/\\\\\'"`,?:;]*';
const PATTERNS = WORDS.map((w) => new RegExp(w.replace(/\s/g, '').split('').map(escapeRe).join(GAP), 'gi'));

function escapeRe(ch) {
  return ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function filterText(text) {
  let out = String(text);
  for (const re of PATTERNS) out = out.replace(re, (m) => '*'.repeat(m.length));
  return out;
}

export function cleanChat(text, maxLen = 60) {
  return filterText(String(text).replace(/[\u0000-\u001f]/g, '').trim().slice(0, maxLen));
}
