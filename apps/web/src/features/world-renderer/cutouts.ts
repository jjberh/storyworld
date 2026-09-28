import { cutOut, type Cutout, type RgbaImage } from "./cutout-mask";

// Browser side of the paper cutouts: reads a drawing's pixels once and keeps
// every piece's cut, so the live stage, a rebuilt stage and the keepsake's
// hidden stage each cut a piece from the same picture only once.

/** Pixels a drawing is read at, at most (drawings are 1000x600). */
const MAX_READ_WIDTH = 1200;
/** The sticker border and ink growth, in stage units (1000 wide). */
const BORDER = 4;
const GROW = 2;
const STAGE_WIDTH = 1000;
/** Drawings whose cuts are kept, newest last. */
const KEPT_DRAWINGS = 3;
const KEPT_CUTS = 64;

const cuts = new Map<string, Map<string, Cutout | null>>();

/** How much smaller than its natural size a drawing is read. */
export function readScale(image: { naturalWidth: number }) {
  return Math.min(1, MAX_READ_WIDTH / Math.max(1, image.naturalWidth));
}

/**
 * The drawing's pixels (scaled by `readScale`), or null when they cannot be
 * read: no 2D canvas here, or a picture from another origin.
 */
export function readImagePixels(image: HTMLImageElement): RgbaImage | null {
  const scale = readScale(image);
  const width = Math.round(image.naturalWidth * scale);
  const height = Math.round(image.naturalHeight * scale);
  if (width < 1 || height < 1) return null;
  try {
    const canvas =
      typeof OffscreenCanvas === "function"
        ? new OffscreenCanvas(width, height)
        : Object.assign(document.createElement("canvas"), { width, height });
    const context = canvas.getContext("2d", { willReadFrequently: true }) as
      CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!context || typeof context.getImageData !== "function") return null;
    context.drawImage(image, 0, 0, width, height);
    const { data } = context.getImageData(0, 0, width, height);
    return { data, width, height };
  } catch {
    return null;
  }
}

/** The cut already made for this drawing and key, if any (null: refused). */
export function cachedCutout(
  drawing: string,
  key: string,
): Cutout | null | undefined {
  return cuts.get(drawing)?.get(key);
}

/**
 * Cuts one piece, or returns the cut made before. `box` is in the pixels
 * `readImagePixels` returns; `pixels` is only called when a cut is needed.
 * Null means show the plain rectangle instead.
 */
export function cutoutFor(
  drawing: string,
  key: string,
  box: { x: number; y: number; width: number; height: number },
  pixels: () => RgbaImage | null,
): Cutout | null {
  const known = cachedCutout(drawing, key);
  if (known !== undefined) {
    // Most recently used drawing last.
    const forDrawing = cuts.get(drawing)!;
    cuts.delete(drawing);
    cuts.set(drawing, forDrawing);
    return known;
  }
  const image = pixels();
  const perUnit = image ? image.width / STAGE_WIDTH : 1;
  const cutout = image
    ? cutOut(image, box, {
        border: BORDER * perUnit,
        grow: Math.max(1, Math.round(GROW * perUnit)),
      })
    : null;
  // A picture that could not be read at all is not remembered: the next
  // stage may be able to read it.
  if (!image) return null;
  let forDrawing = cuts.get(drawing);
  // Most recently used drawing last; forget the oldest.
  cuts.delete(drawing);
  forDrawing ??= new Map();
  cuts.set(drawing, forDrawing);
  while (cuts.size > KEPT_DRAWINGS) cuts.delete(cuts.keys().next().value!);
  if (forDrawing.size >= KEPT_CUTS)
    forDrawing.delete(forDrawing.keys().next().value!);
  forDrawing.set(key, cutout);
  return cutout;
}
