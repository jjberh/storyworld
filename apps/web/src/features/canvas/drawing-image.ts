export async function readDrawing(file: File): Promise<string> {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type))
    throw new Error("Choose a PNG, JPEG, or WebP drawing.");
  if (file.size > 10_000_000)
    throw new Error("Choose a drawing smaller than 10 MB.");
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 1000;
    canvas.height = 600;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#fffdf5";
    context.fillRect(0, 0, 1000, 600);
    const scale = Math.min(1000 / bitmap.width, 600 / bitmap.height);
    const width = bitmap.width * scale,
      height = bitmap.height * scale;
    context.drawImage(
      bitmap,
      (1000 - width) / 2,
      (600 - height) / 2,
      width,
      height,
    );
    return canvas.toDataURL("image/jpeg", 0.85);
  } finally {
    bitmap.close();
  }
}

/** A real empty source layer, shared by scratch and uploaded-picture drafts. */
export function createBlankDrawing() {
  const canvas = document.createElement("canvas");
  canvas.width = 1000;
  canvas.height = 600;
  const context = canvas.getContext("2d")!;
  context.fillStyle = "#fffdf5";
  context.fillRect(0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.85);
}

/** The crayon the canvas draws with; cutouts reuse it so strokes match. */
export const CRAYON = { color: "#dd855c", width: 5 } as const;

function strokeLines(
  context: CanvasRenderingContext2D,
  lines: readonly (readonly number[])[],
  offsetX = 0,
  offsetY = 0,
) {
  context.strokeStyle = CRAYON.color;
  context.lineWidth = CRAYON.width;
  context.lineCap = "round";
  context.lineJoin = "round";
  for (const points of lines) {
    context.beginPath();
    context.moveTo(points[0]! - offsetX, points[1]! - offsetY);
    for (let i = 2; i < points.length; i += 2)
      context.lineTo(points[i]! - offsetX, points[i + 1]! - offsetY);
    if (points.length === 2)
      context.lineTo(points[0]! - offsetX + 0.1, points[1]! - offsetY);
    context.stroke();
  }
}

/**
 * The page as a JPEG: `reference` (if any) under the strokes. A faded
 * reference (`referenceOpacity` below 1) keeps new lines distinct from the
 * picture they were drawn into.
 */
export function captureDrawing(
  lines: number[][],
  reference?: HTMLImageElement,
  referenceOpacity = 1,
) {
  const canvas = document.createElement("canvas");
  canvas.width = 1000;
  canvas.height = 600;
  const context = canvas.getContext("2d")!;
  context.fillStyle = "#fffdf5";
  context.fillRect(0, 0, 1000, 600);
  if (reference) {
    context.globalAlpha = referenceOpacity;
    context.drawImage(reference, 0, 0, 1000, 600);
    context.globalAlpha = 1;
  }
  strokeLines(context, lines);
  return canvas.toDataURL("image/jpeg", 0.85);
}

/** Just the strokes inside `bounds`, on a transparent PNG, for a cutout. */
export function sketchImage(
  lines: readonly (readonly number[])[],
  bounds: { x: number; y: number; width: number; height: number },
) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bounds.width));
  canvas.height = Math.max(1, Math.round(bounds.height));
  const context = canvas.getContext("2d");
  if (!context) return "";
  strokeLines(context, lines, bounds.x, bounds.y);
  return canvas.toDataURL("image/png");
}
