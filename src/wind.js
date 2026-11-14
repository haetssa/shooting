// 실시간 바람: 턴마다 기본 풍향/풍속(target)이 바뀌고, 그 위에 돌풍이 계속 출렁인다.
// 투사체는 매 틱 현재 값을 읽으므로 비행 중에도 바람 변화가 반영된다.
// 시드 난수 + 경과 시간만으로 결정되므로 방장이 계산해 전파하기 쉽다.

export class Wind {
  constructor(cfg, rng) {
    this.cfg = cfg;
    this.rng = rng;
    this.t = 0;
    this.base = 0;
    this.target = 0;
    this.value = 0;
    this.p1 = rng() * 10;
    this.p2 = rng() * 10;
    this.p3 = rng() * 10;
  }

  newTurn() {
    let t = (this.rng() * 2 - 1) * this.cfg.max;
    if (this.rng() < this.cfg.calmChance) t *= 0.2;
    this.target = t;
  }

  update(dt) {
    this.t += dt;
    const k = 1 - Math.exp(-dt / this.cfg.shiftTime);
    this.base += (this.target - this.base) * k;
    const s = this.cfg.gustSpeed, t = this.t;
    const gust =
      Math.sin(t * s + this.p1) * 0.55 +
      Math.sin(t * s * 2.7 + this.p2) * 0.3 +
      Math.sin(t * s * 0.43 + this.p3) * 0.15;
    const m = this.cfg.max;
    this.value = Math.max(-m, Math.min(m, this.base + gust * this.cfg.gustAmp));
  }

  get accel() { return this.value * this.cfg.accelPerUnit; }
}
