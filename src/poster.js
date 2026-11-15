// 타이틀 포스터: 게임 이름 로고 + 캐릭터 전원 + 날아다니는 투사체 (전부 코드로 그림, 게임 화풍과 같은 굵은 외곽선)
// drawPoster(canvas, game, w, h): 캔버스 크기는 호출하는 쪽에서 정한다 (타이틀 화면, 공유 미리보기 이미지)
import { drawFrame } from './sprites.js';
import { drawProjectile } from './projectiles.js';
import { OUTLINE as INK } from './terrain.js';
import { roundRect as rr } from './character.js';

export const GAME_TITLE = '인플루언쏴';
const FONT = 'system-ui,-apple-system,"Apple SD Gothic Neo","Malgun Gothic",sans-serif';

export function drawPoster(canvas, game, w, h, dpr = 1) {
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const s = h / 460; // 기준 높이 460

  // 배경: 하늘 + 햇살 무늬
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, '#ffb547');
  bg.addColorStop(1, '#ff5a5f');
  rr(ctx, 0, 0, w, h, 22 * s);
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.save();
  rr(ctx, 0, 0, w, h, 22 * s);
  ctx.clip();
  const cx = w / 2, cy = h * 0.34;
  for (let k = 0; k < 24; k++) {
    const a0 = (k / 24) * Math.PI * 2, a1 = a0 + Math.PI / 24;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a0) * w * 1.5, cy + Math.sin(a0) * w * 1.5);
    ctx.lineTo(cx + Math.cos(a1) * w * 1.5, cy + Math.sin(a1) * w * 1.5);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255,240,170,0.28)';
    ctx.fill();
  }
  // 아래쪽 섬 (게임 지형 느낌)
  ctx.beginPath();
  ctx.moveTo(-10, h);
  ctx.lineTo(-10, h * 0.86);
  for (let x = 0; x <= w + 20; x += 20) ctx.lineTo(x, h * 0.86 + Math.sin(x / 70) * 6 * s);
  ctx.lineTo(w + 10, h);
  ctx.closePath();
  ctx.fillStyle = '#a0785a';
  ctx.fill();
  ctx.lineWidth = 14 * s;
  ctx.strokeStyle = '#545a68';
  ctx.stroke();
  ctx.lineWidth = 5 * s;
  ctx.strokeStyle = INK;
  ctx.stroke();

  // 날아다니는 투사체 (궤적 포함)
  const shots = [
    ['dollar', 0.12, 0.2, -0.4], ['gpu', 0.86, 0.16, 0.5], ['doge', 0.06, 0.52, 0.2], ['mic', 0.93, 0.5, -0.3],
    ['nuke', 0.78, 0.3, 0.6], ['blackhole', 0.22, 0.38, 0], ['iphone', 0.66, 0.08, 0.9], ['balloon', 0.36, 0.1, 0],
  ];
  for (const [type, fx, fy, age] of shots) {
    const x = fx * w, y = fy * h, dir = fx < 0.5 ? 1 : -1;
    const trail = [];
    for (let i = 10; i >= 1; i--) trail.push(x - dir * i * 9 * s, y + i * i * 0.5 * s);
    drawProjectile(ctx, { type, x, y, vx: dir * 300, vy: -100, age: age + 1, scale: 1.25 * s, trail, color: '#fff' });
  }

  // 캐릭터: 뒷줄(작게) + 앞줄(크게), 왼쪽 절반은 오른쪽, 오른쪽 절반은 왼쪽을 본다
  const idx = game.charDefs.map((d, i) => (d.hidden || d.adminOnly ? -1 : i)).filter((i) => i >= 0 && game.sprites[i]);
  const back = idx.filter((_, k) => k % 2 === 1), front = idx.filter((_, k) => k % 2 === 0);
  const row = (list, y, hgt, spread) => {
    list.forEach((i, k) => {
      const t = list.length === 1 ? 0.5 : k / (list.length - 1);
      const x = w * (0.5 - spread / 2 + t * spread);
      const sp = game.sprites[i];
      // 발밑 그림자
      ctx.beginPath();
      ctx.ellipse(x, y + 2, hgt * 0.22, hgt * 0.05, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(28,26,43,0.25)';
      ctx.fill();
      const A = sp.meta.anims;
      drawFrame(ctx, sp, (A.windup || A.idle)[k % 2 ? 1 : 3] ?? A.idle[0], x, y, hgt, x < w / 2 ? 1 : -1);
    });
  };
  row(back, h * 0.84, 110 * s, 0.62);
  row(front, h * 0.95, 136 * s, 0.8);
  ctx.restore();

  // 로고
  ctx.save();
  ctx.translate(w / 2, h * 0.21);
  ctx.rotate(-0.05);
  const size = Math.min(92 * s, w / 5.6);
  ctx.font = `900 ${size}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  const main = '인플루언', boom = '쏴';
  const mw = ctx.measureText(main).width;
  ctx.font = `900 ${size * 1.3}px ${FONT}`;
  const bw = ctx.measureText(boom).width;
  const total = mw + bw, x0 = -total / 2;
  // "쏴" 뒤 폭발 별
  const bx = x0 + mw + bw / 2;
  ctx.beginPath();
  for (let k = 0; k < 20; k++) {
    const r = (k % 2 ? 0.55 : 1) * size * 0.95, a = (k / 20) * Math.PI * 2;
    ctx.lineTo(bx + Math.cos(a) * r, Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.fillStyle = '#fff2a8';
  ctx.fill();
  ctx.lineWidth = 4 * s;
  ctx.strokeStyle = INK;
  ctx.stroke();
  const word = (str, x, sz, fill) => {
    ctx.font = `900 ${sz}px ${FONT}`;
    ctx.lineWidth = sz * 0.2;
    ctx.strokeStyle = INK;
    ctx.strokeText(str, x, 0);
    const g = ctx.createLinearGradient(0, -sz / 2, 0, sz / 2);
    g.addColorStop(0, fill[0]);
    g.addColorStop(1, fill[1]);
    ctx.fillStyle = g;
    ctx.fillText(str, x, 0);
  };
  word(main, x0 + mw / 2, size, ['#ffffff', '#ffe27a']);
  word(boom, bx, size * 1.3, ['#ff7a5a', '#e0262f']);
  ctx.restore();

  // 부제 리본
  const sub = '유명인 패러디 포격 대전';
  ctx.font = `800 ${17 * s}px ${FONT}`;
  const tw = ctx.measureText(sub).width + 36 * s, ty = h * 0.39;
  rr(ctx, w / 2 - tw / 2, ty - 15 * s, tw, 30 * s, 15 * s);
  ctx.fillStyle = '#1c1a2b';
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(sub, w / 2, ty + 1);

  // 테두리
  rr(ctx, 2 * s, 2 * s, w - 4 * s, h - 4 * s, 21 * s);
  ctx.lineWidth = 5 * s;
  ctx.strokeStyle = INK;
  ctx.stroke();
}
