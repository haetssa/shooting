// 코드로 그리는 투사체 (캐릭터와 같은 굵은 외곽선 + 플랫 셀 셰이딩)
// characters.json 의 weapon.projectile 값: dollar | gpu | phone | blackhole
// 이미지로 교체하고 싶으면 여기에 이미지 분기를 추가하면 된다.
import { OUTLINE as INK } from './terrain.js';
import { roundRect as rr } from './character.js';

// 추가 종류: doge | rocket | satellite | starship | iphone | balloon | nuke | mic | note | ring | apple | apple_gold | pignose
const SPIN = { dollar: 7, gpu: 9, phone: 11, blackhole: 0, doge: 8, satellite: 3, iphone: 10, balloon: 1.5, mic: 9, note: 0, ring: 12, apple: 6, apple_gold: 4, pignose: 5 };
// 회전 대신 진행 방향을 바라보는 투사체
const POINT = { rocket: true, starship: true, nuke: true };
const TRAIL = {
  dollar: 'rgba(155,227,125,0.6)', gpu: 'rgba(201,209,224,0.6)', phone: 'rgba(127,208,255,0.6)', blackhole: 'rgba(176,123,255,0.6)',
  doge: 'rgba(255,214,90,0.6)', rocket: 'rgba(255,170,80,0.7)', satellite: 'rgba(160,200,255,0.6)', starship: 'rgba(255,170,80,0.7)',
  iphone: 'rgba(230,230,240,0.6)', balloon: 'rgba(160,150,120,0.5)', nuke: 'rgba(255,120,60,0.7)', mic: 'rgba(255,150,220,0.6)',
  note: 'rgba(255,140,220,0.7)', ring: 'rgba(255,230,140,0.6)',
  apple: 'rgba(255,110,100,0.6)', apple_gold: 'rgba(255,215,80,0.75)', pignose: 'rgba(255,170,190,0.65)',
};

export function drawProjectile(ctx, p) {
  const tr = p.trail;
  if (tr.length >= 4) {
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = TRAIL[p.type] || 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(tr[0], tr[1]);
    for (let i = 2; i < tr.length; i += 2) ctx.lineTo(tr[i], tr[i + 1]);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  }
  ctx.save();
  ctx.translate(p.x, p.y);
  const k = 1.25 * (p.scale ?? 1);
  if (p.ghost) {
    // 레이 트레이싱: 지형을 통과하는 빛나는 투사체
    const g = ctx.createRadialGradient(0, 0, 2, 0, 0, 26 * k);
    g.addColorStop(0, 'rgba(120,255,160,0.75)');
    g.addColorStop(1, 'rgba(120,255,160,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, 26 * k, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.scale(k, k);
  if (POINT[p.type]) ctx.rotate(Math.atan2(p.vy, p.vx));
  else ctx.rotate(p.age * (SPIN[p.type] ?? 0) * (p.vx < 0 ? -1 : 1));
  ctx.lineJoin = 'round';
  switch (p.type) {
    case 'dollar': drawDollar(ctx); break;
    case 'gpu': drawGpu(ctx, p.age); break;
    case 'phone': drawPhone(ctx); break;
    case 'blackhole': drawBlackhole(ctx, p.age); break;
    case 'doge': drawDoge(ctx); break;
    case 'rocket': drawRocket(ctx, p.age, 1); break;
    case 'starship': drawRocket(ctx, p.age, 2); break;
    case 'satellite': drawSatellite(ctx); break;
    case 'iphone': drawIphone(ctx); break;
    case 'balloon': drawBalloon(ctx, p.age); break;
    case 'nuke': drawNuke(ctx); break;
    case 'mic': drawMic(ctx); break;
    case 'note': drawNote(ctx, p.age); break;
    case 'ring': drawRing(ctx); break;
    case 'apple': drawApple(ctx, false); break;
    case 'apple_gold': drawApple(ctx, true); break;
    case 'pignose': drawPigNose(ctx); break;
    default: drawBall(ctx, p.color);
  }
  ctx.restore();
}

function outline(ctx, w = 2.5) {
  ctx.lineWidth = w;
  ctx.strokeStyle = INK;
  ctx.stroke();
}

function drawDollar(ctx) {
  rr(ctx, -15, -8, 30, 16, 3);
  ctx.fillStyle = '#8fd16f';
  ctx.fill();
  outline(ctx);
  ctx.strokeStyle = '#4e9a3c';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(-11.5, -5, 23, 10);
  ctx.beginPath();
  ctx.arc(2, 0, 4, 0, Math.PI * 2);
  ctx.fillStyle = '#d4f0c4';
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#2f6d23';
  ctx.font = 'bold 8px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('$', 2, 0.5);
  // 띠지
  ctx.fillStyle = '#f3e3a6';
  ctx.fillRect(-9, -8, 5, 16);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = INK;
  ctx.strokeRect(-9, -8, 5, 16);
}

function drawGpu(ctx, age) {
  // 브래킷
  ctx.fillStyle = '#c9ced8';
  ctx.fillRect(-19, -9, 4, 18);
  ctx.lineWidth = 2;
  ctx.strokeStyle = INK;
  ctx.strokeRect(-19, -9, 4, 18);
  // 본체
  rr(ctx, -16, -8, 33, 16, 3);
  ctx.fillStyle = '#3b404c';
  ctx.fill();
  outline(ctx);
  ctx.fillStyle = '#9aa3b5';
  ctx.fillRect(-13, -8, 27, 2.5);
  // 팬 2개
  for (const fx of [-6, 8]) {
    ctx.beginPath();
    ctx.arc(fx, 1, 5.5, 0, Math.PI * 2);
    ctx.fillStyle = '#23262e';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#8a90a0';
    ctx.stroke();
    ctx.strokeStyle = '#b4bac8';
    ctx.lineWidth = 1.8;
    for (let k = 0; k < 3; k++) {
      const a = age * 40 + (k * Math.PI * 2) / 3;
      ctx.beginPath();
      ctx.moveTo(fx, 1);
      ctx.lineTo(fx + Math.cos(a) * 4.5, 1 + Math.sin(a) * 4.5);
      ctx.stroke();
    }
  }
}

function drawPhone(ctx) {
  rr(ctx, -7.5, -13, 15, 26, 3.5);
  ctx.fillStyle = '#262a33';
  ctx.fill();
  outline(ctx);
  const g = ctx.createLinearGradient(0, -10, 0, 10);
  g.addColorStop(0, '#6ec6ff');
  g.addColorStop(1, '#b78cff');
  rr(ctx, -5.5, -10, 11, 19, 1.5);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.fillRect(-4, -8.5, 2, 9);
  ctx.beginPath();
  ctx.arc(0, -11.4, 0.9, 0, Math.PI * 2);
  ctx.fillStyle = '#666';
  ctx.fill();
}

function drawBlackhole(ctx, age) {
  const glow = ctx.createRadialGradient(0, 0, 4, 0, 0, 26);
  glow.addColorStop(0, 'rgba(170,110,255,0.55)');
  glow.addColorStop(1, 'rgba(170,110,255,0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(0, 0, 26, 0, Math.PI * 2);
  ctx.fill();
  const ring = (front) => {
    ctx.save();
    ctx.rotate(-0.35);
    ctx.scale(1, 0.36);
    ctx.beginPath();
    ctx.arc(0, 0, 16, front ? 0 : Math.PI, front ? Math.PI : Math.PI * 2);
    ctx.lineWidth = 5;
    ctx.strokeStyle = '#ffb347';
    ctx.stroke();
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = '#fff1c1';
    ctx.stroke();
    ctx.restore();
  };
  ring(false);
  ctx.beginPath();
  ctx.arc(0, 0, 8.5, 0, Math.PI * 2);
  ctx.fillStyle = '#07060c';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#d9c6ff';
  ctx.stroke();
  ring(true);
  // 빨려드는 입자
  ctx.fillStyle = '#e6d6ff';
  for (let k = 0; k < 4; k++) {
    const t = (age * 1.6 + k / 4) % 1;
    const a = k * 1.7 + t * 5;
    const r = 22 * (1 - t) + 6;
    ctx.globalAlpha = t;
    ctx.fillRect(Math.cos(a) * r - 1, Math.sin(a) * r - 1, 2, 2);
  }
  ctx.globalAlpha = 1;
}

function drawBall(ctx, color) {
  ctx.beginPath();
  ctx.arc(0, 0, 7, 0, Math.PI * 2);
  ctx.fillStyle = color || '#fff';
  ctx.fill();
  outline(ctx, 3);
}

// 금화 + 시바견 얼굴 (글자/로고 없음)
function drawDoge(ctx) {
  ctx.beginPath();
  ctx.arc(0, 0, 12, 0, Math.PI * 2);
  ctx.fillStyle = '#f5c542';
  ctx.fill();
  outline(ctx);
  ctx.beginPath();
  ctx.arc(0, 0, 9, 0, Math.PI * 2);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = '#c8962a';
  ctx.stroke();
  ctx.fillStyle = '#e3a04a';
  for (const sx of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(sx * 2.5, -5);
    ctx.lineTo(sx * 6.5, -8.5);
    ctx.lineTo(sx * 6.5, -3);
    ctx.closePath();
    ctx.fill();
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = INK;
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.ellipse(0, 0.5, 6, 5, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#e3a04a';
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(0, 2.5, 3.6, 2.6, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#fff4dc';
  ctx.fill();
  ctx.fillStyle = INK;
  ctx.fillRect(-3, -1.5, 1.6, 1.6);
  ctx.fillRect(1.4, -1.5, 1.6, 1.6);
  ctx.beginPath();
  ctx.arc(0, 1.6, 1, 0, Math.PI * 2);
  ctx.fill();
}

// level 1: 로켓, 2: 우주선 (진행 방향 = +x)
function drawRocket(ctx, age, level) {
  const L = level === 2 ? 1.25 : 1;
  ctx.save();
  ctx.scale(L, L);
  const f = 8 + Math.sin(age * 40) * 3;
  ctx.beginPath();
  ctx.moveTo(-12, -4);
  ctx.lineTo(-12 - f, 0);
  ctx.lineTo(-12, 4);
  ctx.closePath();
  ctx.fillStyle = '#ffb347';
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-12, -2);
  ctx.lineTo(-12 - f * 0.55, 0);
  ctx.lineTo(-12, 2);
  ctx.closePath();
  ctx.fillStyle = '#fff1a8';
  ctx.fill();
  ctx.fillStyle = level === 2 ? '#5b6170' : '#d93a32';
  for (const sy of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(-10, sy * 4);
    ctx.lineTo(-14, sy * 10);
    ctx.lineTo(-4, sy * 4);
    ctx.closePath();
    ctx.fill();
    outline(ctx, 1.8);
  }
  ctx.beginPath();
  ctx.moveTo(-12, -5);
  ctx.lineTo(8, -5);
  ctx.quadraticCurveTo(16, -4, 18, 0);
  ctx.quadraticCurveTo(16, 4, 8, 5);
  ctx.lineTo(-12, 5);
  ctx.closePath();
  ctx.fillStyle = level === 2 ? '#d7dbe3' : '#f2f3f7';
  ctx.fill();
  outline(ctx, 2.2);
  ctx.beginPath();
  ctx.arc(4, 0, 2.4, 0, Math.PI * 2);
  ctx.fillStyle = '#6ec6ff';
  ctx.fill();
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.restore();
}

function drawSatellite(ctx) {
  for (const sx of [-1, 1]) {
    const x0 = sx > 0 ? 6 : -18;
    ctx.fillStyle = '#3a6fd1';
    ctx.fillRect(x0, -4, 12, 8);
    ctx.lineWidth = 1.8;
    ctx.strokeStyle = INK;
    ctx.strokeRect(x0, -4, 12, 8);
    ctx.strokeStyle = '#8fb6ff';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x0 + 6, -4);
    ctx.lineTo(x0 + 6, 4);
    ctx.stroke();
  }
  rr(ctx, -6, -6, 12, 12, 2);
  ctx.fillStyle = '#d7dbe3';
  ctx.fill();
  outline(ctx, 2);
  ctx.beginPath();
  ctx.moveTo(0, -6);
  ctx.lineTo(0, -11);
  ctx.lineWidth = 1.6;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, -12, 1.8, 0, Math.PI * 2);
  ctx.fillStyle = '#ff5a5f';
  ctx.fill();
}

// 은색 스마트폰 (뒷면 카메라, 로고 없음)
function drawIphone(ctx) {
  rr(ctx, -7.5, -13, 15, 26, 4);
  ctx.fillStyle = '#e9ebf0';
  ctx.fill();
  outline(ctx);
  rr(ctx, -5.5, -11, 6, 6, 2);
  ctx.fillStyle = '#c9cdd6';
  ctx.fill();
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.fillStyle = '#23262e';
  for (const [x, y] of [[-3.8, -9.3], [-1.2, -9.3], [-2.5, -6.8]]) {
    ctx.beginPath();
    ctx.arc(x, y, 1, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.fillRect(3, -10, 1.6, 18);
}

// 오물 풍선: 회색 풍선 + 매달린 봉투
function drawBalloon(ctx, age) {
  ctx.rotate(Math.sin(age * 3) * 0.25);
  ctx.beginPath();
  ctx.moveTo(0, 4);
  ctx.lineTo(0, 11);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = INK;
  ctx.stroke();
  rr(ctx, -5, 10, 10, 8, 2);
  ctx.fillStyle = '#8a7a55';
  ctx.fill();
  outline(ctx, 1.8);
  ctx.beginPath();
  ctx.ellipse(0, -5, 9, 10, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#d8d6cc';
  ctx.fill();
  outline(ctx);
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.beginPath();
  ctx.ellipse(-3, -9, 2, 3.5, -0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#6b5a35';
  for (const [x, y] of [[-6, 16], [7, 14]]) {
    ctx.beginPath();
    ctx.arc(x, y, 1.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

// 핵탄두 (진행 방향 = +x)
function drawNuke(ctx) {
  ctx.fillStyle = '#4a5240';
  for (const sy of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(-10, sy * 5);
    ctx.lineTo(-16, sy * 11);
    ctx.lineTo(-16, sy * 5);
    ctx.closePath();
    ctx.fill();
    outline(ctx, 1.8);
  }
  ctx.beginPath();
  ctx.moveTo(-14, -6);
  ctx.lineTo(6, -7);
  ctx.quadraticCurveTo(17, -6, 18, 0);
  ctx.quadraticCurveTo(17, 6, 6, 7);
  ctx.lineTo(-14, 6);
  ctx.closePath();
  ctx.fillStyle = '#6f7a5c';
  ctx.fill();
  outline(ctx, 2.4);
  ctx.beginPath();
  ctx.arc(1, 0, 5, 0, Math.PI * 2);
  ctx.fillStyle = '#ffd23f';
  ctx.fill();
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.fillStyle = INK;
  for (let k = 0; k < 3; k++) {
    const a = k * (Math.PI * 2 / 3) - Math.PI / 2;
    ctx.beginPath();
    ctx.moveTo(1, 0);
    ctx.arc(1, 0, 4.2, a - 0.45, a + 0.45);
    ctx.closePath();
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(1, 0, 1.1, 0, Math.PI * 2);
  ctx.fillStyle = '#ffd23f';
  ctx.fill();
}

function drawMic(ctx) {
  rr(ctx, -2.8, -2, 5.6, 16, 2);
  ctx.fillStyle = '#2f2b3a';
  ctx.fill();
  outline(ctx, 2);
  ctx.fillStyle = '#ff8fd0';
  ctx.fillRect(-2.8, 1, 5.6, 2);
  ctx.beginPath();
  ctx.arc(0, -6, 6.5, 0, Math.PI * 2);
  ctx.fillStyle = '#c9ced8';
  ctx.fill();
  outline(ctx, 2.2);
  ctx.strokeStyle = '#8a90a0';
  ctx.lineWidth = 1;
  for (const d of [-3, 0, 3]) {
    ctx.beginPath();
    ctx.moveTo(d, -11.5);
    ctx.lineTo(d, -0.5);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-5.5, -6 + d);
    ctx.lineTo(5.5, -6 + d);
    ctx.stroke();
  }
}

function drawNote(ctx, age) {
  ctx.rotate(Math.sin(age * 8) * 0.3);
  ctx.beginPath();
  ctx.arc(0, 0, 14 + Math.sin(age * 20) * 2, 0, Math.PI * 2);
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(255,143,208,0.6)';
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(-3, 6, 5, 3.6, -0.4, 0, Math.PI * 2);
  ctx.fillStyle = '#ff5fb8';
  ctx.fill();
  outline(ctx, 2);
  ctx.beginPath();
  ctx.moveTo(1.5, 5);
  ctx.lineTo(1.5, -10);
  ctx.quadraticCurveTo(7, -7, 8, -2);
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = INK;
  ctx.stroke();
}

function drawRing(ctx) {
  ctx.beginPath();
  ctx.arc(0, 2, 6, 0, Math.PI * 2);
  ctx.lineWidth = 5;
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.lineWidth = 2.8;
  ctx.strokeStyle = '#ffd86b';
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0, -8);
  ctx.lineTo(4, -4);
  ctx.lineTo(0, 0);
  ctx.lineTo(-4, -4);
  ctx.closePath();
  ctx.fillStyle = '#bff3ff';
  ctx.fill();
  outline(ctx, 1.6);
}

// 사과 (gold: 만유인력 황금 사과, 반짝임 추가)
function drawApple(ctx, gold) {
  const body = gold ? '#ffd23f' : '#ff4d4d', shade = gold ? '#e0a516' : '#c9302c';
  ctx.beginPath();
  ctx.moveTo(0, -6);
  ctx.bezierCurveTo(5, -11, 13, -8, 12, 1);
  ctx.bezierCurveTo(11, 9, 5, 12, 0, 10);
  ctx.bezierCurveTo(-5, 12, -11, 9, -12, 1);
  ctx.bezierCurveTo(-13, -8, -5, -11, 0, -6);
  ctx.closePath();
  ctx.fillStyle = body;
  ctx.fill();
  // 그림자 한 톤
  ctx.save();
  ctx.clip();
  ctx.beginPath();
  ctx.ellipse(5, 6, 11, 8, -0.4, 0, Math.PI * 2);
  ctx.fillStyle = shade;
  ctx.fill();
  ctx.restore();
  ctx.beginPath();
  ctx.moveTo(0, -6);
  ctx.bezierCurveTo(5, -11, 13, -8, 12, 1);
  ctx.bezierCurveTo(11, 9, 5, 12, 0, 10);
  ctx.bezierCurveTo(-5, 12, -11, 9, -12, 1);
  ctx.bezierCurveTo(-13, -8, -5, -11, 0, -6);
  ctx.closePath();
  outline(ctx);
  // 하이라이트
  ctx.beginPath();
  ctx.ellipse(-6, -2, 2.2, 3.6, 0.4, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.fill();
  // 꼭지 + 잎
  ctx.beginPath();
  ctx.moveTo(0, -6);
  ctx.quadraticCurveTo(1, -11, 3, -13);
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = '#6b4a2b';
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(2, -10);
  ctx.quadraticCurveTo(7, -15, 11, -11);
  ctx.quadraticCurveTo(7, -8, 2, -10);
  ctx.closePath();
  ctx.fillStyle = '#5ec94a';
  ctx.fill();
  outline(ctx, 1.8);
  if (gold) {
    ctx.fillStyle = '#fffbe0';
    for (const [x, y, r] of [[8, -6, 2.2], [-9, 6, 1.6]]) {
      ctx.beginPath();
      ctx.moveTo(x, y - r * 2);
      ctx.lineTo(x + r * 0.6, y - r * 0.6);
      ctx.lineTo(x + r * 2, y);
      ctx.lineTo(x + r * 0.6, y + r * 0.6);
      ctx.lineTo(x, y + r * 2);
      ctx.lineTo(x - r * 0.6, y + r * 0.6);
      ctx.lineTo(x - r * 2, y);
      ctx.lineTo(x - r * 0.6, y - r * 0.6);
      ctx.closePath();
      ctx.fill();
    }
  }
}

// 돼지코 (분홍 타원 + 콧구멍 두 개)
function drawPigNose(ctx) {
  ctx.beginPath();
  ctx.ellipse(0, 0, 13, 10, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#ffb3c4';
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.beginPath();
  ctx.ellipse(4, 6, 13, 8, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#f08aa3';
  ctx.fill();
  ctx.restore();
  ctx.beginPath();
  ctx.ellipse(0, 0, 13, 10, 0, 0, Math.PI * 2);
  outline(ctx, 3);
  ctx.beginPath();
  ctx.ellipse(-3, -5, 4, 1.8, -0.2, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.fill();
  for (const sx of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(sx * 4.5, 1, 2.4, 3.6, sx * 0.15, 0, Math.PI * 2);
    ctx.fillStyle = '#7a2e45';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = INK;
    ctx.stroke();
  }
}
