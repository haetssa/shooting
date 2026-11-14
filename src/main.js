// 게임 코어: 루프, 턴 진행, 스킬/봇/사운드, 온라인 동기화
// 모드: local(혼자/한 화면) | host(온라인 방장, 모든 판정) | client(온라인 참가자, 화면 표시 + 입력 송신)
// 화면(DOM) 관리는 screens.js
import { loadJSON, mulberry32, shuffle, clamp } from './util.js';
import { Terrain } from './terrain.js';
import { Character } from './character.js';
import { TurnManager } from './turn.js';
import { Input } from './input.js';
import { Camera } from './camera.js';
import { Wind } from './wind.js';
import { Effects } from './effects.js';
import { stepProjectile, computeExplosion, previewPath } from './physics.js';
import { buildBackground, drawBackground, drawSky } from './background.js';
import { HUD, drawAim, drawPreview } from './ui.js';
import { drawProjectile } from './projectiles.js';
import { loadSprite, makePortrait } from './sprites.js';
import { skillOf, canUse, consume, tickCooldowns, makeWeapon, shotAngles, gainUlt, previewSeconds } from './skills.js';
import { planShot } from './bot.js';
import { GameAudio } from './audio.js';
import { HostSync, ClientSync } from './net/sync.js';
import { Screens } from './screens.js';

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
    this.botState = null;
    this.lastTick = 0;
    this.outEvents = [];
    this.sync = null;
    this.pid = 0;
    this.bubbles = {};
    this.chatLog = [];
    this.ultHinted = new Set();
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
    if (q.get('autostart')) {
      const n = +q.get('autostart') || 2, demo = q.has('demo');
      this.startMatch(Array.from({ length: n }, (_, i) => ({ name: demo ? `봇 ${i + 1}` : `플레이어 ${i + 1}`, char: i % this.charDefs.length, bot: demo ? 2 : 0 })), { mapId: q.get('map') || undefined });
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

  // ---------- 이벤트: 방장은 참가자에게도 전달 ----------

  emit(ev) { if (this.mode === 'host') this.outEvents.push(ev); }
  fxBoom(x, y, r, fx) { this.effects.explosion(x, y, r, fx); this.emit({ k: 'boom', x: r1(x), y: r1(y), r, fx: fx || '' }); }
  fxText(x, y, s, c, z) { this.effects.text(x, y, s, c, z); this.emit({ k: 'text', x: r1(x), y: r1(y), s, c, z }); }
  sfx(n, a) { this.audio.play(n, a); this.emit({ k: 'snd', n, a: a ?? 0 }); }
  banner(s, c) { this.hud.showBanner(s, c); this.emit({ k: 'ban', s, c }); }
  carve(x, y, r) { this.terrain.carve(x, y, r); this.emit({ k: 'carve', x: r1(x), y: r1(y), r }); }
  addTerrain(x, y, r) { this.terrain.add(x, y, r); this.emit({ k: 'add', x: r1(x), y: r1(y), r }); }

  applyEvent(ev) {
    if (this.mode !== 'client' || !this.turn) return;
    switch (ev.k) {
      case 'boom': this.effects.explosion(ev.x, ev.y, ev.r, ev.fx || undefined); break;
      case 'text': this.effects.text(ev.x, ev.y, ev.s, ev.c, ev.z); break;
      case 'snd': this.audio.play(ev.n, ev.a); break;
      case 'ban': this.hud.showBanner(ev.s, ev.c); break;
      case 'carve': this.terrain.carve(ev.x, ev.y, ev.r); break;
      case 'add': this.terrain.add(ev.x, ev.y, ev.r); break;
      case 'over': this.gameOver(ev.w >= 0 ? this.chars[ev.w] : null); break;
    }
  }

  // ---------- 경기 시작/종료 ----------

  // players: [{ name, char(인덱스), bot, uid }], opts: { mapId, seed, mode }
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
      const c = new Character(this.charDefs[ci], { id: i, uid: p.uid, name: p.name, color: PLAYER_COLORS[i % PLAYER_COLORS.length], bot: p.bot }, this.sprites[ci]);
      c.angle = this.cfg.aim.default;
      c.placeOn(this.terrain, spawns[i].x, spawns[i].y);
      c.facing = spawns[i].x < map.width / 2 ? 1 : -1;
      this.chars.push(c);
    }
    this.projectiles = [];
    this.pendingShot = null;
    this.outEvents = [];
    this.bubbles = {};
    this.chatLog = [];
    this.ultHinted = new Set();
    this.remoteSeq = {};
    this.pid = 0;
    this.armed = 0;
    this.effects = new Effects();
    this.turn = new TurnManager(this.chars, this.cfg, this.rng);
    this.camera.zoom = clamp(this.camera.defaultZoom, this.camera.minZoom, this.camera.maxZoom);
    this.screens.enterGame();
    this.state = 'playing';
    this.audio.playMusic('battle');
    if (this.mode === 'client') {
      this.lastTi = -1;
      this.net = { active: false, angle: 45, j: 0, s: 0, sl: 0 };
      this.netCharging = false;
      this.camera.focus(this.turn.current.x, this.turn.current.cy, true);
    } else {
      this.onTurnStart();
    }
  }

  startOnline(start, mode, online) {
    this.myUid = online.uid;
    const players = start.players.map((p) => ({ name: p.name, char: p.char, bot: 0, uid: p.uid }));
    this.startMatch(players, { mapId: start.map, seed: start.seed, mode });
    this.sync = mode === 'host' ? new HostSync(online, this) : new ClientSync(online, this);
    if (this.devOnlineBots && mode === 'host') for (const c of this.chars) { c.botLevel = 2; c.isBot = true; } // 개발용
  }

  stopMatch() {
    this.sync?.stop();
    this.sync = null;
    this.mode = 'local';
    this.state = 'menu';
    this.audio.chargeStop();
    this.audio.playMusic('menu');
    this.projectiles = [];
    this.chars = [];
    this.pendingShot = null;
    this.screens.leaveGame();
  }

  onTurnStart() {
    const c = this.turn.current;
    tickCooldowns(c);
    this.armed = 0;
    this.botState = null;
    this.lastTick = 0;
    if (this.mode === 'host' && c.uid && c.uid !== this.myUid) {
      const n = this.sync?.input(c.uid);
      this.remoteSeq[c.uid] = { j: n?.j || 0, s: n?.s || 0 };
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
    this.screens.showOver(winner);
  }

  // 플레이어가 나가거나 연결이 끊기면 즉시 탈락
  eliminate(c, msg) {
    if (!c || c.fellOut) return;
    const wasAlive = c.alive;
    c.alive = false;
    c.hp = 0;
    c.fellOut = true;
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

  say(uid, name, text, sys = false) {
    if (!sys && uid) this.bubbles[uid] = { text, t: 4 };
    this.chatLog.push({ name, text, sys, t: 7 });
    if (this.chatLog.length > 4) this.chatLog.shift();
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

  trySkill(slot) {
    if (this.state !== 'playing') return;
    const t = this.turn, c = t.current;
    if (t.phase !== 'aim' || t.charging || !this.isMine(c)) return;
    if (this.mode === 'client') {
      if (this.armed !== slot && !canUse(c, slot)) return;
      this.net.s++;
      this.net.sl = slot;
      this.audio.play('click');
      return;
    }
    this.activateSkill(c, slot);
  }

  activateSkill(c, slot) {
    if (this.armed === slot) { this.armed = 0; this.sfx('click'); return; }
    if (!canUse(c, slot)) return;
    const s = skillOf(c, slot);
    if (s.type === 'heal') {
      const h = c.heal(s.amount);
      consume(c, slot);
      this.fxBoom(c.x, c.cy, 30, 'heal');
      this.fxText(c.x, c.topY - 10, `+${h}`, '#5ee27a', 26);
      this.banner(s.name, '#5ee27a');
      this.sfx('heal');
      this.turn.phase = 'settle';
      return;
    }
    this.armed = slot;
    if (slot === 3) this.banner(`궁극기: ${s.name}`, '#d9a6ff');
    this.sfx(slot === 3 ? 'ult' : 'arm');
  }

  checkUltHint() {
    if (this.state !== 'playing') return;
    const t = this.turn, c = t.current;
    if (!c || !this.isMine(c) || t.phase !== 'aim' || c.ult < 100 || this.ultHinted.has(c.id)) return;
    if (t.timer > this.cfg.turnTime - 1.7) return; // 턴 시작 배너가 끝난 뒤
    this.ultHinted.add(c.id);
    this.hud.showBanner('궁극기 준비! 보라색 버튼을 누르고 발사', '#e2b6ff');
  }

  // ---------- 발사 ----------

  fire(c, power) {
    const t = this.turn;
    t.charging = false;
    c.charge = null;
    this.audio.chargeStop();
    c.lastAngle = c.angle;
    c.lastPower = power;
    c.startThrow();
    t.phase = 'throwing';
    this.pendingShot = { c, power, slot: this.armed, delay: c.sprite ? 0.09 : 0 };
    this.armed = 0;
    this.camera.manual = false;
  }

  shotOrigin(c, angleDeg, power, facing = c.facing) {
    const a = (angleDeg * Math.PI) / 180;
    const dx = Math.cos(a) * facing, dy = -Math.sin(a);
    const speed = (Math.max(power, 3) / 100) * this.cfg.maxShotSpeed;
    return { x: c.x + dx * (c.radius + 6), y: c.cy - 8 + dy * (c.radius + 6), vx: dx * speed, vy: dy * speed };
  }

  launch(c, power, slot) {
    const s = skillOf(c, slot);
    const weapon = makeWeapon(c, s);
    if (slot) consume(c, slot);
    for (const ang of shotAngles(s, c.angle)) {
      const o = this.shotOrigin(c, ang, power);
      this.spawnProjectile(o.x, o.y, o.vx, o.vy, weapon, c);
    }
    this.sfx('throw');
    this.turn.phase = 'flying';
  }

  spawnProjectile(x, y, vx, vy, weapon, owner, child = false) {
    const scale = weapon.scale ?? 1;
    this.projectiles.push({
      id: ++this.pid, x, y, vx, vy, owner, weapon, type: weapon.projectile, scale,
      radius: 6 * scale, armed: child, child, age: 0, trail: [x, y], color: owner.color,
      pierceLeft: weapon.behavior === 'pierce' ? weapon.skill.depth : 0,
      split: weapon.behavior === 'split',
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
        this.addTerrain(hit.x, hit.y, s.radius);
        this.unstickChars(hit.x, hit.y, s.radius);
        this.fxBoom(hit.x, hit.y, s.radius * 0.7, 'dust');
        this.sfx('build');
        break;
      case 'teleport':
        this.teleport(p.owner, hit.x, hit.y);
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
        this.explode(hit.x, hit.y, w, p.owner, hit.direct);
        const child = this.childWeapon(w, { damage: s.bombletDamage, radius: s.bombletRadius, scale: 0.7 });
        for (let k = 0; k < (s.count || 4); k++) {
          const a = -Math.PI / 2 + (this.rng() - 0.5) * 2.2, sp = 200 + this.rng() * 180;
          this.spawnProjectile(hit.x, hit.y - 8, Math.cos(a) * sp, Math.sin(a) * sp, child, p.owner, true);
        }
        break;
      }
      default:
        this.explode(hit.x, hit.y, w, p.owner, hit.direct);
    }
  }

  teleport(c, x, y) {
    if (!c.alive) return;
    this.fxBoom(c.x, c.cy, 22, 'void');
    c.x = clamp(x, 2, this.map.width - 2);
    c.y = Math.floor(y) - 1;
    let k = 0;
    while (k++ < 300 && this.terrain.isSolid(c.x, c.y)) c.y--;
    c.grounded = false;
    c.vx = c.vy = 0;
    c.fallStartY = c.y;
    this.fxBoom(c.x, c.cy, 22, 'void');
    this.sfx('warp');
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

  explode(x, y, weapon, owner, direct) {
    this.carve(x, y, weapon.radius * (this.rules.craterMult ?? 1));
    this.fxBoom(x, y, weapon.radius, weapon.fx);
    this.sfx(weapon.fx === 'void' ? 'void' : 'boom', weapon.radius);
    const results = computeExplosion(this.chars, x, y, weapon, direct, this.cfg.damage);
    for (const r of results) {
      const c = r.char;
      const dealt = c.takeDamage(r.damage);
      c.knock(r.kx, r.ky);
      const isDirect = c === direct;
      this.fxText(c.x, c.topY - 10, `-${dealt}`, isDirect ? '#ffe14d' : '#ffffff', isDirect ? 28 : 22);
      if (owner !== c) gainUlt(owner, dealt * this.cfg.ult.dealRate);
      gainUlt(c, dealt * this.cfg.ult.takeRate);
      if (!c.alive) { this.fxText(c.x, c.topY - 40, 'KO!', '#ff5a5f', 30); this.sfx('ko'); }
      else if (dealt > 0) this.sfx('hit');
    }
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
    if (!c.alive && this.state === 'playing' && c === this.turn.current && this.turn.phase === 'aim') {
      c.charge = null;
      this.turn.charging = false;
      this.audio.chargeStop();
      this.turn.phase = 'settle';
    }
  }

  // ---------- 루프 ----------

  update(dt) {
    this.time += dt;
    if (this.mode === 'client') {
      if (this.state === 'playing' || this.state === 'over') this.updateClient(dt);
    } else {
      this.wind.update(dt);
      if (this.state === 'playing') this.updateTurn(dt);
      if (this.state === 'playing' || this.state === 'over') {
        for (const c of this.chars) {
          const ev = c.update(dt, this.terrain, this.physCfg);
          if (ev) this.onCharEvent(c, ev);
        }
        this.effects.update(dt, this.gravity);
        if (this.mode === 'host') this.sync?.tick(dt);
      }
    }
    this.hud.update(dt, this.wind, this.wind.cfg.max);
    this.updateChat(dt);
    this.camera.update(dt);
    this.updateSkillUI();
    this.checkUltHint();
  }

  updateTurn(dt) {
    const t = this.turn, c = t.current, inp = this.input.consume();
    for (const ch of this.chars) ch.walking = false;

    if (t.phase === 'aim') {
      if (c.isBot) this.updateBot(dt, c, t);
      else if (this.mode === 'host' && c.uid && c.uid !== this.myUid) this.updatePlayer(dt, c, t, this.remoteSource(c));
      else this.updatePlayer(dt, c, t, this.localSource(inp, dt));
    }

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

  localSource(inp, dt) {
    const a = this.cfg.aim;
    return {
      local: true,
      dir: (this.input.right ? 1 : 0) - (this.input.left ? 1 : 0),
      jump: inp.jump,
      skill: inp.skill,
      fire: this.input.fire,
      angle: null,
      aimDelta: inp.aimDragPx * a.dragSensitivity + this.input.angleAxis * a.keySpeed * dt,
    };
  }

  remoteSource(c) {
    const n = this.sync?.input(c.uid) || {};
    const seq = this.remoteSeq[c.uid] || (this.remoteSeq[c.uid] = { j: n.j || 0, s: n.s || 0 });
    const jump = (n.j || 0) > seq.j, skill = (n.s || 0) > seq.s ? n.sl : 0;
    seq.j = n.j || 0;
    seq.s = n.s || 0;
    return { local: false, dir: (n.r ? 1 : 0) - (n.l ? 1 : 0), jump, skill, fire: !!n.f, angle: typeof n.a === 'number' ? n.a : null, aimDelta: 0 };
  }

  // 사람 플레이어 (이 기기 또는 원격 참가자)
  updatePlayer(dt, c, t, src) {
    const cfg = this.cfg;
    t.timer -= dt;
    if (src.skill) {
      if (src.local) this.trySkill(src.skill);
      else if (!t.charging) this.activateSkill(c, src.skill);
    }
    if (t.phase !== 'aim') return; // 회복 스킬 등으로 턴 종료
    if (!t.charging && c.grounded) {
      if (src.dir) c.walk(src.dir, dt, this.terrain, cfg.move);
      if (src.jump && c.jump(cfg.move)) this.sfx('jump');
    }
    c.angle = clamp(src.angle != null ? src.angle : c.angle + src.aimDelta, cfg.aim.min, cfg.aim.max);
    if (src.fire && (t.charging || c.grounded)) {
      if (!t.charging) { t.charging = true; t.power = 0; this.audio.chargeStart(); }
      t.power = Math.min(100, t.power + (100 / cfg.powerChargeTime) * dt);
      c.charge = t.power;
      this.audio.chargeSet(t.power);
    } else if (t.charging) {
      this.fire(c, t.power);
    }
    const sec = Math.ceil(t.timer);
    if (src.local && t.phase === 'aim' && sec <= 5 && sec > 0 && sec !== this.lastTick) { this.lastTick = sec; this.audio.play('tick'); }
    if (t.phase === 'aim' && t.timer <= 0) {
      if (t.charging) this.fire(c, t.power);
      else { this.banner('시간 초과', '#ffb84d'); t.phase = 'settle'; }
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
      if (b.plan.instant) { this.activateSkill(c, b.plan.slot); return; }
      if (this.devSlot && skillOf(c, this.devSlot)) {
        if (this.devSlot === 3) c.ult = 100;
        c.cooldowns = [0, 0];
        b.plan.slot = this.devSlot;
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
      else t.phase = 'settle';
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
        this.doSplit(p);
        continue;
      }
      const hit = stepProjectile(p, dt, env);
      if (!hit) continue;
      this.projectiles.splice(i, 1);
      if (hit.out) {
        if (!p.child) this.fxText(clamp(p.x, 60, this.map.width - 60), clamp(p.y, 60, this.map.height - 60), '빗나감', '#cfd6e6', 22);
      } else {
        this.impact(p, hit);
      }
    }
    if (this.projectiles.length) this.camera.follow(this.projectiles[0].x, this.projectiles[0].y);
    else { t.phase = 'settle'; t.settleTimer = 0; t.settleTotal = 0; }
  }

  // ---------- 온라인: 방장 → 참가자 ----------

  makeSnapshot() {
    const t = this.turn;
    return {
      ti: t.index, ph: t.phase, tm: r1(Math.max(0, t.timer)), pw: r1(t.power || 0), cg: t.charging ? 1 : 0, ar: this.armed || 0,
      w: r1(this.wind.value), fu: Math.round(t.current.fuel),
      c: this.chars.map((c) => [
        r1(c.x), r1(c.y), c.facing, r1(c.angle), c.hp, c.alive ? 1 : 0, c.fellOut ? 1 : 0,
        c.sprite ? c.animFrame(this.time) : 0, Math.floor(c.ult), c.cooldowns[0], c.cooldowns[1],
        c.lastAngle == null ? -999 : r1(c.lastAngle), c.lastPower == null ? -1 : r1(c.lastPower), c.grounded ? 1 : 0, c.walking ? 1 : 0,
      ]),
      p: this.projectiles.map((p) => [p.id, r1(p.x), r1(p.y), r1(p.vx), r1(p.vy), p.type || '', p.scale ?? 1, Math.round(p.age * 100) / 100, p.weapon.windMult ?? 1, p.weapon.gravityMult ?? 1]),
    };
  }

  applySnapshot(s) {
    if (this.mode !== 'client' || !this.turn) return;
    const t = this.turn;
    t.index = s.ti;
    t.phase = s.ph;
    t.timer = s.tm;
    t.power = s.pw;
    t.charging = !!s.cg;
    this.armed = s.ar;
    this.wind.value = s.w;
    (s.c || []).forEach((a, i) => {
      const c = this.chars[i];
      if (!c) return;
      const mineAim = c.uid === this.myUid && s.ti === i && s.ph === 'aim';
      c.tx = a[0];
      c.ty = a[1];
      c.facing = a[2];
      if (!mineAim) c.angle = a[3];
      c.hp = a[4];
      c.alive = !!a[5];
      c.fellOut = !!a[6];
      c.netFrame = a[7];
      c.ult = a[8];
      c.cooldowns = [a[9], a[10]];
      c.lastAngle = a[11] === -999 ? null : a[11];
      c.lastPower = a[12] < 0 ? null : a[12];
      c.grounded = !!a[13];
      c.walking = !!a[14];
      c.charge = s.ti === i && s.cg ? s.pw : null;
    });
    if (t.current) t.current.fuel = s.fu;
    const byId = new Map(this.projectiles.map((p) => [p.id, p]));
    const next = [];
    for (const a of s.p || []) {
      const [id, x, y, vx, vy, type, scale, age, wm, gm] = a;
      let p = byId.get(id);
      if (!p) p = { id, x, y, vx, vy, type, scale, age, wm, gm, trail: [x, y], color: '#fff' };
      else {
        if (Math.hypot(p.x - x, p.y - y) > 40) { p.x = x; p.y = y; } else { p.x = (p.x + x) / 2; p.y = (p.y + y) / 2; }
        p.vx = vx; p.vy = vy; p.age = age;
      }
      next.push(p);
    }
    this.projectiles = next;
    if (s.ti !== this.lastTi) {
      this.lastTi = s.ti;
      const c = t.current;
      if (c) this.camera.focus(c.x, c.cy);
    }
  }

  // 참가자: 보간 표시 + 내 차례 입력 송신
  updateClient(dt) {
    this.effects.update(dt, this.gravity);
    const k = 1 - Math.exp(-dt * 14);
    for (const c of this.chars) {
      if (c.tx == null) continue;
      if (Math.abs(c.tx - c.x) > 150 || Math.abs(c.ty - c.y) > 150) { c.x = c.tx; c.y = c.ty; }
      else { c.x += (c.tx - c.x) * k; c.y += (c.ty - c.y) * k; }
    }
    for (const p of this.projectiles) {
      p.age += dt;
      p.vx += this.wind.accel * (p.wm ?? 1) * dt;
      p.vy += this.gravity * (p.gm ?? 1) * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.trail.push(p.x, p.y);
      if (p.trail.length > 90) p.trail.splice(0, 2);
    }
    if (this.state !== 'playing') return;
    const t = this.turn, c = t.current, inp = this.input.consume();
    if (t.phase === 'aim') t.timer -= dt;
    const mine = c && c.uid === this.myUid && t.phase === 'aim';
    const a = this.cfg.aim;
    if (mine) {
      if (!this.net.active) { this.net.active = true; this.net.angle = c.angle; this.lastTick = 0; }
      this.net.angle = clamp(this.net.angle + inp.aimDragPx * a.dragSensitivity + this.input.angleAxis * a.keySpeed * dt, a.min, a.max);
      c.angle = this.net.angle;
      if (inp.jump) this.net.j++;
      if (inp.skill) this.trySkill(inp.skill);
      this.sync?.send({ a: r1(this.net.angle), l: this.input.left ? 1 : 0, r: this.input.right ? 1 : 0, f: this.input.fire ? 1 : 0, j: this.net.j, s: this.net.s, sl: this.net.sl }, dt);
      const sec = Math.ceil(t.timer);
      if (sec <= 5 && sec > 0 && sec !== this.lastTick) { this.lastTick = sec; this.audio.play('tick'); }
    } else if (this.net.active) {
      this.net.active = false;
      this.sync?.send({ a: r1(this.net.angle), l: 0, r: 0, f: 0, j: this.net.j, s: this.net.s, sl: this.net.sl }, 1);
    }
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
    const c = this.turn.current;
    if (!c) return;
    const usable = this.isMine(c) && this.turn.phase === 'aim' && !this.turn.charging;
    for (const [slot, id] of [[1, 'btn-skill1'], [2, 'btn-skill2'], [3, 'btn-ult']]) {
      const s = skillOf(c, slot), el = $(id);
      let label = s ? s.name : '-';
      const off = !s || !usable || (!canUse(c, slot) && this.armed !== slot);
      if (s && slot < 3 && c.cooldowns[slot - 1] > 0) label += ` (${c.cooldowns[slot - 1]})`;
      const g = Math.floor(c.ult);
      const key = `${c.id}|${label}|${off}|${this.armed === slot}|${slot === 3 ? g : ''}`;
      if (el.dataset.k === key) continue;
      el.dataset.k = key;
      el.textContent = label;
      el.classList.toggle('off', off);
      el.classList.toggle('armed', this.armed === slot);
      if (slot === 3) {
        el.style.setProperty('--g', `${g}%`);
        el.classList.toggle('ready', g >= 100);
      }
    }
  }

  render() {
    const { ctx, dpr, cw, ch, camera: cam, map } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawSky(ctx, this.bg, cw, ch, this.time);
    drawBackground(ctx, cam, this.bg, dpr, map);
    const sh = this.effects.shake;
    cam.apply(ctx, dpr, (Math.random() * 2 - 1) * sh, (Math.random() * 2 - 1) * sh);

    // 맵 아래 허공 표시
    const fog = ctx.createLinearGradient(0, map.height - 80, 0, map.height + 120);
    fog.addColorStop(0, 'rgba(20,24,40,0)');
    fog.addColorStop(1, 'rgba(20,24,40,0.6)');
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

    for (const c of this.chars) c.draw(ctx, this.time);
    if (this.state === 'playing' && this.turn.phase === 'aim') {
      const c = this.turn.current;
      const secs = previewSeconds(c);
      if (secs > 0 && this.isMine(c)) {
        const w = makeWeapon(c, skillOf(c, this.armed));
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
