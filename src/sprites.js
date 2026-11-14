// 슬라이서가 만든 아틀라스(PNG + JSON) 로드, 프레임 그리기, 초상화 생성
import { loadJSON, vurl } from './util.js';

function loadImg(src) {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error(`이미지 로드 실패: ${src}`));
    im.src = vurl(src);
  });
}

export async function loadSprite(base) {
  const [meta, img] = await Promise.all([loadJSON(`${base}.json`), loadImg(`${base}.png`)]);
  return { meta, img };
}

// (x, y) = 발 아래 중앙, height = 월드 단위 키, facing = 1 | -1
export function drawFrame(ctx, sprite, frame, x, y, height, facing) {
  const m = sprite.meta;
  const s = height / m.refHeight;
  const sx = (frame % m.cols) * m.cellW, sy = Math.floor(frame / m.cols) * m.cellH;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(facing * s, s);
  ctx.drawImage(sprite.img, sx, sy, m.cellW, m.cellH, -m.anchorX, -m.anchorY, m.cellW, m.cellH);
  ctx.restore();
}

// 0번 프레임 윗부분(머리)을 정사각형으로 잘라 초상화 캔버스 생성
export function makePortrait(sprite, size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  if (!sprite) return c;
  const m = sprite.meta, R = m.refHeight;
  const side = R * 0.62;
  const g = c.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(sprite.img, m.anchorX - side / 2, m.anchorY - R - 2, side, side, 0, 0, size, size);
  return c;
}
