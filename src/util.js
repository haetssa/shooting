// 공용 유틸: 시드 난수(멀티플레이 동기화 대비), 수학 헬퍼, JSON 로드

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;

export function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// 부드러운 1D 노이즈 (지형 굴곡용)
export function noise1D(rng, size = 256) {
  const v = new Float32Array(size);
  for (let i = 0; i < size; i++) v[i] = rng() * 2 - 1;
  const at = (i) => v[((i % size) + size) % size];
  return (x) => {
    const i = Math.floor(x);
    const f = x - i;
    const t = (1 - Math.cos(f * Math.PI)) * 0.5;
    const a = at(i), b = at(i + 1);
    return a + (b - a) * t;
  };
}

// 배포 버전: index.html 부트 스크립트가 version.json 에서 읽어 둔다. 파일 주소에 ?v= 를 붙여 브라우저 캐시를 무효화
export const VERSION = window.APP_VERSION || 'dev';
export const vurl = (u) => (VERSION === 'dev' ? u : `${u}${u.includes('?') ? '&' : '?'}v=${VERSION}`);

// 서버에 올라간 최신 버전 (업데이트 확인용, 실패하면 null)
export async function latestVersion() {
  try { return (await (await fetch(`version.json?t=${Date.now()}`, { cache: 'no-store' })).json()).v; } catch { return null; }
}

export async function loadJSON(url) {
  const res = await fetch(vurl(url), { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${url} 로드 실패 (${res.status})`);
  return res.json();
}

export function mixHex(a, b, t) {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const r = Math.round(lerp((pa >> 16) & 255, (pb >> 16) & 255, t));
  const g = Math.round(lerp((pa >> 8) & 255, (pb >> 8) & 255, t));
  const bl = Math.round(lerp(pa & 255, pb & 255, t));
  return `rgb(${r},${g},${bl})`;
}
