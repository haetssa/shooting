// 온라인 대전 동기화 (방장 권한 방식, Firebase 중계)
// 방장: 물리/데미지를 전부 계산 → 상태 스냅샷(초당 snapshotHz회, 바뀐 경우만) + 이벤트(폭발, 지형, 소리, 글자) 송신
// 참가자: 스냅샷/이벤트를 받아 화면을 그림. 자기 차례에는 이동/조준/파워를 직접 계산해서
//         결과 상태(위치, 각도, 파워, 발사·스킬 순번)를 초당 inputHz회 송신 (발사/스킬은 즉시)

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
    this.lastAt = 0;
    this.lastSent = '';
    this.lastSentObj = null;
    this.pending = null;
    this.timer = null;
    this.interval = 1000 / (game.cfg.online?.inputHz || 20);
    online.watchSnap((s) => game.applySnapshot(s));
    online.watchEvents((evs) => evs.forEach((e) => game.applyEvent(e)));
  }

  // 바뀐 경우에만, 최소 interval 간격으로 보낸다. 간격 안에 바뀐 값은 간격이 끝날 때 마지막 값으로 보낸다
  send(obj, force = false) {
    const js = JSON.stringify(obj);
    if (js === this.lastSent) return;
    this.pending = { obj, js };
    const wait = this.interval - (performance.now() - this.lastAt);
    if (force || wait <= 0) this.flush();
    else if (!this.timer) this.timer = setTimeout(() => this.flush(), wait);
  }

  flush() {
    clearTimeout(this.timer);
    this.timer = null;
    const p = this.pending;
    if (!p || p.js === this.lastSent) return;
    this.pending = null;
    this.lastAt = performance.now();
    this.lastSent = p.js;
    this.lastSentObj = p.obj;
    this.on.sendInput(p.obj).catch(() => {});
  }

  stop() {
    clearTimeout(this.timer);
    this.timer = null;
    this.on.unwatchGame();
  }
}
