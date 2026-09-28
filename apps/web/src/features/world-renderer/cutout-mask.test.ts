import { describe, expect, it } from "vitest";
import {
  cutOut,
  cutoutAtlas,
  DEFAULT_CUTOUT_OPTIONS,
  dilate,
  distanceTo,
  estimateBackground,
  floodOutside,
  type Cutout,
  type PixelBox,
  type Rgb,
  type RgbaImage,
} from "./cutout-mask";

const WHITE: Rgb = [255, 253, 245];
const GREY: Rgb = [168, 166, 158];
const CRAYON: Rgb = [221, 133, 92];
const INK: Rgb = [58, 27, 107];

/** A sheet of paper, optionally with deterministic noise like a photo. */
function sheet(width: number, height: number, color: Rgb, noise = 0) {
  const data = new Uint8ClampedArray(width * height * 4);
  let seed = 7;
  const random = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  for (let index = 0; index < width * height; index++) {
    const jitter = noise ? Math.round((random() * 2 - 1) * noise) : 0;
    for (let c = 0; c < 3; c++) data[index * 4 + c] = color[c]! + jitter;
    data[index * 4 + 3] = 255;
  }
  return { data, width, height } satisfies RgbaImage;
}

function paint(image: RgbaImage, x: number, y: number, color: Rgb) {
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) return;
  const offset = (y * image.width + x) * 4;
  for (let c = 0; c < 3; c++) image.data[offset + c] = color[c]!;
}

function fillRect(image: RgbaImage, box: PixelBox, color: Rgb) {
  for (let y = box.y; y < box.y + box.height; y++)
    for (let x = box.x; x < box.x + box.width; x++) paint(image, x, y, color);
}

/** A square outline `thickness` wide: a closed shape with paper inside. */
function outline(image: RgbaImage, box: PixelBox, color: Rgb, thickness = 2) {
  fillRect(image, { ...box, height: thickness }, color);
  fillRect(
    image,
    { ...box, y: box.y + box.height - thickness, height: thickness },
    color,
  );
  fillRect(image, { ...box, width: thickness }, color);
  fillRect(
    image,
    { ...box, x: box.x + box.width - thickness, width: thickness },
    color,
  );
}

/** Alpha of the cutout at a point given in the image's pixels. */
function alphaAt(cutout: Cutout, x: number, y: number) {
  const px = x - cutout.box.x + cutout.pad;
  const py = y - cutout.box.y + cutout.pad;
  return cutout.pixels[(py * cutout.width + px) * 4 + 3]!;
}

function colorAt(cutout: Cutout, x: number, y: number) {
  const px = x - cutout.box.x + cutout.pad;
  const py = y - cutout.box.y + cutout.pad;
  const offset = (py * cutout.width + px) * 4;
  return [...cutout.pixels.subarray(offset, offset + 3)];
}

const box: PixelBox = { x: 20, y: 20, width: 60, height: 40 };

describe("cutOut", () => {
  it("keeps strokes on white paper and clears the paper around them", () => {
    const image = sheet(100, 80, WHITE);
    // An open zigzag of crayon, well inside the box.
    for (let x = 35; x < 65; x++) {
      const y = 30 + Math.abs(((x - 35) % 10) - 5) * 2;
      fillRect(image, { x, y, width: 2, height: 3 }, CRAYON);
    }
    const cutout = cutOut(image, box)!;
    expect(cutout).not.toBeNull();
    expect(cutout.background).toEqual(WHITE);
    // On the stroke: the drawing itself, opaque.
    expect(alphaAt(cutout, 35, 40)).toBe(255);
    expect(colorAt(cutout, 35, 40)).toEqual([...CRAYON]);
    // Just inside the box's corner: see-through paper.
    expect(alphaAt(cutout, 21, 21)).toBe(0);
    expect(alphaAt(cutout, 78, 58)).toBe(0);
    // Right beside the stroke: the sticker border, in the sticker colour.
    expect(alphaAt(cutout, 40, 26)).toBe(255);
    expect(colorAt(cutout, 40, 26)).toEqual([...WHITE]);
    expect(cutout.kept).toBeGreaterThan(0.01);
    expect(cutout.kept).toBeLessThan(0.9);
  });

  it("measures grey, noisy paper from the box's edge and evens it to white", () => {
    const image = sheet(100, 80, GREY, 14);
    fillRect(image, { x: 40, y: 32, width: 20, height: 4 }, INK);
    fillRect(image, { x: 48, y: 28, width: 4, height: 16 }, INK);
    const background = estimateBackground(image, box);
    for (let c = 0; c < 3; c++)
      expect(Math.abs(background.color[c]! - GREY[c]!)).toBeLessThanOrEqual(3);
    expect(background.noise).toBeGreaterThan(4);

    const cutout = cutOut(image, box)!;
    expect(cutout).not.toBeNull();
    // Noise alone never counts as ink, so the corners are cleared.
    expect(alphaAt(cutout, 22, 22)).toBe(0);
    expect(alphaAt(cutout, 77, 57)).toBe(0);
    expect(cutout.kept).toBeLessThan(0.3);
    // The ink keeps its own colour...
    expect(alphaAt(cutout, 50, 34)).toBe(255);
    expect(colorAt(cutout, 50, 34)).toEqual([...INK]);
    // ...and grainy paper kept beside it becomes the flat sticker white.
    expect(alphaAt(cutout, 39, 34)).toBe(255);
    expect(colorAt(cutout, 39, 34)).toEqual([...WHITE]);
  });

  it("keeps the paper inside a closed shape as part of the piece", () => {
    const image = sheet(100, 80, WHITE);
    outline(image, { x: 32, y: 26, width: 36, height: 28 }, CRAYON);
    const cutout = cutOut(image, box)!;
    expect(cutout).not.toBeNull();
    // Inside the castle's walls: paper, opaque, not a hole.
    expect(alphaAt(cutout, 50, 40)).toBe(255);
    expect(colorAt(cutout, 50, 40)).toEqual([...WHITE]);
    // Outside its walls: cleared.
    expect(alphaAt(cutout, 22, 22)).toBe(0);
  });

  it("lets the see-through paper in through a gap wider than the growth", () => {
    const image = sheet(100, 80, WHITE);
    outline(image, { x: 32, y: 26, width: 36, height: 28 }, CRAYON);
    // A doorway 12 px wide in the bottom wall.
    fillRect(image, { x: 44, y: 52, width: 12, height: 2 }, WHITE);
    const cutout = cutOut(image, box)!;
    expect(alphaAt(cutout, 50, 40)).toBe(0);
  });

  it("drops a neighbour's stroke that crosses into the box", () => {
    const image = sheet(100, 80, WHITE);
    outline(image, { x: 44, y: 28, width: 30, height: 26 }, CRAYON);
    // A neighbour's line from outside the box, ending inside it.
    fillRect(image, { x: 5, y: 40, width: 25, height: 3 }, INK);
    const cutout = cutOut(image, box)!;
    expect(cutout).not.toBeNull();
    expect(alphaAt(cutout, 22, 41)).toBe(0);
    expect(alphaAt(cutout, 27, 41)).toBe(0);
    // The piece itself is untouched.
    expect(alphaAt(cutout, 45, 40)).toBe(255);
    expect(alphaAt(cutout, 60, 40)).toBe(255);
  });

  it("keeps a small part that only touches the box's edge", () => {
    const image = sheet(100, 80, WHITE);
    outline(image, { x: 44, y: 28, width: 30, height: 26 }, CRAYON);
    // A sun's ray ending right at the box's left edge (tight bounds).
    fillRect(image, { x: 20, y: 40, width: 10, height: 3 }, CRAYON);
    const cutout = cutOut(image, box)!;
    expect(alphaAt(cutout, 22, 41)).toBe(255);
  });

  it("keeps the piece itself when its own stroke runs past the box", () => {
    const image = sheet(100, 80, WHITE);
    // One big outline, cut by bounds that are slightly too small.
    outline(image, { x: 14, y: 26, width: 60, height: 28 }, CRAYON);
    const cutout = cutOut(image, box)!;
    expect(cutout).not.toBeNull();
    expect(alphaAt(cutout, 21, 26)).toBe(255);
    expect(alphaAt(cutout, 50, 26)).toBe(255);
  });

  it("keeps a closed shape boxed tightly as a whole paper piece", () => {
    const image = sheet(100, 80, WHITE);
    outline(image, { x: 21, y: 21, width: 58, height: 38 }, CRAYON, 3);
    const cutout = cutOut(image, box)!;
    expect(cutout).not.toBeNull();
    expect(cutout.kept).toBe(1);
    expect(colorAt(cutout, 50, 40)).toEqual([...WHITE]);
  });

  it("drops lone specks of noise", () => {
    const image = sheet(100, 80, WHITE);
    outline(image, { x: 44, y: 28, width: 30, height: 26 }, CRAYON);
    paint(image, 28, 50, INK);
    const cutout = cutOut(image, box)!;
    expect(alphaAt(cutout, 28, 50)).toBe(0);
  });

  it("refuses an empty box, so the caller shows the rectangle", () => {
    expect(cutOut(sheet(100, 80, WHITE), box)).toBeNull();
    expect(cutOut(sheet(100, 80, GREY, 14), box)).toBeNull();
  });

  it("refuses a box filled with colour", () => {
    const image = sheet(100, 80, WHITE);
    fillRect(image, box, CRAYON);
    expect(cutOut(image, box)).toBeNull();
    // Paper along the edge, but a shape covering almost all of the box.
    const nearlyFull = sheet(100, 80, WHITE);
    fillRect(nearlyFull, { x: 22, y: 22, width: 56, height: 36 }, INK);
    expect(cutOut(nearlyFull, box)).toBeNull();
  });

  it("refuses dark paper and a busy edge", () => {
    const dark = sheet(100, 80, [40, 40, 40]);
    fillRect(dark, { x: 40, y: 30, width: 10, height: 10 }, WHITE);
    expect(cutOut(dark, box)).toBeNull();
    // Stripes: no colour covers most of the edge.
    const busy = sheet(100, 80, WHITE);
    for (let x = 0; x < 100; x += 4)
      fillRect(busy, { x, y: 0, width: 2, height: 80 }, INK);
    expect(cutOut(busy, box)).toBeNull();
  });

  it("refuses a box too small to measure and clips one past the image", () => {
    const image = sheet(100, 80, WHITE);
    expect(cutOut(image, { x: 10, y: 10, width: 4, height: 4 })).toBeNull();
    fillRect(image, { x: 88, y: 60, width: 6, height: 6 }, INK);
    const cutout = cutOut(image, { x: 70, y: 50, width: 60, height: 60 })!;
    expect(cutout.box).toEqual({ x: 70, y: 50, width: 30, height: 30 });
    expect(alphaAt(cutout, 90, 62)).toBe(255);
  });

  it("gives the sticker a soft outer edge and a transparent margin", () => {
    const image = sheet(100, 80, WHITE);
    fillRect(image, { x: 45, y: 35, width: 10, height: 10 }, INK);
    const cutout = cutOut(image, box)!;
    const border = DEFAULT_CUTOUT_OPTIONS.border;
    // Ink grows 2 px (to x = 43); the border runs `border` px beyond that,
    // half covering its last pixel.
    expect(alphaAt(cutout, 43 - border + 1, 40)).toBe(255);
    expect(alphaAt(cutout, 43 - border, 40)).toBe(128);
    expect(alphaAt(cutout, 43 - border - 1, 40)).toBe(0);
    // The outermost ring of the buffer is always clear.
    for (let x = 0; x < cutout.width; x++)
      expect(cutout.pixels[x * 4 + 3]).toBe(0);
  });
});

describe("mask helpers", () => {
  it("dilate grows a pixel into a square", () => {
    const mask = new Uint8Array(25);
    mask[12] = 1;
    expect([...dilate(mask, 5, 5, 1)]).toEqual([
      0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 1, 1, 1, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0,
    ]);
    expect(dilate(mask, 5, 5, 2).every((value) => value === 1)).toBe(true);
  });

  it("floodOutside stops at a closed ring", () => {
    const ink = new Uint8Array(25);
    for (const index of [6, 7, 8, 11, 13, 16, 17, 18]) ink[index] = 1;
    const outside = floodOutside(ink, 5, 5);
    expect(outside[12]).toBe(0);
    expect(outside[0]).toBe(1);
    expect(outside[7]).toBe(0);
  });

  it("distanceTo measures straight and diagonal steps", () => {
    const mask = new Uint8Array(9);
    mask[0] = 1;
    const dist = distanceTo(mask, 3, 3);
    expect(dist[1]).toBe(1);
    expect(dist[4]).toBeCloseTo(Math.SQRT2);
    expect(dist[8]).toBeCloseTo(2 * Math.SQRT2);
  });

  it("cutoutAtlas stacks the premultiplied sticker over a white shape", () => {
    const pixels = new Uint8ClampedArray([200, 100, 50, 128, 0, 0, 0, 0]);
    const atlas = cutoutAtlas({
      box: { x: 0, y: 0, width: 2, height: 1 },
      pad: 0,
      width: 2,
      height: 1,
      pixels,
      kept: 0.5,
      background: WHITE,
      tolerance: 36,
    });
    expect([...atlas]).toEqual([
      100, 50, 25, 128, 0, 0, 0, 0, 128, 128, 128, 128, 0, 0, 0, 0,
    ]);
  });
});
