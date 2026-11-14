// 입력: 화면 버튼(터치/마우스 공통 Pointer Events), 키보드, 캔버스 드래그/핀치
// 캔버스 한 손가락 드래그 = 각도 (내 조준 단계일 때) / 화면 이동 (그 외)
// 두 손가락 = 화면 이동 + 확대, 마우스 우클릭 드래그 = 화면 이동, 휠 = 확대
// 한 손가락 터치는 먼저 hooks.onTap 에 물어본다 (미니맵, 순간이동 위치 지정)

export class Input {
  constructor(canvas, hooks) {
    this.hooks = hooks;
    this.keys = new Set();
    this.btn = { left: false, right: false, fire: false };
    this.aimDragPx = 0;
    this.jumpQueued = false;
    this.bindKeys();
    this.bindCanvas(canvas);
  }

  get left() { return this.btn.left || this.keys.has('ArrowLeft') || this.keys.has('KeyA'); }
  get right() { return this.btn.right || this.keys.has('ArrowRight') || this.keys.has('KeyD'); }
  get fire() { return this.btn.fire || this.keys.has('Space'); }
  get angleAxis() { return (this.keys.has('ArrowUp') ? 1 : 0) - (this.keys.has('ArrowDown') ? 1 : 0); }

  consume() {
    const r = { aimDragPx: this.aimDragPx, jump: this.jumpQueued, skill: this.skillQueued || 0 };
    this.aimDragPx = 0;
    this.jumpQueued = false;
    this.skillQueued = 0;
    return r;
  }

  bindHold(el, name) {
    const down = (e) => {
      e.preventDefault();
      try { el.setPointerCapture(e.pointerId); } catch {}
      this.btn[name] = true;
      el.classList.add('down');
    };
    const up = () => {
      this.btn[name] = false;
      el.classList.remove('down');
    };
    el.addEventListener('pointerdown', down);
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) el.addEventListener(ev, up);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  bindTap(el, fn) {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      el.classList.add('down');
      fn();
    });
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) el.addEventListener(ev, () => el.classList.remove('down'));
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  bindKeys() {
    const block = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space']);
    const typing = (e) => e.target instanceof Element && e.target.closest('input, textarea, select');
    window.addEventListener('keydown', (e) => {
      if (typing(e)) return; // 채팅/이름 입력 중에는 게임 키 무시
      if (block.has(e.code)) e.preventDefault();
      if (!e.repeat && (e.code === 'KeyW' || e.code === 'KeyZ')) this.jumpQueued = true;
      if (!e.repeat && /^Digit[123]$/.test(e.code)) this.skillQueued = +e.code.slice(5);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.btn.left = this.btn.right = this.btn.fire = false;
    });
  }

  bindCanvas(canvas) {
    const pts = new Map();
    let mode = null, pinchDist = 0, lastCx = 0, lastCy = 0;
    const pair = () => {
      const [a, b] = [...pts.values()];
      return { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
    };

    canvas.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      try { canvas.setPointerCapture(e.pointerId); } catch {}
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 1) {
        const mousePan = e.pointerType === 'mouse' && e.button !== 0;
        // 순간이동 위치 지정, 미니맵 터치 등은 여기서 처리하고 드래그 모드는 시작하지 않음
        if (!mousePan && this.hooks.onTap?.(e.clientX, e.clientY)) { mode = 'none'; return; }
        mode = mousePan || !this.hooks.canAim() ? 'pan' : 'aim';
      } else if (pts.size === 2) {
        mode = 'multi';
        const p = pair();
        pinchDist = p.d; lastCx = p.cx; lastCy = p.cy;
      }
    });

    canvas.addEventListener('pointermove', (e) => {
      const prev = pts.get(e.pointerId);
      if (!prev) return;
      const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
      prev.x = e.clientX;
      prev.y = e.clientY;
      if (mode === 'aim') this.aimDragPx -= dy;
      else if (mode === 'pan') this.hooks.onPan(dx, dy);
      else if (mode === 'multi' && pts.size >= 2) {
        const p = pair();
        this.hooks.onPan(p.cx - lastCx, p.cy - lastCy);
        this.hooks.onZoom(p.d / pinchDist, p.cx, p.cy);
        pinchDist = p.d; lastCx = p.cx; lastCy = p.cy;
      }
    });

    const end = (e) => {
      pts.delete(e.pointerId);
      if (pts.size === 0) mode = null;
      else if (mode === 'multi') mode = 'pan';
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.hooks.onZoom(e.deltaY < 0 ? 1.1 : 1 / 1.1, e.clientX, e.clientY);
    }, { passive: false });
  }
}
