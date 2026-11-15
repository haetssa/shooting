// 캐릭터 목록 도우미: 선택 가능한 캐릭터, 랜덤 선택(일정 확률로 히든 캐릭터)
// characters.json 에서 "hidden": true 인 캐릭터는 목록에 안 보이고 랜덤으로만 등장한다.
// 히든 캐릭터별 확률은 "chance", 없으면 config.hiddenChance
// "adminOnly": true 인 캐릭터는 운영자 모드에서만 고를 수 있다 (랜덤으로도 안 나옴)

export const RANDOM = -1;

export function visibleIndices(defs) {
  return defs.map((d, i) => (d.hidden || d.adminOnly ? -1 : i)).filter((i) => i >= 0);
}

export function adminIndices(defs) {
  return defs.map((d, i) => (d.adminOnly ? i : -1)).filter((i) => i >= 0);
}

// admin: 운영자면 운영자 전용 캐릭터도 그대로 허용, 아니면 랜덤으로 바꾼다
export function resolveChar(defs, choice, rng, hiddenChance, admin = false) {
  if (choice !== RANDOM && defs[choice] && (admin || !defs[choice].adminOnly)) return choice;
  for (const [i, d] of defs.entries()) {
    if (d.hidden && !d.adminOnly && rng() < (d.chance ?? hiddenChance)) return i;
  }
  const vis = visibleIndices(defs);
  return vis[Math.floor(rng() * vis.length)];
}
