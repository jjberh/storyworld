import { expect, test, type Page } from "@playwright/test";
import {
  drawOnStory,
  mockEdit,
  mockJev,
  MOMENT_TIMEOUT,
  waitForReveal,
} from "./story-mocks";

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
  // Turn on the stage's test hook, which reports each piece's drawn pose.
  await page.addInitScript(() => {
    (window as unknown as { __storyStageTest: boolean }).__storyStageTest =
      true;
  });
  await page.goto("/?mode=" + mode);
  await page.getByRole("button", { name: "Start from scratch" }).click();
  // A castle outline inside the castle's box, so its paper piece is cut from
  // real ink.
  const canvas = page.locator(".drawing-layer canvas").last();
  await expect(canvas).toBeVisible();
  // The paper sizes its canvas from a ResizeObserver, a frame or two behind
  // the page's first layout. Strokes aimed at a box measured before then land
  // scaled down, outside the castle, so wait until the canvas fills the paper.
  await expect
    .poll(() =>
      canvas.evaluate((element) => {
        const paper = element.closest(".authoring-paper-wrap")!;
        const style = getComputedStyle(paper);
        const inner =
          paper.clientWidth -
          parseFloat(style.paddingLeft) -
          parseFloat(style.paddingRight);
        return Math.abs(element.getBoundingClientRect().width - inner) < 1;
      }),
    )
    .toBe(true);
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

type Pose = { top: number; scaleX: number; scaleY: number };

/**
 * The castle piece as the stage last drew it (through its test hook): the
 * top edge of its box after scaling, in stage units, and its scale. The top
 * moves up only if the piece rises or grows.
 */
function castlePose(page: Page) {
  return page.evaluate(
    () =>
      (
        window as unknown as {
          __storyStageDebug?: { poses: () => Record<string, Pose> };
        }
      ).__storyStageDebug?.poses().castle ?? null,
  );
}

/** Stage time between samples during the reveal. */
const SAMPLE_STEP_MS = 150;
/** The castle must rise at least this far (stage units) to count as lifted;
 * the reveal's peak is a 22-unit rise plus a 7% swell. */
const LIFT_THRESHOLD = 8;

/**
 * Samples the castle's pose until the reveal is done, with the castle's
 * reveal state at each sample. The page clock (installed before the room
 * opened) is held and stepped between samples, so each one is a known moment
 * of the reveal however slowly the page answers on a busy machine. Holding it
 * fires each timer at most once, and the stage advances at most 100 ms a
 * frame, so the reveal barely moves while it is caught. The clock runs freely
 * again once the reveal is done.
 */
async function castlePosesDuringReveal(page: Page) {
  // The stage has drawn the castle at least once.
  await expect.poll(() => castlePose(page)).not.toBeNull();
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1000);
  const samples: (Pose & { state: string | null })[] = [];
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
    samples.push({ ...(await castlePose(page))!, state });
    await page.clock.runFor(SAMPLE_STEP_MS);
    state = await castleState();
  }
  // Landed, where it started.
  const rest = (await castlePose(page))!;
  await page.clock.resume();
  // One screen pixel of the stage, in stage units.
  const width = await page
    .locator(".story-stage-canvas")
    .evaluate((canvas) => canvas.getBoundingClientRect().width);
  return { samples, rest, pixel: 1000 / width };
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
  // Canvas samples are slow on a busy machine; the stepped clock waits.
  test.setTimeout(90_000);
  // Tall enough that the whole stage stays in view for canvas samples.
  await page.setViewportSize({ width: 1280, height: 1400 });
  const trace = await traceStage(page);
  await page.clock.install();
  await openRoom(page);
  const stage = page.locator(".paper-theater-stage");
  await expect(stage).toHaveAttribute("data-motion", "full");
  // Flat or rising pieces cannot be tickled yet.
  await expect(stage).toHaveAttribute("data-intro", "playing");
  await expect(page.getByRole("button", { name: "Tickle Fox" })).toBeDisabled();
  // The castle rises off the paper during the reveal.
  const { samples, rest, pixel } = await castlePosesDuringReveal(page);
  await waitForReveal(page);
  // Caught flat on the paper first: at its box, unscaled.
  expect(samples[0]!.state).toBe("flat");
  const flat = samples[0]!.top;
  expect(flat).toBeCloseTo(120, 1);
  expect(samples[0]!.scaleY).toBe(1);
  const lifted = samples.filter((sample) => sample.state === "lifting");
  expect(Math.min(...lifted.map((sample) => sample.top))).toBeLessThan(
    flat - LIFT_THRESHOLD,
  );
  // And it lands back where it lay, to within a screen pixel (its idle
  // sway included).
  expect(Math.abs(rest.top - flat)).toBeLessThanOrEqual(pixel);
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
  // The opening, the drawing's moment and Jev's outcome, each a few 2–4 s
  // beats (slower still on a loaded machine).
  test.setTimeout(60_000);
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
  await expect(page.getByText(/Fox made it across!/)).toBeVisible({
    timeout: MOMENT_TIMEOUT,
  });
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
  test.setTimeout(90_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1280, height: 1400 });
  const trace = await traceStage(page);
  await page.clock.install();
  await openRoom(page);
  await expect(page.locator(".paper-theater-stage")).toHaveAttribute(
    "data-motion",
    "reduced",
  );
  const { samples, rest, pixel } = await castlePosesDuringReveal(page);
  await waitForReveal(page);
  await expect(page.locator(".paper-theater-caption")).not.toHaveText(READY);
  // Same flat → fade → landed order, and the opening after it.
  expectFullReveal(await trace());
  // No rise, no swell and no shake: the castle never leaves its resting
  // place, including while it fades in.
  expect(samples[0]!.state).toBe("flat");
  expect(samples.some((sample) => sample.state === "lifting")).toBe(true);
  for (const { top, scaleX, scaleY } of [...samples, rest]) {
    expect(Math.abs(top - rest.top)).toBeLessThanOrEqual(pixel);
    expect(scaleX).toBe(1);
    expect(scaleY).toBe(1);
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
