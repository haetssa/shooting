// Firebase Realtime Database 연결: 접속 인원 제한, 로비(방 목록), 방, 채팅, 게임 메시지 중계
// Firebase SDK는 온라인 메뉴에 들어갈 때만 불러온다 (혼자/한 화면 모드는 인터넷 없이도 동작)
//
// DB 구조
//   presence/{uid}            접속 중 표시 (연결 끊기면 자동 삭제) → 동시 접속 인원 계산
//   lobby/{roomId}            방 목록용 요약 { name, hostName, hasPw, map, max, count, status, createdAt }
//   rooms/{roomId}/meta       { name, host, hostName, hasPw, pw(해시), map, max, status, v(게임 버전) }
//   rooms/{roomId}/players/{uid}  { name, char, ready, joinedAt }
//   rooms/{roomId}/chat/{id}  { u, n, t, s(시스템), ts }
//   rooms/{roomId}/bye/{uid}  스스로 나간 경우 표시 (강제종료와 구분)
//   rooms/{roomId}/game/start 게임 시작 정보, game/snap 상태 스냅샷, game/ev/{id} 이벤트 묶음
//   rooms/{roomId}/input/{uid} 참가자 입력 상태

import { VERSION } from '../util.js';

const SDK = 'https://www.gstatic.com/firebasejs/10.12.2';

function makeUid() {
  try {
    let id = sessionStorage.getItem('pg.uid');
    if (!id) { id = 'u' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); sessionStorage.setItem('pg.uid', id); }
    return id;
  } catch {
    return 'u' + Math.random().toString(36).slice(2, 12);
  }
}

// 비밀번호를 그대로 저장하지 않기 위한 간단한 해시 (지인용 수준의 보호)
export function hashPw(roomId, pw) {
  let h = 2166136261;
  const s = `${roomId}:${pw}:pogyeok`;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

export class Online {
  constructor(cfg, fbConfig) {
    this.cfg = cfg;
    this.fbConfig = fbConfig;
    this.uid = makeUid();
    this.db = null;
    this.room = null;     // { id, host }
    this.roomSubs = [];
    this.gameSubs = [];
    this.globalSubs = [];
  }

  r(path) { return path ? this.f.ref(this.db, path) : this.f.ref(this.db); }

  // 접속: 인원이 가득 찼으면 { full: true }
  async connect() {
    if (!this.db) {
      const [app, dbm] = await Promise.all([import(`${SDK}/firebase-app.js`), import(`${SDK}/firebase-database.js`)]);
      this.f = dbm;
      this.app = app.initializeApp(this.fbConfig);
      this.db = dbm.getDatabase(this.app);
    } else {
      this.f.goOnline(this.db);
    }
    const snap = await this.f.get(this.r('presence'));
    const count = snap.exists() ? Object.keys(snap.val()).length : 0;
    if (count >= this.cfg.maxConcurrent) {
      this.f.goOffline(this.db);
      return { full: true, count };
    }
    const me = this.r(`presence/${this.uid}`);
    await this.f.onDisconnect(me).remove();
    await this.f.set(me, this.f.serverTimestamp());
    return { ok: true, count: count + 1 };
  }

  async disconnect() {
    if (!this.db) return;
    await this.leaveRoom().catch(() => {});
    this.globalSubs.forEach((u) => u());
    this.globalSubs = [];
    await this.f.remove(this.r(`presence/${this.uid}`)).catch(() => {});
    this.f.goOffline(this.db);
  }

  watchPresence(cb) {
    this.globalSubs.push(this.f.onValue(this.r('presence'), (s) => cb(s.exists() ? Object.keys(s.val()).length : 0)));
  }

  watchConnected(cb) {
    this.globalSubs.push(this.f.onValue(this.r('.info/connected'), (s) => cb(s.val() === true)));
  }

  watchLobby(cb) {
    const unsub = this.f.onValue(this.r('lobby'), (s) => {
      const v = s.val() || {};
      const now = Date.now();
      const list = Object.entries(v)
        .map(([id, r]) => ({ id, ...r }))
        .filter((r) => !r.createdAt || now - r.createdAt < 6 * 3600 * 1000)
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      cb(list);
    });
    this.globalSubs.push(unsub);
    return unsub;
  }

  // ---------- 방 ----------

  async createRoom({ name, pw, map, max, nickname, char }) {
    const f = this.f;
    const id = f.push(this.r('lobby')).key;
    const hasPw = !!pw;
    const meta = { name, host: this.uid, hostName: nickname, hasPw, pw: hasPw ? hashPw(id, pw) : '', map, max, status: 'lobby', v: VERSION, createdAt: f.serverTimestamp() };
    await f.onDisconnect(this.r(`rooms/${id}`)).remove();
    await f.onDisconnect(this.r(`lobby/${id}`)).remove();
    await f.set(this.r(`rooms/${id}`), {
      meta,
      players: { [this.uid]: { name: nickname, char, ready: true, joinedAt: f.serverTimestamp() } },
    });
    await f.set(this.r(`lobby/${id}`), { name, hostName: nickname, hasPw, map, max, count: 1, status: 'lobby', v: VERSION, createdAt: f.serverTimestamp() });
    this.room = { id, host: true };
    return id;
  }

  // 반환: { ok } 또는 { error: '메시지' }
  async joinRoom(id, pw, nickname, char) {
    const f = this.f;
    const ms = await f.get(this.r(`rooms/${id}/meta`));
    if (!ms.exists()) return { error: '방이 사라졌어요.' };
    const meta = ms.val();
    if ((meta.v || 'dev') !== VERSION) return { error: '방장과 게임 버전이 달라요. 방장도 새로고침해서 최신 버전으로 맞춰 주세요.', update: true };
    if (meta.status !== 'lobby') return { error: '이미 게임이 진행 중인 방이에요.' };
    if (meta.hasPw && meta.pw !== hashPw(id, pw || '')) return { error: '비밀번호가 맞지 않아요.' };
    const ps = await f.get(this.r(`rooms/${id}/players`));
    const count = ps.exists() ? Object.keys(ps.val()).length : 0;
    if (count >= meta.max) return { error: '방이 가득 찼어요.' };
    const me = this.r(`rooms/${id}/players/${this.uid}`);
    await f.onDisconnect(me).remove();
    await f.set(me, { name: nickname, char, ready: false, joinedAt: f.serverTimestamp() });
    await f.remove(this.r(`rooms/${id}/bye/${this.uid}`)).catch(() => {});
    this.room = { id, host: false };
    return { ok: true };
  }

  async leaveRoom() {
    if (!this.room) return;
    const { id, host } = this.room;
    const f = this.f;
    this.unwatchRoom();
    this.unwatchGame();
    this.room = null;
    if (host) {
      await f.remove(this.r(`lobby/${id}`)).catch(() => {});
      await f.remove(this.r(`rooms/${id}`)).catch(() => {});
      f.onDisconnect(this.r(`rooms/${id}`)).cancel().catch(() => {});
      f.onDisconnect(this.r(`lobby/${id}`)).cancel().catch(() => {});
    } else {
      await f.set(this.r(`rooms/${id}/bye/${this.uid}`), true).catch(() => {});
      const me = this.r(`rooms/${id}/players/${this.uid}`);
      await f.remove(me).catch(() => {});
      f.onDisconnect(me).cancel().catch(() => {});
    }
  }

  // cbs: { meta(meta|null), players(obj), chat(msg), bye(obj) }
  watchRoom(cbs) {
    const id = this.room.id, f = this.f;
    this.unwatchRoom();
    this.roomSubs.push(f.onValue(this.r(`rooms/${id}/meta`), (s) => cbs.meta(s.val())));
    this.roomSubs.push(f.onValue(this.r(`rooms/${id}/players`), (s) => cbs.players(s.val() || {})));
    this.roomSubs.push(f.onValue(this.r(`rooms/${id}/bye`), (s) => cbs.bye?.(s.val() || {})));
    this.roomSubs.push(f.onChildAdded(f.query(this.r(`rooms/${id}/chat`), f.limitToLast(30)), (s) => cbs.chat(s.val())));
  }

  unwatchRoom() {
    this.roomSubs.forEach((u) => u());
    this.roomSubs = [];
  }

  setMyPlayer(fields) {
    if (!this.room) return;
    return this.f.update(this.r(`rooms/${this.room.id}/players/${this.uid}`), fields);
  }

  // 방장: 메타 + 로비 요약 동시 갱신
  setMeta(fields) {
    if (!this.room?.host) return;
    const id = this.room.id, up = {};
    for (const [k, v] of Object.entries(fields)) {
      up[`rooms/${id}/meta/${k}`] = v;
      if (['name', 'map', 'max', 'status', 'count'].includes(k)) up[`lobby/${id}/${k}`] = v;
    }
    return this.f.update(this.r(''), up);
  }

  resetReady(uids) {
    if (!this.room?.host) return;
    const up = {};
    for (const u of uids) if (u !== this.uid) up[`rooms/${this.room.id}/players/${u}/ready`] = false;
    return this.f.update(this.r(''), up);
  }

  sendChat(name, text, sys = false) {
    if (!this.room) return;
    return this.f.push(this.r(`rooms/${this.room.id}/chat`), { u: this.uid, n: name, t: text, s: sys, ts: this.f.serverTimestamp() });
  }

  // ---------- 게임 ----------

  startGame(start) {
    const id = this.room.id;
    return this.f.update(this.r(''), {
      [`rooms/${id}/game`]: { start },
      [`rooms/${id}/input`]: null,
      [`rooms/${id}/meta/status`]: 'playing',
      [`lobby/${id}/status`]: 'playing',
    });
  }

  endGame() {
    if (!this.room?.host) return;
    const id = this.room.id;
    return this.f.update(this.r(''), {
      [`rooms/${id}/game`]: null,
      [`rooms/${id}/input`]: null,
      [`rooms/${id}/meta/status`]: 'lobby',
      [`lobby/${id}/status`]: 'lobby',
    });
  }

  watchGameStart(cb) {
    const unsub = this.f.onValue(this.r(`rooms/${this.room.id}/game/start`), (s) => cb(s.val()));
    this.roomSubs.push(unsub);
  }

  // 방장: 스냅샷/이벤트 송신, 참가자 입력 수신
  setSnap(s) { return this.f.set(this.r(`rooms/${this.room.id}/game/snap`), s); }
  pushEvents(evs) { return this.f.push(this.r(`rooms/${this.room.id}/game/ev`), { e: JSON.parse(JSON.stringify(evs)) }); }
  watchInputs(cb) { this.gameSubs.push(this.f.onValue(this.r(`rooms/${this.room.id}/input`), (s) => cb(s.val() || {}))); }

  // 참가자: 스냅샷/이벤트 수신, 입력 송신
  watchSnap(cb) { this.gameSubs.push(this.f.onValue(this.r(`rooms/${this.room.id}/game/snap`), (s) => s.exists() && cb(s.val()))); }
  watchEvents(cb) { this.gameSubs.push(this.f.onChildAdded(this.r(`rooms/${this.room.id}/game/ev`), (s) => cb(s.val().e || []))); }
  sendInput(obj) { return this.f.set(this.r(`rooms/${this.room.id}/input/${this.uid}`), obj); }

  unwatchGame() {
    this.gameSubs.forEach((u) => u());
    this.gameSubs = [];
  }
}
