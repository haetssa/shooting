// 테마별 배경: 하늘 그라데이션 + 하늘 장식(해/행성/별/오로라) + 원경/근경 실루엣 2겹(패럴랙스)
// 지금은 코드로 그린 임시 배경. AI 배경 이미지가 생기면 layers 대신 이미지를 그리면 된다.
import { mulberry32 } from './util.js';

const THEMES = {
  city: {
    sky: ['#7fb2ee', '#cfe0f5', '#f7d9b4'], deco: null,
    far: (g, W, H, r) => skyline(g, W, H, r, { body: '#9fadd0', line: '#8592b8', win: '#c8d2ea', lit: 0.2, minH: 280, maxH: 720, minW: 70, maxW: 170 }),
    near: (g, W, H, r) => skyline(g, W, H, r, { body: '#5f6c91', line: '#434e70', win: '#ffd88a', lit: 0.35, minH: 140, maxH: 520, minW: 60, maxW: 150 }),
  },
  mars: {
    sky: ['#d7835c', '#eab089', '#f6d6b5'], deco: 'planet',
    far: (g, W, H, r) => mesas(g, W, H, r, '#c9785a', '#b0644a'),
    near: (g, W, H, r) => domes(g, W, H, r),
  },
  snow: {
    sky: ['#8fbfe9', '#cfe5fa', '#eef6ff'], deco: 'aurora',
    far: (g, W, H, r) => mountains(g, W, H, r),
    near: (g, W, H, r) => pines(g, W, H, r),
  },
  desert: {
    sky: ['#f29e5c', '#f8c987', '#fde6b8'], deco: 'sun',
    far: (g, W, H, r) => dunes(g, W, H, r),
    near: (g, W, H, r) => ruins(g, W, H, r),
  },
  space: {
    sky: ['#070a22', '#151a45', '#2b2358'], deco: 'stars',
    far: (g, W, H, r) => asteroids(g, W, H, r),
    near: (g, W, H, r) => station(g, W, H, r),
  },
  night: {
    sky: ['#0d1030', '#262a5c', '#5a3f74'], deco: 'moon',
    far: (g, W, H, r) => skyline(g, W, H, r, { body: '#2b2f5a', line: '#22254a', win: '#ffe08a', lit: 0.3, minH: 280, maxH: 720, minW: 70, maxW: 170 }),
    near: (g, W, H, r) => skyline(g, W, H, r, { body: '#1a1c3a', line: '#121329', win: '#ff7ad9', lit: 0.4, minH: 140, maxH: 520, minW: 60, maxW: 150 }),
  },
  jungle: {
    sky: ['#79c7e3', '#bfe7d4', '#eef6c8'], deco: 'sun',
    far: (g, W, H, r) => hills(g, W, H, r, ['#7fb98a', '#6aa877']),
    near: (g, W, H, r) => jungleTrees(g, W, H, r),
  },
  volcano: {
    sky: ['#2a0f12', '#6b2418', '#d0612c'], deco: 'ember',
    far: (g, W, H, r) => volcanoes(g, W, H, r),
    near: (g, W, H, r) => lavaRocks(g, W, H, r),
  },
};

export function buildBackground(map) {
  const th = THEMES[map.theme] || THEMES.city;
  const rng = mulberry32(map.bgSeed || 5);
  const layer = (H, fn, parallax) => {
    const c = document.createElement('canvas');
    c.width = map.width;
    c.height = H;
    fn(c.getContext('2d'), map.width, H, rng);
    return { canvas: c, parallax, w: map.width, h: H };
  };
  const stars = Array.from({ length: 120 }, () => ({ x: rng(), y: rng(), s: 0.5 + rng() * 1.6, p: rng() * 6 }));
  return { theme: map.theme, sky: th.sky, deco: th.deco, stars, layers: [layer(780, th.far, 0.25), layer(560, th.near, 0.5)] };
}

// 화면 좌표계에서 하늘 + 장식
export function drawSky(ctx, bg, cw, ch, time) {
  const g = ctx.createLinearGradient(0, 0, 0, ch);
  g.addColorStop(0, bg.sky[0]);
  g.addColorStop(0.65, bg.sky[1]);
  g.addColorStop(1, bg.sky[2]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, cw, ch);
  if (bg.deco === 'sun') {
    const x = cw * 0.78, y = ch * 0.2, r = Math.min(cw, ch) * 0.09;
    const glow = ctx.createRadialGradient(x, y, r * 0.5, x, y, r * 2.6);
    glow.addColorStop(0, 'rgba(255,240,190,0.7)');
    glow.addColorStop(1, 'rgba(255,240,190,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(x - r * 3, y - r * 3, r * 6, r * 6);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = '#fff3c4';
    ctx.fill();
  } else if (bg.deco === 'planet') {
    const x = cw * 0.22, y = ch * 0.2, r = Math.min(cw, ch) * 0.12;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,236,214,0.75)';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x + r * 0.35, y - r * 0.2, r * 0.25, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(230,190,160,0.6)';
    ctx.fill();
  } else if (bg.deco === 'aurora') {
    for (let k = 0; k < 3; k++) {
      ctx.beginPath();
      const base = ch * (0.12 + k * 0.07);
      ctx.moveTo(0, base);
      for (let x = 0; x <= cw; x += 20) ctx.lineTo(x, base + Math.sin(x / 90 + time * 0.6 + k * 1.7) * 14);
      ctx.lineWidth = 16 - k * 4;
      ctx.strokeStyle = `rgba(120,255,200,${0.18 - k * 0.04})`;
      ctx.stroke();
    }
  } else if (bg.deco === 'moon') {
    for (const s of bg.stars) {
      if (s.y > 0.6) continue;
      ctx.globalAlpha = 0.4 + 0.4 * Math.sin(time * 1.5 + s.p);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(s.x * cw, s.y * ch, s.s, s.s);
    }
    ctx.globalAlpha = 1;
    const x = cw * 0.62, y = ch * 0.26, r = Math.min(cw, ch) * 0.075;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = '#fff6d6';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x + r * 0.35, y - r * 0.15, r * 0.85, 0, Math.PI * 2);
    ctx.fillStyle = bg.sky[0];
    ctx.fill();
  } else if (bg.deco === 'ember') {
    for (const s of bg.stars) {
      const yy = (s.y - time * 0.04 * s.s) % 1;
      const py = (yy < 0 ? yy + 1 : yy) * ch;
      ctx.globalAlpha = 0.3 + 0.5 * Math.abs(Math.sin(time * 2 + s.p));
      ctx.fillStyle = s.p > 3 ? '#ffb347' : '#ff6a3d';
      ctx.fillRect(s.x * cw + Math.sin(time + s.p) * 8, py, s.s + 1, s.s + 1);
    }
    ctx.globalAlpha = 1;
  } else if (bg.deco === 'stars') {
    for (const s of bg.stars) {
      ctx.globalAlpha = 0.5 + 0.5 * Math.sin(time * 2 + s.p);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(s.x * cw, s.y * ch, s.s, s.s);
    }
    ctx.globalAlpha = 1;
    const x = cw * 0.8, y = ch * 0.24, r = Math.min(cw, ch) * 0.1;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = '#c77dff';
    ctx.fill();
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-0.3);
    ctx.scale(1, 0.28);
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.7, 0, Math.PI * 2);
    ctx.lineWidth = 8;
    ctx.strokeStyle = 'rgba(255,214,140,0.8)';
    ctx.stroke();
    ctx.restore();
  }
}

export function drawBackground(ctx, cam, bg, dpr, map) {
  for (const L of bg.layers) {
    const p = L.parallax;
    const cx = map.width / 2 + (cam.x - map.width / 2) * p;
    const cy = map.height / 2 + (cam.y - map.height / 2) * p;
    const z = cam.zoom * dpr;
    ctx.setTransform(z, 0, 0, z, (cam.cw / 2 - cx * cam.zoom) * dpr, (cam.ch / 2 - cy * cam.zoom) * dpr);
    const y = map.height + 120 - L.h;
    for (const ox of [-L.w, 0, L.w]) ctx.drawImage(L.canvas, ox, y);
  }
}

// ---------- 레이어 그리기 ----------

function skyline(g, W, H, rng, col) {
  let x = -20;
  while (x < W) {
    const bw = col.minW + rng() * (col.maxW - col.minW);
    const bh = col.minH + rng() * (col.maxH - col.minH);
    const top = H - bh;
    g.fillStyle = col.body;
    if (rng() < 0.35) g.fillRect(x + bw * 0.3, top - 18, bw * 0.25, 18);
    if (rng() < 0.25) g.fillRect(x + bw * 0.7, top - 42, 3, 42);
    g.fillRect(x, top, bw, bh);
    g.strokeStyle = col.line;
    g.lineWidth = 3;
    g.strokeRect(x + 1.5, top + 1.5, bw - 3, bh);
    for (let wy = top + 14; wy < H - 16; wy += 19) {
      for (let wx = x + 10; wx < x + bw - 14; wx += 18) {
        g.fillStyle = rng() < col.lit ? col.win : col.line;
        g.fillRect(wx, wy, 8, 11);
      }
    }
    x += bw + rng() * 14;
  }
}

function mesas(g, W, H, rng, body, line) {
  let x = -50;
  while (x < W) {
    const w = 180 + rng() * 260, h = 160 + rng() * 300, top = H - h;
    g.beginPath();
    g.moveTo(x, H);
    g.lineTo(x + w * 0.15, top);
    g.lineTo(x + w * 0.85, top);
    g.lineTo(x + w, H);
    g.closePath();
    g.fillStyle = body;
    g.fill();
    g.lineWidth = 3;
    g.strokeStyle = line;
    g.stroke();
    x += w * (0.7 + rng() * 0.5);
  }
}

function domes(g, W, H, rng) {
  g.fillStyle = '#7d3b2b';
  g.fillRect(0, H - 40, W, 40);
  let x = 40;
  while (x < W) {
    const r = 50 + rng() * 70;
    g.beginPath();
    g.arc(x, H - 40, r, Math.PI, 0);
    g.fillStyle = '#8e4633';
    g.fill();
    g.lineWidth = 3;
    g.strokeStyle = '#5e2a1e';
    g.stroke();
    g.fillStyle = '#ffcf7a';
    for (let k = 0; k < 3; k++) g.fillRect(x - r * 0.5 + k * r * 0.4, H - 40 - r * 0.35, 8, 6);
    if (rng() < 0.6) {
      g.fillStyle = '#5e2a1e';
      g.fillRect(x + r + 20, H - 40 - 140, 6, 140);
      g.fillRect(x + r + 8, H - 40 - 140, 30, 6);
    }
    x += r * 2 + 80 + rng() * 140;
  }
}

function mountains(g, W, H, rng) {
  let x = -100;
  while (x < W) {
    const w = 300 + rng() * 300, h = 300 + rng() * 380, peak = x + w / 2;
    g.beginPath();
    g.moveTo(x, H);
    g.lineTo(peak, H - h);
    g.lineTo(x + w, H);
    g.closePath();
    g.fillStyle = '#b9cfe6';
    g.fill();
    g.beginPath();
    g.moveTo(peak - w * 0.12, H - h * 0.76);
    g.lineTo(peak, H - h);
    g.lineTo(peak + w * 0.12, H - h * 0.76);
    g.lineTo(peak + w * 0.04, H - h * 0.8);
    g.lineTo(peak - w * 0.03, H - h * 0.74);
    g.closePath();
    g.fillStyle = '#ffffff';
    g.fill();
    x += w * 0.6;
  }
}

function pines(g, W, H, rng) {
  g.fillStyle = '#e8f1fb';
  g.fillRect(0, H - 50, W, 50);
  let x = 0;
  while (x < W) {
    const h = 90 + rng() * 150, w = h * 0.45;
    for (let k = 0; k < 3; k++) {
      const ty = H - 50 - h + k * h * 0.25;
      g.beginPath();
      g.moveTo(x, ty);
      g.lineTo(x - w / 2 - k * 6, ty + h * 0.45);
      g.lineTo(x + w / 2 + k * 6, ty + h * 0.45);
      g.closePath();
      g.fillStyle = '#2f5d62';
      g.fill();
    }
    g.fillStyle = '#4b3a2a';
    g.fillRect(x - 5, H - 60, 10, 14);
    x += 50 + rng() * 120;
  }
}

function dunes(g, W, H, rng) {
  for (let k = 0; k < 2; k++) {
    const ph = rng() * 10, amp = 60 + k * 30, base = H - 200 + k * 90;
    g.beginPath();
    g.moveTo(0, H);
    for (let x = 0; x <= W; x += 20) g.lineTo(x, base - Math.sin(x / (260 + k * 90) + ph) * amp);
    g.lineTo(W, H);
    g.closePath();
    g.fillStyle = k === 0 ? '#efd29c' : '#e2b977';
    g.fill();
  }
}

function ruins(g, W, H, rng) {
  let x = 100;
  while (x < W) {
    if (rng() < 0.5) {
      const w = 220 + rng() * 180, h = w * 0.7;
      for (let k = 0; k < 5; k++) {
        const sw = w * (1 - k * 0.18), sh = h / 5;
        g.fillStyle = k % 2 ? '#b98445' : '#a8743a';
        g.fillRect(x - sw / 2, H - (k + 1) * sh, sw, sh);
      }
      x += w + 80 + rng() * 120;
    } else {
      const h = 120 + rng() * 140;
      g.fillStyle = '#b98445';
      g.fillRect(x, H - h, 26, h);
      g.fillRect(x - 8, H - h - 10, 42, 12);
      if (rng() < 0.5) g.fillRect(x + 70, H - h * 0.6, 26, h * 0.6);
      x += 140 + rng() * 100;
    }
  }
}

function asteroids(g, W, H, rng) {
  for (let k = 0; k < 18; k++) {
    const x = rng() * W, y = H * 0.2 + rng() * H * 0.7, r = 10 + rng() * 40;
    g.beginPath();
    for (let a = 0; a < Math.PI * 2; a += 0.6) {
      const rr = r * (0.75 + rng() * 0.35);
      g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    g.closePath();
    g.fillStyle = '#3b3f66';
    g.fill();
  }
}

function station(g, W, H, rng) {
  const y = H - 220;
  g.fillStyle = '#2d3354';
  g.fillRect(0, y, W, 14);
  for (let x = 0; x < W; x += 60) {
    g.strokeStyle = '#2d3354';
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + 30, y + 40);
    g.lineTo(x + 60, y);
    g.stroke();
  }
  let x = 80;
  while (x < W) {
    const w = 120 + rng() * 100, h = 60 + rng() * 40;
    g.fillStyle = '#3a4270';
    g.fillRect(x, y - h / 2, w, h);
    g.strokeStyle = '#232846';
    g.lineWidth = 3;
    g.strokeRect(x, y - h / 2, w, h);
    g.fillStyle = '#7fd0ff';
    for (let k = 0; k < 4; k++) g.fillRect(x + 12 + k * (w - 24) / 4, y - 6, 10, 10);
    if (rng() < 0.5) {
      g.fillStyle = '#4a6fb5';
      g.fillRect(x + w / 2 - 60, y - h / 2 - 70, 120, 34);
      g.fillStyle = '#232846';
      g.fillRect(x + w / 2 - 2, y - h / 2 - 36, 4, 36);
    }
    x += w + 160 + rng() * 200;
  }
}

function hills(g, W, H, rng, cols) {
  cols.forEach((col, k) => {
    const ph = rng() * 10, base = H - 260 + k * 120;
    g.beginPath();
    g.moveTo(0, H);
    for (let x = 0; x <= W; x += 20) g.lineTo(x, base - Math.abs(Math.sin(x / (300 + k * 120) + ph)) * (160 - k * 40));
    g.lineTo(W, H);
    g.closePath();
    g.fillStyle = col;
    g.fill();
  });
}

function jungleTrees(g, W, H, rng) {
  g.fillStyle = '#2f6b3a';
  g.fillRect(0, H - 40, W, 40);
  let x = 0;
  while (x < W) {
    const h = 160 + rng() * 220, tw = 12 + rng() * 8;
    g.fillStyle = '#5a3d24';
    g.fillRect(x - tw / 2, H - 40 - h, tw, h);
    if (rng() < 0.5) {
      // 야자수 잎
      g.strokeStyle = '#2f7d3a';
      g.lineWidth = 14;
      g.lineCap = 'round';
      for (let k = 0; k < 5; k++) {
        const a = -Math.PI / 2 + (k - 2) * 0.6;
        g.beginPath();
        g.moveTo(x, H - 40 - h);
        g.quadraticCurveTo(x + Math.cos(a) * 60, H - 40 - h + Math.sin(a) * 40 - 20, x + Math.cos(a) * 95, H - 40 - h + 30);
        g.stroke();
      }
    } else {
      for (const [dx, dy, r] of [[0, -20, 60], [-40, 10, 45], [40, 10, 45]]) {
        g.beginPath();
        g.arc(x + dx, H - 40 - h + dy, r, 0, Math.PI * 2);
        g.fillStyle = '#3b8a45';
        g.fill();
      }
      g.strokeStyle = '#2c6b35';
      g.lineWidth = 3;
      for (let k = 0; k < 3; k++) {
        const vx = x - 30 + k * 30;
        g.beginPath();
        g.moveTo(vx, H - 40 - h + 30);
        g.quadraticCurveTo(vx + 10, H - 40 - h + 90, vx - 4, H - 40 - h + 140);
        g.stroke();
      }
    }
    x += 90 + rng() * 160;
  }
}

function volcanoes(g, W, H, rng) {
  let x = 200;
  while (x < W + 200) {
    const w = 500 + rng() * 300, h = 380 + rng() * 260;
    g.beginPath();
    g.moveTo(x - w / 2, H);
    g.lineTo(x - w * 0.09, H - h);
    g.lineTo(x + w * 0.09, H - h);
    g.lineTo(x + w / 2, H);
    g.closePath();
    g.fillStyle = '#3d1c1a';
    g.fill();
    // 분화구 용암 + 흘러내림
    g.fillStyle = '#ff6a2a';
    g.fillRect(x - w * 0.09, H - h, w * 0.18, 10);
    g.strokeStyle = '#ff7a3a';
    g.lineWidth = 6;
    g.beginPath();
    g.moveTo(x - 10, H - h + 8);
    g.quadraticCurveTo(x - 40, H - h * 0.6, x - 70, H - h * 0.25);
    g.stroke();
    // 연기
    g.fillStyle = 'rgba(80,60,60,0.5)';
    for (let k = 0; k < 4; k++) {
      g.beginPath();
      g.arc(x + k * 25 - 20, H - h - 40 - k * 55, 34 + k * 10, 0, Math.PI * 2);
      g.fill();
    }
    x += w * 1.1 + rng() * 300;
  }
}

function lavaRocks(g, W, H, rng) {
  g.fillStyle = '#ff5a1f';
  g.fillRect(0, H - 34, W, 34);
  g.fillStyle = '#ffb347';
  for (let x = 0; x < W; x += 40) g.fillRect(x + rng() * 20, H - 30 + rng() * 10, 14, 3);
  let x = 0;
  while (x < W) {
    const w = 60 + rng() * 120, h = 60 + rng() * 160;
    g.beginPath();
    g.moveTo(x, H - 30);
    g.lineTo(x + w * 0.3, H - 30 - h);
    g.lineTo(x + w * 0.55, H - 30 - h * 0.7);
    g.lineTo(x + w * 0.8, H - 30 - h * 0.9);
    g.lineTo(x + w, H - 30);
    g.closePath();
    g.fillStyle = '#241414';
    g.fill();
    g.strokeStyle = '#ff6a2a';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(x + w * 0.4, H - 30 - h * 0.5);
    g.lineTo(x + w * 0.5, H - 30 - h * 0.25);
    g.lineTo(x + w * 0.45, H - 32);
    g.stroke();
    x += w + rng() * 120;
  }
}
