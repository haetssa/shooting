// 폭발 연출, 파편, 화면 흔들림, 데미지 숫자
import { OUTLINE } from './terrain.js';

const FONT = 'system-ui,-apple-system,"Apple SD Gothic Neo","Malgun Gothic",sans-serif';

export class Effects {
  constructor() {
    this.booms = [];
    this.parts = [];
    this.texts = [];
    this.shake = 0;
  }

  // style: undefined(일반 폭발) | 'void'(블랙홀: 안쪽으로 빨려드는 연출)
  explosion(x, y, r, style) {
    const isVoid = style === 'void';
    this.booms.push({ x, y, r, t: 0, dur: isVoid ? 0.7 : 0.5, style });
    for (let i = 0; i < 18; i++) {
      const a = Math.random() * Math.PI * 2, s = 120 + Math.random() * 260;
      const colors = isVoid ? ['#b07bff', '#2a1745'] : style === 'heal' ? ['#5ee27a', '#c8ffd4'] : ['#7a5a3c', '#3b3b46'];
      this.parts.push({
        x, y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s - 120,
        t: 0,
        dur: 0.6 + Math.random() * 0.5,
        size: 3 + Math.random() * 4,
        color: colors[Math.random() < 0.5 ? 0 : 1],
      });
    }
    this.shake = style === 'heal' ? 0 : Math.min(16, 4 + r / 6);
  }

  text(x, y, str, color = '#fff', size = 22) {
    this.texts.push({ x, y, str, color, size, t: 0, dur: 1.3 });
  }

  get busy() { return this.booms.length > 0; }

  update(dt, gravity) {
    for (const b of this.booms) b.t += dt;
    this.booms = this.booms.filter((b) => b.t < b.dur);
    for (const p of this.parts) {
      p.t += dt;
      p.vy += gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    this.parts = this.parts.filter((p) => p.t < p.dur);
    for (const t of this.texts) { t.t += dt; t.y -= 40 * dt; }
    this.texts = this.texts.filter((t) => t.t < t.dur);
    this.shake = Math.max(0, this.shake - dt * 30);
  }

  // 월드 좌표계에서
  draw(ctx) {
    for (const b of this.booms) {
      const p = b.t / b.dur;
      if (b.style === 'void') {
        ctx.globalAlpha = 1 - p * 0.8;
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r * (1.2 - 0.9 * p), 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(70,30,130,0.8)';
        ctx.fill();
        ctx.lineWidth = 5;
        ctx.strokeStyle = '#b07bff';
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r * 0.45 * (1 - p), 0, Math.PI * 2);
        ctx.fillStyle = '#07060c';
        ctx.fill();
        continue;
      }
      if (b.style === 'dust' || b.style === 'heal') {
        ctx.globalAlpha = (1 - p) * 0.8;
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r * (0.5 + 0.8 * p), 0, Math.PI * 2);
        ctx.fillStyle = b.style === 'heal' ? 'rgba(94,226,122,0.6)' : 'rgba(170,140,110,0.7)';
        ctx.fill();
        continue;
      }
      ctx.globalAlpha = 1 - p;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r * (0.6 + 0.6 * p), 0, Math.PI * 2);
      ctx.fillStyle = '#ff9a3c';
      ctx.fill();
      ctx.lineWidth = 5;
      ctx.strokeStyle = OUTLINE;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r * (0.35 + 0.4 * p), 0, Math.PI * 2);
      ctx.fillStyle = '#fff2a8';
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    for (const p of this.parts) {
      ctx.globalAlpha = 1 - p.t / p.dur;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;
  }

  // 화면 좌표계에서 (확대 배율과 무관하게 읽히도록)
  drawTexts(ctx, cam) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    for (const t of this.texts) {
      const s = cam.worldToScreen(t.x, t.y);
      const pop = t.t < 0.12 ? 0.6 + (t.t / 0.12) * 0.4 : 1;
      ctx.globalAlpha = t.t > t.dur - 0.3 ? (t.dur - t.t) / 0.3 : 1;
      ctx.font = `900 ${Math.round(t.size * pop)}px ${FONT}`;
      ctx.lineWidth = 5;
      ctx.strokeStyle = OUTLINE;
      ctx.strokeText(t.str, s.x, s.y);
      ctx.fillStyle = t.color;
      ctx.fillText(t.str, s.x, s.y);
    }
    ctx.globalAlpha = 1;
  }
}
