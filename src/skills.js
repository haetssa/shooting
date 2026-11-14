// 스킬 / 궁극기 / 패시브 (범용 타입 조합, 수치는 characters.json)
//
// 슬롯: 0 = 기본 공격, 1 = 스킬1, 2 = 스킬2, 3 = 궁극기
// 스킬 타입:
//   shot        기본 무기 수치만 바꾼 사격 (gravityMult, windMult 등)
//   multi_shot  여러 발 동시 발사 (count, spread)
//   split       최고점에서 여러 갈래로 분열 (count, spread)
//   scatter     폭발 후 작은 폭탄을 흩뿌림 (count, bombletDamage, bombletRadius)
//   pierce      지형을 depth 만큼 뚫고 들어가 폭발
//   airstrike   맞은 지점 위로 투사체가 쏟아짐 (count, spread)
//   build       맞은 지점에 흙벽 생성 (radius)
//   teleport    맞은 지점으로 순간이동
//   heal        즉시 체력 회복 (amount), 턴 종료
//   big_blast   큰 폭발 (damage, radius ...)
// 공통: cooldown(내 턴 기준 재사용 대기, 궁극기는 gauge), 무기 덮어쓰기 필드(WEAPON_KEYS)
//
// 패시브 타입: damage_reduction(value 비율 감소), wind_resist(바람 배율), ult_charge(궁극기 충전 배율),
//             trajectory_preview(value 초만큼 예상 궤적 표시)

export const WEAPON_KEYS = ['projectile', 'damage', 'radius', 'windMult', 'gravityMult', 'knockbackMult', 'fx', 'scale'];

export function skillOf(c, slot) {
  if (slot === 1) return c.def.skills?.[0] || null;
  if (slot === 2) return c.def.skills?.[1] || null;
  if (slot === 3) return c.def.ultimate || null;
  return null;
}

export function canUse(c, slot) {
  const s = skillOf(c, slot);
  if (!s) return false;
  if (slot === 3) return c.ult >= (s.gauge ?? 100);
  return (c.cooldowns[slot - 1] || 0) <= 0;
}

export function consume(c, slot) {
  const s = skillOf(c, slot);
  if (!s) return;
  if (slot === 3) c.ult = 0;
  else c.cooldowns[slot - 1] = s.cooldown ?? 2;
}

// 내 턴이 시작될 때 재사용 대기 1 감소
export function tickCooldowns(c) {
  c.cooldowns = c.cooldowns.map((v) => Math.max(0, v - 1));
}

// 기본 무기 + 스킬 덮어쓰기 + 패시브 반영
export function makeWeapon(c, s) {
  const w = { ...c.def.weapon };
  if (s) for (const k of WEAPON_KEYS) if (s[k] !== undefined) w[k] = s[k];
  const pv = c.def.passive;
  if (pv?.type === 'wind_resist') w.windMult = (w.windMult ?? 1) * pv.value;
  w.behavior = s ? s.type : null;
  w.skill = s || null;
  return w;
}

export function shotAngles(s, angle) {
  if (s?.type === 'multi_shot') {
    const n = s.count || 3, sp = s.spread || 6;
    return Array.from({ length: n }, (_, i) => angle + (i - (n - 1) / 2) * sp);
  }
  return [angle];
}

export function gainUlt(c, amount) {
  const pv = c.def.passive;
  const m = pv?.type === 'ult_charge' ? pv.value : 1;
  c.ult = Math.min(100, c.ult + amount * m);
}

export function damageTakenMult(def) {
  const pv = def.passive;
  return pv?.type === 'damage_reduction' ? 1 - pv.value : 1;
}

export function previewSeconds(c) {
  const pv = c.def.passive;
  return pv?.type === 'trajectory_preview' ? pv.value : 0;
}
