import { expect, test, type Page } from "@playwright/test";
import { waitForReveal } from "./story-mocks";

// Scene pieces are cut from the drawing along their strokes, like stickers:
// the paper around them turns see-through. A box with nothing drawn in it
// cannot be cut and falls back to the plain rectangle.

const scene = {
  mode: "live",
  message: "A fox by a castle.",
  candidates: [
    {
      id: "fox",
      name: "Fox",
      role: "character",
      description: "",
      properties: ["moves"],
      confidence: 1,
      imageBounds: { x: 0.1, y: 0.2, width: 0.2, height: 0.2 },
    },
    {
      id: "castle",
      name: "Castle",
      role: "goal",
      description: "",
      properties: ["goal"],
      confidence: 1,
      imageBounds: { x: 0.7, y: 0.2, width: 0.2, height: 0.2 },
    },
    {
      // Nothing is drawn in the river's box.
      id: "river",
      name: "River",
      role: "obstacle",
      description: "",
      properties: ["blocks"],
      confidence: 1,
      imageBounds: { x: 0.45, y: 0.05, width: 0.12, height: 0.9 },
    },
  ],
  characterCandidateId: "fox",
  goalCandidateId: "castle",
  openingNarration: "Fox explores.",
  moodHints: ["curious"],
};

/**
 * A photo-like drawing: grey, slightly noisy paper with a closed castle
 * outline and a filled fox, as a 1000x600 PNG.
 */
async function greyPaperDrawing(page: Page) {
  const dataUrl = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 1000;
    canvas.height = 600;
    const context = canvas.getContext("2d")!;
    const paper = context.createImageData(1000, 600);
    let seed = 11;
    for (let index = 0; index < 1000 * 600; index++) {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      const jitter = Math.round((seed / 2147483648) * 12 - 6);
      paper.data.set(
        [170 + jitter, 168 + jitter, 160 + jitter, 255],
        index * 4,
      );
    }
    context.putImageData(paper, 0, 0);
    context.strokeStyle = "rgb(60, 40, 90)";
    context.lineWidth = 6;
    context.lineJoin = "round";
    context.strokeRect(740, 150, 120, 72);
    context.fillStyle = "rgb(221, 133, 92)";
    context.beginPath();
    context.ellipse(200, 180, 50, 30, 0, 0, Math.PI * 2);
    context.fill();
    return canvas.toDataURL("image/png");
  });
  return Buffer.from(dataUrl.split(",")[1]!, "base64");
}

async function openRoom(page: Page) {
  await page.route("**/api/interpret/scene", (route) =>
    route.fulfill({ json: scene }),
  );
  // One quiet beat, so no piece moves while the canvas is sampled.
  await page.route("**/api/story/sequence", async (route) => {
    const request = route.request().postDataJSON();
    await route.fulfill({
      json: {
        mode: "fixture",
        requestId: request.requestId,
        sourceRevision: request.committedEvent.revision,
        sourceEventId: request.committedEvent.id,
        beats: [
          {
            id: "beat-1",
            narration: "The castle waits.",
            mood: "curious",
            action: { type: "focus", entityId: "castle" },
          },
        ],
      },
    });
  });
  await page.goto("/?mode=fixture");
  await page.getByLabel("Choose a drawing file").setInputFiles({
    name: "grey-paper.png",
    mimeType: "image/png",
    buffer: await greyPaperDrawing(page),
  });
  await expect(page.locator(".drawing-layer canvas").last()).toBeVisible();
  await page
    .getByRole("button", { name: "Bring my world to life", exact: true })
    .click();
  await page.getByRole("button", { name: "Start my story" }).click();
  await expect(
    page.getByRole("heading", { name: "Your Story Room" }),
  ).toBeVisible({ timeout: 20_000 });
  await waitForReveal(page);
}

/**
 * Mean brightness of 5x5 patches of the stage canvas, at points given in
 * the 1000x600 stage's units.
 */
async function brightness(page: Page, points: [number, number][]) {
  const canvas = page.locator(".story-stage-canvas");
  await canvas.scrollIntoViewIfNeeded();
  const shot = await canvas.screenshot({ type: "png" });
  return page.evaluate(
    async ({ data, points }) => {
      const image = new Image();
      image.src = "data:image/png;base64," + data;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext("2d")!;
      context.drawImage(image, 0, 0);
      const scale = image.width / 1000;
      return points.map(([x, y]) => {
        const { data } = context.getImageData(
          Math.round(x * scale) - 2,
          Math.round(y * scale) - 2,
          5,
          5,
        );
        let sum = 0;
        for (let index = 0; index < data.length; index += 4)
          sum += (data[index]! + data[index + 1]! + data[index + 2]!) / 3;
        return sum / 25;
      });
    },
    { data: shot.toString("base64"), points },
  );
}

test("scene pieces are cut along their strokes; an empty box stays a rectangle", async ({
  page,
}) => {
  test.setTimeout(60_000);
  // No idle bobbing, so every piece stays exactly on its box.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1280, height: 1400 });
  await openRoom(page);
  const piece = (id: string) => page.locator(`[data-entity-id="${id}"]`);
  await expect(piece("castle")).toHaveAttribute("data-cutout", "mask");
  await expect(piece("fox")).toHaveAttribute("data-cutout", "mask");
  await expect(piece("river")).toHaveAttribute("data-cutout", "rect");
  await expect(page.locator(".paper-theater-caption")).toHaveText(
    "The castle waits.",
  );

  // The canvas is sampled until the drawn frame shows the settled pieces
  // (a busy machine may still be catching up), not once.
  await expect(async () => {
    const [
      castleCorner,
      castleOutside,
      castleInside,
      riverCorner,
      riverOutside,
    ] = await brightness(page, [
      // Just inside the castle's box, away from its outline.
      [706, 126],
      // Just outside the castle's box: the faded drawing.
      [694, 114],
      // Inside the castle's walls.
      [800, 186],
      [456, 36],
      [444, 24],
    ]);
    // The castle's box corner shows the faded drawing, as outside the box:
    // the paper there was cut away.
    expect(Math.abs(castleCorner! - castleOutside!)).toBeLessThan(12);
    // Inside its closed walls the piece keeps its paper, evened out to white.
    expect(castleInside!).toBeGreaterThan(castleCorner! + 20);
    // The river's rectangle carries the grey paper, darker than the faded
    // drawing around it.
    expect(riverCorner!).toBeLessThan(riverOutside! - 20);
  }).toPass({ timeout: 15_000 });
});
