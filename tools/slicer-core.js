// 스프라이트 시트 슬라이서 핵심 로직 (slicer.html 에서 사용)
// 칸 기준이 아니라 덩어리 기준으로 자른다:
// 1) 테두리 색을 배경색으로 잡아 크로마키  2) 연결된 픽셀 덩어리 검출
// 3) 큰 덩어리 N개 = 프레임, 근처 조각은 병합, 나머지(워터마크 등)는 버림
// 4) 위→아래, 왼→오 정렬  5) 머리 중심 x / 발바닥 y 기준점으로 정렬  6) 아틀라스로 묶기

export const ANIM_NAMES = ['idle', 'walk', 'windup', 'throw', 'hit', 'jump'];

export const DEFAULTS = {
  tolerance: 100,   // 배경색과의 RGB 거리 이하면 투명
  soft: 40,         // 경계 부드럽게 처리할 폭
  halo: 0,          // 가장자리 흰 테두리 제거 반복 횟수
  flip: [],         // 좌우반전할 프레임 번호
  ignore: [],       // 무시할 영역 [x0, y0, x1, y1] (0~1 비율)
  expected: [4, 4, 4, 4, 4, 3],
  targetHeight: 160, // 0번 프레임(idle) 높이를 이 픽셀로 맞춤
  minArea: 30,
};

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error(`이미지 로드 실패: ${src}`));
    im.src = src;
  });
}

export function defaultAnims(expected) {
  const a = {};
  let i = 0;
  expected.forEach((n, r) => {
    a[ANIM_NAMES[r] || `row${r + 1}`] = Array.from({ length: n }, (_, k) => i + k);
    i += n;
  });
  return a;
}

export function sliceSheet(img, options = {}) {
  const o = { ...DEFAULTS, ...options };
  const W = img.naturalWidth || img.width, H = img.naturalHeight || img.height;
  const src = document.createElement('canvas');
  src.width = W;
  src.height = H;
  const sctx = src.getContext('2d', { willReadFrequently: true });
  sctx.drawImage(img, 0, 0);
  const d = sctx.getImageData(0, 0, W, H).data;
  const N = W * H;
  if (o.grid) removeGridLines(d, W, H, o.grid);
  const key = sampleBorder(d, W, H);
  if (o.grid) paintGridLines(d, W, H, key);

  // 1. 크로마키
  const alpha = new Uint8Array(N);
  for (let i = 0, p = 0; i < N; i++, p += 4) {
    const r = d[p], g = d[p + 1], b = d[p + 2];
    const dist = Math.sqrt((r - key[0]) ** 2 + (g - key[1]) ** 2 + (b - key[2]) ** 2);
    let a = (dist - o.tolerance) / o.soft;
    a = a < 0 ? 0 : a > 1 ? 1 : a;
    const mn = r < b ? r : b;
    if (mn > 110 && g < mn * 0.45) a = 0; // 남은 마젠타 계열
    alpha[i] = Math.round(a * 255);
  }

  // 2. 연결 덩어리 (8방향)
  const labels = new Int32Array(N);
  const stack = new Int32Array(N);
  const blobs = [];
  for (let i = 0; i < N; i++) {
    if (alpha[i] < 128 || labels[i]) continue;
    const id = blobs.length + 1;
    let sp = 0;
    stack[sp++] = i;
    labels[i] = id;
    let area = 0, minx = W, miny = H, maxx = 0, maxy = 0, sx = 0, sy = 0;
    while (sp) {
      const j = stack[--sp];
      const x = j % W, y = (j - x) / W;
      area++; sx += x; sy += y;
      if (x < minx) minx = x;
      if (x > maxx) maxx = x;
      if (y < miny) miny = y;
      if (y > maxy) maxy = y;
      const y0 = y > 0 ? y - 1 : 0, y1 = y < H - 1 ? y + 1 : H - 1;
      const x0 = x > 0 ? x - 1 : 0, x1 = x < W - 1 ? x + 1 : W - 1;
      for (let yy = y0; yy <= y1; yy++) {
        for (let xx = x0; xx <= x1; xx++) {
          const k = yy * W + xx;
          if (alpha[k] >= 128 && !labels[k]) { labels[k] = id; stack[sp++] = k; }
        }
      }
    }
    blobs.push({ id, area, minx, miny, maxx, maxy, cx: sx / area, cy: sy / area, members: [id] });
  }

  // 3. 프레임 선택 + 조각 병합
  const warnings = [];
  const inIgnore = (b) => o.ignore.some(([x0, y0, x1, y1]) => {
    const nx = b.cx / W, ny = b.cy / H;
    return nx >= x0 && nx <= x1 && ny >= y0 && ny <= y1;
  });
  const cand = blobs.filter((b) => b.area >= o.minArea && !inIgnore(b)).sort((a, b) => b.area - a.area);
  const total = o.expected.reduce((s, n) => s + n, 0);
  const prim = cand.slice(0, total);
  const rest = cand.slice(total);
  if (prim.length < total) warnings.push(`프레임 덩어리가 ${prim.length}개뿐 (예상 ${total})`);
  const mergeDist = Math.max(4, W * 0.012);
  let merged = 0, dropped = 0;
  for (const b of rest) {
    let best = null, bestGap = Infinity;
    for (const p of prim) {
      const gx = Math.max(0, p.minx - b.maxx, b.minx - p.maxx);
      const gy = Math.max(0, p.miny - b.maxy, b.miny - p.maxy);
      const gap = Math.max(gx, gy);
      if (gap < bestGap) { bestGap = gap; best = p; }
    }
    if (best && bestGap <= mergeDist) {
      best.members.push(b.id);
      best.minx = Math.min(best.minx, b.minx);
      best.miny = Math.min(best.miny, b.miny);
      best.maxx = Math.max(best.maxx, b.maxx);
      best.maxy = Math.max(best.maxy, b.maxy);
      merged++;
    } else dropped++;
  }

  // 4. 행 정렬
  prim.sort((a, b) => a.cy - b.cy);
  const hs = prim.map((b) => b.maxy - b.miny + 1).sort((a, b) => a - b);
  const medH = hs[hs.length >> 1] || 1;
  const rows = [];
  for (const b of prim) {
    const row = rows[rows.length - 1];
    const mean = row ? row.reduce((s, x) => s + x.cy, 0) / row.length : 0;
    if (!row || b.cy - mean > medH * 0.5) rows.push([b]);
    else row.push(b);
  }
  rows.forEach((r) => r.sort((a, b) => a.cx - b.cx));
  const counts = rows.map((r) => r.length);
  if (counts.join(',') !== o.expected.join(',')) warnings.push(`행별 개수 ${counts.join('/')} (예상 ${o.expected.join('/')})`);
  const ordered = rows.flat();

  // 5. 프레임 추출
  const frames = ordered.map((b, idx) => extractFrame(d, alpha, labels, W, H, b, o, idx)).filter(Boolean);

  // 6. 아틀라스
  const ref = frames[0] ? frames[0].h : 1;
  const s = o.targetHeight / ref;
  let L = 0, R = 0, U = 0;
  for (const f of frames) {
    L = Math.max(L, f.ax * s);
    R = Math.max(R, (f.w - f.ax) * s);
    U = Math.max(U, f.ay * s);
  }
  const anchorX = Math.ceil(L) + 2, anchorY = Math.ceil(U) + 2;
  const cellW = anchorX + Math.ceil(R) + 2, cellH = anchorY + 2;
  const cols = 4, rowsN = Math.ceil(frames.length / cols);
  const atlas = document.createElement('canvas');
  atlas.width = cols * cellW;
  atlas.height = rowsN * cellH;
  const actx = atlas.getContext('2d');
  frames.forEach((f, i) => {
    const w = Math.max(1, Math.round(f.w * s)), h = Math.max(1, Math.round(f.h * s));
    const scaled = scaleCanvas(f.canvas, w, h);
    const cx = (i % cols) * cellW, cy = Math.floor(i / cols) * cellH;
    actx.drawImage(scaled, Math.round(cx + anchorX - f.ax * s), Math.round(cy + anchorY - f.ay * s));
  });

  const meta = {
    cols, cellW, cellH, anchorX, anchorY,
    refHeight: o.targetHeight,
    frames: frames.length,
    anims: o.anims || defaultAnims(o.expected),
  };
  const report = { size: [W, H], key, blobs: blobs.length, merged, dropped, rows: counts, warnings };
  return { atlas, meta, frames, report };
}

// grid 옵션: 칸 사이 선(가로/세로로 길게 이어진 줄)을 찾아 표시해 두고, 배경색으로 칠한다
// grid: true 또는 "white" = 흰 선, "dark" = 검은 선
let gridMask = null;
function removeGridLines(d, W, H, kind) {
  const white = kind === 'dark'
    ? (p) => d[p] < 150 && d[p + 1] < 70 && d[p + 2] < 150
    : (p) => d[p] > 215 && d[p + 1] > 215 && d[p + 2] > 215;
  gridMask = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    let n = 0;
    for (let x = 0; x < W; x++) if (white((y * W + x) * 4)) n++;
    if (n > W * 0.55) for (let x = 0; x < W; x++) gridMask[y * W + x] = 1;
  }
  for (let x = 0; x < W; x++) {
    let n = 0;
    for (let y = 0; y < H; y++) if (white((y * W + x) * 4)) n++;
    if (n > H * 0.55) for (let y = 0; y < H; y++) gridMask[y * W + x] = 1;
  }
  // 선 양옆 1~2px 안티에일리어싱 번짐도 포함
  const grow = gridMask.slice();
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!gridMask[y * W + x]) continue;
      for (let k = -2; k <= 2; k++) {
        if (x + k >= 0 && x + k < W) grow[y * W + x + k] = 1;
        if (y + k >= 0 && y + k < H) grow[(y + k) * W + x] = 1;
      }
    }
  }
  gridMask = grow;
  for (let i = 0; i < W * H; i++) if (gridMask[i]) { d[i * 4] = 255; d[i * 4 + 1] = 0; d[i * 4 + 2] = 255; }
}
function paintGridLines(d, W, H, key) {
  for (let i = 0; i < W * H; i++) if (gridMask[i]) { d[i * 4] = key[0]; d[i * 4 + 1] = key[1]; d[i * 4 + 2] = key[2]; }
  gridMask = null;
}

function sampleBorder(d, W, H) {
  const rs = [], gs = [], bs = [];
  const push = (x, y) => { const p = (y * W + x) * 4; rs.push(d[p]); gs.push(d[p + 1]); bs.push(d[p + 2]); };
  for (let x = 0; x < W; x += 3) { push(x, 1); push(x, H - 2); }
  for (let y = 0; y < H; y += 3) { push(1, y); push(W - 2, y); }
  const med = (a) => a.sort((x, y) => x - y)[a.length >> 1];
  return [med(rs), med(gs), med(bs)];
}

function extractFrame(d, alpha, labels, W, H, b, o, idx) {
  const pad = 2;
  const bx = Math.max(0, b.minx - pad), by = Math.max(0, b.miny - pad);
  const bw = Math.min(W - 1, b.maxx + pad) - bx + 1, bh = Math.min(H - 1, b.maxy + pad) - by + 1;
  const px = new Uint8ClampedArray(bw * bh * 4);
  const set = new Set(b.members);
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      const k = (by + y) * W + bx + x;
      const lab = labels[k];
      if (!(set.has(lab) || (lab === 0 && alpha[k] > 0))) continue;
      const q = (y * bw + x) * 4, p = k * 4;
      px[q] = d[p]; px[q + 1] = d[p + 1]; px[q + 2] = d[p + 2]; px[q + 3] = alpha[k];
    }
  }
  const A = (x, y) => (x < 0 || y < 0 || x >= bw || y >= bh ? 0 : px[(y * bw + x) * 4 + 3]);

  // 가장자리 마젠타 번짐 제거
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      const q = (y * bw + x) * 4;
      if (!px[q + 3]) continue;
      const edge = px[q + 3] < 255 || !A(x - 1, y) || !A(x + 1, y) || !A(x, y - 1) || !A(x, y + 1) ||
        !A(x - 2, y) || !A(x + 2, y) || !A(x, y - 2) || !A(x, y + 2);
      if (!edge) continue;
      const r = px[q], g = px[q + 1], bl = px[q + 2];
      if (r > g && bl > g) {
        const e = Math.min(r, bl) - g;
        px[q] = r - e;
        px[q + 2] = bl - e;
      }
    }
  }

  // 흰 테두리(스티커 외곽) 제거
  for (let pass = 0; pass < o.halo; pass++) {
    const kill = [];
    for (let y = 0; y < bh; y++) {
      for (let x = 0; x < bw; x++) {
        const q = (y * bw + x) * 4;
        if (!px[q + 3]) continue;
        if (A(x - 1, y) && A(x + 1, y) && A(x, y - 1) && A(x, y + 1)) continue;
        const r = px[q], g = px[q + 1], bl = px[q + 2];
        const mx = Math.max(r, g, bl), mn = Math.min(r, g, bl);
        if ((r + g + bl) / 3 > 170 && mx - mn < 50) kill.push(q);
      }
    }
    if (!kill.length) break;
    for (const q of kill) px[q + 3] = 0;
  }

  // 딱 맞게 자르기
  let minx = bw, miny = bh, maxx = -1, maxy = -1;
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      const q = (y * bw + x) * 4;
      if (px[q + 3] < 24) { px[q + 3] = 0; continue; }
      if (x < minx) minx = x;
      if (x > maxx) maxx = x;
      if (y < miny) miny = y;
      if (y > maxy) maxy = y;
    }
  }
  if (maxx < 0) return null;
  const w = maxx - minx + 1, h = maxy - miny + 1;
  const flip = o.flip.includes(idx);
  const out = new ImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const q = ((miny + y) * bw + minx + x) * 4;
      const t = (y * w + (flip ? w - 1 - x : x)) * 4;
      out.data[t] = px[q]; out.data[t + 1] = px[q + 1]; out.data[t + 2] = px[q + 2]; out.data[t + 3] = px[q + 3];
    }
  }
  // 기준점: 위쪽 25%(머리) 픽셀의 가로 중앙값, 발바닥
  const xs = [];
  const headRows = Math.max(1, Math.floor(h * 0.25));
  for (let y = 0; y < headRows; y++) {
    for (let x = 0; x < w; x++) if (out.data[(y * w + x) * 4 + 3] >= 128) xs.push(x);
  }
  xs.sort((a, b) => a - b);
  const ax = xs.length ? xs[xs.length >> 1] + 0.5 : w / 2;
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  cv.getContext('2d').putImageData(out, 0, 0);
  return { canvas: cv, w, h, ax, ay: h, sheet: { x: bx + minx, y: by + miny, w, h } };
}

// 큰 비율로 줄일 때 계단 현상 줄이려고 절반씩 줄인다
function scaleCanvas(src, w, h) {
  let cur = src;
  while (cur.width / 2 > w && cur.height / 2 > h) {
    const c = document.createElement('canvas');
    c.width = Math.ceil(cur.width / 2);
    c.height = Math.ceil(cur.height / 2);
    const g = c.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.drawImage(cur, 0, 0, c.width, c.height);
    cur = c;
  }
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(cur, 0, 0, w, h);
  return c;
}
