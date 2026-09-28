import { expect, test, type Page } from "@playwright/test";
import { drawOnStory, mockEdit, mockJev, waitForReveal } from "./story-mocks";

// The Story Room's lift-off reveal: after "Start my story" the confirmed
// drawing lies flat, the pieces lift off together and land, and only then
// does the opening sequence play. A later drawing gets a short lift of its
// own. All of it is presentation: the world's revision never moves.

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

const READY = "The paper theater is ready.";

type Frame = {
  t: number;
  intro: string | null;
  caption: string;
  states: Record<string, string | null>;
};

/**
 * Records every change to the stage's reveal state, captions and piece
 * states from the first paint of every page load, so a state that lasts a
 * frame cannot slip past an assertion.
 */
async function traceStage(page: Page) {
  await page.addInitScript(() => {
    const frames: Frame[] = [];
    (window as unknown as { revealTrace: Frame[] }).revealTrace = frames;
    const key = (frame: Frame) => JSON.stringify({ ...frame, t: 0 });
    const note = () => {
      const stage = document.querySelector(".paper-theater-stage");
      if (!stage) return;
      const states: Frame["states"] = {};
      for (const piece of document.querySelectorAll("[data-entity-id]"))
        states[piece.getAttribute("data-entity-id")!] =
          piece.getAttribute("data-reveal-state");
      const frame: Frame = {
        t: performance.now(),
        intro: stage.getAttribute("data-intro"),
        caption:
          document.querySelector(".paper-theater-caption")?.textContent ?? "",
        states,
      };
      const last = frames.at(-1);
      if (!last || key(last) !== key(frame)) frames.push(frame);
    };
    new MutationObserver(note).observe(document, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["data-intro", "data-reveal-state"],
    });
  });
  return () =>
    page.evaluate(
      () => (window as unknown as { revealTrace: Frame[] }).revealTrace,
    );
}

async function openRoom(page: Page, mode: "fixture" | "live" = "fixture") {
  await page.route("**/api/interpret/scene", (route) =>
    route.fulfill({ json: scene }),
  );
  await page.goto("/?mode=" + mode);
  await page.getByRole("button", { name: "Start from scratch" }).click();
  // A castle outline inside the castle's box, so its paper piece carries ink
  // the canvas checks below can find.
  const canvas = page.locator(".drawing-layer canvas").last();
  await expect(canvas).toBeVisible();
  const box = (await canvas.boundingBox())!;
  const at = (x: number, y: number) =>
    [box.x + box.width * x, box.y + box.height * y] as const;
  await page.mouse.move(...at(0.74, 0.37));
  await page.mouse.down();
  for (const [x, y] of [
    [0.74, 0.25],
    [0.86, 0.25],
    [0.86, 0.37],
    [0.74, 0.37],
  ] as const)
    await page.mouse.move(...at(x, y), { steps: 6 });
  await page.mouse.up();
  await expect(page.getByText("1 mark on the page")).toBeVisible();
  await page
    .getByRole("button", { name: "Bring my world to life", exact: true })
    .click();
  await page.getByRole("button", { name: "Start my story" }).click();
  await expect(
    page.getByRole("heading", { name: "Your Story Room" }),
  ).toBeVisible({ timeout: 20_000 });
}

const allStates = (frame: Frame) => Object.values(frame.states);

/**
 * The topmost row (in canvas pixels) of the castle's crayon ink, read from a
 * clipped screenshot of the stage canvas. It moves up only if the piece
 * rises. The page is tall enough that the stage never scrolls away.
 */
async function castleInkTop(page: Page, clip: Clip) {
  const shot = await page.screenshot({ clip, type: "jpeg", quality: 90 });
  return page.evaluate(async (data) => {
    const image = new Image();
    image.src = "data:image/jpeg;base64," + data;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d")!;
    context.drawImage(image, 0, 0);
    const { width, height } = canvas;
    const pixels = context.getImageData(0, 0, width, height).data;
    // The castle's box spans x 0.7–0.9 and y 0.2–0.4 of the stage.
    for (let y = Math.round(height * 0.05); y < height * 0.5; y++) {
      let ink = 0;
      for (let x = Math.round(width * 0.7); x < width * 0.9; x++) {
        const index = (y * width + x) * 4;
        // Orange crayon: far more red than blue; paper and shadows are not.
        if (pixels[index]! - pixels[index + 2]! > 40) ink++;
      }
      if (ink >= 3) return y;
    }
    return null;
  }, shot.toString("base64"));
}

type Clip = { x: number; y: number; width: number; height: number };

/** Where the stage canvas is, once it is in view. */
async function stageClip(page: Page): Promise<Clip> {
  const canvas = page.locator(".story-stage-canvas");
  await canvas.scrollIntoViewIfNeeded();
  return (await canvas.boundingBox())!;
}

/**
 * Samples the castle's ink top until the reveal is done, with the castle's
 * reveal state at each sample.
 */
async function castleTopsDuringReveal(page: Page) {
  const clip = await stageClip(page);
  const samples: { top: number | null; state: string | null }[] = [];
  const castleState = () =>
    page.evaluate(() =>
      document
        .querySelector(".paper-theater-stage")
        ?.getAttribute("data-intro") === "playing"
        ? (document
            .querySelector('[data-entity-id="castle"]')
            ?.getAttribute("data-reveal-state") ?? null)
        : undefined,
    );
  for (let state = await castleState(); state !== undefined;) {
    samples.push({ top: await castleInkTop(page, clip), state });
    state = await castleState();
  }
  return samples;
}

/** The reveal as traced: flat, lifting, landed, then the opening. */
function expectFullReveal(frames: Frame[]) {
  const staged = frames.filter((frame) => frame.intro !== null);
  const first = staged[0]!;
  expect(first.intro).toBe("playing");
  expect(first.caption).toBe(READY);
  expect(Object.keys(first.states).sort()).toEqual(["castle", "fox", "river"]);
  expect(allStates(first)).toEqual(["flat", "flat", "flat"]);
  // The pieces rise together: at some point all of them are in the air.
  expect(
    staged.some((frame) =>
      allStates(frame).every((state) => state === "lifting"),
    ),
  ).toBe(true);
  const doneAt = staged.findIndex((frame) => frame.intro === "done");
  expect(doneAt).toBeGreaterThan(0);
  const done = staged[doneAt]!;
  expect(allStates(done)).toEqual(["visible", "visible", "visible"]);
  // The reveal takes about 3 s of stage time; a busy machine only makes it
  // longer, so the upper bound is generous. The order above is what counts,
  // and the opening never shares the stage with it.
  const lasted = done.t - first.t;
  expect(lasted).toBeGreaterThan(2800);
  expect(lasted).toBeLessThan(15_000);
  for (const frame of staged.slice(0, doneAt)) {
    expect(frame.intro).toBe("playing");
    expect(frame.caption).toBe(READY);
  }
  // Once done it stays done.
  for (const frame of staged.slice(doneAt)) expect(frame.intro).toBe("done");
}

test("Start my story opens the room with the lift-off reveal, then the opening", async ({
  page,
}) => {
  // Tall enough that the whole stage stays in view for canvas samples.
  await page.setViewportSize({ width: 1280, height: 1400 });
  const trace = await traceStage(page);
  await openRoom(page);
  const stage = page.locator(".paper-theater-stage");
  await expect(stage).toHaveAttribute("data-motion", "full");
  // Flat or rising pieces cannot be tickled yet.
  await expect(stage).toHaveAttribute("data-intro", "playing");
  await expect(page.getByRole("button", { name: "Tickle Fox" })).toBeDisabled();
  // The castle's ink rises off the paper during the reveal.
  const samples = await castleTopsDuringReveal(page);
  await waitForReveal(page);
  const flat = samples[0]!.top!;
  expect(flat).not.toBeNull();
  const lifted = samples.filter((sample) => sample.state === "lifting");
  expect(Math.min(...lifted.map((sample) => sample.top ?? flat))).toBeLessThan(
    flat - 6,
  );
  await expect(page.getByRole("button", { name: "Tickle Fox" })).toBeEnabled();
  // The opening narration plays after the reveal.
  await expect(page.locator(".paper-theater-caption")).not.toHaveText(READY);
  const opening = await page.locator(".paper-theater-caption").textContent();
  const frames = await trace();
  expectFullReveal(frames);
  const firstOpening = frames.findIndex((frame) => frame.caption === opening);
  expect(frames[firstOpening]!.intro).toBe("done");
  // Presentation only: the world is still at its first revision.
  await expect(page.getByText(/^Revision 0$/)).toBeVisible();
});

test("a new drawing gets its own short lift-off, and the story goes on", async ({
  page,
}) => {
  const trace = await traceStage(page);
  await mockEdit(page, {
    name: "Bridge",
    properties: ["carries"],
    idPrefix: "bridge",
  });
  const asked = await mockJev(page, "crosses");
  await openRoom(page);
  await waitForReveal(page);
  await drawOnStory(page);
  const bridge = page.locator('[data-entity-id="bridge-1"]');
  await expect(bridge).toHaveAttribute("data-reveal-state", "visible");
  await expect(page.getByText(/Fox made it across!/)).toBeVisible();
  expect(asked).toEqual(["bridge-1"]);
  const frames = await trace();
  const withBridge = frames.filter((frame) => "bridge-1" in frame.states);
  // It lifted, landed, and nothing else replayed the full reveal.
  expect(withBridge[0]!.states["bridge-1"]).toBe("lifting");
  expect(withBridge.at(-1)!.states["bridge-1"]).toBe("visible");
  const lifting = withBridge.filter(
    (frame) => frame.states["bridge-1"] === "lifting",
  );
  const landed = withBridge.find(
    (frame) => frame.states["bridge-1"] === "visible",
  )!;
  // A short lift (0.9 s of stage time); generous for a busy machine.
  expect(landed.t - lifting[0]!.t).toBeLessThan(10_000);
  for (const frame of withBridge) {
    expect(frame.intro).toBe("done");
    expect(frame.states.fox).toBe("visible");
  }
});

test("reduced motion fades the pieces in instead of lifting them", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1280, height: 1400 });
  const trace = await traceStage(page);
  await openRoom(page);
  await expect(page.locator(".paper-theater-stage")).toHaveAttribute(
    "data-motion",
    "reduced",
  );
  const samples = await castleTopsDuringReveal(page);
  await waitForReveal(page);
  await expect(page.locator(".paper-theater-caption")).not.toHaveText(READY);
  // Same flat → fade → landed order, and the opening after it.
  expectFullReveal(await trace());
  // No rise and no shake: the castle's ink never leaves its resting row,
  // including while it fades in.
  const rest = await castleInkTop(page, await stageClip(page));
  expect(rest).not.toBeNull();
  expect(samples.some((sample) => sample.state === "lifting")).toBe(true);
  for (const { top } of samples) {
    expect(top).not.toBeNull();
    expect(Math.abs(top! - rest!)).toBeLessThanOrEqual(1);
  }
});

/**
 * Reloads `page` (or opens `url` in it) and checks the pieces are standing
 * from the first frame. Fixture rooms cannot be reopened at all, so this
 * runs against a live room.
 */
async function expectNoReplay(page: Page, url?: string) {
  const trace = await traceStage(page);
  if (url) await page.goto(url);
  else await page.reload();
  await expect(page.locator("[data-entity-id]")).toHaveCount(3);
  // The latest moment plays straight away, with the pieces standing.
  await expect(page.locator(".paper-theater-caption")).not.toHaveText(READY, {
    timeout: 10_000,
  });
  const frames = await trace();
  expect(frames.length).toBeGreaterThan(0);
  for (const frame of frames) {
    expect(frame.intro).toBe("done");
    for (const state of allStates(frame)) expect(state).toBe("visible");
  }
}

test("a reload or a guest sees the pieces standing: no replayed reveal", async ({
  browser,
}) => {
  test.skip(
    !process.env.TEST_LIVE,
    "Enable TEST_LIVE with a local module configured.",
  );
  const director = await browser.newContext();
  const guest = await browser.newContext();
  try {
    const page = await director.newPage();
    const trace = await traceStage(page);
    await openRoom(page, "live");
    await waitForReveal(page);
    expectFullReveal(await trace());
    const world = new URL(page.url()).searchParams.get("world")!;
    expect(page.url()).toContain("mode=live");
    await expectNoReplay(page);
    await expectNoReplay(
      await guest.newPage(),
      `/join?mode=live&world=${world}`,
    );
  } finally {
    await director.close();
    await guest.close();
  }
});
