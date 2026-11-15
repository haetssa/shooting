// 투사체 물리와 폭발 판정 (방장 권한 방식에서 방장만 실행하게 될 부분)

// 한 틱 진행. 충돌하면 { x, y, direct } 또는 { out: true } 반환
// p.pierceLeft > 0 이면 지형을 그만큼 뚫고 지나간다 (env.sim 이면 지형을 깎지 않음)
// p.ghost 면 지형을 무시하고 캐릭터에만 맞는다, homing 무기는 가까운 적 쪽으로 휜다
export function stepProjectile(p, dt, env) {
  const w = p.weapon;
  if (w.behavior === 'uturn' && !p.turned && p.age >= (w.skill.delay ?? 0.7)) {
    p.vx = -p.vx * (w.skill.speedMult ?? 1);
    p.turned = true;
  }
  if (w.behavior === 'homing' && p.age >= (w.skill.delay ?? 0.3)) steerHoming(p, dt, env);
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
      // 쏜 사람 판정(캡슐) 밖으로 완전히 나가야 무장 → 그 전엔 자기 몸에 안 맞는다
      const oy = o.nearestY ? o.nearestY(p.y) : o.cy;
      if (!o.alive || Math.hypot(p.x - o.x, p.y - oy) > o.radius + p.radius + 2) p.armed = true;
    }
    for (const c of env.chars) {
      if (!c.alive || (c === p.owner && !p.armed)) continue;
      if (c.hitTest(p.x, p.y, p.radius)) return { x: p.x, y: p.y, direct: c };
    }
    if (!p.ghost && env.terrain.isSolid(p.x, p.y)) {
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

function steerHoming(p, dt, env) {
  const s = p.weapon.skill;
  let best = null, bd = s.range ?? 380;
  for (const c of env.chars) {
    if (!c.alive || c === p.owner) continue;
    const d = Math.hypot(c.x - p.x, c.cy - p.y);
    if (d < bd) { bd = d; best = c; }
  }
  if (!best) return;
  const cur = Math.atan2(p.vy, p.vx), want = Math.atan2(best.cy - p.y, best.x - p.x);
  let da = want - cur;
  while (da > Math.PI) da -= Math.PI * 2;
  while (da < -Math.PI) da += Math.PI * 2;
  const m = (s.turn ?? 2.5) * dt;
  const a = cur + Math.max(-m, Math.min(m, da)), sp = Math.hypot(p.vx, p.vy);
  p.vx = Math.cos(a) * sp;
  p.vy = Math.sin(a) * sp;
  p.homing = true;
}

// 투사체 공통 초기값 (실제 발사와 봇 시뮬레이션이 같이 사용)
export function projectileProps(weapon, baseRadius = 6) {
  const s = weapon.skill;
  const pierce = weapon.behavior === 'pierce';
  return {
    radius: baseRadius * (weapon.scale ?? 1),
    ghost: pierce && !!s?.ghost,
    pierceLeft: pierce && !s?.ghost ? s.depth || 0 : 0,
  };
}

// 봇용: 실제와 같은 물리로 한 발을 끝까지 계산 (지형은 건드리지 않음)
export function simulateShot(env, x, y, vx, vy, weapon, owner, maxT = 7) {
  const p = { x, y, vx, vy, weapon, owner, armed: false, age: 0, trail: null, ...projectileProps(weapon, env.projR) };
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
// 거리는 캐릭터 판정 캡슐(머리~발)까지 잰다. cfg.splashBonus 만큼 피해 범위를 넓힌다
// 넉백: 수평 방향 위주 + 일정한 작은 튀어오름 (예전엔 발밑에서 터지면 위로 크게 솟구쳐 장외로 날아갔다)
//   cfg.knockback 기본 세기, cfg.knockUp 튀어오름 비율, cfg.knockbackMax 수평 최대 속도
// weapon.knockbackMult 가 음수면 밀어내지 않고 끌어당긴다 (블랙홀)
export function computeExplosion(chars, x, y, weapon, direct, cfg) {
  const out = [];
  const km = weapon.knockbackMult ?? 1;
  const K = cfg.knockback, up = cfg.knockUp ?? 0.45, maxX = cfg.knockbackMax ?? 220;
  for (const c of chars) {
    if (!c.alive) continue;
    const ny = c.nearestY ? c.nearestY(y) : c.cy;
    const dx = c.x - x, dy = ny - y;
    const d = Math.hypot(dx, dy);
    const reach = weapon.radius + c.radius + (cfg.splashBonus ?? 0);
    if (c !== direct && d >= reach) continue;
    const f = c === direct ? 1 : 1 - d / reach;
    const mult = c === direct ? cfg.directHitMult : cfg.splashMin + (1 - cfg.splashMin) * f;
    const kb = K * Math.max(f, 0.3);
    let kx, ky;
    if (km >= 0) {
      const s = Math.min(km, 3);
      const hx = d > 0 ? Math.abs(dx) / d : 0;
      const sx = Math.abs(dx) < 3 ? 0 : Math.sign(dx);
      const cap = maxX * Math.max(1, s);
      kx = Math.max(-cap, Math.min(cap, sx * kb * (0.35 + 0.65 * hx) * s));
      ky = -kb * up * Math.min(s, 1.5);
    } else {
      const len = d || 1;
      kx = (dx / len) * kb * km;
      ky = (dy / len) * kb * km - kb * 0.3;
    }
    out.push({ char: c, damage: Math.round(weapon.damage * mult), kx, ky });
  }
  return out;
}
