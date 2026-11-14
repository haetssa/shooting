// 턴 관리: 현재 플레이어, 단계(aim → flying → settle), 타이머, 파워 차지
// aim: 이동/조준/차지 가능, flying: 투사체 비행, settle: 낙하/연출이 멈출 때까지 대기

export class TurnManager {
  constructor(chars, cfg, rng) {
    this.chars = chars;
    this.cfg = cfg;
    this.index = Math.floor(rng() * chars.length);
    this.turnNo = 0;
    this.reset();
  }

  get current() { return this.chars[this.index]; }

  reset() {
    this.phase = 'aim';
    this.timer = this.cfg.turnTime;
    this.power = 0;
    this.charging = false;
    this.settleTimer = 0;
    this.settleTotal = 0;
    this.turnNo++;
    const c = this.current;
    c.fuel = c.maxFuel;
  }

  next() {
    const n = this.chars.length;
    for (let k = 1; k <= n; k++) {
      const i = (this.index + k) % n;
      if (this.chars[i].alive) { this.index = i; break; }
    }
    this.reset();
  }
}
