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

export function captureDrawing(
  lines: number[][],
  reference?: HTMLImageElement,
) {
  const canvas = document.createElement("canvas");
  canvas.width = 1000;
  canvas.height = 600;
  const context = canvas.getContext("2d")!;
  context.fillStyle = "#fffdf5";
  context.fillRect(0, 0, 1000, 600);
  if (reference) context.drawImage(reference, 0, 0, 1000, 600);
  context.strokeStyle = "#dd855c";
  context.lineWidth = 5;
  context.lineCap = "round";
  context.lineJoin = "round";
  for (const points of lines) {
    context.beginPath();
    context.moveTo(points[0]!, points[1]!);
    for (let i = 2; i < points.length; i += 2)
      context.lineTo(points[i]!, points[i + 1]!);
    context.stroke();
  }
  return canvas.toDataURL("image/jpeg", 0.85);
}
