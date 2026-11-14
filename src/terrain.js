// 파괴 가능 지형: 렌더용 캔버스 + 충돌용 마스크(Uint8Array)
// 지형 모양은 maps.json의 islands 정의로 생성하고, 외곽선은 코드가 그린다.
// 폭발 시 원형으로 깎고 구멍 테두리에도 외곽선을 다시 그려 캐릭터 화풍(굵은 선)을 유지한다.
import { mulberry32, noise1D } from './util.js';

export const OUTLINE = '#1c1a2b';

export class Terrain {
  constructor(map) {
    this.w = map.width;
    this.h = map.height;
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.w;
    this.canvas.height = this.h;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    this.mask = new Uint8Array(this.w * this.h);
    this.holes = []; // 네트워크 동기화용 (x, y, r) 목록
    this.style = map.terrainStyle || {};
    this.build(map.islands);
  }

  build(islands) {
    const ctx = this.ctx, st = this.style;
    const pattern = ctx.createPattern(makeSoilTile(st), 'repeat');
    this.pattern = pattern;
    for (const isl of islands) {
      const { body, top } = islandPaths(isl, this.w, this.h);
      ctx.save();
      ctx.clip(body);
      ctx.fillStyle = pattern;
      ctx.fillRect(0, 0, this.w, this.h);
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      // 윗면 띠 (도시: 아스팔트 + 연석 하이라이트)
      ctx.strokeStyle = st.topColor || '#545a68';
      ctx.lineWidth = 48;
      ctx.stroke(top);
      ctx.strokeStyle = st.topHighlight || '#9aa1ad';
      ctx.lineWidth = 12;
      ctx.stroke(top);
      ctx.save();
      ctx.translate(0, 24);
      ctx.strokeStyle = 'rgba(28,26,43,0.55)';
      ctx.lineWidth = 4;
      ctx.stroke(top);
      ctx.restore();
      // 외곽선 (클립 때문에 안쪽 절반만 그려짐)
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = 10;
      ctx.stroke(body);
      ctx.restore();
    }
    const data = ctx.getImageData(0, 0, this.w, this.h).data;
    for (let i = 0, n = this.mask.length; i < n; i++) this.mask[i] = data[i * 4 + 3] > 127 ? 1 : 0;
  }

  isSolid(x, y) {
    x = Math.floor(x);
    y = Math.floor(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return false;
    return this.mask[y * this.w + x] === 1;
  }

  carve(x, y, r) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    // 남은 지형 위에만 그을음 + 외곽선
    ctx.globalCompositeOperation = 'source-atop';
    const g = ctx.createRadialGradient(x, y, r, x, y, r + 18);
    g.addColorStop(0, 'rgba(40,24,20,0.55)');
    g.addColorStop(1, 'rgba(40,24,20,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r + 18, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    const r2 = r * r;
    const x0 = Math.max(0, Math.floor(x - r)), x1 = Math.min(this.w - 1, Math.ceil(x + r));
    const y0 = Math.max(0, Math.floor(y - r)), y1 = Math.min(this.h - 1, Math.ceil(y + r));
    for (let yy = y0; yy <= y1; yy++) {
      const dy = yy + 0.5 - y;
      for (let xx = x0; xx <= x1; xx++) {
        const dx = xx + 0.5 - x;
        if (dx * dx + dy * dy <= r2) this.mask[yy * this.w + xx] = 0;
      }
    }
    this.holes.push({ x: Math.round(x), y: Math.round(y), r });
    this.dirty = true;
  }

  // 지형 생성 (장벽 건설 스킬). 기존 지형 뒤쪽(빈 곳)에만 그려서 바깥 테두리에만 외곽선이 생긴다.
  add(x, y, r) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = 'destination-over';
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.arc(x, y, r - 5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = this.pattern;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    const r2 = r * r;
    const x0 = Math.max(0, Math.floor(x - r)), x1 = Math.min(this.w - 1, Math.ceil(x + r));
    const y0 = Math.max(0, Math.floor(y - r)), y1 = Math.min(this.h - 1, Math.ceil(y + r));
    for (let yy = y0; yy <= y1; yy++) {
      const dy = yy + 0.5 - y;
      for (let xx = x0; xx <= x1; xx++) {
        const dx = xx + 0.5 - x;
        if (dx * dx + dy * dy <= r2) this.mask[yy * this.w + xx] = 1;
      }
    }
    this.holes.push({ x: Math.round(x), y: Math.round(y), r, add: true });
    this.dirty = true;
  }

  // 벽돌 장벽 (관세 장벽 스킬). (x, bottom) = 아래 가운데. 위에 그려서 벽이 또렷하게 보인다
  addWall(x, bottom, w, h) {
    const ctx = this.ctx;
    const x0 = Math.round(x - w / 2), y0 = Math.round(bottom - h);
    ctx.save();
    ctx.fillStyle = '#b5523b';
    ctx.fillRect(x0, y0, w, h);
    const bw = 20, bh = 12;
    for (let row = 0, y = y0; y < y0 + h; row++, y += bh) {
      const off = row % 2 ? bw / 2 : 0;
      for (let bx = x0 - bw + off; bx < x0 + w; bx += bw) {
        const l = Math.max(x0, bx + 1.5), r = Math.min(x0 + w, bx + bw - 1.5);
        if (r <= l) continue;
        ctx.fillStyle = (row * 3 + Math.round(bx / bw)) % 4 === 0 ? '#d0735a' : '#c2604a';
        ctx.fillRect(l, y + 1.5, r - l, Math.min(bh - 3, y0 + h - y - 1.5));
      }
    }
    // 윗면 갓돌
    ctx.fillStyle = '#e8d9c0';
    ctx.fillRect(x0 - 4, y0, w + 8, 10);
    ctx.lineWidth = 3;
    ctx.strokeStyle = OUTLINE;
    ctx.strokeRect(x0 - 4, y0, w + 8, 10);
    ctx.lineWidth = 6;
    ctx.strokeRect(x0 + 1, y0 + 1, w - 2, h - 2);
    ctx.restore();
    for (let yy = Math.max(0, y0); yy < Math.min(this.h, y0 + h); yy++) {
      for (let xx = Math.max(0, x0 - 4); xx < Math.min(this.w, x0 + w + 4); xx++) {
        if (yy < y0 + 10 || (xx >= x0 && xx < x0 + w)) this.mask[yy * this.w + xx] = 1;
      }
    }
    this.dirty = true;
  }
}

function islandPaths(isl, W, H) {
  const rng = mulberry32(isl.seed || 1);
  const nA = noise1D(rng), nB = noise1D(rng);
  const x0 = isl.x, x1 = isl.x + isl.w;
  const bump = isl.bump ?? 20, round = isl.round ?? 46;
  const freeL = x0 > 0, freeR = x1 < W; // 맵 가장자리에 붙은 쪽은 둥글게 깎지 않음
  const count = Math.max(4, Math.round(isl.w / 10));

  const topPts = [];
  for (let i = 0; i <= count; i++) {
    const x = x0 + (i / count) * isl.w;
    let y = isl.y + (nA(x / 160) * 0.75 + nB(x / 45) * 0.25) * bump;
    const dl = x - x0, dr = x1 - x;
    if (freeL && dl < round) y += (1 - Math.sqrt(1 - (1 - dl / round) ** 2)) * round * 0.7;
    if (freeR && dr < round) y += (1 - Math.sqrt(1 - (1 - dr / round) ** 2)) * round * 0.7;
    topPts.push([x, y]);
  }

  const bottomPts = [];
  if (isl.type === 'ground') {
    // 바닥까지 이어진 절벽형 섬
    const yR = topPts[topPts.length - 1][1];
    for (let y = yR; y <= H + 30; y += 14) bottomPts.push([x1 + nB(y / 40) * 10 + (y - yR) * 0.08, y]);
    const yL = topPts[0][1];
    const left = [];
    for (let y = yL; y <= H + 30; y += 14) left.push([x0 + nA(y / 40) * 10 - (y - yL) * 0.08, y]);
    bottomPts.push(...left.reverse());
  } else {
    // 떠 있는 섬: 아래쪽이 가운데로 갈수록 두꺼워짐
    const h = isl.h ?? 120;
    const half = isl.w * 0.5;
    for (let i = count; i >= 0; i--) {
      const x = topPts[i][0];
      const dl = x - x0, dr = x1 - x;
      const fl = freeL ? Math.pow(Math.sin(Math.min(1, dl / half) * Math.PI / 2), 0.7) : 1;
      const fr = freeR ? Math.pow(Math.sin(Math.min(1, dr / half) * Math.PI / 2), 0.7) : 1;
      let y = isl.y + h * (0.45 + 0.55 * Math.min(fl, fr)) + nB(x / 28) * 7;
      y = Math.max(y, topPts[i][1] + 30);
      bottomPts.push([x, y]);
    }
  }

  const body = new Path2D();
  const top = new Path2D();
  body.moveTo(topPts[0][0], topPts[0][1]);
  top.moveTo(topPts[0][0], topPts[0][1]);
  for (let i = 1; i < topPts.length; i++) {
    body.lineTo(topPts[i][0], topPts[i][1]);
    top.lineTo(topPts[i][0], topPts[i][1]);
  }
  for (const [x, y] of bottomPts) body.lineTo(x, y);
  body.closePath();
  return { body, top };
}

// 지형 텍스처 (tile: stones 돌 박힌 흙 | bricks 벽돌 | panels 금속 패널). 나중에 AI 타일 이미지로 교체 가능
function makeSoilTile(st) {
  const S = 96;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = st.soil || '#a0785a';
  g.fillRect(0, 0, S, S);
  if (st.tile === 'bricks') {
    const bw = 32, bh = 16;
    for (let row = 0; row < S / bh; row++) {
      const off = row % 2 ? bw / 2 : 0;
      for (let x = -bw; x < S + bw; x += bw) {
        g.fillStyle = (row * 7 + x) % 3 === 0 ? st.stoneB : st.soil;
        g.fillRect(x + off + 1.5, row * bh + 1.5, bw - 3, bh - 3);
      }
      g.fillStyle = st.stoneA;
      g.fillRect(0, row * bh, S, 1.5);
      for (let x = -bw; x < S + bw; x += bw) g.fillRect(x + off, row * bh, 1.5, bh);
    }
    return c;
  }
  if (st.tile === 'panels') {
    const P = 48;
    for (let y = 0; y < S; y += P) {
      for (let x = 0; x < S; x += P) {
        g.fillStyle = (x + y) % (P * 2) === 0 ? st.soil : st.stoneB;
        g.globalAlpha = (x + y) % (P * 2) === 0 ? 1 : 0.35;
        g.fillRect(x + 2, y + 2, P - 4, P - 4);
        g.globalAlpha = 1;
        g.strokeStyle = st.stoneA;
        g.lineWidth = 2;
        g.strokeRect(x + 1, y + 1, P - 2, P - 2);
        g.fillStyle = st.stoneA;
        for (const [rx, ry] of [[6, 6], [P - 6, 6], [6, P - 6], [P - 6, P - 6]]) {
          g.beginPath();
          g.arc(x + rx, y + ry, 2, 0, Math.PI * 2);
          g.fill();
        }
      }
    }
    return c;
  }
  const rng = mulberry32(7);
  for (let i = 0; i < 14; i++) {
    const x = rng() * S, y = rng() * S, r = 3 + rng() * 7;
    const col = rng() < 0.5 ? st.stoneA || '#8a6449' : st.stoneB || '#b88f6c';
    for (const ox of [-S, 0, S]) {
      for (const oy of [-S, 0, S]) {
        g.beginPath();
        g.ellipse(x + ox, y + oy, r, r * 0.75, 0, 0, Math.PI * 2);
        g.fillStyle = col;
        g.fill();
        g.lineWidth = 2;
        g.strokeStyle = 'rgba(28,26,43,0.35)';
        g.stroke();
      }
    }
  }
  return c;
}
