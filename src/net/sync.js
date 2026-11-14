// 온라인 대전 동기화 (방장 권한 방식, Firebase 중계)
// 방장: 물리/데미지를 전부 계산 → 상태 스냅샷(초당 10회, 바뀐 경우만) + 이벤트(폭발, 지형, 소리, 글자) 송신
// 참가자: 스냅샷/이벤트를 받아 화면만 그림, 자기 차례에는 입력 상태만 송신

export class HostSync {
  constructor(online, game) {
    this.on = online;
    this.g = game;
    this.acc = 0;
    this.hb = 0;
    this.last = '';
    this.inputs = {};
    this.interval = 1 / (game.cfg.online?.snapshotHz || 10);
    online.watchInputs((v) => { this.inputs = v; });
  }

  input(uid) { return this.inputs[uid] || null; }

  tick(dt) {
    const g = this.g;
    if (g.outEvents.length) {
      this.on.pushEvents(g.outEvents).catch(() => {});
      g.outEvents = [];
    }
    this.acc += dt;
    this.hb += dt;
    if (this.acc < this.interval) return;
    this.acc = 0;
    const s = g.makeSnapshot();
    const js = JSON.stringify(s);
    if (js === this.last && this.hb < 1) return;
    this.last = js;
    this.hb = 0;
    this.on.setSnap(s).catch(() => {});
  }

  stop() { this.on.unwatchGame(); }
}

export class ClientSync {
  constructor(online, game) {
    this.on = online;
    this.acc = 0;
    this.lastSent = '';
    online.watchSnap((s) => game.applySnapshot(s));
    online.watchEvents((evs) => evs.forEach((e) => game.applyEvent(e)));
  }

  send(obj, dt) {
    this.acc += dt;
    const js = JSON.stringify(obj);
    if (js === this.lastSent || this.acc < 0.08) return;
    this.acc = 0;
    this.lastSent = js;
    this.on.sendInput(obj).catch(() => {});
  }

  stop() { this.on.unwatchGame(); }
}
