// 캐릭터 상태, 이동(경사 따라 걷기, 점프), 낙하, 애니메이션
// 스프라이트가 없으면 임시 캡슐 그림으로 대체한다.
import { OUTLINE } from './terrain.js';
import { drawFrame } from './sprites.js';
import { damageTakenMult } from './skills.js';

export class Character {
  constructor(def, player, sprite = null) {
    this.def = def;
    this.sprite = sprite;
    this.spriteH = def.spriteHeight || 66;
    this.charName = def.name;
    this.id = player.id;
    this.uid = player.uid || null; // 온라인 플레이어 식별자
    this.name = player.name;
    this.color = player.color;
    this.teamId = player.teamId ?? null;
    this.maxHp = def.hp;
    this.hp = def.hp;
    this.maxFuel = def.moveFuel;
    this.fuel = def.moveFuel;
    this.weapon = def.weapon;
    this.x = 0; this.y = 0; // 발 아래 중앙
    this.vx = 0; this.vy = 0;
    // 판정 크기는 스프라이트 키에 비례 (72 → 키 56, 반지름 24)
    this.w = 34;
    this.h = Math.round(this.spriteH * 0.78);
    this.radius = Math.round(this.spriteH * 0.34);
    this.grounded = false;
    this.facing = 1;
    this.angle = 45;
    this.alive = true;
    this.fellOut = false;
    this.fallStartY = 0;
    this.ult = 0;
    this.lastAngle = null;
    this.lastPower = null;
    this.walking = false;
    this.hurt = 0;
    // 애니메이션 타이머
    this.deadT = 0;
    this.throwT = -1;   // 발사 후 경과 시간 (-1 = 발사 중 아님)
    this.landT = 0;
    this.charge = null; // 차지 중이면 파워(0~100)
    // 스킬
    this.cooldowns = [0, 0];
    this.dmgMult = damageTakenMult(def);
    // 봇 (0 = 사람, 1~3 = 난이도)
    this.botLevel = player.bot || 0;
    this.isBot = this.botLevel > 0;
  }

  heal(n) {
    if (!this.alive) return 0;
    const h = Math.min(this.maxHp - this.hp, Math.round(n));
    this.hp += h;
    return h;
  }

  get cy() { return this.y - this.h / 2; }
  get topY() { return this.y - (this.sprite ? this.spriteH : this.h); }

  startThrow() { this.throwT = 0; }

  hitTest(px, py, pr) {
    const dx = px - this.x, dy = py - this.cy;
    const r = this.radius + pr;
    return dx * dx + dy * dy < r * r;
  }

  placeOn(terrain, x, y) {
    this.x = x;
    this.y = y;
    let k = 0;
    while (k++ < terrain.h && !terrain.isSolid(x, this.y + 1)) this.y++;
    while (terrain.isSolid(x, this.y)) this.y--;
    this.grounded = true;
    this.vx = this.vy = 0;
  }

  walk(dir, dt, terrain, m) {
    this.facing = dir;
    if (!this.grounded || this.fuel <= 0) return false;
    const dx = dir * m.speed * dt;
    const nx = this.x + dx;
    const climb = Math.max(1, Math.ceil(Math.abs(dx) * m.maxSlope));
    let ny = null;
    if (terrain.isSolid(nx, this.y)) {
      for (let k = 1; k <= climb; k++) if (!terrain.isSolid(nx, this.y - k)) { ny = this.y - k; break; }
      if (ny === null) return false; // 너무 가파름
    } else {
      for (let k = 0; k <= climb * 2 + 2; k++) if (terrain.isSolid(nx, this.y + k + 1)) { ny = this.y + k; break; }
    }
    const baseY = ny ?? this.y;
    const ahead = nx + dir * this.w * 0.45;
    if (terrain.isSolid(ahead, baseY - this.h * 0.55) || terrain.isSolid(nx, baseY - this.h + 4)) return false; // 벽
    this.x = nx;
    this.fuel = Math.max(0, this.fuel - Math.abs(dx) * m.fuelPerPx);
    this.walking = true;
    if (ny === null) {
      // 낭떠러지로 걸어 나감
      this.grounded = false;
      this.vx = dir * m.speed * 0.8;
      this.vy = 0;
      this.fallStartY = this.y;
    } else {
      this.y = ny;
    }
    return true;
  }

  jump(m) {
    if (!this.grounded || this.fuel < m.jumpFuelCost) return false;
    this.fuel -= m.jumpFuelCost;
    this.grounded = false;
    this.vx = this.facing * m.jumpVx;
    this.vy = -m.jumpVy;
    this.fallStartY = this.y;
    return true;
  }

  knock(kx, ky) {
    if (this.fellOut) return;
    this.vx += kx;
    this.vy += ky;
    if (Math.hypot(kx, ky) > 40) {
      if (this.grounded) this.vy = Math.min(this.vy, -80);
      this.grounded = false;
      this.fallStartY = this.y;
    }
  }

  takeDamage(n) {
    if (!this.alive) return 0;
    const d = Math.min(this.hp, Math.max(0, Math.round(n * this.dmgMult)));
    this.hp -= d;
    this.hurt = 0.35;
    if (this.hp <= 0) { this.hp = 0; this.alive = false; }
    return d;
  }

  // 매 틱 물리. 이벤트 { type: 'fall', amount } | { type: 'out' } 반환
  update(dt, terrain, cfg) {
    if (this.fellOut) return null;
    if (this.hurt > 0) this.hurt -= dt;
    if (!this.alive) this.deadT += dt;
    if (this.throwT >= 0) { this.throwT += dt; if (this.throwT > 0.45) this.throwT = -1; }
    if (this.landT > 0) this.landT -= dt;

    if (this.grounded) {
      if (!terrain.isSolid(this.x, this.y + 1)) {
        let snapped = false;
        for (let k = 1; k <= 4; k++) if (terrain.isSolid(this.x, this.y + k + 1)) { this.y += k; snapped = true; break; }
        if (!snapped) { this.grounded = false; this.vx = 0; this.vy = 0; this.fallStartY = this.y; }
      } else {
        let k = 0;
        while (k++ < 30 && terrain.isSolid(this.x, this.y)) this.y--;
      }
    }
    if (this.grounded) return null;

    this.vy = Math.min(this.vy + cfg.gravity * dt, cfg.maxFallSpeed);
    const steps = Math.max(1, Math.ceil((Math.max(Math.abs(this.vx), Math.abs(this.vy)) * dt) / 2));
    let landed = false;
    for (let i = 0; i < steps; i++) {
      const sx = (this.vx * dt) / steps;
      const nx = this.x + sx;
      if (sx !== 0 && (terrain.isSolid(nx, this.y - this.h * 0.5) || terrain.isSolid(nx, this.y - this.h + 4))) this.vx = 0;
      else this.x = nx;
      const sy = (this.vy * dt) / steps;
      const ny = this.y + sy;
      if (sy > 0 && terrain.isSolid(this.x, Math.floor(ny) + 1)) {
        let yy = Math.floor(ny), k = 0;
        while (k++ < 40 && terrain.isSolid(this.x, yy)) yy--;
        this.y = yy;
        landed = true;
        break;
      }
      if (sy < 0 && terrain.isSolid(this.x, ny - this.h + 4)) { this.vy = 0; continue; }
      this.y = ny;
      if (this.y < this.fallStartY) this.fallStartY = this.y;
    }

    if (landed) {
      this.grounded = true;
      this.vx = 0;
      this.vy = 0;
      this.landT = 0.12;
      const fall = this.y - this.fallStartY;
      if (this.alive && fall > cfg.fall.safeHeight) {
        return { type: 'fall', amount: Math.round((fall - cfg.fall.safeHeight) * cfg.fall.damagePerPx) };
      }
      return null;
    }
    if (this.y > terrain.h + 60) {
      this.fellOut = true;
      const wasAlive = this.alive;
      this.alive = false;
      this.hp = 0;
      return wasAlive ? { type: 'out' } : null;
    }
    return null;
  }

  // 현재 상태에 맞는 아틀라스 프레임 번호
  animFrame(time) {
    const A = this.sprite.meta.anims;
    const pick = (list, i) => list[Math.max(0, Math.min(list.length - 1, i))];
    if (!this.alive) return pick(A.hit, Math.floor(this.deadT * 8));
    if (this.throwT >= 0) return pick(A.throw, Math.floor(this.throwT * 14));
    if (this.charge != null) return pick(A.windup, Math.floor((this.charge / 100) * A.windup.length));
    if (this.hurt > 0) return pick(A.hit, this.hurt > 0.18 ? 0 : 1);
    if (!this.grounded) return pick(A.jump, this.vy < 0 ? 1 : 2);
    if (this.landT > 0) return A.jump[0];
    if (this.walking) return A.walk[Math.floor(time * 9) % A.walk.length];
    return A.idle[Math.floor(time * 4) % A.idle.length];
  }

  draw(ctx, time) {
    if (this.fellOut) return;
    if (this.sprite) {
      // 온라인 참가자는 방장이 보낸 프레임 번호(netFrame)로 그린다
      drawFrame(ctx, this.sprite, this.netFrame ?? this.animFrame(time), this.x, this.y + 1, this.spriteH, this.facing);
      return;
    }
    this.drawPlaceholder(ctx, time);
  }

  // 임시 그림 (캡슐 + 눈). 쓰러지면 뒤쪽으로 눕는다.
  drawPlaceholder(ctx, time) {
    const { w, h } = this;
    ctx.save();
    ctx.translate(this.x, this.y);
    if (!this.alive) {
      ctx.translate(0, -w / 2);
      ctx.rotate(-this.facing * Math.PI / 2);
      ctx.globalAlpha = 0.75;
    }
    const sq = !this.alive ? 0 : this.walking ? Math.abs(Math.sin(time * 14)) * 3 : (Math.sin(time * 3) + 1) * 0.8;
    ctx.scale(this.facing, 1);
    roundRect(ctx, -w / 2, -h + sq, w, h - sq, 13);
    ctx.fillStyle = this.color;
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = OUTLINE;
    ctx.stroke();
    // 배 하이라이트
    roundRect(ctx, -w / 2 + 6, -h * 0.45, w * 0.45, h * 0.3, 7);
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fill();
    // 눈
    const ey = -h + 16 + sq;
    ctx.beginPath();
    ctx.arc(w * 0.18, ey, 7, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(w * 0.18 + 2.5, ey, this.alive ? 3.5 : 1.5, 0, Math.PI * 2);
    ctx.fillStyle = OUTLINE;
    ctx.fill();
    if (this.hurt > 0) {
      roundRect(ctx, -w / 2, -h + sq, w, h - sq, 13);
      ctx.fillStyle = `rgba(255,255,255,${Math.min(1, this.hurt * 2.5)})`;
      ctx.fill();
    }
    ctx.restore();
  }
}

export function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
