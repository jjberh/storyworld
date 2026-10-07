// Cuts one piece out of a drawing like scissors on paper: inside the piece's
// box, the paper becomes transparent and the strokes stay, with a thin
// sticker border around what is left. Pure pixel math on typed arrays, so it
// runs anywhere and is tested on small synthetic pictures.
//
// 1. Paper colour: the per-channel median of a thin ring along the box's
//    edge, so off-white or grey paper (a photo) works as well as white.
// 2. Ink: any pixel further from that colour than a tolerance that grows
//    with the paper's own noise. Ink is then grown a couple of pixels so thin
//    lines survive and their soft edges come along.
// 3. Outside: a flood fill from the box's edge through paper. Paper it cannot
//    reach (inside a closed outline) stays, so a drawn castle keeps its paper
//    inside instead of turning see-through.
// 4. Neighbours: a separate, smaller part whose stroke carries on past the
//    box's edge belongs to something next door and is dropped, as are specks.
// 5. Sanity: a cut keeping under 1% of the box (an empty box, or one filled
//    with colour, whose edge then reads as the paper) or whose ink covers over
//    90% of it (a busy photo) is refused, and the caller falls back to a
//    plain rectangle.
// 6. Sticker: paper left in the piece becomes the border's flat white, ink
//    keeps its colour, and the border is soft-edged.

export type RgbaImage = {
  /** Straight (not premultiplied) RGBA, row by row. */
  data: Uint8ClampedArray;
  width: number;
  height: number;
};

export type PixelBox = { x: number; y: number; width: number; height: number };

export type Rgb = readonly [number, number, number];

export type CutoutOptions = {
  /** Ink grows by this many pixels (a square), keeping thin lines whole. */
  grow: number;
  /** Width of the sticker border around the kept drawing, in pixels. */
  border: number;
  /** The smallest colour distance (0–441) that counts as ink. */
  minTolerance: number;
  /** The largest, however noisy the paper. */
  maxTolerance: number;
  /** A cut keeping less of the box than this is refused. */
  minKept: number;
  /** A cut whose ink covers more of the box than this is refused. */
  maxInk: number;
  /** The colour paper becomes, matching the sticker border. */
  sticker: Rgb;
};

export const DEFAULT_CUTOUT_OPTIONS: CutoutOptions = {
  grow: 2,
  border: 4,
  minTolerance: 36,
  maxTolerance: 110,
  minKept: 0.01,
  maxInk: 0.9,
  sticker: [0xff, 0xfd, 0xf5],
};

/** Paper darker than this (0–255 luminance) is not paper we can cut. */
const MIN_PAPER_LUMINANCE = 100;
/** At least this share of the edge ring must look like the paper colour. */
const MIN_RING_AGREEMENT = 0.5;
/** Width of the edge ring the paper colour is measured from. */
const RING = 2;
/** A stray part at most this big, and under this share of the piece, is a
 * speck (dust, a stray dot of noise). */
const SPECK_AREA = 36;
const SPECK_SHARE = 0.1;
/**
 * Kept pixels this close to the paper (in tolerances) become the sticker
 * colour; from here to the second value they blend into their own colour.
 */
const PAPER_BLEND = [0.5, 1] as const;
/** A part whose stroke carries on outside and is under this share of the
 * piece's main part belongs to a neighbour. */
const NEIGHBOUR_SHARE = 0.5;

export type Cutout = {
  /** The whole-pixel box that was cut, in the image's pixels. */
  box: PixelBox;
  /** Transparent margin around `box` in `pixels`, holding the border. */
  pad: number;
  /** Size of `pixels`: the box plus `pad` on every side. */
  width: number;
  height: number;
  /**
   * Straight RGBA: the kept drawing (paper evened out to the sticker colour)
   * inside a soft-edged sticker border; transparent everywhere else.
   */
  pixels: Uint8ClampedArray;
  /** Share of the box that was kept. */
  kept: number;
  background: Rgb;
  tolerance: number;
};

/** One pixel over white, since a transparent pixel reads as white paper. */
function channel(data: Uint8ClampedArray, offset: number, c: number) {
  const alpha = data[offset + 3]!;
  const value = data[offset + c]!;
  return alpha === 255 ? value : 255 - ((255 - value) * alpha) / 255;
}

function distanceSquared(data: Uint8ClampedArray, offset: number, color: Rgb) {
  const r = channel(data, offset, 0) - color[0];
  const g = channel(data, offset, 1) - color[1];
  const b = channel(data, offset, 2) - color[2];
  return r * r + g * g + b * b;
}

/** Image offsets of the pixels in the `ring`-wide band along the box's edge. */
function ringOffsets(image: RgbaImage, box: PixelBox, ring: number) {
  const offsets: number[] = [];
  for (let y = 0; y < box.height; y++) {
    const edgeRow = y < ring || y >= box.height - ring;
    for (let x = 0; x < box.width; x++) {
      if (!edgeRow && x >= ring && x < box.width - ring) {
        x = box.width - ring - 1; // Skip the middle of the row.
        continue;
      }
      offsets.push(((box.y + y) * image.width + box.x + x) * 4);
    }
  }
  return offsets;
}

function median(histogram: Uint32Array, count: number) {
  let seen = 0;
  for (let value = 0; value < histogram.length; value++) {
    seen += histogram[value]!;
    if (seen * 2 >= count) return value;
  }
  return histogram.length - 1;
}

export type Background = {
  color: Rgb;
  /** Median distance of the ring's pixels from `color`: the paper's noise. */
  noise: number;
  /** Image offsets of the ring pixels the estimate came from. */
  ring: number[];
};

/**
 * The paper colour around a box: the per-channel median of a thin ring along
 * its edge. A median ignores the strokes that cross the ring, as long as
 * paper covers most of it.
 */
export function estimateBackground(
  image: RgbaImage,
  box: PixelBox,
  ring = RING,
): Background {
  const offsets = ringOffsets(image, box, ring);
  const histograms = [0, 1, 2].map(() => new Uint32Array(256));
  for (const offset of offsets)
    for (let c = 0; c < 3; c++)
      histograms[c]![Math.round(channel(image.data, offset, c))]!++;
  const color = histograms.map((histogram) =>
    median(histogram, offsets.length),
  ) as unknown as Rgb;
  const distances = new Uint32Array(443);
  for (const offset of offsets)
    distances[
      Math.round(Math.sqrt(distanceSquared(image.data, offset, color)))
    ]!++;
  return { color, noise: median(distances, offsets.length), ring: offsets };
}

/** How far a colour may stray from the paper and still be paper. */
export function toleranceFor(noise: number, options = DEFAULT_CUTOUT_OPTIONS) {
  return Math.min(
    options.maxTolerance,
    Math.max(options.minTolerance, options.minTolerance + 3 * noise),
  );
}

/** Grows set pixels of a `width`x`height` mask by `radius` (a square). */
export function dilate(
  mask: Uint8Array,
  width: number,
  height: number,
  radius: number,
) {
  if (radius <= 0) return mask.slice();
  // Separable: along rows, then along columns, each with a running count.
  const rows = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    let count = 0;
    for (let x = 0; x < Math.min(radius, width); x++) count += mask[row + x]!;
    for (let x = 0; x < width; x++) {
      if (x + radius < width) count += mask[row + x + radius]!;
      if (x - radius - 1 >= 0) count -= mask[row + x - radius - 1]!;
      rows[row + x] = count > 0 ? 1 : 0;
    }
  }
  const out = new Uint8Array(mask.length);
  for (let x = 0; x < width; x++) {
    let count = 0;
    for (let y = 0; y < Math.min(radius, height); y++)
      count += rows[y * width + x]!;
    for (let y = 0; y < height; y++) {
      if (y + radius < height) count += rows[(y + radius) * width + x]!;
      if (y - radius - 1 >= 0) count -= rows[(y - radius - 1) * width + x]!;
      out[y * width + x] = count > 0 ? 1 : 0;
    }
  }
  return out;
}

/**
 * Marks the paper reachable from the edge of a `width`x`height` grid without
 * crossing `ink` (4-connected). Paper it cannot reach is enclosed.
 */
export function floodOutside(ink: Uint8Array, width: number, height: number) {
  const outside = new Uint8Array(ink.length);
  const queue = new Int32Array(ink.length);
  let head = 0;
  let tail = 0;
  const seed = (index: number) => {
    if (ink[index] || outside[index]) return;
    outside[index] = 1;
    queue[tail++] = index;
  };
  for (let x = 0; x < width; x++) {
    seed(x);
    seed((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    seed(y * width);
    seed(y * width + width - 1);
  }
  while (head < tail) {
    const index = queue[head++]!;
    const x = index % width;
    if (x > 0) seed(index - 1);
    if (x < width - 1) seed(index + 1);
    if (index >= width) seed(index - width);
    if (index < ink.length - width) seed(index + width);
  }
  return outside;
}

/**
 * Labels the 8-connected parts of `mask` (1, 2, ...; 0 is unset) and returns
 * each part's area, indexed by label.
 */
export function labelParts(mask: Uint8Array, width: number, height: number) {
  const labels = new Int32Array(mask.length);
  const areas = [0];
  const queue = new Int32Array(mask.length);
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || labels[start]) continue;
    const label = areas.length;
    let area = 0;
    let head = 0;
    let tail = 0;
    labels[start] = label;
    queue[tail++] = start;
    while (head < tail) {
      const index = queue[head++]!;
      area++;
      const x = index % width;
      const y = (index - x) / width;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          const next = ny * width + nx;
          if (mask[next] && !labels[next]) {
            labels[next] = label;
            queue[tail++] = next;
          }
        }
      }
    }
    areas.push(area);
  }
  return { labels, areas };
}

/**
 * Distance from every cell of a `width`x`height` grid to the nearest set cell
 * of `mask` (a two-pass chamfer; close to Euclidean for short distances).
 */
export function distanceTo(mask: Uint8Array, width: number, height: number) {
  const far = width + height;
  const dist = new Float32Array(mask.length);
  for (let index = 0; index < mask.length; index++)
    dist[index] = mask[index] ? 0 : far;
  const straight = 1;
  const diagonal = Math.SQRT2;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      let d = dist[index]!;
      if (x > 0) d = Math.min(d, dist[index - 1]! + straight);
      if (y > 0) {
        d = Math.min(d, dist[index - width]! + straight);
        if (x > 0) d = Math.min(d, dist[index - width - 1]! + diagonal);
        if (x < width - 1) d = Math.min(d, dist[index - width + 1]! + diagonal);
      }
      dist[index] = d;
    }
  for (let y = height - 1; y >= 0; y--)
    for (let x = width - 1; x >= 0; x--) {
      const index = y * width + x;
      let d = dist[index]!;
      if (x < width - 1) d = Math.min(d, dist[index + 1]! + straight);
      if (y < height - 1) {
        d = Math.min(d, dist[index + width]! + straight);
        if (x < width - 1) d = Math.min(d, dist[index + width + 1]! + diagonal);
        if (x > 0) d = Math.min(d, dist[index + width - 1]! + diagonal);
      }
      dist[index] = d;
    }
  return dist;
}

/** The whole-pixel part of `box` inside the image. */
function clipBox(image: RgbaImage, box: PixelBox): PixelBox {
  const x0 = Math.max(0, Math.floor(box.x));
  const y0 = Math.max(0, Math.floor(box.y));
  const x1 = Math.min(image.width, Math.ceil(box.x + box.width));
  const y1 = Math.min(image.height, Math.ceil(box.y + box.height));
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/**
 * Cuts the drawing inside `box` out of `image`, or returns null when the cut
 * does not look like a drawing on paper (see the checks above), in which case
 * the caller shows the plain rectangle.
 */
export function cutOut(
  image: RgbaImage,
  requested: PixelBox,
  overrides: Partial<CutoutOptions> = {},
): Cutout | null {
  const options = { ...DEFAULT_CUTOUT_OPTIONS, ...overrides };
  const box = clipBox(image, requested);
  const { width: w, height: h } = box;
  if (w < 2 * RING + 2 || h < 2 * RING + 2) return null;

  const background = estimateBackground(image, box);
  const paper = background.color;
  if (
    0.299 * paper[0] + 0.587 * paper[1] + 0.114 * paper[2] <
    MIN_PAPER_LUMINANCE
  )
    return null;
  const tolerance = toleranceFor(background.noise, options);
  const limit = tolerance * tolerance;
  let agreeing = 0;
  for (const offset of background.ring)
    if (distanceSquared(image.data, offset, paper) <= limit) agreeing++;
  if (agreeing < background.ring.length * MIN_RING_AGREEMENT) return null;

  // Ink over the box plus a margin, so a stroke can be followed outside.
  const reach = options.grow + 2;
  const ex = Math.max(0, box.x - reach);
  const ey = Math.max(0, box.y - reach);
  const ew = Math.min(image.width, box.x + w + reach) - ex;
  const eh = Math.min(image.height, box.y + h + reach) - ey;
  const ink = new Uint8Array(ew * eh);
  // Each pixel's squared distance from the paper, reused for the sticker.
  const distances = new Float32Array(ew * eh);
  for (let y = 0; y < eh; y++)
    for (let x = 0; x < ew; x++) {
      const d = distanceSquared(
        image.data,
        ((ey + y) * image.width + ex + x) * 4,
        paper,
      );
      distances[y * ew + x] = d;
      if (d > limit) ink[y * ew + x] = 1;
    }
  // The box's own grid, from here on. Ink is grown inside the box only, so
  // whatever lies just outside it never seals the box's edge.
  const bx = box.x - ex;
  const by = box.y - ey;
  const rawInk = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    rawInk.set(ink.subarray((by + y) * ew + bx, (by + y) * ew + bx + w), y * w);
  const boxInk = dilate(rawInk, w, h, options.grow);
  const outside = floodOutside(boxInk, w, h);
  const kept = new Uint8Array(w * h);
  for (let index = 0; index < kept.length; index++)
    kept[index] = outside[index] ? 0 : 1;

  // Which parts carry on past the box's edge as raw ink a few pixels out.
  const { labels, areas } = labelParts(kept, w, h);
  const crosses = new Uint8Array(areas.length);
  const inkAt = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < ew && y < eh && ink[y * ew + x] === 1;
  const carriesOn = (x: number, y: number, dx: number, dy: number) => {
    for (let step = options.grow + 1; step <= reach; step++)
      if (inkAt(bx + x + dx * step, by + y + dy * step)) return true;
    return false;
  };
  const noteEdge = (x: number, y: number, dx: number, dy: number) => {
    const label = labels[y * w + x]!;
    if (label && !crosses[label] && carriesOn(x, y, dx, dy)) crosses[label] = 1;
  };
  for (let x = 0; x < w; x++) {
    noteEdge(x, 0, 0, -1);
    noteEdge(x, h - 1, 0, 1);
  }
  for (let y = 0; y < h; y++) {
    noteEdge(0, y, -1, 0);
    noteEdge(w - 1, y, 1, 0);
  }
  let main = 0;
  for (let label = 1; label < areas.length; label++)
    if (!main || areas[label]! > areas[main]!) main = label;
  if (!main) return null;
  const mainArea = areas[main]!;
  const drop = areas.map(
    (area, label) =>
      label !== main &&
      ((crosses[label] === 1 && area < mainArea * NEIGHBOUR_SHARE) ||
        (area <= SPECK_AREA && area < mainArea * SPECK_SHARE)),
  );
  let keptArea = 0;
  let inkArea = 0;
  for (let index = 0; index < kept.length; index++) {
    if (kept[index] && drop[labels[index]!]) kept[index] = 0;
    keptArea += kept[index]!;
    inkArea += kept[index]! & boxInk[index]!;
  }
  const share = keptArea / (w * h);
  // A tightly boxed closed shape may keep the whole box (its inside is
  // paper); a box covered in ink is a filled shape or a busy photo.
  if (share < options.minKept || inkArea / (w * h) > options.maxInk)
    return null;

  // The sticker: the kept drawing on a soft-edged border `border` wide.
  const pad = Math.ceil(options.border) + 1;
  const width = w + pad * 2;
  const height = h + pad * 2;
  const padded = new Uint8Array(width * height);
  for (let y = 0; y < h; y++)
    padded.set(kept.subarray(y * w, y * w + w), (y + pad) * width + pad);
  const dist = distanceTo(padded, width, height);
  const pixels = new Uint8Array(width * height * 4);
  const [sr, sg, sb] = options.sticker;
  // Paper left in the piece (beside strokes, inside closed shapes) becomes
  // the sticker's own flat colour; ink keeps its colour, and the soft edge
  // between them blends, so grey or grainy paper turns into a clean sticker.
  const paperBelow = tolerance * PAPER_BLEND[0];
  const inkAbove = tolerance * PAPER_BLEND[1];
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      const out = index * 4;
      if (padded[index]) {
        const source = ((box.y + y - pad) * image.width + box.x + x - pad) * 4;
        const distance = Math.sqrt(
          distances[(by + y - pad) * ew + bx + x - pad]!,
        );
        const t = Math.min(
          1,
          Math.max(0, (inkAbove - distance) / (inkAbove - paperBelow)),
        );
        const toSticker = t * t * (3 - 2 * t);
        for (let c = 0; c < 3; c++) {
          const value = channel(image.data, source, c);
          pixels[out + c] = Math.round(
            value + (options.sticker[c]! - value) * toSticker,
          );
        }
        pixels[out + 3] = 255;
        continue;
      }
      const alpha = options.border + 0.5 - dist[index]!;
      if (alpha <= 0) continue;
      pixels[out] = sr;
      pixels[out + 1] = sg;
      pixels[out + 2] = sb;
      pixels[out + 3] = Math.round(Math.min(1, alpha) * 255);
    }
  return {
    box,
    pad,
    width,
    height,
    pixels: new Uint8ClampedArray(pixels.buffer),
    kept: share,
    background: paper,
    tolerance,
  };
}

/**
 * One premultiplied RGBA buffer, `cutout.height * 2` rows tall: the sticker
 * on top, and below it the same shape in plain white, for the piece's shadow
 * and the paper patch it leaves behind (both tinted).
 */
export function cutoutAtlas(cutout: Cutout) {
  const { pixels } = cutout;
  const atlas = new Uint8Array(pixels.length * 2);
  for (let offset = 0; offset < pixels.length; offset += 4) {
    const alpha = pixels[offset + 3]!;
    if (!alpha) continue;
    for (let c = 0; c < 3; c++)
      atlas[offset + c] = Math.round((pixels[offset + c]! * alpha) / 255);
    atlas[offset + 3] = alpha;
    const below = pixels.length + offset;
    atlas[below] = atlas[below + 1] = atlas[below + 2] = alpha;
    atlas[below + 3] = alpha;
  }
  return atlas;
}
