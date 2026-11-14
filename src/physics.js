// 투사체 물리와 폭발 판정 (방장 권한 방식에서 방장만 실행하게 될 부분)

// 한 틱 진행. 충돌하면 { x, y, direct } 또는 { out: true } 반환
// p.pierceLeft > 0 이면 지형을 그만큼 뚫고 지나간다 (env.sim 이면 지형을 깎지 않음)
export function stepProjectile(p, dt, env) {
  const w = p.weapon;
  p.vx += env.windAccel * (w.windMult ?? 1) * dt;
  p.vy += env.gravity * (w.gravityMult ?? 1) * dt;
  p.age += dt;
  const dist = Math.hypot(p.vx, p.vy) * dt;
  const steps = Math.max(1, Math.ceil(dist / 2)); // 2px 단위로 쪼개서 터널링 방지
  const sx = (p.vx * dt) / steps, sy = (p.vy * dt) / steps;
  for (let i = 0; i < steps; i++) {
    p.x += sx;
    p.y += sy;
    if (!p.armed) {
      const o = p.owner;
      if (!o.alive || Math.hypot(p.x - o.x, p.y - o.cy) > o.radius + p.radius + 2) p.armed = true;
    }
    for (const c of env.chars) {
      if (!c.alive || (c === p.owner && !p.armed)) continue;
      if (c.hitTest(p.x, p.y, p.radius)) return { x: p.x, y: p.y, direct: c };
    }
    if (env.terrain.isSolid(p.x, p.y)) {
      if (p.pierceLeft > 0) {
        const sl = Math.hypot(sx, sy);
        p.pierceLeft -= sl;
        p.drillAcc = (p.drillAcc || 0) + sl;
        if (!env.sim && p.drillAcc >= 9) {
          p.drillAcc = 0;
          if (env.carve) env.carve(p.x, p.y, 8); else env.terrain.carve(p.x, p.y, 8);
        }
        if (p.pierceLeft > 0) continue;
      }
      return { x: p.x, y: p.y, direct: null };
    }
    if (p.y > env.terrain.h + 80 || p.x < -600 || p.x > env.terrain.w + 600) return { out: true };
  }
  if (p.trail) {
    p.trail.push(p.x, p.y);
    if (p.trail.length > 90) p.trail.splice(0, 2);
  }
  return null;
}

// 봇용: 실제와 같은 물리로 한 발을 끝까지 계산 (지형은 건드리지 않음)
export function simulateShot(env, x, y, vx, vy, weapon, owner, maxT = 7) {
  const p = {
    x, y, vx, vy, weapon, owner, radius: 6 * (weapon.scale ?? 1), armed: false, age: 0, trail: null,
    pierceLeft: weapon.behavior === 'pierce' ? weapon.skill.depth : 0,
  };
  const e = { ...env, sim: true };
  const dt = 1 / 60;
  for (let t = 0; t < maxT; t += dt) {
    const hit = stepProjectile(p, dt, e);
    if (hit) return hit;
  }
  return { out: true };
}

// 예상 궤적 앞부분 (아인슈타잉 패시브)
export function previewPath(x, y, vx, vy, weapon, env, seconds) {
  const pts = [];
  const dt = 1 / 60;
  for (let t = 0, i = 0; t < seconds; t += dt, i++) {
    vx += env.windAccel * (weapon.windMult ?? 1) * dt;
    vy += env.gravity * (weapon.gravityMult ?? 1) * dt;
    x += vx * dt;
    y += vy * dt;
    if (env.terrain.isSolid(x, y)) break;
    if (i % 3 === 0) pts.push(x, y);
  }
  return pts;
}

// 폭발 피해 계산: 중심에서 멀수록 감소, 직격은 보너스
// weapon.knockbackMult 가 음수면 밀어내지 않고 끌어당긴다 (블랙홀)
export function computeExplosion(chars, x, y, weapon, direct, cfg) {
  const out = [];
  const km = weapon.knockbackMult ?? 1;
  for (const c of chars) {
    if (!c.alive) continue;
    const dx = c.x - x, dy = c.cy - y;
    const d = Math.hypot(dx, dy);
    const reach = weapon.radius + c.radius;
    if (c !== direct && d >= reach) continue;
    const f = c === direct ? 1 : 1 - d / reach;
    const mult = c === direct ? cfg.directHitMult : cfg.splashMin + (1 - cfg.splashMin) * f;
    const len = d || 1;
    const kb = cfg.knockback * Math.max(f, 0.3);
    out.push({
      char: c,
      damage: Math.round(weapon.damage * mult),
      kx: (dx / len) * kb * km,
      ky: (dy / len) * kb * km - kb * 0.5,
    });
  }
  return out;
}
