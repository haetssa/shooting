// 코드로 그리는 투사체 (캐릭터와 같은 굵은 외곽선 + 플랫 셀 셰이딩)
// characters.json 의 weapon.projectile 값: dollar | gpu | phone | blackhole
// 이미지로 교체하고 싶으면 여기에 이미지 분기를 추가하면 된다.
import { OUTLINE as INK } from './terrain.js';
import { roundRect as rr } from './character.js';

const SPIN = { dollar: 7, gpu: 9, phone: 11, blackhole: 0 };
const TRAIL = { dollar: 'rgba(155,227,125,0.6)', gpu: 'rgba(201,209,224,0.6)', phone: 'rgba(127,208,255,0.6)', blackhole: 'rgba(176,123,255,0.6)' };

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
  ctx.scale(k, k);
  ctx.rotate(p.age * (SPIN[p.type] ?? 0) * (p.vx < 0 ? -1 : 1));
  ctx.lineJoin = 'round';
  switch (p.type) {
    case 'dollar': drawDollar(ctx); break;
    case 'gpu': drawGpu(ctx, p.age); break;
    case 'phone': drawPhone(ctx); break;
    case 'blackhole': drawBlackhole(ctx, p.age); break;
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
