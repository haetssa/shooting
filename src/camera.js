// 카메라: 대상 따라가기, 드래그 이동, 핀치/휠 확대. 좌표 단위는 CSS px
import { clamp } from './util.js';

export class Camera {
  constructor() {
    this.x = 0; this.y = 0;
    this.tx = 0; this.ty = 0;
    this.zoom = 1;
    this.manual = false;
    this.cw = 1; this.ch = 1;
    this.W = 1; this.H = 1;
  }

  resize(cw, ch, W, H) {
    this.cw = cw; this.ch = ch; this.W = W; this.H = H;
    this.minZoom = Math.min(cw / W, ch / H);
    this.defaultZoom = ch / 520;
    this.maxZoom = ch / 320;
    this.zoom = clamp(this.zoom, this.minZoom, this.maxZoom);
    this.clamp();
  }

  focus(x, y, instant = false) {
    this.manual = false;
    this.glide = null;
    this.tx = x; this.ty = y;
    if (instant) { this.x = x; this.y = y; }
  }

  follow(x, y) {
    if (this.manual) return;
    this.tx = x; this.ty = y;
  }

  // 수동 모드로 전환하면서 (x, y)로 부드럽게 이동 (미니맵 터치)
  lookAt(x, y) {
    this.manual = true;
    this.glide = { x, y };
  }

  pan(dx, dy) {
    this.manual = true;
    this.glide = null;
    this.x -= dx / this.zoom;
    this.y -= dy / this.zoom;
    this.clamp();
  }

  zoomAt(f, sx, sy) {
    const before = this.screenToWorld(sx, sy);
    this.zoom = clamp(this.zoom * f, this.minZoom, this.maxZoom);
    const after = this.screenToWorld(sx, sy);
    this.x += before.x - after.x;
    this.y += before.y - after.y;
    this.clamp();
  }

  update(dt) {
    if (this.manual && this.glide) {
      const k = 1 - Math.exp(-dt * 8);
      this.x += (this.glide.x - this.x) * k;
      this.y += (this.glide.y - this.y) * k;
      if (Math.hypot(this.glide.x - this.x, this.glide.y - this.y) < 2) this.glide = null;
    }
    if (!this.manual) {
      const k = 1 - Math.exp(-dt * 5);
      this.x += (this.tx - this.x) * k;
      this.y += (this.ty - this.y) * k;
    }
    this.clamp();
  }

  clamp() {
    const hw = this.cw / 2 / this.zoom, hh = this.ch / 2 / this.zoom;
    const mx = 0, top = -500, bottom = this.H + 120;
    this.x = 2 * hw >= this.W + 2 * mx ? this.W / 2 : clamp(this.x, hw - mx, this.W - hw + mx);
    this.y = 2 * hh >= bottom - top ? (top + bottom) / 2 : clamp(this.y, top + hh, bottom - hh);
  }

  apply(ctx, dpr, ox = 0, oy = 0) {
    const z = this.zoom * dpr;
    ctx.setTransform(z, 0, 0, z, (this.cw / 2 - this.x * this.zoom + ox) * dpr, (this.ch / 2 - this.y * this.zoom + oy) * dpr);
  }

  screenToWorld(sx, sy) {
    return { x: (sx - this.cw / 2) / this.zoom + this.x, y: (sy - this.ch / 2) / this.zoom + this.y };
  }

  worldToScreen(x, y) {
    return { x: (x - this.x) * this.zoom + this.cw / 2, y: (y - this.y) * this.zoom + this.ch / 2 };
  }

  visibleRect() {
    const w = this.cw / this.zoom, h = this.ch / this.zoom;
    return { x: this.x - w / 2, y: this.y - h / 2, w, h };
  }
}
