// 튜토리얼: 봇 1명과 실제로 대전하면서 단계별로 조작과 규칙을 알려준다
// 단계마다 조건(걷기, 점프, 각도, 발사, 스킬...)을 채우면 다음 단계로. 설명 단계는 [다음] 버튼
// 설명 중에는 내 턴 타이머가 멈춘다 (pauseTimer). 마지막 단계 이후는 일반 대전
const $ = (id) => document.getElementById(id);

const PC = matchMedia('(pointer: fine)').matches;
const k = (mobile, pc) => (PC ? pc : mobile);

export class Tutorial {
  constructor(game) {
    this.g = game;
    this.i = -1;
    this.acc = 0;
    this.flags = {};
    this.steps = [
      { text: '포격 게임에 온 걸 환영해요! 🎯\n차례대로 포탄을 던져 상대를 쓰러뜨리면 승리. 섬 아래로 떨어지면 즉시 탈락이에요.', next: true },
      { text: k('◀ ▶ 버튼을 눌러 걸어 보세요.', '← → 키로 걸어 보세요.') + '\n아래쪽 초록 줄이 이번 턴 이동 연료예요.', myTurn: true, done: (f) => f.walk >= 60 },
      { text: k('점프 버튼(발사 버튼 위)을 눌러 뛰어 보세요.', 'W 키로 뛰어 보세요.') + '\n공중에서도 ' + k('◀ ▶', '← →') + '로 방향을 바꿀 수 있어요. 방향 없이 누르면 제자리 점프!', myTurn: true, done: (f, c) => f.jump && c.grounded },
      { text: k('화면을 위아래로 드래그해서', '↑ ↓ 키나 마우스 드래그로') + ' 조준 각도를 바꿔 보세요.', myTurn: true, done: (f) => f.aim >= 15 },
      { text: '위쪽 가운데 바람 표시를 보세요 🌬️\n화살표 방향으로 포탄이 밀려요. 바람은 턴마다 바뀌고, 조금씩 계속 출렁여요.', next: true },
      { text: k('발사 버튼을 누르고 있다가 떼세요.', '스페이스를 누르고 있다가 떼세요.') + '\n오래 누를수록 멀리 날아가요. 오른쪽 위 미니맵에서 봇 위치를 보고 노려 보세요!', myTurn: true, done: (f) => f.fire },
      { text: '봇의 차례예요. 잠시 기다려 주세요…', wait: (g) => g.isMine(g.turn.current) && g.turn.phase === 'aim' },
      { text: '흰 점선 = 지난번 궤적, 파워 게이지 위 흰 삼각형 = 지난번 파워예요.\n빗나갔다면 이걸 보고 각도와 파워를 조절해 보세요.', next: true, myTurn: true },
      { text: '파란 줄은 마나 💧 예요. 시간이 지나면 조금씩 차고, 상대를 맞히면 더 차요.\n오른쪽 스킬1 버튼을 눌러 보세요. 다음 발사가 스킬로 바뀌어요! (다시 누르면 취소)', myTurn: true, enter: (g) => { g.turn.current.mana = g.cfg.mana.max; }, done: (f) => f.skill },
      { text: '궁극기(보라색 버튼)는 기본 공격으로 상대를 2번 맞히면 해금되고, 그다음부터 마나로 쓸 수 있어요.\n버튼을 길게 누르면 설명이 나와요.', next: true },
      { text: '미니맵을 누르면 그곳으로 화면이 이동해요. ' + k('두 손가락으로 화면 이동/확대', '우클릭 드래그로 화면 이동, 휠로 확대') + '도 돼요.', next: true },
      { text: '이제 봇을 쓰러뜨려 보세요! 💪\n(언제든 오른쪽 🚪 버튼으로 나갈 수 있어요)', next: true, label: '시작!' },
    ];
    this.onNext = () => this.advance();
  }

  get pauseTimer() {
    return this.i >= 0 && this.i < this.steps.length;
  }

  start() {
    $('tut-next').addEventListener('click', this.onNext);
    this.go(0);
  }

  end() {
    $('tut-next').removeEventListener('click', this.onNext);
    $('tutorial').classList.add('hidden');
  }

  go(i) {
    this.i = i;
    this.flags = { walk: 0, aim: 0 };
    const st = this.steps[i];
    if (!st) { $('tutorial').classList.add('hidden'); return; }
    this.entered = false;
    $('tut-step').textContent = `${i + 1} / ${this.steps.length}`;
    $('tut-text').textContent = st.text;
    $('tut-next').textContent = st.label || '다음';
    $('tutorial').classList.remove('hidden');
    this.g.audio.play('click');
  }

  advance() { if (this.pauseTimer) this.go(this.i + 1); }

  note(ev, v = 1) {
    if (!this.pauseTimer) return;
    if (ev === 'walk' || ev === 'aim') this.flags[ev] += v;
    else this.flags[ev] = true;
  }

  update() {
    const st = this.steps[this.i];
    if (!st) return;
    const g = this.g, t = g.turn, c = t?.current;
    const myAim = g.state === 'playing' && c && g.isMine(c) && t.phase === 'aim';
    // 반드시 true/false 로 (undefined 를 classList.toggle 에 넘기면 매 프레임 뒤집혀서 깜빡인다)
    const waiting = !!st.myTurn && !myAim;
    // 내 차례를 기다리는 동안에는 버튼 대신 안내
    $('tut-next').classList.toggle('hidden', !st.next || waiting);
    $('tut-wait').classList.toggle('hidden', !waiting);
    if (waiting) return;
    if (!this.entered) { this.entered = true; st.enter?.(g); }
    if (st.wait && st.wait(g)) return this.go(this.i + 1);
    if (st.done && st.done(this.flags, c)) {
      g.audio.play('arm');
      this.go(this.i + 1);
    }
  }
}
