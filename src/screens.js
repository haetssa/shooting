// 화면(DOM) 관리: 타이틀, 닉네임, 대전 설정, 튜토리얼 시작, 게임 방법, 캐릭터 도감/상세, 온라인 로비/방(강퇴), 결과, 통계, 게임 중 버튼/채팅
import { RANDOM, visibleIndices, resolveChar } from './roster.js';
import { BOT_LABELS } from './bot.js';
import { Online } from './net/online.js';
import { cleanChat } from './net/filter.js';
import { skillOf, blockReason, manaCost } from './skills.js';
import { mulberry32, VERSION, latestVersion } from './util.js';

const STORE_KEY = 'pg.profile.v1';
const SCREENS = ['title', 'name', 'setup', 'help', 'dex', 'lobby', 'room', 'over', 'stats'];
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const TYPE_LABEL = {
  shot: '특수 사격', multi_shot: '다연발', split: '분열', scatter: '흩뿌림', pierce: '관통',
  airstrike: '공중 폭격', build: '지형 생성', teleport: '순간이동', heal: '회복', big_blast: '대폭발',
  homing: '유도', bounce: '튕김', shield: '보호막', global: '전체 공격',
};

function loadStore() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch { return {}; }
}
function withTimeout(p, ms) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
}

export class Screens {
  constructor(game, fbConfig) {
    this.g = game;
    this.fb = fbConfig;
    this.online = null;
    this.store = loadStore();
    this.roomMeta = null;
    this.roomPlayers = {};
    this.byes = {};
    this.kicked = {};
    this.chatCool = 0;
    this.lastStartSeed = null;
    this.bind();
    this.updateSoundLabels();
    if (this.store.nickname) this.show('title');
    else this.showName(true);
  }

  save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(this.store)); } catch { /* 저장 불가 */ }
  }

  get nick() { return this.store.nickname || '플레이어'; }

  bind() {
    const g = this.g, on = (id, fn) => $(id).addEventListener('click', fn);
    // 타이틀
    on('btn-edit-name', () => this.showName(false));
    on('btn-play-local', () => this.showSetup());
    on('btn-tutorial', () => this.startTutorial());
    on('btn-stats-back', () => this.show('title'));
    on('btn-online', () => this.enterOnline());
    on('btn-help', () => this.show('help'));
    on('btn-dex', () => { this.renderDex(); this.show('dex'); });
    on('btn-music', () => { g.audio.setMusic(!g.audio.musicOn); this.updateSoundLabels(); });
    on('btn-sfx', () => { g.audio.setSfx(!g.audio.sfxOn); this.updateSoundLabels(); });
    // 닉네임
    on('btn-name-ok', () => this.confirmName());
    $('name-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') this.confirmName(); });
    // 한 화면 대전 설정
    on('btn-back', () => this.show('title'));
    $('setup-count').querySelectorAll('[data-players]').forEach((b) => b.addEventListener('click', () => {
      this.setupCount = +b.dataset.players;
      this.renderSetup();
    }));
    on('btn-start', () => this.beginFromSetup());
    // 도움말/도감
    on('btn-help-back', () => this.show('title'));
    on('btn-dex-back', () => this.show('title'));
    // 로비/방
    on('btn-lobby-back', () => this.leaveOnline());
    on('btn-create-room', () => this.createRoomDialog());
    on('btn-ready', () => this.toggleReady());
    on('btn-go', () => this.go());
    on('btn-room-leave', () => this.leaveRoomFlow());
    on('btn-room-send', () => this.sendChatFrom('room-chat-input'));
    $('room-chat-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') this.sendChatFrom('room-chat-input'); });
    // 결과
    on('btn-restart', () => this.afterOver());
    // 게임 중
    g.input.bindTap($('btn-sound'), () => {
      const v = !(g.audio.musicOn || g.audio.sfxOn);
      g.audio.setMusic(v);
      g.audio.setSfx(v);
      this.updateSoundLabels();
    });
    g.input.bindTap($('btn-exit'), () => this.exitGame());
    g.input.bindTap($('btn-chat'), () => this.toggleChatBar());
    on('btn-chat-send', () => { this.sendChatFrom('chat-input'); });
    on('btn-chat-close', () => this.toggleChatBar(false));
    $('chat-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') this.sendChatFrom('chat-input'); });
    // 매크로
    for (const boxId of ['room-macros', 'chat-macros']) {
      const box = $(boxId);
      for (const m of g.cfg.chat.macros) {
        const b = document.createElement('button');
        b.className = 'chip small';
        b.textContent = m;
        b.addEventListener('click', () => { this.sendChat(m); if (boxId === 'chat-macros') this.toggleChatBar(false); });
        box.appendChild(b);
      }
    }
  }

  show(name) {
    for (const s of SCREENS) $(`screen-${s}`).classList.toggle('hidden', s !== name);
    if (name === 'title') $('my-name').textContent = this.nick;
  }

  devScreen(name) {
    this.store.nickname ||= '테스트';
    if (name === 'setup') this.showSetup();
    else if (name === 'dex') { this.renderDex(); this.show('dex'); }
    else if (name === 'lobby') this.enterOnline();
    else if (name === 'stats') this.showStats();
    else if (SCREENS.includes(name)) this.show(name);
  }

  // 개발용 자동 온라인 테스트: ?autoonline=host|join&nick=이름
  async devAuto(role, nick) {
    this.store.nickname = nick || (role === 'host' ? '방장' : '참가자');
    await this.enterOnline();
    if (!this.online?.db || $('screen-lobby').classList.contains('hidden')) return;
    if (role === 'host') {
      await this.online.createRoom({ name: '자동테스트', pw: '', map: 'city_01', max: 4, nickname: this.nick, char: 0 });
      this.enterRoom();
      const iv = setInterval(() => {
        const list = this.sortedPlayers();
        if (list.length >= 2 && list.every((p) => p.uid === this.roomMeta?.host || p.ready)) { clearInterval(iv); this.go(); }
      }, 500);
    } else {
      const iv = setInterval(async () => {
        const r = (this.lobbyList || []).find((x) => x.name === '자동테스트' && x.status === 'lobby');
        if (!r) return;
        clearInterval(iv);
        await this.joinRoomFlow(r);
        setTimeout(() => { this.online.setMyPlayer({ ready: true, char: 2 }); this.sendChat('안녕하세요!'); }, 800);
      }, 500);
    }
  }

  updateSoundLabels() {
    const a = this.g.audio;
    $('btn-music').textContent = `🎵 배경음 ${a.musicOn ? '켜짐' : '꺼짐'}`;
    $('btn-sfx').textContent = `🔊 효과음 ${a.sfxOn ? '켜짐' : '꺼짐'}`;
    $('btn-music').classList.toggle('on', a.musicOn);
    $('btn-sfx').classList.toggle('on', a.sfxOn);
    $('btn-sound').textContent = a.musicOn || a.sfxOn ? '🔊' : '🔇';
  }

  // ---------- 공용: 모달, 토스트 ----------

  modal({ title, html, buttons = [{ label: '확인', value: true, primary: true }] }) {
    return new Promise((resolve) => {
      $('modal-title').textContent = title;
      $('modal-body').innerHTML = html;
      const box = $('modal-buttons');
      box.innerHTML = '';
      const close = (v) => { $('modal').classList.add('hidden'); resolve(v); };
      for (const b of buttons) {
        const el = document.createElement('button');
        el.className = b.primary ? 'big slim' : 'chip';
        el.textContent = b.label;
        el.addEventListener('click', () => {
          const v = typeof b.value === 'function' ? b.value() : b.value;
          if (v === undefined) return; // 입력 확인 실패 시 닫지 않음
          close(v);
        });
        box.appendChild(el);
      }
      $('modal').classList.remove('hidden');
      const first = $('modal-body').querySelector('input');
      if (first) setTimeout(() => first.focus(), 50);
    });
  }

  alert(title, msg) {
    return this.modal({ title, html: `<p>${esc(msg)}</p>` });
  }

  confirm(title, msg, yes = '확인', no = '취소') {
    return this.modal({ title, html: `<p>${esc(msg)}</p>`, buttons: [{ label: no, value: false }, { label: yes, value: true, primary: true }] });
  }

  toast(msg) {
    const t = $('toast');
    if (!msg) { t.classList.add('hidden'); return; }
    t.textContent = msg;
    t.classList.remove('hidden');
  }

  // ---------- 닉네임 ----------

  showName(first) {
    $('name-input').value = this.store.nickname || '';
    $('name-hint').textContent = first ? '처음 오셨네요! 게임에서 쓸 닉네임을 정해 주세요.' : '바꿀 닉네임을 입력해 주세요.';
    this.show('name');
  }

  confirmName() {
    const v = cleanChat($('name-input').value, 10);
    if (!v || /^\*+$/.test(v)) { $('name-hint').textContent = '닉네임을 한 글자 이상 입력해 주세요.'; return; }
    this.store.nickname = v;
    this.save();
    $('name-input').blur();
    this.show('title');
  }

  // ---------- 캐릭터 카드 / 상세 ----------

  charCards(container, selected, onSelect, { random = true } = {}) {
    const g = this.g;
    container.innerHTML = '';
    const make = (idx, name, img) => {
      const b = document.createElement('button');
      b.className = 'card' + (selected === idx ? ' on' : '');
      if (img) {
        const im = document.createElement('img');
        im.src = img;
        im.alt = '';
        b.appendChild(im);
      } else {
        const d = document.createElement('div');
        d.className = 'dice';
        d.textContent = '🎲';
        b.appendChild(d);
      }
      const nm = document.createElement('span');
      nm.textContent = name;
      b.appendChild(nm);
      if (idx !== RANDOM) {
        const info = document.createElement('span');
        info.className = 'info';
        info.textContent = 'i';
        info.addEventListener('click', (e) => { e.stopPropagation(); this.showCharDetail(idx); });
        b.appendChild(info);
      }
      b.addEventListener('click', () => onSelect(idx));
      container.appendChild(b);
    };
    for (const i of visibleIndices(g.charDefs)) make(i, g.charDefs[i].name, g.portraitUrls[i]);
    if (random) make(RANDOM, '랜덤', null);
  }

  charSummary(idx) {
    if (idx === RANDOM) return '무작위 캐릭터 · 낮은 확률로 히든 캐릭터가 나와요!';
    const d = this.g.charDefs[idx];
    const sk = (d.skills || []).map((s) => s.name).join(' · ');
    return `${d.passive ? `[${d.passive.name}] ${d.passive.desc}` : d.desc || ''}${sk ? ` / 스킬: ${sk}` : ''}${d.ultimate ? ` / 궁극기: ${d.ultimate.name}` : ''}`;
  }

  showCharDetail(idx) {
    const d = this.g.charDefs[idx];
    const sec = (tag, cls, s, extra = '') => s ? `<div class="dsec"><span class="tag ${cls}">${tag}</span><b>${esc(s.name)}</b>${s.type ? ` <small>${TYPE_LABEL[s.type] || ''}</small>` : ''}<br>${esc(s.desc || '')}${extra}</div>` : '';
    const pv = d.passive, disc = pv?.type === 'skill_discount' ? pv.value : 0;
    const cost = (s) => Math.round((s.mana ?? 35) * (1 - disc));
    const cd = (s) => s ? `<br><small>마나 ${cost(s)}${s.cooldown ? ` · ${s.cooldown}턴에 한 번` : ''}</small>` : '';
    const html = `
      <div class="detail">
        <div class="dtop">
          <img class="dimg" src="${this.g.portraitUrls[idx]}" alt="">
          <div>
            <div class="dname">${esc(d.name)}</div>
            <div class="sub">${esc(d.desc || '')}</div>
            <div class="stats">체력 ${d.hp} · 이동량 ${d.moveFuel} · 기본 공격 ${d.weapon.damage} (폭발 반경 ${d.weapon.radius})</div>
          </div>
        </div>
        ${d.passive ? `<div class="dsec"><span class="tag passive">패시브</span><b>${esc(d.passive.name)}</b><br>${esc(d.passive.desc)}<br><small>항상 적용돼요</small></div>` : ''}
        ${sec('스킬1', '', d.skills?.[0], cd(d.skills?.[0]))}
        ${sec('스킬2', '', d.skills?.[1], cd(d.skills?.[1]))}
        ${sec('궁극기', 'ult', d.ultimate, d.ultimate ? `<br><small>마나 ${cost(d.ultimate)} · 기본 공격으로 상대를 ${this.g.cfg.ult.unlockHits}번 맞히면 해금</small>` : '')}
        <p class="sub">사용법: 스킬 버튼을 누르면 다음 발사에 적용돼요 (다시 누르면 취소). 마나는 시간이 지나면 차고, 상대를 맞히면 더 차요. 게임 중 버튼을 길게 누르면 설명이 떠요.</p>
      </div>`;
    this.modal({ title: '캐릭터 정보', html });
  }

  renderDex() {
    const box = $('dex-grid');
    box.innerHTML = '';
    const g = this.g;
    for (const i of visibleIndices(g.charDefs)) {
      const d = g.charDefs[i];
      const b = document.createElement('button');
      b.className = 'dexcard';
      b.innerHTML = `<img src="${g.portraitUrls[i]}" alt=""><b>${esc(d.name)}</b><small>${esc(d.desc || '')}</small>`;
      b.addEventListener('click', () => this.showCharDetail(i));
      box.appendChild(b);
    }
    const hidden = g.charDefs.filter((d) => d.hidden).length;
    if (hidden) {
      const b = document.createElement('div');
      b.className = 'dexcard secret';
      b.innerHTML = `<div class="dice">❓</div><b>???</b><small>히든 캐릭터 ${hidden}명 · 랜덤 선택 시 낮은 확률로 등장</small>`;
      box.appendChild(b);
    }
  }

  // ---------- 한 화면 대전 설정 ----------

  showSetup() {
    const saved = this.store.players || [];
    const vis = visibleIndices(this.g.charDefs);
    this.setupCount = this.store.playerCount || 2;
    this.setupMap = this.store.map || 'random';
    this.setupPlayers = Array.from({ length: this.g.cfg.maxPlayers }, (_, i) => {
      const c = saved[i]?.char;
      return {
        name: i === 0 ? this.nick : saved[i]?.name || `플레이어 ${i + 1}`,
        char: c === RANDOM || vis.includes(c) ? c : vis[i % vis.length],
        bot: i === 0 ? 0 : saved[i]?.bot || 0,
      };
    });
    this.renderSetup();
    this.show('setup');
  }

  renderMapChips(box, current, onPick) {
    box.innerHTML = '';
    const add = (id, name, title) => {
      const b = document.createElement('button');
      b.className = 'chip small' + (current === id ? ' on' : '');
      b.textContent = name;
      b.title = title || '';
      b.addEventListener('click', () => onPick(id));
      box.appendChild(b);
    };
    add('random', '🎲 랜덤', '');
    for (const m of this.g.maps) add(m.id, m.name, m.desc);
  }

  mapName(id) {
    if (id === 'random') return '랜덤 맵';
    return this.g.maps.find((m) => m.id === id)?.name || id;
  }

  renderSetup() {
    $('setup-count').querySelectorAll('[data-players]').forEach((b) => b.classList.toggle('on', +b.dataset.players === this.setupCount));
    this.renderMapChips($('setup-maps'), this.setupMap, (id) => { this.setupMap = id; this.renderSetup(); });
    const m = this.g.maps.find((x) => x.id === this.setupMap);
    $('setup-map-desc').textContent = m ? m.desc : `${this.g.maps.length}개 맵 중 무작위`;
    const box = $('player-rows');
    box.innerHTML = '';
    for (let i = 0; i < this.setupCount; i++) {
      const p = this.setupPlayers[i];
      const row = document.createElement('div');
      row.className = 'prow';
      const dot = document.createElement('span');
      dot.className = 'pdot';
      dot.style.background = this.g.colors[i];
      const who = document.createElement('div');
      who.className = 'pwho';
      const inp = document.createElement('input');
      inp.maxLength = 10;
      inp.value = p.name;
      inp.placeholder = `플레이어 ${i + 1}`;
      inp.addEventListener('input', () => { p.name = inp.value; });
      const botBtn = document.createElement('button');
      botBtn.className = 'chip small botbtn' + (p.bot ? ' on' : '');
      botBtn.textContent = BOT_LABELS[p.bot || 0];
      botBtn.addEventListener('click', () => { p.bot = ((p.bot || 0) + 1) % BOT_LABELS.length; this.renderSetup(); });
      who.append(inp, botBtn);
      const cards = document.createElement('div');
      cards.className = 'cards';
      this.charCards(cards, p.char, (idx) => { p.char = idx; this.renderSetup(); });
      const desc = document.createElement('div');
      desc.className = 'pdesc';
      desc.textContent = this.charSummary(p.char);
      row.append(dot, who, cards, desc);
      box.appendChild(row);
    }
  }

  beginFromSetup() {
    const g = this.g;
    const players = this.setupPlayers.slice(0, this.setupCount).map((p, i) => ({
      name: cleanChat(p.name, 10) || `플레이어 ${i + 1}`,
      char: resolveChar(g.charDefs, p.char, Math.random, g.cfg.hiddenChance),
      bot: p.bot || 0,
    }));
    this.store.playerCount = this.setupCount;
    this.store.map = this.setupMap;
    this.store.players = this.setupPlayers.map((p) => ({ name: p.name, char: p.char, bot: p.bot || 0 }));
    this.save();
    requestFullscreenLandscape();
    g.startMatch(players, { mapId: this.setupMap });
    this.announceHidden(players.map((p) => p.char));
  }

  startTutorial() {
    const vis = visibleIndices(this.g.charDefs);
    const ch = vis.includes(this.store.lastChar) ? this.store.lastChar : vis[0];
    requestFullscreenLandscape();
    this.g.startTutorial(ch);
  }

  announceHidden(chars) {
    const g = this.g;
    const hid = chars.filter((ci) => g.charDefs[ci]?.hidden);
    if (hid.length) setTimeout(() => g.hud.showBanner(`히든 캐릭터 ${g.charDefs[hid[0]].name} 등장!`, '#ffd23f'), 1800);
  }

  // ---------- 게임 화면 진입/종료 ----------

  enterGame() {
    for (const s of SCREENS) $(`screen-${s}`).classList.add('hidden');
    $('modal').classList.add('hidden');
    $('controls').classList.remove('hidden');
    $('btn-chat').classList.toggle('hidden', this.g.mode === 'local');
    this.toggleChatBar(false);
  }

  leaveGame() {
    $('controls').classList.add('hidden');
    this.toggleChatBar(false);
    this.hideSkillTip();
  }

  showOver(winner) {
    const el = $('over-title');
    el.textContent = winner ? `${winner.name} 승리!` : '무승부';
    el.style.color = winner ? winner.color : '#fff';
    $('over-sub').textContent = winner ? winner.charName : '';
    if (this.g.tutorial) {
      const me = winner && !winner.isBot;
      el.textContent = me ? '튜토리얼 완료! 🎉' : '아쉬워요! 다시 도전해 보세요';
      $('over-sub').textContent = me ? '이제 온라인 대전이나 봇 대전을 즐겨 보세요' : '';
    }
    const online = this.g.mode !== 'local';
    $('btn-restart').textContent = online ? '방으로 돌아가기' : '처음으로';
    $('controls').classList.add('hidden');
    setTimeout(() => { if (this.g.state === 'over') this.show('over'); }, 900);
    if (this.g.mode === 'host') {
      setTimeout(() => {
        if (!this.online?.room?.host) return;
        this.online.endGame();
        this.online.resetReady(Object.keys(this.roomPlayers));
      }, 4000);
    }
    // 온라인: 4초 뒤 전원 방으로 자동 복귀 (버튼으로 먼저 돌아가도 됨)
    if (online) setTimeout(() => { if (this.g.state === 'over' && this.online?.room) this.afterOver(); }, 4300);
  }

  afterOver() {
    const online = this.g.mode !== 'local' && this.online?.room;
    this.g.stopMatch();
    if (online) { this.show('room'); this.renderRoom(); } else this.show('title');
  }

  async exitGame() {
    const g = this.g;
    const online = g.mode !== 'local';
    const host = g.mode === 'host';
    const msg = !online ? '게임을 그만두고 처음 화면으로 갈까요?'
      : host ? '방장이 나가면 게임이 끝나고 다른 플레이어도 연결이 끊겨요. 나갈까요?'
        : '지금 나가면 내 캐릭터는 바로 탈락해요. 나갈까요?';
    const ok = await this.confirm('게임 나가기', msg, '나가기');
    if (!ok) return;
    if (online) await this.leaveRoomFlow();
    else { g.stopMatch(); this.show('title'); }
  }

  showSkillTip(el, slot) {
    const t = this.g.turn, c = t?.current;
    const s = c && skillOf(c, slot);
    if (!s) return;
    const why = blockReason(c, slot);
    const extra = `마나 ${manaCost(c, slot)}${slot === 3 ? ` · 기본 공격 ${c.ultNeed}번 적중 시 해금` : ''}${why ? `<br>⛔ ${esc(why)}` : ''}`;
    const tip = $('skill-tip');
    tip.innerHTML = `<b>${esc(s.name)}</b><br>${esc(s.desc || '')}<br><small>${extra}</small>`;
    const r = el.getBoundingClientRect();
    tip.style.right = `${window.innerWidth - r.left + 8}px`;
    tip.style.top = `${Math.max(8, r.top - 10)}px`;
    tip.classList.remove('hidden');
  }

  hideSkillTip() { $('skill-tip').classList.add('hidden'); }

  // ---------- 채팅 ----------

  toggleChatBar(force) {
    const bar = $('chatbar');
    const open = force ?? bar.classList.contains('hidden');
    bar.classList.toggle('hidden', !open);
    if (!open) $('chat-input').blur();
  }

  sendChatFrom(inputId) {
    const inp = $(inputId);
    if (this.sendChat(inp.value)) inp.value = '';
    if (inputId === 'chat-input') this.toggleChatBar(false);
  }

  sendChat(raw) {
    if (!this.online?.room) return false;
    const now = performance.now() / 1000;
    if (now - this.chatCool < this.g.cfg.chat.cooldown) { this.toast('채팅은 조금 천천히 보내 주세요'); setTimeout(() => this.toast(null), 1200); return false; }
    const text = cleanChat(raw, this.g.cfg.chat.maxLength);
    if (!text) return false;
    this.chatCool = now;
    this.online.sendChat(this.nick, text);
    return true;
  }

  onChat(msg) {
    if (!msg || typeof msg.t !== 'string') return;
    const text = cleanChat(msg.t, this.g.cfg.chat.maxLength);
    const log = $('room-chat-log');
    const line = document.createElement('div');
    line.className = msg.s ? 'sys' : '';
    line.innerHTML = msg.s ? esc(text) : `<b>${esc(msg.n)}</b> ${esc(text)}`;
    log.appendChild(line);
    while (log.children.length > 60) log.firstChild.remove();
    log.scrollTop = log.scrollHeight;
    if (this.g.mode !== 'local' && (this.g.state === 'playing' || this.g.state === 'over')) this.g.say(msg.u, msg.n, text, !!msg.s);
  }

  // ---------- 온라인: 로비 ----------

  // 서버에 새 버전이 올라왔으면 새로고침 안내 (온라인은 모두 같은 버전이어야 함)
  async checkUpdate() {
    if (VERSION === 'dev') return false;
    const lv = await latestVersion();
    if (!lv || lv === VERSION) return false;
    await this.modal({
      title: '새 버전이 나왔어요',
      html: '<p>게임이 업데이트되었어요. 새로고침해서 최신 버전을 받아 주세요.</p>',
      buttons: [{ label: '새로고침', primary: true, value: true }],
    });
    location.reload();
    return true;
  }

  async enterOnline() {
    if (!this.fb) return this.alert('온라인 사용 불가', 'Firebase 설정 파일(data/firebase.json)이 없어요.');
    if (await this.checkUpdate()) return;
    if (!this.online) this.online = new Online(this.g.cfg.online, this.fb);
    this.show('lobby');
    $('room-list').innerHTML = '<p class="sub">서버에 연결하는 중…</p>';
    $('lobby-count').textContent = '';
    let res;
    try {
      res = await withTimeout(this.online.connect(), 12000);
    } catch (e) {
      console.error(e);
      this.show('title');
      const denied = String(e?.message || e).toLowerCase().includes('permission');
      return this.alert('연결 실패', denied ? '서버 권한 설정이 아직 안 되어 있어요. (관리자: Firebase 보안 규칙을 확인해 주세요)' : '서버에 연결하지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.');
    }
    if (res.full) {
      this.show('title');
      return this.alert('접속 제한', `서버에 사람이 많아 접속이 제한됩니다. (현재 ${res.count}명) 잠시 후 다시 시도해 주세요.`);
    }
    this.online.watchPresence((n) => { $('lobby-count').textContent = `현재 접속 ${n}명`; });
    let lostTimer = null;
    this.online.watchConnected((ok) => {
      clearTimeout(lostTimer);
      if (ok) this.toast(null);
      else lostTimer = setTimeout(() => this.toast('서버 연결이 불안정해요… 다시 연결하는 중'), 2500);
    });
    this.online.watchLobby((list) => this.renderLobby(list));
  }

  async leaveOnline() {
    this.toast(null);
    await this.online?.disconnect().catch(() => {});
    this.show('title');
  }

  renderLobby(list) {
    this.lobbyList = list;
    const box = $('room-list');
    if (!list.length) { box.innerHTML = '<p class="sub">아직 방이 없어요. 방을 만들어 보세요!</p>'; return; }
    box.innerHTML = '';
    for (const r of list) {
      const row = document.createElement('button');
      row.className = 'roomrow' + (r.status !== 'lobby' || r.count >= r.max ? ' full' : '');
      row.innerHTML = `<span class="rname">${r.hasPw ? '🔒 ' : ''}${esc(r.name)}</span>
        <span class="rmap">${esc(this.mapName(r.map))}</span>
        <span class="rcount">${r.count || 0}/${r.max}</span>
        <span class="rstat ${r.status === 'lobby' ? 'wait' : 'play'}">${r.status === 'lobby' ? '대기 중' : '게임 중'}</span>`;
      row.addEventListener('click', () => this.joinRoomFlow(r));
      box.appendChild(row);
    }
  }

  async createRoomDialog() {
    const g = this.g;
    const maxOpts = [2, 3, 4, 5, 6].filter((n) => n <= g.cfg.online.roomMax).map((n) => `<option value="${n}" ${n === 4 ? 'selected' : ''}>${n}명</option>`).join('');
    const mapOpts = [`<option value="random">🎲 랜덤 맵</option>`, ...g.maps.map((m) => `<option value="${m.id}">${esc(m.name)} · ${esc(m.desc)}</option>`)].join('');
    const html = `
      <div class="form">
        <label>방 이름<input id="f-name" maxlength="20" value="${esc(this.nick)}의 방"></label>
        <label>비밀번호 <small>(비우면 공개방)</small><input id="f-pw" maxlength="12" placeholder="없음"></label>
        <label>맵<select id="f-map">${mapOpts}</select></label>
        <label>최대 인원<select id="f-max">${maxOpts}</select></label>
        <p id="f-err" class="err"></p>
      </div>`;
    const res = await this.modal({
      title: '방 만들기', html,
      buttons: [
        { label: '취소', value: null },
        {
          label: '만들기', primary: true, value: () => {
            const name = cleanChat($('f-name').value, 20);
            if (!name) { $('f-err').textContent = '방 이름을 입력해 주세요.'; return undefined; }
            return { name, pw: $('f-pw').value.trim(), map: $('f-map').value, max: +$('f-max').value };
          },
        },
      ],
    });
    if (!res) return;
    try {
      await this.online.createRoom({ ...res, nickname: this.nick, char: this.store.lastChar ?? RANDOM });
      this.enterRoom();
    } catch (e) {
      console.error(e);
      this.alert('방 만들기 실패', '방을 만들지 못했어요. 잠시 후 다시 시도해 주세요.');
    }
  }

  async joinRoomFlow(r) {
    if (r.status !== 'lobby') return this.alert('입장 불가', '이미 게임이 진행 중인 방이에요.');
    if ((r.count || 0) >= r.max) return this.alert('입장 불가', '방이 가득 찼어요.');
    let pw = '';
    if (r.hasPw) {
      pw = await this.modal({
        title: '비밀번호 입력',
        html: `<div class="form"><label>🔒 ${esc(r.name)}<input id="f-join-pw" maxlength="12" placeholder="비밀번호"></label></div>`,
        buttons: [{ label: '취소', value: null }, { label: '입장', primary: true, value: () => $('f-join-pw').value }],
      });
      if (pw == null) return;
    }
    const res = await this.online.joinRoom(r.id, pw, this.nick, this.store.lastChar ?? RANDOM).catch((e) => ({ error: String(e) }));
    if (res.update) { if (await this.checkUpdate()) return; }
    if (res.error) return this.alert('입장 실패', res.error);
    this.enterRoom();
  }

  // ---------- 온라인: 방 ----------

  enterRoom() {
    const on = this.online;
    this.roomMeta = null;
    this.roomPlayers = {};
    this.byes = {};
    this.kicked = {};
    this.myChar = this.store.lastChar ?? RANDOM;
    $('room-chat-log').innerHTML = '';
    on.watchRoom({
      meta: (m) => this.onRoomMeta(m),
      players: (p) => this.onRoomPlayers(p),
      chat: (msg) => this.onChat(msg),
      bye: (b) => { this.byes = b; },
      kicked: (k) => this.onKicked(k),
    });
    on.watchGameStart((start) => this.onGameStart(start));
    on.sendChat(this.nick, `${this.nick}님이 입장했습니다.`, true);
    this.show('room');
  }

  onKicked(k) {
    this.kicked = k;
    const on = this.online;
    if (!on?.room || on.room.host || !k[on.uid]) return;
    const inGame = this.g.mode !== 'local';
    on.dropRoom();
    if (inGame) this.g.stopMatch();
    this.show('lobby');
    this.alert('강퇴', '방장에 의해 강퇴되었어요.');
  }

  onRoomMeta(m) {
    if (!m) return this.roomClosed();
    this.roomMeta = m;
    this.renderRoom();
  }

  roomClosed() {
    const g = this.g;
    const inGame = g.mode !== 'local';
    const on = this.online;
    on.unwatchRoom();
    on.unwatchGame();
    on.room = null;
    if (inGame) g.stopMatch();
    this.show('lobby');
    this.alert('연결 종료', inGame ? '방장이 게임을 종료해서 다른 플레이어의 접속이 끊겼습니다.' : '방장이 방을 나가서 방이 사라졌어요.');
  }

  onRoomPlayers(p) {
    const g = this.g, on = this.online;
    this.roomPlayers = p;
    if (on.room?.host) {
      on.setMeta({ count: Object.keys(p).length });
      if (g.mode === 'host' && g.state === 'playing') {
        for (const c of g.chars) {
          if (c.uid && !p[c.uid] && !c.fellOut) g.eliminate(c, this.kicked[c.uid] ? `${c.name}님이 강퇴되었습니다` : this.byes[c.uid] ? `${c.name}님이 나갔습니다` : `${c.name}님이 강제종료했습니다`);
        }
      }
    }
    this.renderRoom();
  }

  sortedPlayers() {
    return Object.entries(this.roomPlayers)
      .map(([uid, p]) => ({ uid, ...p }))
      .sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0));
  }

  renderRoom() {
    const m = this.roomMeta, on = this.online;
    if (!m || !on?.room) return;
    const g = this.g, host = on.room.host;
    $('room-title').textContent = `${m.hasPw ? '🔒 ' : ''}${m.name}`;
    const list = this.sortedPlayers();
    $('room-info').textContent = `${this.mapName(m.map)} · ${list.length}/${m.max}명${m.status === 'playing' ? ' · 게임 진행 중' : ''}`;
    const box = $('room-players');
    box.innerHTML = '';
    list.forEach((p, i) => {
      const row = document.createElement('div');
      row.className = 'rp';
      const ci = p.char ?? RANDOM;
      const img = ci === RANDOM || !g.portraitUrls[ci] ? '<div class="dice small">🎲</div>' : `<img src="${g.portraitUrls[ci]}" alt="">`;
      const isHost = p.uid === m.host;
      const state = isHost ? '<span class="badge host">방장</span>' : p.ready ? '<span class="badge ready">준비 완료</span>' : '<span class="badge wait">대기 중</span>';
      row.innerHTML = `<span class="pdot" style="background:${g.colors[i % g.colors.length]}"></span>${img}
        <span class="rpname">${isHost ? '👑 ' : ''}${esc(p.name)}${p.uid === on.uid ? ' <small>(나)</small>' : ''}<br><small>${ci === RANDOM ? '랜덤' : esc(g.charDefs[ci]?.name || '')}</small></span>${state}`;
      if (host && !isHost && m.status !== 'playing') {
        const kb = document.createElement('button');
        kb.className = 'chip small kick';
        kb.textContent = '강퇴';
        kb.addEventListener('click', async () => {
          if (!(await this.confirm('강퇴', `${p.name}님을 강퇴할까요? 이 방에 다시 들어올 수 없어요.`, '강퇴'))) return;
          on.sendChat(this.nick, `${p.name}님이 강퇴되었습니다.`, true);
          on.kick(p.uid);
        });
        row.appendChild(kb);
      }
      box.appendChild(row);
    });
    const me = this.roomPlayers[on.uid];
    if (me && me.char !== undefined) this.myChar = me.char;
    const locked = !host && !!me?.ready;
    $('room-cards').classList.toggle('locked', locked);
    this.charCards($('room-cards'), this.myChar, (idx) => {
      if (locked) { this.toast('준비를 취소해야 캐릭터를 바꿀 수 있어요'); setTimeout(() => this.toast(null), 1500); return; }
      this.myChar = idx;
      this.store.lastChar = idx;
      this.save();
      on.setMyPlayer({ char: idx });
      this.renderRoom();
    });
    $('room-char-desc').textContent = (locked ? '🔒 준비 완료 상태에서는 캐릭터를 바꿀 수 없어요 · ' : '') + this.charSummary(this.myChar);
    const mapBox = $('room-maps');
    if (host) {
      this.renderMapChips(mapBox, m.map, (id) => on.setMeta({ map: id }));
    } else {
      mapBox.innerHTML = `<span class="sub">맵: ${esc(this.mapName(m.map))} (방장이 선택)</span>`;
    }
    const playing = m.status === 'playing';
    $('btn-go').classList.toggle('hidden', !host);
    $('btn-ready').classList.toggle('hidden', host);
    const allReady = list.length >= 2 && list.every((p) => p.uid === m.host || p.ready);
    $('btn-go').disabled = !allReady || playing;
    $('btn-go').textContent = list.length < 2 ? '2명 이상 필요' : allReady ? 'GO!' : '준비 기다리는 중';
    $('btn-ready').disabled = playing;
    $('btn-ready').textContent = me?.ready ? '준비 취소' : '준비';
    $('btn-ready').classList.toggle('on', !!me?.ready);
  }

  toggleReady() {
    const me = this.roomPlayers[this.online.uid];
    this.online.setMyPlayer({ ready: !me?.ready });
  }

  async go() {
    const g = this.g, on = this.online, m = this.roomMeta;
    const list = this.sortedPlayers();
    if (list.length < 2) return this.alert('시작할 수 없어요', '2명 이상 있어야 시작할 수 있어요.');
    if (list.some((p) => p.uid !== m.host && !p.ready)) return this.alert('시작할 수 없어요', '모든 플레이어가 준비해야 시작할 수 있어요.');
    const seed = (Math.random() * 2 ** 32) >>> 0;
    const rng = mulberry32(seed ^ 0x9e3779b9);
    const players = list.map((p) => ({ uid: p.uid, name: p.name, char: resolveChar(g.charDefs, p.char ?? RANDOM, rng, g.cfg.hiddenChance) }));
    let map = m.map;
    if (map === 'random' || !g.maps.find((x) => x.id === map)) map = g.maps[Math.floor(rng() * g.maps.length)].id;
    requestFullscreenLandscape();
    await on.startGame({ seed, map, players, at: Date.now() }).catch((e) => {
      console.error(e);
      this.alert('시작 실패', '게임을 시작하지 못했어요. 다시 시도해 주세요.');
    });
  }

  onGameStart(start) {
    if (!start || !this.online?.room) return;
    if (this.lastStartSeed === start.seed) return;
    this.lastStartSeed = start.seed;
    const mode = this.online.room.host ? 'host' : 'client';
    if (mode === 'client') requestFullscreenLandscape();
    this.g.startOnline(start, mode, this.online);
    this.announceHidden(start.players.map((p) => p.char));
  }

  // ---------- 통계 (캐릭터별 승률) ----------

  // 방장: 온라인 경기 결과 기록 (사람 2명 이상, 개발용 봇 경기는 제외)
  recordStats(g, winner) {
    if (!g.cfg.stats?.enabled || !this.online?.room?.host || g.devOnlineBots) return;
    if (g.chars.length < 2) return;
    this.online.recordMatch({
      v: VERSION, bv: g.balanceVersion, map: g.map.id,
      p: g.chars.map((c) => ({ c: c.def.id, w: c === winner ? 1 : 0, d: c.dealt })),
    }).catch((e) => console.warn('통계 기록 실패', e));
  }

  async showStats() {
    this.show('stats');
    const box = $('stats-body');
    box.innerHTML = '<p class="sub">불러오는 중…</p>';
    if (!this.fb) { box.innerHTML = '<p class="sub">Firebase 설정이 없어요.</p>'; return; }
    if (!this.online) this.online = new Online(this.g.cfg.online, this.fb);
    let rows;
    try { rows = await withTimeout(this.online.fetchStats(), 12000); } catch (e) {
      console.error(e);
      box.innerHTML = '<p class="sub">불러오지 못했어요. (Firebase 보안 규칙에 stats 항목이 있는지 확인)</p>';
      return;
    }
    this.statsRows = rows;
    this.renderStats(String(this.g.balanceVersion));
  }

  renderStats(filter) {
    const g = this.g, rows = this.statsRows || [];
    const vers = [...new Set(rows.map((r) => String(r.bv ?? '?')))].sort();
    const sel = rows.filter((r) => filter === 'all' || String(r.bv ?? '?') === filter);
    const agg = {};
    for (const d of g.charDefs) agg[d.id] = { name: d.name, n: 0, w: 0, dmg: 0 };
    for (const r of sel) {
      for (const p of r.p || []) {
        const a = agg[p.c] || (agg[p.c] = { name: p.c, n: 0, w: 0, dmg: 0 });
        a.n++;
        a.w += p.w ? 1 : 0;
        a.dmg += p.d || 0;
      }
    }
    const list = Object.values(agg).sort((a, b) => (b.n ? b.w / b.n : -1) - (a.n ? a.w / a.n : -1));
    const opts = ['all', ...vers].map((v) => `<button class="chip small ${v === filter ? 'on' : ''}" data-v="${esc(v)}">${v === 'all' ? '전체' : `밸런스 v${esc(v)}`}</button>`).join('');
    $('stats-body').innerHTML = `
      <div class="row wrap">${opts}</div>
      <p class="sub">온라인 경기 ${sel.length}판 기준 · 판수가 적으면(10판 미만) 참고만 하세요</p>
      <table class="stats"><tr><th>캐릭터</th><th>판수</th><th>승</th><th>승률</th><th>평균 피해</th></tr>
      ${list.map((a) => `<tr><td>${esc(a.name)}</td><td>${a.n}</td><td>${a.w}</td><td>${a.n ? Math.round((a.w / a.n) * 100) + '%' : '-'}</td><td>${a.n ? Math.round(a.dmg / a.n) : '-'}</td></tr>`).join('')}
      </table>`;
    $('stats-body').querySelectorAll('[data-v]').forEach((b) => b.addEventListener('click', () => this.renderStats(b.dataset.v)));
  }

  async leaveRoomFlow() {
    const g = this.g, on = this.online;
    if (!on?.room) return;
    if (!on.room.host) await on.sendChat(this.nick, `${this.nick}님이 나갔습니다.`, true).catch(() => {});
    await on.leaveRoom();
    if (g.mode !== 'local') g.stopMatch();
    this.show('lobby');
  }
}

export function requestFullscreenLandscape() {
  if (!matchMedia('(pointer: coarse)').matches) return; // 모바일에서만
  const el = document.documentElement;
  try {
    const p = el.requestFullscreen ? el.requestFullscreen() : el.webkitRequestFullscreen?.();
    Promise.resolve(p).then(() => screen.orientation?.lock?.('landscape')).catch(() => {});
  } catch { /* 지원 안 함 */ }
}
