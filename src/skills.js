// 스킬 / 궁극기 / 패시브 (범용 타입 조합, 수치는 characters.json)
//
// 슬롯: 0 = 기본 공격, 1 = 스킬1, 2 = 스킬2, 3 = 궁극기
// 자원: 마나 (config.mana: 최대, 시작값, 초당 회복, 적중 보너스). 스킬/궁극기는 `mana` 만큼 소모 (기본 35)
// 궁극기: 기본 공격으로 상대를 config.ult.unlockHits 번 맞히면 해금, 이후 마나로 사용
// `cooldown`(선택): 마나와 별개로 내 턴 기준 재사용 대기 (2 = 다음 턴 쉬고 그다음 사용)
//
// 스킬 타입:
//   shot        기본 무기 수치만 바꾼 사격 (gravityMult, windMult, knockbackMult 등)
//   multi_shot  여러 발 동시 발사 (count, spread)
//   split       최고점에서 여러 갈래로 분열 (count, spread)
//   scatter     폭발 후 작은 폭탄을 흩뿌림 (count, bombletDamage, bombletRadius)
//   pierce      depth 만큼 지형을 파고 들어가 폭발. ghost: true 면 지형을 통과하고 캐릭터에 닿을 때만 폭발
//   uturn       delay 초 뒤 수평 방향을 반대로 꺾는다 (speedMult: 꺾은 뒤 수평 속도 배율)
//   homing      delay 초 뒤부터 range 안의 가장 가까운 적 쪽으로 turn(rad/s) 만큼 휜다
//   bounce      지형에 닿으면 폭발 후 한 번 튀어 올라 다시 폭발
//   airstrike   맞은 지점 위로 투사체가 쏟아짐 (count, spread)
//   build       맞은 지점에 지형 생성 (shape: "wall" 이면 w x h 벽돌 벽, 아니면 radius 원)
//   teleport    즉시 발동: 화면을 터치한 곳으로 순간이동 (range), 턴은 계속
//   heal        즉시 발동: 체력 회복 (amount), 턴 종료
//   shield      즉시 발동: 다음 내 턴까지 받는 피해 value 비율 감소, 턴은 계속
//   global      즉시 발동: 살아 있는 모든 적에게 damage, 턴 종료
//   big_blast   큰 폭발 (damage, radius ...)
//
// 패시브 타입: damage_reduction(value 비율 감소, 음수면 증가), wind_resist(바람 배율), mana_regen(마나 회복 배율),
//             trajectory_preview(value 초만큼 예상 궤적 표시), safe_landing(낙하 피해 없음, value = 최대 낙하 속도),
//             skill_discount(마나 소모 value 비율 감소), regen(내 턴 시작 시 체력 value 회복),
//             knockback_resist(밀려나는 거리 value 비율 감소), admin(설명용, 실제 능력은 god 필드)
//
// 운영자 전용 캐릭터(adminOnly): god 필드 { freeSkills(마나·해금·재사용 대기·한 턴 하나 제한 없음), jumps(연속 점프 수), noFallDamage }

export const WEAPON_KEYS = ['projectile', 'damage', 'radius', 'windMult', 'gravityMult', 'knockbackMult', 'fx', 'scale'];
export const INSTANT = ['heal', 'shield', 'global', 'teleport'];

export function skillOf(c, slot) {
  if (slot === 1) return c.def.skills?.[0] || null;
  if (slot === 2) return c.def.skills?.[1] || null;
  if (slot === 3) return c.def.ultimate || null;
  return null;
}

// 운영자 캐릭터: 마나/궁극기 해금/재사용 대기/한 턴 하나 제한 없음
export function isFree(c) {
  return !!c?.def?.god?.freeSkills;
}

export function manaCost(c, slot) {
  const s = skillOf(c, slot);
  if (!s || isFree(c)) return 0;
  const pv = c.def.passive;
  const disc = pv?.type === 'skill_discount' ? pv.value : 0;
  return Math.round((s.mana ?? 35) * (1 - disc));
}

export function ultLocked(c) {
  if (isFree(c)) return false;
  return c.hits < (c.ultNeed ?? 2);
}

// 사용 불가 이유 (사용 가능하면 null)
export function blockReason(c, slot) {
  const s = skillOf(c, slot);
  if (!s) return '없음';
  if (isFree(c)) return null;
  if (slot === 3 && ultLocked(c)) return `기본 공격으로 ${c.ultNeed}번 맞히면 해금 (${c.hits}/${c.ultNeed})`;
  if (slot < 3 && (c.cooldowns[slot - 1] || 0) > 0) return `${c.cooldowns[slot - 1]}턴 뒤 사용 가능`;
  if (c.mana < manaCost(c, slot)) return `마나 부족 (${Math.floor(c.mana)}/${manaCost(c, slot)})`;
  return null;
}

export function canUse(c, slot) {
  return blockReason(c, slot) === null;
}

export function consume(c, slot, cfg) {
  const s = skillOf(c, slot);
  if (!s || isFree(c)) return;
  c.mana = Math.max(0, c.mana - manaCost(c, slot));
  if (slot === 3) {
    if (cfg?.ult?.resetOnUse) c.hits = 0;
  } else if (s.cooldown) c.cooldowns[slot - 1] = s.cooldown;
}

// 내 턴이 시작될 때 재사용 대기 1 감소
export function tickCooldowns(c) {
  c.cooldowns = c.cooldowns.map((v) => Math.max(0, v - 1));
}

export function manaRegenMult(c) {
  const pv = c.def.passive;
  return pv?.type === 'mana_regen' ? pv.value : 1;
}

export function gainMana(c, amount, max = 100) {
  if (!c.alive) return;
  c.mana = Math.min(max, c.mana + amount);
}

// 기본 무기 + 스킬 덮어쓰기 + 패시브 반영
export function makeWeapon(c, s, slot = 0) {
  const w = { ...c.def.weapon };
  if (s) for (const k of WEAPON_KEYS) if (s[k] !== undefined) w[k] = s[k];
  const pv = c.def.passive;
  if (pv?.type === 'wind_resist') w.windMult = (w.windMult ?? 1) * pv.value;
  w.behavior = s ? s.type : null;
  w.skill = s || null;
  w.slot = slot;
  return w;
}

export function shotAngles(s, angle) {
  if (s?.type === 'multi_shot') {
    const n = s.count || 3, sp = s.spread || 6;
    return Array.from({ length: n }, (_, i) => angle + (i - (n - 1) / 2) * sp);
  }
  return [angle];
}

export function damageTakenMult(def) {
  const pv = def.passive;
  return pv?.type === 'damage_reduction' ? 1 - pv.value : 1;
}

export function knockbackTakenMult(def) {
  const pv = def.passive;
  return pv?.type === 'knockback_resist' ? 1 - pv.value : 1;
}

export function previewSeconds(c) {
  const pv = c.def.passive;
  return pv?.type === 'trajectory_preview' ? pv.value : 0;
}
