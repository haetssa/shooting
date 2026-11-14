// 캐릭터 목록 도우미: 선택 가능한 캐릭터, 랜덤 선택(일정 확률로 히든 캐릭터)
// characters.json 에서 "hidden": true 인 캐릭터는 목록에 안 보이고 랜덤으로만 등장한다.
// 히든 캐릭터별 확률은 "chance", 없으면 config.hiddenChance

export const RANDOM = -1;

export function visibleIndices(defs) {
  return defs.map((d, i) => (d.hidden ? -1 : i)).filter((i) => i >= 0);
}

export function resolveChar(defs, choice, rng, hiddenChance) {
  if (choice !== RANDOM && defs[choice]) return choice;
  for (const [i, d] of defs.entries()) {
    if (d.hidden && rng() < (d.chance ?? hiddenChance)) return i;
  }
  const vis = visibleIndices(defs);
  return vis[Math.floor(rng() * vis.length)];
}
