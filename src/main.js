// 게임 코어: 루프, 턴 진행, 스킬/봇/사운드, 온라인 동기화
// 모드: local(혼자/한 화면) | host(온라인 방장, 모든 판정) | client(온라인 참가자, 화면 표시 + 입력 송신)
// 온라인 참가자는 자기 차례에 이동/점프/조준/파워 차지를 자기 기기에서 직접 계산하고(끊김 없는 조작),
// 결과 상태(위치, 파워, 발사)를 방장에게 보낸다. 투사체/데미지/지형 판정은 항상 방장이 한다.
// 화면(DOM) 관리는 screens.js
import { loadJSON, mulberry32, shuffle, clamp } from './util.js';
import { Terrain } from './terrain.js';
import { Character } from './character.js';
import { TurnManager } from './turn.js';
import { Input } from './input.js';
import { Camera } from './camera.js';
import { Wind } from './wind.js';
import { Effects } from './effects.js';
import { stepProjectile, computeExplosion, previewPath, projectileProps } from './physics.js';
import { buildBackground, drawBackground, drawSky } from './background.js';
import { HUD, drawAim, drawPreview, drawGhost, drawRange } from './ui.js';
import { drawProjectile } from './projectiles.js';
import { loadSprite, makePortrait } from './sprites.js';
import {
  skillOf, canUse, blockReason, consume, tickCooldowns, makeWeapon, shotAngles, previewSeconds,
  gainMana, manaRegenMult, manaCost, ultLocked, isFree, INSTANT,
} from './skills.js';
import { planShot } from './bot.js';
import { GameAudio } from './audio.js';
import { HostSync, ClientSync } from './net/sync.js';
import { Screens } from './screens.js';
import { Tutorial } from './tutorial.js';
import { visibleIndices } from './roster.js';

const STEP = 1 / 60;
export const PLAYER_COLORS = ['#ff5a5f', '#3fa7ff', '#ffd23f', '#5ee27a', '#c77dff', '#ff9f43'];
const $ = (id) => document.getElementById(id);
const newSeed = () => (Math.random() * 2 ** 32) >>> 0;
const r1 = (v) => Math.round(v * 10) / 10;

class Game {
  constructor() {
    this.canvas = $('game');
    this.ctx = this.canvas.getContext('2d');
    this.camera = new Camera();
    this.state = 'loading';
    this.mode = 'local';
    this.myUid = null;
    this.time = 0;
    this.chars = [];
    this.projectiles = [];
    this.pendingShot = null;
    this.armed = 0;
    this.targeting = 0;
    this.turnSkill = false;
    this.botState = null;
    this.lastTick = 0;
    this.outEvents = [];
    this.sync = null;
    this.pid = 0;
    this.bubbles = {};
    this.chatLog = [];
    this.ghosts = {};
    this.cl = null;
    this.tutorial = null;
    this.effects = new Effects();
    this.colors = PLAYER_COLORS;
  }

  async load() {
    const [cfg, chars, maps, fb] = await Promise.all([
      loadJSON('data/config.json'),
      loadJSON('data/characters.json'),
      loadJSON('data/maps.json'),
      loadJSON('data/firebase.json').catch(() => null),
    ]);
    this.cfg = cfg;
    this.balanceVersion = chars.balanceVersion;
    this.charDefs = chars.characters;
    this.maps = maps.maps;
    this.sprites = await Promise.all(this.charDefs.map((d) =>
      d.sprite ? loadSprite(d.sprite).catch((e) => { console.warn(e); return null; }) : null));
    this.portraitUrls = this.sprites.map((s) => makePortrait(s, 96).toDataURL());

    this.audio = new GameAudio(cfg.audio || {});
    const unlock = () => this.audio.unlock();
    document.addEventListener('pointerdown', unlock, true);
    document.addEventListener('keydown', unlock, true);
    document.addEventListener('click', (e) => { if (e.target.closest('.chip, .big, .card, .roomrow')) this.audio.play('click'); }, true);
    this.audio.playMusic('menu');

    this.input = new Input(this.canvas, {
      canAim: () => this.state === 'playing' && this.turn.phase === 'aim' && this.isMine(this.turn.current),
      onPan: (dx, dy) => this.camera.pan(dx, dy),
      onZoom: (f, x, y) => this.camera.zoomAt(f, x, y),
      onTap: (x, y) => this.onCanvasTap(x, y),
    });
    this.input.bindHold($('btn-left'), 'left');
    this.input.bindHold($('btn-right'), 'right');
    this.input.bindHold($('btn-fire'), 'fire');
    this.input.bindTap($('btn-jump'), () => { this.input.jumpQueued = true; });
    this.bindSkillButton($('btn-skill1'), 1);
    this.bindSkillButton($('btn-skill2'), 2);
    this.bindSkillButton($('btn-ult'), 3);
    this.hud = new HUD();

    this.setMap(this.maps[0], mulberry32(newSeed()));
    window.addEventListener('resize', () => this.resize());
    this.resize();
    this.camera.zoom = this.camera.minZoom;
    this.camera.focus(this.map.width / 2, this.map.height / 2, true);
    this.screens = new Screens(this, fb);
    this.state = 'menu';

    // 개발용 URL 옵션 (CLAUDE.md 9장 참고)
    const q = new URLSearchParams(location.search);
    this.devSlot = +q.get('slot') || 0;
    this.debugBot = q.has('botlog');
    if (q.get('screen')) this.screens.devScreen(q.get('screen'));
    this.devOnlineBots = q.has('onlinebots');
    if (q.get('autoonline')) this.screens.devAuto(q.get('autoonline'), q.get('nick'));
    if (q.has('tutorial')) this.startTutorial(0);
    if (q.get('autostart')) {
      const n = +q.get('autostart') || 2, demo = q.has('demo');
      const pick = (q.get('chars') || '').split(',').filter(Boolean).map(Number); // &chars=4,5,6,7
      this.startMatch(Array.from({ length: n }, (_, i) => ({ name: demo ? `봇 ${i + 1}` : `플레이어 ${i + 1}`, char: pick.length ? pick[i % pick.length] : i % this.charDefs.length, bot: demo ? 2 : 0, admin: i === 0 && q.has('admin') })), { mapId: q.get('map') || undefined });
    }
    const ff = +q.get('ff') || 0;
    for (let i = 0; i < ff * 60; i++) this.update(STEP);
    window.game = this; // 콘솔 디버깅용
  }

  // 이 기기에서 조작하는 캐릭터인지
  isMine(c) {
    if (!c) return false;
    if (this.mode === 'client') return c.uid === this.myUid;
    if (c.isBot) return false;
    if (this.mode === 'host') return !c.uid || c.uid === this.myUid;
    return true;
  }

  setMap(map, rng) {
    this.map = map;
    this.rules = map.rules || {};
    this.gravity = this.cfg.gravity * (this.rules.gravityMult ?? 1);
    this.physCfg = { ...this.cfg, gravity: this.gravity };
    this.terrain = new Terrain(map);
    this.bg = buildBackground(map);
    const wm = this.rules.windMult ?? 1;
    this.wind = new Wind({ ...this.cfg.wind, max: this.cfg.wind.max * wm, gustAmp: this.cfg.wind.gustAmp * wm }, rng);
    this.wind.newTurn();
    this.wind.base = this.wind.target;
    this.camera.resize(this.cw || 1, this.ch || 1, map.width, map.height);
  }

  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.cw = window.innerWidth;
    this.ch = window.innerHeight;
    this.canvas.width = Math.round(this.cw * this.dpr);
    this.canvas.height = Math.round(this.ch * this.dpr);
    this.camera.resize(this.cw, this.ch, this.map.width, this.map.height);
  }

  bindSkillButton(el, slot) {
    let timer = null, long = false;
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      long = false;
      el.classList.add('down');
      timer = setTimeout(() => { long = true; this.screens.showSkillTip(el, slot); }, 450);
    });
    const end = (act) => {
      clearTimeout(timer);
      if (!el.classList.contains('down')) return;
      el.classList.remove('down');
      this.screens.hideSkillTip();
      if (act && !long) this.trySkill(slot);
    };
    el.addEventListener('pointerup', () => end(true));
    el.addEventListener('pointercancel', () => end(false));
    el.addEventListener('pointerleave', () => end(false));
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // 캔버스를 톡 눌렀을 때: 순간이동 위치 지정 > 미니맵 이동. 처리했으면 true
  onCanvasTap(sx, sy) {
    if (this.state !== 'playing') return false;
    if (this.targeting) {
      const w = this.camera.screenToWorld(sx, sy);
      this.useTarget(w.x, w.y);
      return true;
    }
    const w = this.hud.minimapHit(sx, sy);
    if (w) {
      this.camera.lookAt(w.x, w.y);
      return true;
    }
    return false;
  }

  // ---------- 이벤트: 방장은 참가자에게도 전달 ----------

  emit(ev) { if (this.mode === 'host') this.outEvents.push(ev); }
  fxBoom(x, y, r, fx) { this.effects.explosion(x, y, r, fx); this.emit({ k: 'boom', x: r1(x), y: r1(y), r, fx: fx || '' }); }
  fxText(x, y, s, c, z) { this.effects.text(x, y, s, c, z); this.emit({ k: 'text', x: r1(x), y: r1(y), s, c, z }); }
  sfx(n, a) { this.audio.play(n, a); this.emit({ k: 'snd', n, a: a ?? 0 }); }
  banner(s, c) { this.hud.showBanner(s, c); this.emit({ k: 'ban', s, c }); }
  carve(x, y, r) { this.terrain.carve(x, y, r); this.emit({ k: 'carve', x: r1(x), y: r1(y), r }); }
  addTerrain(x, y, r) { this.terrain.add(x, y, r); this.emit({ k: 'add', x: r1(x), y: r1(y), r }); }
  addWall(x, y, w, h) { this.terrain.addWall(x, y, w, h); this.emit({ k: 'wall', x: r1(x), y: r1(y), w, h }); }

  applyEvent(ev) {
    if (this.mode !== 'client' || !this.turn) return;
    switch (ev.k) {
      case 'boom': this.effects.explosion(ev.x, ev.y, ev.r, ev.fx || undefined); break;
      case 'text': this.effects.text(ev.x, ev.y, ev.s, ev.c, ev.z); break;
      case 'snd': this.audio.play(ev.n, ev.a); break;
      case 'ban': this.hud.showBanner(ev.s, ev.c); break;
      case 'carve': this.terrain.carve(ev.x, ev.y, ev.r); break;
      case 'add': this.terrain.add(ev.x, ev.y, ev.r); break;
      case 'wall': this.terrain.addWall(ev.x, ev.y, ev.w, ev.h); break;
      case 'over': this.gameOver(ev.w >= 0 ? this.chars[ev.w] : null); break;
    }
  }

  // ---------- 경기 시작/종료 ----------

  // players: [{ name, char(인덱스), bot, uid, admin(운영자: 오오라 표시) }], opts: { mapId, seed, mode, tutorial }
  startMatch(players, opts = {}) {
    this.mode = opts.mode || 'local';
    this.rng = mulberry32(opts.seed ?? newSeed());
    let map = this.maps.find((m) => m.id === opts.mapId);
    if (!map) map = opts.mapId === 'random' ? this.maps[Math.floor(this.rng() * this.maps.length)] : this.maps[0];
    this.setMap(map, this.rng);
    const spawns = shuffle(map.spawns.slice(), this.rng);
    const n = Math.min(players.length, spawns.length, this.cfg.maxPlayers);
    this.chars = [];
    for (let i = 0; i < n; i++) {
      const p = players[i], ci = p.char;
      const c = new Character(this.charDefs[ci], { id: i, uid: p.uid, name: p.name, color: PLAYER_COLORS[i % PLAYER_COLORS.length], bot: p.bot, admin: p.admin }, this.sprites[ci]);
      c.setHitbox(this.cfg.hitbox);
      c.angle = this.cfg.aim.default;
      c.mana = this.cfg.mana.start;
      c.ultNeed = this.cfg.ult.unlockHits;
      if (p.hpMult) { c.maxHp = Math.round(c.maxHp * p.hpMult); c.hp = c.maxHp; }
      c.placeOn(this.terrain, spawns[i].x, spawns[i].y);
      c.facing = spawns[i].x < map.width / 2 ? 1 : -1;
      this.chars.push(c);
    }
    this.projectiles = [];
    this.pendingShot = null;
    this.outEvents = [];
    this.bubbles = {};
    this.chatLog = [];
    this.ghosts = {};
    this.remoteSeq = {};
    this.cl = null;
    this.pid = 0;
    this.armed = 0;
    this.targeting = 0;
    this.effects = new Effects();
    this.turn = new TurnManager(this.chars, this.cfg, this.rng);
    if (opts.tutorial) { this.turn.index = 0; this.turn.reset(); }
    this.camera.zoom = clamp(this.camera.defaultZoom, this.camera.minZoom, this.camera.maxZoom);
    this.tutorial = opts.tutorial ? new Tutorial(this) : null;
    this.screens.enterGame();
    this.state = 'playing';
    this.audio.playMusic(map.music || 'battle');
    if (!opts.tutorial && map.intro) this.hud.showIntro(map.name, map.intro);
    if (this.mode === 'client') {
      this.lastTi = -1;
      this.lastTn = -1;
      this.netCharging = false;
      this.camera.focus(this.turn.current.x, this.turn.current.cy, true);
    } else {
      this.onTurnStart();
    }
    this.tutorial?.start();
  }

  startTutorial(char = 0) {
    const nick = this.screens.nick;
    const vis = visibleIndices(this.charDefs);
    const botChar = vis[(Math.max(0, vis.indexOf(char)) + 3) % vis.length];
    this.startMatch([
      { name: nick, char, bot: 0, hpMult: 1.5, admin: this.screens.isAdmin },
      { name: '연습 봇', char: botChar, bot: 1 },
    ], { mapId: 'city_01', tutorial: true });
  }

  startOnline(start, mode, online) {
    this.myUid = online.uid;
    const players = start.players.map((p) => ({ name: p.name, char: p.char, bot: 0, uid: p.uid, admin: !!p.admin }));
    this.startMatch(players, { mapId: start.map, seed: start.seed, mode });
    this.sync = mode === 'host' ? new HostSync(online, this) : new ClientSync(online, this);
    if (this.devOnlineBots && mode === 'host') for (const c of this.chars) { c.botLevel = 2; c.isBot = true; } // 개발용
  }

  stopMatch() {
    this.sync?.stop();
    this.sync = null;
    this.tutorial?.end();
    this.tutorial = null;
    this.mode = 'local';
    this.state = 'menu';
    this.audio.chargeStop();
    this.audio.playMusic('menu');
    this.projectiles = [];
    this.chars = [];
    this.pendingShot = null;
    this.targeting = 0;
    this.screens.leaveGame();
  }

  onTurnStart() {
    const c = this.turn.current;
    tickCooldowns(c);
    c.shield = 0;
    for (const ch of this.chars) ch.netControlled = false;
    this.armed = 0;
    this.targeting = 0;
    this.turnSkill = false;
    this.botState = null;
    this.lastTick = 0;
    if (this.mode === 'host' && c.uid && c.uid !== this.myUid) {
      const n = this.sync?.input(c.uid) || {};
      this.remoteSeq[c.uid] = { j: n.j || 0, s: n.s || 0, fs: n.fs || 0, fe: n.fe || 0 };
    }
    const pv = c.def.passive;
    if (pv?.type === 'regen' && c.alive && c.hp < c.maxHp) {
      const h = c.heal(pv.value);
      if (h > 0) this.fxText(c.x, c.topY - 10, `+${h}`, '#5ee27a', 20);
    }
    this.camera.focus(c.x, c.cy);
    this.banner(`${c.name} (${c.charName}) 차례`, c.color);
    this.sfx('turn');
  }

  endTurn() {
    const alive = this.chars.filter((c) => c.alive);
    if (alive.length <= 1) return this.gameOver(alive[0]);
    this.turn.next();
    this.wind.newTurn();
    this.onTurnStart();
  }

  gameOver(winner) {
    if (this.state !== 'playing') return;
    this.state = 'over';
    this.audio.chargeStop();
    this.emit({ k: 'over', w: winner ? winner.id : -1 });
    this.audio.play('win');
    if (this.mode === 'host') this.screens.recordStats(this, winner);
    this.screens.showOver(winner);
  }

  // 플레이어가 나가거나 연결이 끊기면 즉시 탈락
  eliminate(c, msg) {
    if (!c || c.fellOut) return;
    const wasAlive = c.alive;
    c.alive = false;
    c.hp = 0;
    c.fellOut = true;
    c.netControlled = false;
    this.fxBoom(c.x, c.cy, 26, 'void');
    if (wasAlive) this.banner(msg, '#ffb84d');
    const t = this.turn;
    if (this.state === 'playing' && t.current === c && (t.phase === 'aim' || t.phase === 'throwing')) {
      t.charging = false;
      c.charge = null;
      this.pendingShot = null;
      this.audio.chargeStop();
      t.phase = 'settle';
      t.settleTimer = 0;
      t.settleTotal = 0;
    }
  }

  // ---------- 채팅 표시 ----------

  // 게임 중 채팅: 머리 위 말풍선(화면 밖이면 화면 가장자리에 방향 표시) + 왼쪽 채팅 목록
  say(uid, name, text, sys = false) {
    const c = uid ? this.chars.find((ch) => ch.uid === uid) : null;
    if (!sys && uid) this.bubbles[uid] = { text, t: 5 };
    this.chatLog.push({ name, text, sys, t: 10, color: c?.color || null, admin: !!c?.admin });
    if (this.chatLog.length > 5) this.chatLog.shift();
  }

  updateChat(dt) {
    for (const k of Object.keys(this.bubbles)) {
      this.bubbles[k].t -= dt;
      if (this.bubbles[k].t <= 0) delete this.bubbles[k];
    }
    for (const m of this.chatLog) m.t -= dt;
    this.chatLog = this.chatLog.filter((m) => m.t > 0);
  }

  // ---------- 스킬 ----------

  // 이 기기 플레이어가 스킬 버튼(또는 1/2/3)을 눌렀을 때
  trySkill(slot) {
    if (this.state !== 'playing') return;
    const t = this.turn, c = t.current;
    if (t.phase !== 'aim' || t.charging || !this.isMine(c)) return;
    if (this.mode === 'client') {
      const cl = this.cl;
      if (!cl || cl.done || cl.charging) return;
      const s = skillOf(c, slot);
      if (!s) return;
      if (this.targeting === slot) { this.targeting = 0; this.audio.play('click'); return; }
      if (cl.armed === slot) { cl.armed = 0; this.armed = 0; this.audio.play('click'); return; }
      if (!isFree(c) && (this.turnSkill || cl.usedInstant)) { this.hud.showBanner('스킬은 한 턴에 하나만 쓸 수 있어요', '#ffb84d'); return; }
      const why = blockReason(c, slot);
      if (why) { this.hud.showBanner(why, '#ffb84d'); return; }
      if (s.type === 'teleport') { this.targeting = slot; this.hud.showBanner('순간이동할 곳을 터치하세요', '#d9a6ff'); this.audio.play('arm'); return; }
      if (INSTANT.includes(s.type)) { cl.s++; cl.sl = slot; cl.usedInstant = true; this.sendClient(true); this.audio.play('arm'); return; }
      cl.armed = slot;
      this.armed = slot;
      this.audio.play(slot === 3 ? 'ult' : 'arm');
      return;
    }
    if (this.targeting === slot) { this.targeting = 0; this.audio.play('click'); return; }
    if (this.armed !== slot) {
      if (this.turnSkill && !isFree(c)) { this.hud.showBanner('스킬은 한 턴에 하나만 쓸 수 있어요', '#ffb84d'); return; }
      const why = blockReason(c, slot);
      if (why) { this.hud.showBanner(why, '#ffb84d'); return; }
    }
    this.activateSkill(c, slot);
  }

  // 방장/로컬에서 스킬 실제 발동. target = 순간이동 위치 { x, y }
  activateSkill(c, slot, target) {
    if (this.armed === slot) { this.armed = 0; this.sfx('click'); return; }
    if ((this.turnSkill && !isFree(c)) || !canUse(c, slot)) return;
    const s = skillOf(c, slot);
    switch (s.type) {
      case 'heal': {
        const h = c.heal(s.amount);
        consume(c, slot, this.cfg);
        this.turnSkill = true;
        this.fxBoom(c.x, c.cy, 30, 'heal');
        this.fxText(c.x, c.topY - 10, `+${h}`, '#5ee27a', 26);
        this.banner(s.name, '#5ee27a');
        this.sfx('heal');
        this.endAim();
        return;
      }
      case 'shield':
        c.shield = s.value;
        consume(c, slot, this.cfg);
        this.turnSkill = true;
        this.fxBoom(c.x, c.cy, 50, 'shield');
        this.banner(`${s.name}: 받는 피해 ${Math.round(s.value * 100)}% 감소`, '#bfe8ff');
        this.sfx('heal');
        this.tutorial?.note('skill');
        return;
      case 'global': {
        consume(c, slot, this.cfg);
        this.turnSkill = true;
        this.banner(`궁극기: ${s.name}!`, '#ff8fd0');
        this.sfx('ult');
        for (const o of this.chars) {
          if (!o.alive || o === c || (c.teamId != null && o.teamId === c.teamId)) continue;
          this.fxBoom(o.x, o.cy, 60, 'concert');
          this.damageChar(o, s.damage, c, false);
        }
        this.sfx('win');
        this.endAim();
        return;
      }
      case 'teleport': {
        if (!target) {
          if (this.isMine(c)) { this.targeting = slot; this.hud.showBanner('순간이동할 곳을 터치하세요', '#d9a6ff'); this.audio.play('arm'); }
          return;
        }
        const dest = this.teleportTarget(c, target.x, target.y, s.range);
        if (!dest) return;
        consume(c, slot, this.cfg);
        this.turnSkill = true;
        this.doTeleport(c, dest.x, dest.y);
        this.banner(s.name, '#d9a6ff');
        this.tutorial?.note('skill');
        return;
      }
      default:
        this.armed = slot;
        if (slot === 3) this.banner(`궁극기: ${s.name}`, '#d9a6ff');
        this.sfx(slot === 3 ? 'ult' : 'arm');
        this.tutorial?.note('skill');
    }
  }

  endAim() {
    const t = this.turn;
    t.charging = false;
    t.current.charge = null;
    this.audio.chargeStop();
    t.phase = 'settle';
    t.settleTimer = 0;
    t.settleTotal = 0;
  }

  // 순간이동 위치 지정 (이 기기)
  useTarget(x, y) {
    const t = this.turn, c = t.current, slot = this.targeting;
    if (!slot || t.phase !== 'aim' || !this.isMine(c)) { this.targeting = 0; return; }
    const s = skillOf(c, slot);
    const dest = this.teleportTarget(c, x, y, s.range);
    if (!dest) { this.hud.showBanner('거기엔 설 수 있는 땅이 없어요', '#ffb84d'); return; }
    this.targeting = 0;
    if (this.mode === 'client') {
      const cl = this.cl;
      if (!cl || cl.done) return;
      this.doTeleport(c, dest.x, dest.y, true);
      cl.s++;
      cl.sl = slot;
      cl.tx = r1(dest.x);
      cl.ty = r1(dest.y);
      cl.usedInstant = true;
      this.sendClient(true);
      return;
    }
    this.activateSkill(c, slot, dest);
  }

  // 지정한 곳 아래의 땅 위치 (사거리 밖이면 사거리 끝으로 당김). 설 곳이 없으면 null
  teleportTarget(c, x, y, range = 650) {
    const dx = x - c.x, dy = y - c.cy, d = Math.hypot(dx, dy);
    if (d > range) { x = c.x + (dx / d) * range; y = c.cy + (dy / d) * range; }
    x = clamp(x, 12, this.map.width - 12);
    y = clamp(y, 0, this.map.height - 2);
    const T = this.terrain;
    let k = 0;
    if (T.isSolid(x, y)) {
      while (k++ < 500 && T.isSolid(x, y)) y--;
    } else {
      while (y < T.h && !T.isSolid(x, y + 1)) y++;
      if (y >= T.h - 1) return null;
    }
    if (T.isSolid(x, y - c.h + 6)) return null;
    return { x, y: Math.floor(y) };
  }

  doTeleport(c, x, y, localOnly = false) {
    if (!c.alive) return;
    const fx = localOnly ? (a, b, r) => this.effects.explosion(a, b, r, 'void') : (a, b, r) => this.fxBoom(a, b, r, 'void');
    fx(c.x, c.cy, 22);
    c.x = x;
    c.y = y;
    c.grounded = true;
    c.vx = c.vy = 0;
    c.fallStartY = y;
    c.car = false;
    fx(c.x, c.cy, 22);
    if (localOnly) this.audio.play('warp'); else this.sfx('warp');
    this.camera.focus(c.x, c.cy);
  }

  // ---------- 발사 ----------

  fire(c, power) {
    const t = this.turn;
    t.charging = false;
    c.charge = null;
    c.netControlled = false;
    this.audio.chargeStop();
    c.lastAngle = c.angle;
    c.lastPower = power;
    c.startThrow();
    t.phase = 'throwing';
    this.targeting = 0;
    this.pendingShot = { c, power, slot: this.armed, delay: c.sprite ? 0.09 : 0 };
    this.armed = 0;
    this.camera.manual = false;
    this.tutorial?.note('fire');
  }

  shotOrigin(c, angleDeg, power, facing = c.facing) {
    const a = (angleDeg * Math.PI) / 180;
    const dx = Math.cos(a) * facing, dy = -Math.sin(a);
    const speed = (Math.max(power, 3) / 100) * this.cfg.maxShotSpeed;
    return { x: c.x + dx * (c.radius + 6), y: c.cy - 8 + dy * (c.radius + 6), vx: dx * speed, vy: dy * speed };
  }

  launch(c, power, slot) {
    if (slot && !canUse(c, slot)) slot = 0;
    const s = skillOf(c, slot);
    const weapon = makeWeapon(c, s, slot);
    if (slot) consume(c, slot, this.cfg);
    shotAngles(s, c.angle).forEach((ang, i) => {
      const o = this.shotOrigin(c, ang, power);
      this.spawnProjectile(o.x, o.y, o.vx, o.vy, weapon, c, false, i > 0);
    });
    this.sfx('throw');
    this.turn.phase = 'flying';
  }

  // sibling: 다연발의 두 번째 이후 (궤적 기록 안 함)
  spawnProjectile(x, y, vx, vy, weapon, owner, child = false, sibling = false) {
    const pp = projectileProps(weapon, this.cfg.projectileRadius ?? 6);
    this.projectiles.push({
      id: ++this.pid, x, y, vx, vy, owner, weapon, type: weapon.projectile, scale: weapon.scale ?? 1,
      armed: child, child, age: 0, trail: [x, y], path: child || sibling ? null : [x, y], color: owner.color,
      split: weapon.behavior === 'split', bounces: weapon.behavior === 'bounce' ? 1 : 0, ...pp,
    });
  }

  childWeapon(w, extra = {}) {
    return { ...w, behavior: null, skill: null, ...extra };
  }

  doSplit(p) {
    const s = p.weapon.skill, n = s.count || 3, sp = ((s.spread || 12) * Math.PI) / 180;
    const base = Math.atan2(p.vy, p.vx), speed = Math.hypot(p.vx, p.vy) * 0.95;
    const w = this.childWeapon(p.weapon);
    for (let k = 0; k < n; k++) {
      const a = base + (k - (n - 1) / 2) * sp;
      this.spawnProjectile(p.x, p.y, Math.cos(a) * speed, Math.sin(a) * speed, w, p.owner, true);
    }
    this.sfx('split');
  }

  impact(p, hit) {
    const w = p.weapon, s = w.skill;
    switch (w.behavior) {
      case 'build':
        if (s.shape === 'wall') {
          // 캐릭터에 맞거나 공중에서 터져도 벽은 그 아래 땅 위에 세운다
          let gy = Math.floor(hit.y);
          while (gy < this.terrain.h && !this.terrain.isSolid(hit.x, gy)) gy++;
          const bottom = (gy < this.terrain.h ? gy : hit.y) + 18;
          this.addWall(hit.x, bottom, s.w || 60, s.h || 150);
          this.unstickRect(hit.x - (s.w || 60) / 2 - 4, bottom - (s.h || 150), (s.w || 60) + 8, s.h || 150);
          this.fxBoom(hit.x, bottom - 20, 40, 'dust');
        } else {
          this.addTerrain(hit.x, hit.y, s.radius);
          this.unstickChars(hit.x, hit.y, s.radius);
          this.fxBoom(hit.x, hit.y, s.radius * 0.7, 'dust');
        }
        this.sfx('build');
        break;
      case 'airstrike': {
        this.fxBoom(hit.x, hit.y, 18, 'void');
        this.sfx('ult');
        const n = s.count || 5, child = this.childWeapon(w);
        for (let k = 0; k < n; k++) {
          const x = hit.x + (n === 1 ? 0 : (k / (n - 1) - 0.5) * (s.spread || 200)) + (this.rng() - 0.5) * 16;
          this.spawnProjectile(x, -60 - k * 45, (this.rng() - 0.5) * 30, 240, child, p.owner, true);
        }
        break;
      }
      case 'scatter': {
        this.explode(hit.x, hit.y, w, p.owner, hit.direct, p);
        const child = this.childWeapon(w, { damage: s.bombletDamage, radius: s.bombletRadius, scale: 0.7 });
        for (let k = 0; k < (s.count || 4); k++) {
          const a = -Math.PI / 2 + (this.rng() - 0.5) * 2.2, sp = 200 + this.rng() * 180;
          this.spawnProjectile(hit.x, hit.y - 8, Math.cos(a) * sp, Math.sin(a) * sp, child, p.owner, true);
        }
        break;
      }
      case 'bounce': {
        this.explode(hit.x, hit.y, w, p.owner, hit.direct, p);
        if (!hit.direct) {
          const child = this.childWeapon(w);
          const sp = Math.max(260, Math.hypot(p.vx, p.vy) * 0.6);
          const dir = Math.sign(p.vx) || p.owner.facing;
          this.spawnProjectile(hit.x, hit.y - w.radius * 0.6, dir * sp * 0.55, -sp * 0.85, child, p.owner, true);
          this.sfx('split');
        }
        break;
      }
      default:
        this.explode(hit.x, hit.y, w, p.owner, hit.direct, p);
    }
  }

  unstickChars(x, y, r) {
    for (const c of this.chars) {
      if (c.fellOut || Math.hypot(c.x - x, c.y - y) > r + 4) continue;
      let k = 0;
      while (k++ < r * 2 + 20 && this.terrain.isSolid(c.x, c.y)) c.y--;
      c.grounded = false;
      c.fallStartY = c.y;
    }
  }

  unstickRect(x, y, w, h) {
    for (const c of this.chars) {
      if (c.fellOut || c.x < x - c.w / 2 || c.x > x + w + c.w / 2 || c.y < y || c.y - c.h > y + h) continue;
      let k = 0;
      while (k++ < h + 40 && this.terrain.isSolid(c.x, c.y)) c.y--;
      c.grounded = false;
      c.fallStartY = c.y;
    }
  }

  // 피해 적용 공통 (폭발, 공연 궁극기)
  damageChar(c, amount, owner, isDirect, kb) {
    const dealt = c.takeDamage(amount);
    if (kb) c.knock(kb.x, kb.y);
    this.fxText(c.x, c.topY - 10, `-${dealt}`, isDirect ? '#ffe14d' : '#ffffff', isDirect ? 28 : 22);
    if (owner && owner !== c) owner.dealt += dealt;
    if (!c.alive) { this.fxText(c.x, c.topY - 40, 'KO!', '#ff5a5f', 30); this.sfx('ko'); }
    else if (dealt > 0) this.sfx('hit');
    return dealt;
  }

  explode(x, y, weapon, owner, direct, p) {
    this.carve(x, y, weapon.radius * (this.rules.craterMult ?? 1));
    this.fxBoom(x, y, weapon.radius, weapon.fx);
    this.sfx(weapon.fx === 'void' ? 'void' : weapon.fx === 'nuke' ? 'nuke' : 'boom', weapon.radius);
    const results = computeExplosion(this.chars, x, y, weapon, direct, this.cfg.damage);
    let hitEnemy = false;
    for (const r of results) {
      const c = r.char;
      const dealt = this.damageChar(c, r.damage, owner, c === direct, { x: r.kx, y: r.ky });
      if (owner !== c && dealt > 0 && (owner.teamId == null || owner.teamId !== c.teamId)) hitEnemy = true;
    }
    if (!hitEnemy) return;
    gainMana(owner, this.cfg.mana.onHit, this.cfg.mana.max);
    // 기본 공격 적중 → 궁극기 해금 카운트
    if (weapon.slot === 0 && !p?.child && ultLocked(owner)) {
      owner.hits++;
      if (!ultLocked(owner)) {
        this.banner(`${owner.name}: 궁극기 해금!`, '#e2b6ff');
        this.sfx('ult');
      }
    }
    this.tutorial?.note('hit');
  }

  onCharEvent(c, ev) {
    if (ev.type === 'fall') {
      const d = c.takeDamage(ev.amount);
      this.sfx('thud');
      if (d > 0) this.fxText(c.x, c.topY - 10, `낙하 -${d}`, '#ffb84d', 20);
      if (!c.alive) { this.fxText(c.x, c.topY - 40, 'KO!', '#ff5a5f', 30); this.sfx('ko'); }
    } else if (ev.type === 'out') {
      this.sfx('fall');
      this.fxText(clamp(c.x, 60, this.map.width - 60), this.map.height - 60, `${c.name} 추락!`, '#ff5a5f', 26);
    }
    if (!c.alive && this.state === 'playing' && c === this.turn.current && this.turn.phase === 'aim') this.endAim();
  }

  // ---------- 루프 ----------

  update(dt) {
    this.time += dt;
    if (this.mode === 'client') {
      if (this.state === 'playing' || this.state === 'over') this.updateClient(dt);
    } else {
      this.wind.update(dt);
      if (this.state === 'playing') {
        this.updateTurn(dt);
        const m = this.cfg.mana;
        for (const c of this.chars) gainMana(c, m.regenPerSec * manaRegenMult(c) * dt, m.max);
      }
      if (this.state === 'playing' || this.state === 'over') {
        for (const c of this.chars) {
          const ev = c.update(dt, this.terrain, this.physCfg);
          if (ev) this.onCharEvent(c, ev);
        }
        this.effects.update(dt, this.gravity);
        if (this.mode === 'host') this.sync?.tick(dt);
      }
    }
    this.tutorial?.update(dt);
    this.hud.update(dt, this.wind, this.wind.cfg.max);
    this.updateChat(dt);
    this.camera.update(dt);
    this.updateSkillUI();
  }

  updateTurn(dt) {
    const t = this.turn, c = t.current, inp = this.input.consume();
    for (const ch of this.chars) { ch.walking = false; ch.airDir = 0; }

    if (t.phase === 'aim') {
      if (c.isBot) this.updateBot(dt, c, t);
      else if (this.mode === 'host' && c.uid && c.uid !== this.myUid) this.updateRemote(dt, c, t);
      else this.updatePlayer(dt, c, t, inp);
    } else this.targeting = 0;

    if (t.phase === 'throwing') {
      const s = this.pendingShot;
      if (!s) t.phase = 'settle';
      else {
        s.delay -= dt;
        if (s.delay <= 0) { this.launch(s.c, s.power, s.slot); this.pendingShot = null; }
      }
    }

    if (t.phase === 'flying') this.updateProjectiles(dt);

    if (t.phase === 'settle') {
      t.settleTotal += dt;
      const calm = this.chars.every((ch) => ch.fellOut || ch.grounded) && !this.effects.busy;
      t.settleTimer = calm ? t.settleTimer + dt : 0;
      if (t.settleTimer >= this.cfg.settleDelay || t.settleTotal > 8) this.endTurn();
    }
  }

  // 이 기기 플레이어 (로컬 / 방장 본인)
  updatePlayer(dt, c, t, inp) {
    const cfg = this.cfg, a = cfg.aim;
    if (!this.tutorial?.pauseTimer) t.timer -= dt;
    if (inp.skill) this.trySkill(inp.skill);
    if (t.phase !== 'aim') return; // 회복 스킬 등으로 턴 종료
    const dir = (this.input.right ? 1 : 0) - (this.input.left ? 1 : 0);
    if (!t.charging) {
      if (c.grounded) {
        if (dir && c.walk(dir, dt, this.terrain, cfg.move)) this.tutorial?.note('walk', cfg.move.speed * dt);
      } else c.airDir = dir;
      if (inp.jump && c.jump(cfg.move, dir)) { this.sfx('jump'); this.tutorial?.note('jump'); }
    }
    const before = c.angle;
    c.angle = clamp(c.angle + inp.aimDragPx * a.dragSensitivity + this.input.angleAxis * a.keySpeed * dt, a.min, a.max);
    if (c.angle !== before) this.tutorial?.note('aim', Math.abs(c.angle - before));
    if (this.input.fire && (t.charging || c.grounded) && !this.targeting) {
      if (!t.charging) { t.charging = true; t.power = 0; this.audio.chargeStart(); }
      t.power = Math.min(100, t.power + (100 / cfg.powerChargeTime) * dt);
      c.charge = t.power;
      this.audio.chargeSet(t.power);
    } else if (t.charging) {
      this.fire(c, t.power);
    }
    const sec = Math.ceil(t.timer);
    if (t.phase === 'aim' && sec <= 5 && sec > 0 && sec !== this.lastTick) { this.lastTick = sec; this.audio.play('tick'); }
    if (t.phase === 'aim' && t.timer <= 0) {
      if (t.charging) this.fire(c, t.power);
      else { this.banner('시간 초과', '#ffb84d'); this.endAim(); }
    }
    if (t.phase === 'aim') this.camera.follow(c.x, c.cy);
  }

  // 방장: 원격 참가자의 차례. 참가자가 보낸 위치/파워/발사를 그대로 반영한다
  updateRemote(dt, c, t) {
    t.timer -= dt;
    const n = this.sync?.input(c.uid);
    const seq = this.remoteSeq[c.uid] || (this.remoteSeq[c.uid] = { j: 0, s: 0, fs: 0, fe: 0 });
    if (n && n.tn === t.turnNo && c.alive) {
      c.netControlled = true;
      const k = 1 - Math.exp(-dt * 20);
      if (Math.abs(n.x - c.x) > 80 || Math.abs(n.y - c.y) > 80) { c.x = n.x; c.y = n.y; }
      else { c.x += (n.x - c.x) * k; c.y += (n.y - c.y) * k; }
      c.vx = n.vx || 0;
      c.vy = n.vy || 0;
      c.grounded = !!n.g;
      c.facing = n.fc || c.facing;
      c.fuel = n.fu ?? c.fuel;
      c.walking = !!n.wk;
      c.car = !!n.car;
      c.fallStartY = n.fsy ?? c.y;
      if (typeof n.a === 'number') c.angle = n.a;
      if ((n.j || 0) > seq.j) this.sfx('jump');
      seq.j = n.j || 0;
      if ((n.fe || 0) > seq.fe) { seq.fe = n.fe; this.onCharEvent(c, { type: 'fall', amount: n.fd || 0 }); }
      if (c.y > this.terrain.h + 60 && !c.fellOut) {
        c.fellOut = true;
        c.alive = false;
        c.hp = 0;
        c.netControlled = false;
        this.onCharEvent(c, { type: 'out' });
        return;
      }
      if ((n.s || 0) > seq.s) {
        seq.s = n.s;
        this.activateSkill(c, n.sl, n.sl && skillOf(c, n.sl)?.type === 'teleport' ? { x: n.tx, y: n.ty } : undefined);
        if (t.phase !== 'aim') return;
      }
      const want = n.ar || 0;
      if (want !== this.armed) {
        if (!want) this.armed = 0;
        else if ((!this.turnSkill || isFree(c)) && canUse(c, want) && !INSTANT.includes(skillOf(c, want)?.type)) { this.armed = want; this.sfx(want === 3 ? 'ult' : 'arm'); }
      }
      const cg = !!n.cg;
      if (cg && !t.charging) this.audio.chargeStart();
      if (!cg && t.charging) this.audio.chargeStop();
      t.charging = cg;
      t.power = n.pw || 0;
      c.charge = cg ? t.power : null;
      if (cg) this.audio.chargeSet(t.power);
      if ((n.fs || 0) > seq.fs) {
        seq.fs = n.fs;
        c.x = n.x;
        c.y = n.y;
        this.fire(c, clamp(n.fp || 0, 0, 100));
        return;
      }
    }
    if (t.timer <= -(this.cfg.remoteGrace ?? 0.8)) {
      if (t.charging) this.fire(c, t.power);
      else { c.netControlled = false; this.banner('시간 초과', '#ffb84d'); this.endAim(); }
    }
    if (t.phase === 'aim') this.camera.follow(c.x, c.cy);
  }

  // 봇: 잠깐 생각 → 계획 → 각도 돌리기 → 파워 차지 → 발사
  updateBot(dt, c, t) {
    t.timer -= dt;
    const b = this.botState || (this.botState = { t: 0, plan: null });
    b.t += dt;
    if (!b.plan && b.t > 0.7) {
      b.plan = planShot(this, c, this.rng) || { slot: 0, facing: c.facing, angle: 45, power: 50 };
      if (this.devSlot && skillOf(c, this.devSlot)) {
        if (this.devSlot === 3) c.hits = c.ultNeed;
        c.mana = this.cfg.mana.max;
        c.cooldowns = [0, 0];
        if (!b.plan.instant && !INSTANT.includes(skillOf(c, this.devSlot).type)) b.plan.slot = this.devSlot;
      }
      if (b.plan.instant) {
        this.activateSkill(c, b.plan.slot);
        if (t.phase !== 'aim') return;
        b.plan = null;
        b.t = 0.2;
        b.usedInstant = true;
        return;
      }
      c.facing = b.plan.facing;
      if (b.plan.slot) this.activateSkill(c, b.plan.slot);
      if (t.phase !== 'aim') return;
    }
    if (b.plan && !b.plan.instant) {
      const da = b.plan.angle - c.angle;
      c.angle += clamp(da, -70 * dt, 70 * dt);
      if (Math.abs(da) < 0.3 && b.t > 1.3) {
        if (!t.charging) { t.charging = true; t.power = 0; this.audio.chargeStart(); }
        t.power = Math.min(b.plan.power, t.power + (100 / this.cfg.powerChargeTime) * dt);
        c.charge = t.power;
        this.audio.chargeSet(t.power);
        if (t.power >= b.plan.power - 0.01) this.fire(c, t.power);
      }
    }
    if (t.phase === 'aim' && t.timer <= 0) {
      if (t.charging) this.fire(c, t.power);
      else this.endAim();
    }
    if (t.phase === 'aim') this.camera.follow(c.x, c.cy);
  }

  updateProjectiles(dt) {
    const t = this.turn;
    const env = {
      gravity: this.gravity, windAccel: this.wind.accel, terrain: this.terrain, chars: this.chars,
      carve: (x, y, r) => this.carve(x, y, r),
    };
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      if (p.split && p.age > 0.12 && p.vy >= 0) {
        this.projectiles.splice(i, 1);
        this.keepGhost(p);
        this.doSplit(p);
        continue;
      }
      const hit = stepProjectile(p, dt, env);
      if (p.path && p.path.length < 1200) p.path.push(p.x, p.y);
      if (!hit) continue;
      this.projectiles.splice(i, 1);
      this.keepGhost(p);
      if (hit.out) {
        if (!p.child) this.fxText(clamp(p.x, 60, this.map.width - 60), clamp(p.y, 60, this.map.height - 60), '빗나감', '#cfd6e6', 22);
      } else {
        this.impact(p, hit);
      }
    }
    if (this.projectiles.length) this.camera.follow(this.projectiles[0].x, this.projectiles[0].y);
    else { t.phase = 'settle'; t.settleTimer = 0; t.settleTotal = 0; }
  }

  // 지난번 궤적 (다음 내 차례에 흐린 점선으로 표시)
  keepGhost(p) {
    if (!p.path || !this.cfg.trajectoryGhost) return;
    const owner = typeof p.owner === 'number' ? p.owner : p.owner.id;
    this.ghosts[owner] = p.path;
  }

  // ---------- 온라인: 방장 → 참가자 ----------

  makeSnapshot() {
    const t = this.turn;
    return {
      ti: t.index, tn: t.turnNo, ph: t.phase, tm: r1(Math.max(0, t.timer)), pw: r1(t.power || 0), cg: t.charging ? 1 : 0, ar: this.armed || 0,
      ts: this.turnSkill ? 1 : 0, w: r1(this.wind.value), fu: Math.round(t.current.fuel),
      c: this.chars.map((c) => [
        r1(c.x), r1(c.y), c.facing, r1(c.angle), c.hp, c.alive ? 1 : 0, c.fellOut ? 1 : 0,
        c.sprite ? c.animFrame(this.time) : 0, Math.floor(c.mana), c.cooldowns[0], c.cooldowns[1],
        c.lastAngle == null ? -999 : r1(c.lastAngle), c.lastPower == null ? -1 : r1(c.lastPower), c.grounded ? 1 : 0, c.walking ? 1 : 0,
        c.hits, (c.car ? 1 : 0) | (c.shield > 0 ? 2 : 0), c.maxHp,
      ]),
      p: this.projectiles.map((p) => [
        p.id, r1(p.x), r1(p.y), r1(p.vx), r1(p.vy), p.type || '', p.scale ?? 1, Math.round(p.age * 100) / 100,
        p.weapon.windMult ?? 1, p.weapon.gravityMult ?? 1, p.owner.id, (p.ghost ? 1 : 0) | (p.child ? 2 : 0) | (p.path ? 4 : 0),
      ]),
    };
  }

  applySnapshot(s) {
    if (this.mode !== 'client' || !this.turn) return;
    const t = this.turn;
    const cur = this.chars[s.ti];
    const mineAim = s.ph === 'aim' && cur && cur.uid === this.myUid && cur.alive;
    if (mineAim && (!this.cl || this.cl.tn !== s.tn)) this.beginLocalControl(s);
    const ctrl = !!(mineAim && this.cl && this.cl.tn === s.tn);
    t.index = s.ti;
    t.turnNo = s.tn;
    t.phase = s.ph;
    this.turnSkill = !!s.ts;
    if (!ctrl) {
      t.timer = s.tm;
      t.power = s.pw;
      t.charging = !!s.cg;
      this.armed = s.ar;
      if (t.current) t.current.fuel = s.fu;
      if (s.ph !== 'aim') this.targeting = 0;
    }
    this.wind.value = s.w;
    (s.c || []).forEach((a, i) => {
      const c = this.chars[i];
      if (!c) return;
      const self = ctrl && i === s.ti;
      c.hp = a[4];
      c.alive = !!a[5];
      c.fellOut = !!a[6];
      c.mana = a[8];
      c.cooldowns = [a[9], a[10]];
      c.hits = a[15] ?? 0;
      c.shield = a[16] & 2 ? 0.5 : 0;
      if (a[17]) c.maxHp = a[17];
      if (self) { c.netFrame = null; return; } // 내가 직접 조작 중인 캐릭터
      c.tx = a[0];
      c.ty = a[1];
      c.facing = a[2];
      c.angle = a[3];
      c.netFrame = a[7];
      c.lastAngle = a[11] === -999 ? null : a[11];
      c.lastPower = a[12] < 0 ? null : a[12];
      c.grounded = !!a[13];
      c.walking = !!a[14];
      c.car = !!(a[16] & 1);
      c.charge = s.ti === i && s.cg ? s.pw : null;
    });
    const byId = new Map(this.projectiles.map((p) => [p.id, p]));
    const next = [];
    for (const a of s.p || []) {
      const [id, x, y, vx, vy, type, scale, age, wm, gm, owner, fl] = a;
      let p = byId.get(id);
      if (!p) {
        p = { id, x, y, vx, vy, type, scale, age, wm, gm, owner, ghost: !!(fl & 1), trail: [x, y], path: fl & 4 ? [x, y] : null, color: this.chars[owner]?.color || '#fff' };
      } else {
        byId.delete(id);
        if (Math.hypot(p.x - x, p.y - y) > 40) { p.x = x; p.y = y; } else { p.x = (p.x + x) / 2; p.y = (p.y + y) / 2; }
        p.vx = vx; p.vy = vy; p.age = age;
      }
      next.push(p);
    }
    for (const p of byId.values()) this.keepGhost(p); // 사라진 투사체 → 궤적 기록
    this.projectiles = next;
    if (s.ti !== this.lastTi || s.tn !== this.lastTn) {
      this.lastTi = s.ti;
      this.lastTn = s.tn;
      this.targeting = 0;
      const c = t.current;
      if (c) this.camera.focus(c.x, c.cy);
    }
  }

  // 참가자: 내 차례 시작 → 방장 위치에서 출발해 내 기기에서 직접 조작
  beginLocalControl(s) {
    const i = s.ti, c = this.chars[i], a = s.c[i];
    const prev = this.cl || { fs: 0, fe: 0, j: 0, s: 0 };
    const n = this.sync?.lastSentObj || {};
    this.cl = {
      tn: s.tn, done: false, charging: false, power: 0, armed: 0, usedInstant: false,
      fs: Math.max(prev.fs, n.fs || 0), fe: Math.max(prev.fe, n.fe || 0), j: Math.max(prev.j, n.j || 0), s: Math.max(prev.s, n.s || 0),
      sl: 0, tx: 0, ty: 0, fp: 0, fd: 0,
    };
    c.x = c.tx = a[0];
    c.y = c.ty = a[1];
    c.facing = a[2];
    c.angle = a[3];
    c.grounded = !!a[13];
    c.vx = c.vy = 0;
    c.fallStartY = c.y;
    c.jumpsLeft = c.maxJumps - 1;
    c.fuel = s.fu;
    c.netFrame = null;
    c.charge = null;
    this.turn.timer = s.tm;
    this.turn.charging = false;
    this.turn.power = 0;
    this.armed = 0;
    this.targeting = 0;
    this.lastTick = 0;
  }

  // 참가자: 내 조작 상태를 방장에게 (위치, 각도, 파워, 발사/스킬 순번)
  sendClient(force = false) {
    const c = this.turn?.current, cl = this.cl;
    if (!c || !cl) return;
    this.sync?.send({
      tn: cl.tn, a: r1(c.angle), x: r1(c.x), y: r1(c.y), vx: r1(c.vx), vy: r1(c.vy), g: c.grounded ? 1 : 0, fc: c.facing,
      fu: Math.round(c.fuel), wk: c.walking ? 1 : 0, fsy: r1(c.fallStartY), car: c.car ? 1 : 0,
      cg: cl.charging ? 1 : 0, pw: r1(cl.power), ar: cl.armed, fs: cl.fs, fp: r1(cl.fp), j: cl.j, s: cl.s, sl: cl.sl,
      tx: cl.tx, ty: cl.ty, fe: cl.fe, fd: cl.fd,
    }, force);
  }

  clientFire(c) {
    const cl = this.cl, t = this.turn;
    cl.fs++;
    cl.fp = cl.power;
    cl.charging = false;
    cl.done = true;
    t.charging = false;
    c.charge = null;
    c.lastAngle = c.angle;
    c.lastPower = cl.power;
    c.startThrow();
    this.audio.chargeStop();
    this.audio.play('throw');
    this.targeting = 0;
    this.sendClient(true);
  }

  // 참가자: 내 차례 조작 (로컬 로직과 같지만 판정은 방장이 함)
  updateLocalControl(dt, c, t, inp) {
    const cfg = this.cfg, cl = this.cl, a = cfg.aim;
    c.walking = false;
    c.airDir = 0;
    if (!cl.done) {
      t.timer -= dt;
      const dir = (this.input.right ? 1 : 0) - (this.input.left ? 1 : 0);
      if (!cl.charging) {
        if (c.grounded) {
          if (dir) c.walk(dir, dt, this.terrain, cfg.move);
        } else c.airDir = dir;
        if (inp.jump && c.jump(cfg.move, dir)) { cl.j++; this.audio.play('jump'); }
      }
      c.angle = clamp(c.angle + inp.aimDragPx * a.dragSensitivity + this.input.angleAxis * a.keySpeed * dt, a.min, a.max);
      if (inp.skill) this.trySkill(inp.skill);
      if (this.input.fire && (cl.charging || c.grounded) && !this.targeting) {
        if (!cl.charging) { cl.charging = true; cl.power = 0; this.audio.chargeStart(); }
        cl.power = Math.min(100, cl.power + (100 / cfg.powerChargeTime) * dt);
        this.audio.chargeSet(cl.power);
      } else if (cl.charging) this.clientFire(c);
      if (!cl.done && t.timer <= 0) {
        if (cl.charging) this.clientFire(c);
        else cl.done = true;
      }
      const sec = Math.ceil(t.timer);
      if (!cl.done && sec <= 5 && sec > 0 && sec !== this.lastTick) { this.lastTick = sec; this.audio.play('tick'); }
    }
    t.charging = cl.charging;
    t.power = cl.power;
    c.charge = cl.charging ? cl.power : null;
    this.armed = cl.armed;
    const ev = c.update(dt, this.terrain, this.physCfg);
    if (ev?.type === 'fall') { cl.fe++; cl.fd = ev.amount; }
    if (ev?.type === 'out') cl.done = true;
    this.sendClient(false);
    this.camera.follow(c.x, c.cy);
  }

  // 참가자: 보간 표시 + 내 차례 조작
  updateClient(dt) {
    this.effects.update(dt, this.gravity);
    const t = this.turn, c = t.current;
    const ctrl = this.state === 'playing' && t.phase === 'aim' && c && c.uid === this.myUid && this.cl && this.cl.tn === t.turnNo;
    const k = 1 - Math.exp(-dt * 14);
    for (const ch of this.chars) {
      if (ctrl && ch === c) continue;
      if (ch.tx == null) continue;
      if (Math.abs(ch.tx - ch.x) > 150 || Math.abs(ch.ty - ch.y) > 150) { ch.x = ch.tx; ch.y = ch.ty; }
      else { ch.x += (ch.tx - ch.x) * k; ch.y += (ch.ty - ch.y) * k; }
      if (ch.throwT >= 0) { ch.throwT += dt; if (ch.throwT > 0.45) ch.throwT = -1; }
    }
    for (const p of this.projectiles) {
      p.age += dt;
      p.vx += this.wind.accel * (p.wm ?? 1) * dt;
      p.vy += this.gravity * (p.gm ?? 1) * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.trail.push(p.x, p.y);
      if (p.trail.length > 90) p.trail.splice(0, 2);
      if (p.path && p.path.length < 1200) p.path.push(p.x, p.y);
    }
    if (this.state !== 'playing') return;
    const inp = this.input.consume();
    if (ctrl) {
      this.updateLocalControl(dt, c, t, inp);
      return;
    }
    if (t.phase === 'aim') t.timer -= dt;
    // 다른 사람이 차지 중이면 스냅샷 사이에도 게이지를 부드럽게 채운다
    if (t.charging) t.power = Math.min(100, t.power + (100 / this.cfg.powerChargeTime) * dt);
    if (this.projectiles.length) this.camera.follow(this.projectiles[0].x, this.projectiles[0].y);
    else if (c) this.camera.follow(c.x, c.cy);
    if (t.charging && !this.netCharging) this.audio.chargeStart();
    if (!t.charging && this.netCharging) this.audio.chargeStop();
    if (t.charging) this.audio.chargeSet(t.power);
    this.netCharging = t.charging;
  }

  // 스킬 버튼 표시 (바뀐 경우에만 DOM 갱신)
  updateSkillUI() {
    if (this.state !== 'playing') return;
    const t = this.turn, c = t.current;
    if (!c) return;
    const usable = this.isMine(c) && t.phase === 'aim' && !t.charging && !(this.mode === 'client' && (!this.cl || this.cl.done));
    for (const [slot, id] of [[1, 'btn-skill1'], [2, 'btn-skill2'], [3, 'btn-ult']]) {
      const s = skillOf(c, slot), el = $(id);
      const active = this.armed === slot || this.targeting === slot;
      const locked = slot === 3 && s && ultLocked(c);
      let sub = '';
      if (s) {
        if (isFree(c)) sub = '무제한';
        else if (locked) sub = `🔒 ${c.hits}/${c.ultNeed}`;
        else if (slot < 3 && c.cooldowns[slot - 1] > 0) sub = `${c.cooldowns[slot - 1]}턴 대기`;
        else sub = `💧${manaCost(c, slot)}`;
      }
      const off = !s || !usable || (!active && (!canUse(c, slot) || (this.turnSkill && !isFree(c))));
      const key = `${c.id}|${s?.name}|${sub}|${off}|${active}`;
      if (el.dataset.k === key) continue;
      el.dataset.k = key;
      el.innerHTML = s ? `${s.name}<small>${sub}</small>` : '-';
      el.classList.toggle('off', off);
      el.classList.toggle('armed', active);
      if (slot === 3) el.classList.toggle('ready', !!s && canUse(c, slot));
    }
  }

  render() {
    const { ctx, dpr, cw, ch, camera: cam, map } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawSky(ctx, this.bg, cw, ch, this.time);
    drawBackground(ctx, cam, this.bg, dpr, map);
    const sh = this.effects.shake;
    cam.apply(ctx, dpr, (Math.random() * 2 - 1) * sh, (Math.random() * 2 - 1) * sh);

    // 맵 아래 허공 (화산은 용암)
    const fog = ctx.createLinearGradient(0, map.height - 80, 0, map.height + 120);
    fog.addColorStop(0, 'rgba(20,24,40,0)');
    fog.addColorStop(1, map.fog || 'rgba(20,24,40,0.6)');
    ctx.fillStyle = fog;
    ctx.fillRect(-2000, map.height - 80, map.width + 4000, 200);
    // 맵 좌우 경계 밖 (최대로 축소했을 때만 보임)
    ctx.fillStyle = 'rgba(20,24,40,0.55)';
    ctx.fillRect(-3000, -3000, 3000, map.height + 6000);
    ctx.fillRect(map.width, -3000, 3000, map.height + 6000);

    // 지형 (보이는 영역만)
    const v = cam.visibleRect();
    const sx = clamp(Math.floor(v.x), 0, map.width), sy = clamp(Math.floor(v.y), 0, map.height);
    const ex = clamp(Math.ceil(v.x + v.w), 0, map.width), ey = clamp(Math.ceil(v.y + v.h), 0, map.height);
    if (ex > sx && ey > sy) ctx.drawImage(this.terrain.canvas, sx, sy, ex - sx, ey - sy, sx, sy, ex - sx, ey - sy);

    const aimC = this.state === 'playing' && this.turn.phase === 'aim' ? this.turn.current : null;
    if (aimC && this.isMine(aimC) && this.ghosts[aimC.id]) drawGhost(ctx, this.ghosts[aimC.id]);
    for (const c of this.chars) c.draw(ctx, this.time);
    if (aimC) {
      const c = aimC;
      if (this.targeting && this.isMine(c)) drawRange(ctx, c, skillOf(c, this.targeting)?.range || 650, this.time);
      const secs = previewSeconds(c);
      if (secs > 0 && this.isMine(c)) {
        const w = makeWeapon(c, skillOf(c, this.armed), this.armed);
        const power = this.turn.charging ? this.turn.power : c.lastPower ?? 50;
        const o = this.shotOrigin(c, c.angle, power);
        const env = { gravity: this.gravity, windAccel: this.wind.accel, terrain: this.terrain };
        drawPreview(ctx, previewPath(o.x, o.y, o.vx, o.vy, w, env, secs));
      }
      drawAim(ctx, c);
    }
    for (const p of this.projectiles) drawProjectile(ctx, p);
    this.effects.draw(ctx);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.hud.draw(ctx, this, cw, ch);
  }
}

const game = new Game();
game.load().then(() => {
  let last = performance.now(), acc = 0;
  const frame = (now) => {
    acc += Math.min(0.1, (now - last) / 1000);
    last = now;
    while (acc >= STEP) { game.update(STEP); acc -= STEP; }
    game.render();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}).catch((err) => {
  console.error(err);
  document.querySelectorAll('.overlay').forEach((el) => el.classList.add('hidden'));
  $('load-error').classList.remove('hidden');
  $('load-error-detail').textContent = String(err);
});
