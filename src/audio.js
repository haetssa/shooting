// 사운드: 파일 없이 Web Audio로 효과음과 배경음(칩튠)을 합성한다.
// 모바일은 첫 터치 전에는 소리를 낼 수 없어서 unlock()을 터치/키 입력 때 호출한다.
// 음원 파일로 바꾸고 싶으면 config.json 의 audio.music.{menu,battle} 에 mp3 경로를 넣으면 그 파일을 반복 재생한다.

const PREF_KEY = 'pg.audio.v1';
const NOTE = (m) => 440 * Math.pow(2, (m - 69) / 12);
const CHORD = { M: [0, 4, 7, 12], m: [0, 3, 7, 12] };

// 마디마다 [근음 MIDI, 장/단조], melody = [16분음표 위치, 화음 구성음 번호, 길이(16분음표)]
const SONGS = {
  menu: {
    bpm: 92,
    chords: [[60, 'M'], [57, 'm'], [53, 'M'], [55, 'M']],
    drums: false,
    arpEvery: 2, arpType: 'triangle', arpVol: 0.13,
    arp: [0, 1, 2, 1, 3, 1, 2, 1],
    bass: [0, 8],
    melody: [
      [[0, 2, 4], [6, 1, 2], [8, 3, 6]],
      [[0, 1, 3], [4, 2, 2], [8, 0, 6], [14, 1, 2]],
    ],
    leadType: 'triangle', leadVol: 0.16,
  },
  battle: {
    bpm: 132,
    chords: [[57, 'm'], [53, 'M'], [48, 'M'], [55, 'M']],
    drums: true,
    arpEvery: 1, arpType: 'square', arpVol: 0.045,
    arp: [0, 2, 1, 2, 0, 2, 1, 3, 0, 2, 1, 2, 3, 2, 1, 0],
    bass: [0, 3, 6, 8, 11, 14],
    melody: [
      [[0, 3, 3], [3, 2, 1], [4, 1, 2], [6, 2, 2], [8, 3, 4], [12, 2, 2], [14, 1, 2]],
      [[0, 2, 2], [2, 3, 2], [4, 2, 2], [6, 1, 2], [8, 0, 6], [14, 1, 2]],
    ],
    leadType: 'square', leadVol: 0.07,
  },
};

export class GameAudio {
  constructor(cfg = {}) {
    this.cfg = cfg;
    this.ctx = null;
    this.musicOn = true;
    this.sfxOn = true;
    try {
      const p = JSON.parse(localStorage.getItem(PREF_KEY));
      if (p) { this.musicOn = p.music !== false; this.sfxOn = p.sfx !== false; }
    } catch { /* 저장소 사용 불가 */ }
    this.want = null;
    this.track = null;
    this.timer = null;
    this.fileMusic = null;
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) this.ctx.suspend(); else this.ctx.resume();
      if (this.fileMusic) { if (document.hidden) this.fileMusic.pause(); else if (this.musicOn) this.fileMusic.play().catch(() => {}); }
    });
  }

  savePrefs() {
    try { localStorage.setItem(PREF_KEY, JSON.stringify({ music: this.musicOn, sfx: this.sfxOn })); } catch { /* 무시 */ }
  }

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.8;
      this.master.connect(this.ctx.destination);
      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = 0.55;
      this.musicGain.connect(this.master);
      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.value = 0.7;
      this.sfxGain.connect(this.master);
      const len = this.ctx.sampleRate * 2;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    if (this.want && this.track !== this.want) this.playMusic(this.want);
  }

  setMusic(on) {
    this.musicOn = on;
    this.savePrefs();
    if (on) { const w = this.want; this.track = null; if (w) this.playMusic(w); } else this.stopMusic();
  }

  setSfx(on) {
    this.sfxOn = on;
    this.savePrefs();
    if (!on) this.chargeStop();
  }

  // ---------- 배경음 ----------

  playMusic(name) {
    this.want = name;
    if (!this.ctx || !this.musicOn || this.track === name) return;
    this.stopMusic();
    this.track = name;
    const file = this.cfg.music?.[name];
    if (file) {
      this.fileMusic = new Audio(file);
      this.fileMusic.loop = true;
      this.fileMusic.volume = 0.5;
      this.fileMusic.play().catch(() => {});
      return;
    }
    this.step = 0;
    this.nextTime = this.ctx.currentTime + 0.1;
    this.timer = setInterval(() => this.schedule(), 25);
  }

  stopMusic() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.fileMusic) { this.fileMusic.pause(); this.fileMusic = null; }
    this.track = null;
  }

  schedule() {
    const song = SONGS[this.track];
    if (!song || !this.ctx) return;
    const spb = 60 / song.bpm / 4;
    while (this.nextTime < this.ctx.currentTime + 0.15) {
      this.playStep(song, this.step, this.nextTime, spb);
      this.nextTime += spb;
      this.step = (this.step + 1) % (song.chords.length * 16 * 2);
    }
  }

  playStep(song, step, t, spb) {
    const bar = Math.floor(step / 16), s = step % 16;
    const [root, q] = song.chords[bar % song.chords.length];
    const tones = CHORD[q].map((i) => root + i);
    const out = this.musicGain;
    if (song.bass.includes(s)) this.tone(NOTE(root - 12), spb * 1.7, { type: 'triangle', vol: 0.32, at: t, out });
    if (s % song.arpEvery === 0) {
      const idx = song.arp[(s / song.arpEvery) % song.arp.length];
      this.tone(NOTE(tones[idx] + 12), spb * song.arpEvery * 0.9, { type: song.arpType, vol: song.arpVol, at: t, out });
    }
    const mel = song.melody[(bar >> 1) % song.melody.length];
    for (const [ms, ti, len] of mel) {
      if (ms === s) this.tone(NOTE(tones[ti] + 24), spb * len * 0.95, { type: song.leadType, vol: song.leadVol, at: t, out, attack: 0.01 });
    }
    if (song.drums) {
      if (s % 4 === 0) this.tone(140, 0.12, { type: 'sine', vol: 0.55, slide: 45, at: t, out });
      if (s === 4 || s === 12) this.noise(0.1, { filter: 'bandpass', freq: 1800, vol: 0.22, at: t, out });
      if (s % 2 === 0) this.noise(0.03, { filter: 'highpass', freq: 7000, vol: 0.07, at: t, out });
    }
  }

  // ---------- 효과음 ----------

  tone(freq, dur, o = {}) {
    const c = this.ctx, t = o.at ?? c.currentTime;
    const osc = c.createOscillator(), g = c.createGain();
    osc.type = o.type || 'square';
    osc.frequency.setValueAtTime(freq, t);
    if (o.slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.slide), t + dur);
    const v = o.vol ?? 0.3;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + (o.attack ?? 0.005));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(o.out || this.sfxGain);
    osc.start(t);
    osc.stop(t + dur + 0.03);
  }

  noise(dur, o = {}) {
    const c = this.ctx, t = o.at ?? c.currentTime;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = c.createBiquadFilter();
    f.type = o.filter || 'lowpass';
    f.frequency.setValueAtTime(o.freq || 1000, t);
    if (o.freqTo) f.frequency.exponentialRampToValueAtTime(o.freqTo, t + dur);
    f.Q.value = o.q ?? 1;
    const g = c.createGain();
    g.gain.setValueAtTime(o.vol ?? 0.3, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(o.out || this.sfxGain);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.03);
  }

  play(name, arg) {
    if (!this.ctx || !this.sfxOn || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime;
    const seq = (notes, step, o) => notes.forEach((f, i) => this.tone(f, o.dur ?? 0.12, { ...o, at: t + i * step }));
    switch (name) {
      case 'click': this.tone(880, 0.05, { vol: 0.1 }); break;
      case 'arm': this.tone(660, 0.07, { vol: 0.14 }); this.tone(990, 0.09, { vol: 0.14, at: t + 0.06 }); break;
      case 'ult':
        seq([523, 659, 784, 1047], 0.06, { vol: 0.16, dur: 0.14 });
        this.noise(0.5, { filter: 'highpass', freq: 3000, vol: 0.08 });
        break;
      case 'jump': this.tone(330, 0.14, { vol: 0.1, slide: 700 }); break;
      case 'throw': this.noise(0.18, { filter: 'bandpass', freq: 600, freqTo: 2400, q: 2, vol: 0.35 }); break;
      case 'boom': {
        const k = Math.min(1.6, (arg || 40) / 45);
        this.noise(0.45 * k + 0.2, { filter: 'lowpass', freq: 1600, freqTo: 120, vol: 0.7 });
        this.tone(110, 0.35 * k, { type: 'sine', vol: 0.7, slide: 35 });
        break;
      }
      case 'void':
        this.tone(500, 0.6, { type: 'sawtooth', vol: 0.12, slide: 50 });
        this.tone(80, 0.6, { type: 'sine', vol: 0.6, slide: 30 });
        this.noise(0.5, { filter: 'lowpass', freq: 800, freqTo: 100, vol: 0.35 });
        break;
      case 'hit': this.tone(260, 0.12, { vol: 0.16, slide: 120 }); break;
      case 'ko': seq([440, 370, 311, 220], 0.11, { vol: 0.15, dur: 0.16 }); break;
      case 'thud': this.tone(120, 0.12, { type: 'sine', vol: 0.4, slide: 60 }); this.noise(0.08, { freq: 500, vol: 0.2 }); break;
      case 'turn': this.tone(784, 0.1, { type: 'triangle', vol: 0.22 }); this.tone(1175, 0.16, { type: 'triangle', vol: 0.22, at: t + 0.09 }); break;
      case 'tick': this.tone(1500, 0.04, { vol: 0.07 }); break;
      case 'heal': seq([523, 659, 784, 1047, 1319], 0.05, { type: 'triangle', vol: 0.17 }); break;
      case 'warp': this.tone(300, 0.35, { type: 'sine', vol: 0.25, slide: 1400 }); this.tone(1400, 0.3, { type: 'sine', vol: 0.14, slide: 300, at: t + 0.2 }); break;
      case 'build': this.noise(0.25, { freq: 400, vol: 0.45 }); this.tone(90, 0.2, { type: 'sine', vol: 0.5, slide: 60 }); break;
      case 'split': this.tone(900, 0.08, { vol: 0.12 }); this.tone(600, 0.08, { vol: 0.12, at: t + 0.05 }); break;
      case 'fall': this.tone(900, 0.9, { type: 'sine', vol: 0.18, slide: 120 }); break;
      case 'win': seq([523, 659, 784, 1047, 784, 1047], 0.13, { vol: 0.16, dur: 0.16 }); break;
    }
  }

  chargeStart() {
    if (!this.ctx || !this.sfxOn || this.chargeOsc || this.ctx.state !== 'running') return;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = 'triangle';
    o.frequency.value = 220;
    g.gain.value = 0.05;
    o.connect(g).connect(this.sfxGain);
    o.start();
    this.chargeOsc = o;
    this.chargeGain = g;
  }

  chargeSet(p) {
    if (this.chargeOsc) this.chargeOsc.frequency.setTargetAtTime(220 + p * 6, this.ctx.currentTime, 0.02);
  }

  chargeStop() {
    if (!this.chargeOsc) return;
    const t = this.ctx.currentTime;
    this.chargeGain.gain.setTargetAtTime(0.0001, t, 0.02);
    this.chargeOsc.stop(t + 0.12);
    this.chargeOsc = null;
  }
}
