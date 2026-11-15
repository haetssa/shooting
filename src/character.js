// 캐릭터 상태, 이동(경사 따라 걷기, 점프), 낙하, 애니메이션
// 스프라이트가 없으면 임시 캡슐 그림으로 대체한다.
import { OUTLINE } from './terrain.js';
import { drawFrame } from './sprites.js';
import { damageTakenMult, knockbackTakenMult } from './skills.js';

const MAX_KNOCK_VX = 380; // 여러 번 연달아 맞아도 수평 속도는 이 이상 안 쌓임

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
    this.capsule = false;
    this.grounded = false;
    this.facing = 1;
    this.angle = 45;
    this.alive = true;
    this.fellOut = false;
    this.fallStartY = 0;
    this.mana = 0;
    this.hits = 0;      // 기본 공격 적중 횟수 (궁극기 해금)
    this.ultNeed = 2;
    this.shield = 0;    // 받는 피해 감소 비율 (다음 내 턴까지)
    this.airDir = 0;    // 공중 좌우 조작 (-1, 0, 1)
    this.car = false;   // 안전 착지 패시브 변신 중
    this.netControlled = false;
    this.dealt = 0;     // 이번 경기에서 상대에게 준 피해 (통계)
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
    this.kbMult = knockbackTakenMult(def);
    // 운영자 전용 캐릭터 능력 (characters.json god 필드)
    this.maxJumps = def.god?.jumps || 1;
    this.jumpsLeft = 0;
    this.noFall = def.passive?.type === 'safe_landing' || !!def.god?.noFallDamage;
    // 운영자(제작자)가 조종하는 캐릭터: 오오라 + 제작자 표시
    this.admin = !!player.admin;
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

  // 판정 크기 (config.hitbox): radiusMult 반지름 배율, capsule 이면 머리부터 발까지 덮는 세로 캡슐
  setHitbox(hb = {}) {
    this.radius = Math.round(this.spriteH * 0.34 * (hb.radiusMult ?? 1));
    this.capsule = hb.capsule !== false;
  }

  // 판정 중심선에서 py 에 가장 가까운 y (캡슐이 아니면 몸 중심)
  nearestY(py) {
    if (!this.capsule) return this.cy;
    const bot = this.y - this.radius, top = Math.min(this.y - this.spriteH + this.radius, bot);
    return py < top ? top : py > bot ? bot : py;
  }

  hitTest(px, py, pr) {
    const dx = px - this.x, dy = py - this.nearestY(py);
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
    this.jumpsLeft = this.maxJumps - 1;
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
      this.jumpsLeft = this.maxJumps - 1;
    } else {
      this.y = ny;
    }
    return true;
  }

  // dir: 누르고 있는 방향 (0이면 제자리 점프). 운영자 캐릭터는 공중에서도 maxJumps 번까지 연속 점프
  jump(m, dir = 0) {
    if (this.fuel < m.jumpFuelCost || !this.alive) return false;
    if (this.grounded) this.jumpsLeft = this.maxJumps - 1;
    else if (this.jumpsLeft > 0) this.jumpsLeft--;
    else return false;
    this.fuel -= m.jumpFuelCost;
    this.grounded = false;
    this.car = false;
    if (dir) this.facing = dir;
    this.vx = dir * m.jumpVx;
    this.vy = -m.jumpVy;
    this.fallStartY = this.y;
    return true;
  }

  knock(kx, ky) {
    if (this.fellOut) return;
    kx *= this.kbMult;
    ky *= this.kbMult;
    this.vx = Math.max(-MAX_KNOCK_VX, Math.min(MAX_KNOCK_VX, this.vx + kx));
    this.vy += ky;
    if (Math.hypot(kx, ky) > 40) {
      if (this.grounded) this.vy = Math.min(this.vy, -80);
      this.grounded = false;
      this.fallStartY = this.y;
    }
  }

  takeDamage(n) {
    if (!this.alive) return 0;
    const d = Math.min(this.hp, Math.max(0, Math.round(n * this.dmgMult * (1 - this.shield))));
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
    // 온라인 참가자가 자기 차례에 직접 움직이는 중이면 방장은 받은 위치만 쓴다
    if (this.netControlled) return null;

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

    // 공중 좌우 조작: 누르는 방향으로 수평 속도를 서서히 맞춘다
    if (this.airDir && cfg.move) {
      const target = this.airDir * cfg.move.airSpeed, a = cfg.move.airAccel * dt;
      this.vx += Math.max(-a, Math.min(a, target - this.vx));
      this.facing = this.airDir;
    }
    let maxV = cfg.maxFallSpeed;
    const pv = this.def.passive;
    if (pv?.type === 'safe_landing' && this.alive) {
      if (!this.car && this.vy > 0 && this.y - this.fallStartY > 60) this.car = true;
      if (this.car) maxV = pv.value;
    }
    this.vy = Math.min(this.vy + cfg.gravity * dt, maxV);
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
      const safe = this.car || this.noFall;
      this.jumpsLeft = this.maxJumps - 1;
      this.car = false;
      if (this.alive && !safe && fall > cfg.fall.safeHeight) {
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
    if (this.admin) this.drawAura(ctx, time);
    if (this.car) { this.drawCar(ctx, time); return; }
    if (this.sprite) {
      // 온라인 참가자는 방장이 보낸 프레임 번호(netFrame)로 그린다 (내 차례에는 직접 계산)
      drawFrame(ctx, this.sprite, this.netFrame ?? this.animFrame(time), this.x, this.y + 1, this.spriteH, this.facing);
    } else this.drawPlaceholder(ctx, time);
    if (this.shield > 0 && this.alive) this.drawShield(ctx, time);
  }

  // 운영자 오오라: 금빛 후광 + 발밑 고리 + 위로 피어오르는 반짝이
  drawAura(ctx, time) {
    const cx = this.x, cy = this.alive ? this.y - this.spriteH * 0.48 : this.y - 14;
    const R = this.spriteH * (this.alive ? 0.78 : 0.5) * (1 + Math.sin(time * 3) * 0.06);
    ctx.save();
    const g = ctx.createRadialGradient(cx, cy, R * 0.15, cx, cy, R);
    g.addColorStop(0, 'rgba(255,236,140,0.55)');
    g.addColorStop(0.55, 'rgba(255,200,60,0.28)');
    g.addColorStop(1, 'rgba(255,170,40,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fill();
    if (this.alive) {
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(255,215,90,' + (0.55 + Math.sin(time * 5) * 0.25) + ')';
      ctx.beginPath();
      ctx.ellipse(this.x, this.y, this.spriteH * 0.36, this.spriteH * 0.09, 0, 0, Math.PI * 2);
      ctx.stroke();
      for (let k = 0; k < 6; k++) {
        const ph = (time * 0.7 + k / 6) % 1;
        const sx = cx + Math.sin(k * 2.4 + time * 1.3) * R * 0.7;
        const sy = this.y - ph * this.spriteH * 1.15;
        const sz = 3.2 * (1 - ph) + 1;
        ctx.globalAlpha = 1 - ph;
        ctx.fillStyle = k % 2 ? '#fff6c2' : '#ffd23f';
        ctx.beginPath();
        ctx.moveTo(sx, sy - sz * 1.8);
        ctx.lineTo(sx + sz * 0.5, sy - sz * 0.5);
        ctx.lineTo(sx + sz * 1.8, sy);
        ctx.lineTo(sx + sz * 0.5, sy + sz * 0.5);
        ctx.lineTo(sx, sy + sz * 1.8);
        ctx.lineTo(sx - sz * 0.5, sy + sz * 0.5);
        ctx.lineTo(sx - sz * 1.8, sy);
        ctx.lineTo(sx - sz * 0.5, sy - sz * 0.5);
        ctx.closePath();
        ctx.fill();
      }
    }
    ctx.restore();
  }

  drawShield(ctx, time) {
    const r = this.spriteH * 0.62 + Math.sin(time * 4) * 2;
    ctx.beginPath();
    ctx.arc(this.x, this.y - this.spriteH * 0.48, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(140,210,255,0.18)';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(200,236,255,0.85)';
    ctx.stroke();
  }

  // 안전 착지 패시브: 빨간 로드스터를 타고 천천히 내려온다
  drawCar(ctx, time) {
    if (this.sprite) {
      const A = this.sprite.meta.anims;
      drawFrame(ctx, this.sprite, A.idle[0], this.x - this.facing * 4, this.y - 14, this.spriteH * 0.7, this.facing);
    }
    ctx.save();
    ctx.translate(this.x, this.y - 6);
    ctx.scale(this.facing, 1);
    ctx.lineJoin = 'round';
    // 바람 줄기 (낙하 표현)
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 2;
    for (let k = -1; k <= 1; k++) {
      const o = ((time * 160 + k * 37) % 30);
      ctx.beginPath();
      ctx.moveTo(k * 16, -36 - o);
      ctx.lineTo(k * 16, -50 - o);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(-34, 0);
    ctx.lineTo(-34, -12);
    ctx.quadraticCurveTo(-26, -18, -12, -18);
    ctx.lineTo(4, -18);
    ctx.lineTo(14, -10);
    ctx.quadraticCurveTo(32, -10, 36, -4);
    ctx.lineTo(36, 0);
    ctx.closePath();
    ctx.fillStyle = '#e8342b';
    ctx.fill();
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = OUTLINE;
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillRect(-26, -14, 26, 3);
    for (const wx of [-22, 22]) {
      ctx.beginPath();
      ctx.arc(wx, 1, 8, 0, Math.PI * 2);
      ctx.fillStyle = '#23252e';
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(wx, 1, 3, 0, Math.PI * 2);
      ctx.fillStyle = '#c9ced8';
      ctx.fill();
    }
    ctx.restore();
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
