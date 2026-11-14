// HUD(화면 좌표): 바람 표시, 플레이어 목록, 타이머, 파워/각도/연료 게이지, 머리 위 이름표, 배너
// 월드 좌표 그리기 도우미: 조준선, 투사체
import { clamp, mixHex } from './util.js';
import { roundRect as rr } from './character.js';
import { OUTLINE as INK } from './terrain.js';
import { skillOf } from './skills.js';

const FONT = 'system-ui,-apple-system,"Apple SD Gothic Neo","Malgun Gothic",sans-serif';

function text(ctx, str, x, y, size, color, align = 'left', weight = 800) {
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(3, size / 5);
  ctx.strokeStyle = INK;
  ctx.strokeText(str, x, y);
  ctx.fillStyle = color;
  ctx.fillText(str, x, y);
}

const hpColor = (r) => (r > 0.5 ? '#5ee27a' : r > 0.25 ? '#ffd23f' : '#ff5a5f');

export class HUD {
  constructor() {
    this.streaks = [];
    for (let i = 0; i < 36; i++) this.streaks.push({ x: Math.random(), y: Math.random(), s: 0.5 + Math.random(), l: 0.5 + Math.random() });
    this.banner = null;
  }

  showBanner(str, color = '#fff') { this.banner = { text: str, color, t: 0 }; }

  update(dt, wind, max) {
    if (wind && max > 0) {
      const v = wind.value / max;
      const drift = (Math.sign(wind.value) || 1) * 0.01;
      for (const k of this.streaks) {
        k.x += (v * 0.5 * k.s + drift) * dt;
        if (k.x > 1.05) { k.x = -0.05; k.y = Math.random(); }
        if (k.x < -0.05) { k.x = 1.05; k.y = Math.random(); }
      }
    }
    if (this.banner) {
      this.banner.t += dt;
      if (this.banner.t > 1.6) this.banner = null;
    }
  }

  draw(ctx, game, w, h) {
    const wmax = game.wind.cfg.max;
    this.drawStreaks(ctx, game.wind, wmax, w, h);
    if (game.state !== 'playing' && game.state !== 'over') return;
    this.drawLabels(ctx, game);
    this.drawBubbles(ctx, game);
    game.effects.drawTexts(ctx, game.camera);
    this.drawWind(ctx, game.wind, wmax, w);
    this.drawPlayers(ctx, game);
    this.drawChatLog(ctx, game);
    if (game.state === 'playing') {
      this.drawTimer(ctx, game, w);
      this.drawGauge(ctx, game, w, h);
    }
    this.drawBanner(ctx, w, h);
  }

  // 채팅 말풍선 (머리 위)
  drawBubbles(ctx, game) {
    for (const c of game.chars) {
      const b = c.uid && game.bubbles[c.uid];
      if (!b || c.fellOut) continue;
      const p = game.camera.worldToScreen(c.x, c.topY);
      ctx.font = `700 12px ${FONT}`;
      const tw = Math.min(180, ctx.measureText(b.text).width);
      const bw = tw + 16, bh = 22, bx = p.x - bw / 2, by = p.y - 74;
      ctx.globalAlpha = Math.min(1, b.t);
      rr(ctx, bx, by, bw, bh, 9);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = INK;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(p.x - 5, by + bh);
      ctx.lineTo(p.x + 5, by + bh);
      ctx.lineTo(p.x, by + bh + 6);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = INK;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(b.text, p.x, by + bh / 2 + 1, 180);
      ctx.globalAlpha = 1;
    }
  }

  // 최근 채팅 몇 줄 (플레이어 목록 아래)
  drawChatLog(ctx, game) {
    let y = 14 + game.chars.length * 26;
    for (const m of game.chatLog) {
      ctx.globalAlpha = Math.min(1, m.t);
      text(ctx, `${m.name}: ${m.text}`, 10, y, 11, m.sys ? '#ffd23f' : '#ffffff', 'left', 700);
      y += 16;
    }
    ctx.globalAlpha = 1;
  }

  drawStreaks(ctx, wind, max, w, h) {
    if (!wind || !(max > 0)) return;
    const s = Math.abs(wind.value) / max;
    const dir = Math.sign(wind.value) || 1;
    ctx.strokeStyle = `rgba(255,255,255,${0.12 + 0.3 * s})`;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (const k of this.streaks) {
      const x = k.x * w, y = k.y * h, L = (6 + 34 * s) * k.l;
      ctx.moveTo(x, y);
      ctx.lineTo(x - dir * L, y);
    }
    ctx.stroke();
  }

  drawLabels(ctx, game) {
    const cam = game.camera;
    const cur = game.state === 'playing' ? game.turn.current : null;
    for (const c of game.chars) {
      if (c.fellOut) continue;
      const p = cam.worldToScreen(c.x, c.topY);
      const y = p.y - 12;
      if (c.alive) {
        const bw = 44, r = c.hp / c.maxHp;
        rr(ctx, p.x - bw / 2 - 1, y - 1, bw + 2, 8, 3);
        ctx.fillStyle = INK;
        ctx.fill();
        ctx.fillStyle = hpColor(r);
        ctx.fillRect(p.x - bw / 2 + 1, y + 1, (bw - 2) * r, 4);
      }
      text(ctx, c.name, p.x, y - 10, 12, c.alive ? c.color : '#9aa0ad', 'center');
      if (c === cur) {
        const by = y - 30 + Math.sin(game.time * 6) * 3;
        ctx.beginPath();
        ctx.moveTo(p.x - 8, by - 8);
        ctx.lineTo(p.x + 8, by - 8);
        ctx.lineTo(p.x, by + 2);
        ctx.closePath();
        ctx.fillStyle = c.color;
        ctx.fill();
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = INK;
        ctx.stroke();
      }
    }
  }

  drawWind(ctx, wind, max, w) {
    const pw = 190, ph = 44, x = w / 2 - pw / 2, y = 8;
    rr(ctx, x, y, pw, ph, 12);
    ctx.fillStyle = 'rgba(20,22,40,0.72)';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.stroke();
    text(ctx, '바람', x + 24, y + ph / 2, 13, '#cfd6e6', 'center', 700);
    if (!(max > 0)) { text(ctx, '없음', x + pw / 2 + 14, y + ph / 2, 15, '#cfd6e6', 'center', 800); return; }
    const v = wind.value, s = Math.abs(v) / max;
    const cx = x + pw / 2 + 4, cy = y + ph / 2;
    const col = mixHex('#ffffff', '#ff6a3d', s);
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(cx - 50, cy);
    ctx.lineTo(cx + 50, cy);
    ctx.stroke();
    const dir = Math.sign(v) || 1, len = 50 * s, tip = cx + dir * len;
    if (len > 3) {
      ctx.strokeStyle = col;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(tip, cy);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(tip + dir * 8, cy);
      ctx.lineTo(tip - dir * 4, cy - 8);
      ctx.lineTo(tip - dir * 4, cy + 8);
      ctx.closePath();
      ctx.fillStyle = col;
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.arc(cx, cy, 4, 0, Math.PI * 2);
      ctx.fillStyle = col;
      ctx.fill();
    }
    text(ctx, String(Math.round(Math.abs(v))), x + pw - 18, cy, 18, col, 'center');
  }

  drawPlayers(ctx, game) {
    const cur = game.state === 'playing' ? game.turn.current : null;
    let y = 8;
    for (const c of game.chars) {
      rr(ctx, 8, y, 168, 22, 8);
      ctx.fillStyle = c === cur ? 'rgba(255,255,255,0.25)' : 'rgba(20,22,40,0.55)';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(20, y + 11, 6, 0, Math.PI * 2);
      ctx.fillStyle = c.alive ? c.color : '#666';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = INK;
      ctx.stroke();
      const nm = c.name.length > 6 ? c.name.slice(0, 5) + '…' : c.name;
      text(ctx, nm, 31, y + 11, 12, c.alive ? '#fff' : '#888', 'left', 700);
      const r = c.hp / c.maxHp;
      rr(ctx, 104, y + 7, 64, 8, 3);
      ctx.fillStyle = INK;
      ctx.fill();
      if (r > 0) {
        ctx.fillStyle = hpColor(r);
        ctx.fillRect(105, y + 8, 62 * r, 6);
      }
      if (c.alive && c.ult > 0) {
        ctx.fillStyle = c.ult >= 100 ? '#e2b6ff' : '#9b6bd6';
        ctx.fillRect(105, y + 16, 62 * (c.ult / 100), 3);
      }
      if (c.isBot) text(ctx, '봇', 96, y + 11, 9, '#cfd6e6', 'right', 700);
      y += 26;
    }
  }

  drawTimer(ctx, game, w) {
    const t = game.turn;
    const cx = w - 34, cy = 34, r = 24;
    const left = Math.max(0, t.timer);
    const warn = t.phase === 'aim' && left <= 5;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(20,22,40,0.72)';
    ctx.fill();
    ctx.lineWidth = 5;
    ctx.strokeStyle = warn ? '#ff5a5f' : t.current.color;
    ctx.beginPath();
    ctx.arc(cx, cy, r - 3, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * left) / game.cfg.turnTime);
    ctx.stroke();
    text(ctx, t.phase === 'aim' ? String(Math.ceil(left)) : '…', cx, cy + 1, 18, warn ? '#ff5a5f' : '#fff', 'center', 900);
  }

  drawGauge(ctx, game, w, h) {
    const t = game.turn, c = t.current;
    const gw = clamp(w - 480, 150, 360), gh = 18, gx = (w - gw) / 2, gy = h - 42;
    rr(ctx, gx - 2, gy - 2, gw + 4, gh + 4, 8);
    ctx.fillStyle = INK;
    ctx.fill();
    rr(ctx, gx, gy, gw, gh, 6);
    ctx.fillStyle = '#3a3d55';
    ctx.fill();
    const pw = t.charging ? t.power : 0;
    if (pw > 0) {
      const g = ctx.createLinearGradient(gx, 0, gx + gw, 0);
      g.addColorStop(0, '#ffd23f');
      g.addColorStop(1, '#ff4d3d');
      ctx.fillStyle = g;
      rr(ctx, gx, gy, Math.max(8, (gw * pw) / 100), gh, 6);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    for (const q of [25, 50, 75]) ctx.fillRect(gx + (gw * q) / 100 - 1, gy + 3, 2, gh - 6);
    if (c.lastPower != null) {
      const mx = gx + (gw * c.lastPower) / 100;
      ctx.beginPath();
      ctx.moveTo(mx - 6, gy - 10);
      ctx.lineTo(mx + 6, gy - 10);
      ctx.lineTo(mx, gy - 2);
      ctx.closePath();
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = INK;
      ctx.stroke();
    }
    const armed = game.armed ? skillOf(c, game.armed) : null;
    if (armed) text(ctx, `★ ${armed.name}`, gx + gw / 2, gy - 11, 13, game.armed === 3 ? '#e2b6ff' : '#ffd23f', 'center', 900);
    text(ctx, '파워', gx + 4, gy - 10, 11, '#cfd6e6', 'left', 700);
    text(ctx, `각도 ${Math.round(c.angle)}°`, gx + gw - 2, gy - 11, 14, '#fff', 'right', 900);
    // 연료
    const fy = gy + gh + 5;
    rr(ctx, gx, fy, gw, 6, 3);
    ctx.fillStyle = INK;
    ctx.fill();
    ctx.fillStyle = '#5ee27a';
    ctx.fillRect(gx + 1, fy + 1, (gw - 2) * (c.fuel / c.maxFuel), 4);
    text(ctx, '연료', gx + gw + 22, fy + 3, 11, '#cfd6e6', 'center', 700);
  }

  drawBanner(ctx, w, h) {
    const b = this.banner;
    if (!b) return;
    const a = b.t < 0.2 ? b.t / 0.2 : b.t > 1.2 ? Math.max(0, 1 - (b.t - 1.2) / 0.4) : 1;
    ctx.globalAlpha = a;
    text(ctx, b.text, w / 2, h * 0.3, Math.round(Math.min(28, h * 0.062)), b.color, 'center', 900);
    ctx.globalAlpha = 1;
  }
}

// ---- 월드 좌표 도우미 ----

// 예상 궤적 점선 (아인슈타잉 패시브)
export function drawPreview(ctx, pts) {
  for (let i = 0; i < pts.length; i += 2) {
    const a = 1 - i / pts.length;
    ctx.globalAlpha = 0.25 + 0.6 * a;
    ctx.beginPath();
    ctx.arc(pts[i], pts[i + 1], 3.2, 0, Math.PI * 2);
    ctx.fillStyle = '#e6d6ff';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = INK;
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

export function drawAim(ctx, c) {
  if (!c.alive || c.fellOut) return;
  const ox = c.x, oy = c.cy - 4;
  const line = (ang, r0, r1, color, width) => {
    const a = (ang * Math.PI) / 180;
    const dx = Math.cos(a) * c.facing, dy = -Math.sin(a);
    ctx.beginPath();
    ctx.moveTo(ox + dx * r0, oy + dy * r0);
    ctx.lineTo(ox + dx * r1, oy + dy * r1);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();
    return { x: ox + dx * r1, y: oy + dy * r1, dx, dy };
  };
  ctx.lineCap = 'round';
  if (c.lastAngle != null) {
    ctx.setLineDash([6, 8]);
    line(c.lastAngle, 30, 78, 'rgba(255,255,255,0.45)', 3);
    ctx.setLineDash([]);
  }
  line(c.angle, 30, 84, INK, 8);
  const tip = line(c.angle, 30, 84, '#fff', 4);
  ctx.beginPath();
  ctx.moveTo(tip.x + tip.dx * 12, tip.y + tip.dy * 12);
  ctx.lineTo(tip.x - tip.dy * 8, tip.y + tip.dx * 8);
  ctx.lineTo(tip.x + tip.dy * 8, tip.y - tip.dx * 8);
  ctx.closePath();
  ctx.fillStyle = '#fff';
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = INK;
  ctx.stroke();
}

