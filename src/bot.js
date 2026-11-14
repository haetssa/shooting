// AI 봇: 같은 물리로 각도/파워 조합을 시뮬레이션해 목표에 가장 가까운 샷을 고르고,
// 난이도에 따라 일부러 오차를 준다. 바람은 계획 시점 값만 알기 때문에 돌풍이 자연스러운 오차가 된다.
import { simulateShot } from './physics.js';
import { skillOf, canUse, makeWeapon } from './skills.js';

export const BOT_LABELS = ['사람', '봇 쉬움', '봇 보통', '봇 어려움'];
const LEVELS = {
  1: { ang: 7, pow: 9, skill: 0.15 },
  2: { ang: 3.5, pow: 4.5, skill: 0.35 },
  3: { ang: 1.2, pow: 1.5, skill: 0.55 },
};

const gauss = (rng) => (rng() + rng() + rng() - 1.5) / 1.5; // 대략 -1 ~ 1

// 반환: { slot, facing, angle, power } 또는 { slot, instant: true } (회복 등 즉시 스킬)
export function planShot(game, c, rng) {
  const lv = LEVELS[c.botLevel] || LEVELS[2];
  const enemies = game.chars.filter((o) => o.alive && o !== c && (c.teamId == null || o.teamId !== c.teamId));
  if (!enemies.length) return null;

  // 스킬 선택 (한 턴에 하나: 이미 즉시 스킬을 썼으면 기본 공격)
  let slot = 0;
  const ult = skillOf(c, 3);
  const free = !game.turnSkill;
  if (free && ult && canUse(c, 3) && !['teleport', 'build', 'heal', 'shield'].includes(ult.type) && rng() < 0.85) {
    if (ult.type === 'global') return { slot: 3, instant: true };
    slot = 3;
  } else if (free) {
    for (const sl of [1, 2]) {
      const s = skillOf(c, sl);
      if (!s || !canUse(c, sl)) continue;
      if (s.type === 'heal') {
        if (c.hp < c.maxHp * 0.4) return { slot: sl, instant: true };
        continue;
      }
      if (s.type === 'shield') {
        if (c.hp < c.maxHp * 0.6 && rng() < lv.skill) return { slot: sl, instant: true };
        continue;
      }
      if (s.type === 'teleport' || s.type === 'build' || s.type === 'global') continue;
      if (rng() < lv.skill) { slot = sl; break; }
    }
  }

  const weapon = makeWeapon(c, skillOf(c, slot), slot);
  const env = { gravity: game.gravity, windAccel: game.wind.accel, terrain: game.terrain, chars: game.chars, projR: game.cfg.projectileRadius };
  // 한 발을 쏘면 어디에 떨어지는지 계산해 상대와의 거리로 점수화 (낮을수록 좋음)
  const score = (target, facing, ang, pow) => {
    const o = game.shotOrigin(c, ang, pow, facing);
    const hit = simulateShot(env, o.x, o.y, o.vx, o.vy, weapon, c);
    if (hit.out) return 1e5;
    let d = hit.direct === target ? 0 : Math.hypot(hit.x - target.x, hit.y - target.cy);
    if (hit.direct === c || Math.hypot(hit.x - c.x, hit.y - c.cy) < weapon.radius + c.radius + 8) d += 600; // 자폭 회피
    return d;
  };

  // 상대 전원에 대해 대략 탐색 → 가장 잘 맞힐 수 있는 상대 선택 (체력 낮은 상대 약간 우선)
  const { min, max } = game.cfg.aim;
  let best = { s: Infinity, a: 45, p: 60, target: enemies[0], facing: 1 };
  for (const target of enemies) {
    const facing = target.x < c.x ? -1 : 1;
    const bias = (target.hp / target.maxHp) * 40;
    for (let a = Math.max(min, -10); a <= Math.min(max, 85); a += 5) {
      for (let p = 25; p <= 100; p += 5) {
        const s = score(target, facing, a, p) + bias;
        if (s < best.s) best = { s, a, p, target, facing };
      }
    }
  }
  const { target, facing } = best;
  const { a: a0, p: p0 } = best;
  for (let a = a0 - 4; a <= a0 + 4; a++) {
    for (let p = p0 - 4; p <= p0 + 4; p++) {
      if (p < 5 || p > 100 || a < min || a > max) continue;
      const s = score(target, facing, a, p) + (target.hp / target.maxHp) * 40;
      if (s < best.s) best = { ...best, s, a, p };
    }
  }
  if (game.debugBot) {
    const o = game.shotOrigin(c, best.a, best.p, facing);
    const h = simulateShot(env, o.x, o.y, o.vx, o.vy, weapon, c);
    console.log(`BOT ${c.name} @${c.x | 0},${c.y | 0} → ${target.name} @${target.x | 0},${target.y | 0} f=${facing} a=${best.a} p=${best.p} score=${best.s | 0} hit=${h.out ? 'out' : `${h.x | 0},${h.y | 0} direct=${h.direct?.name}`}`);
  }
  return {
    slot,
    facing,
    angle: Math.max(min, Math.min(max, best.a + gauss(rng) * lv.ang)),
    power: Math.max(5, Math.min(100, best.p + gauss(rng) * lv.pow)),
  };
}
