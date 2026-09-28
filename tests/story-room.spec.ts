import { expect, test, type Page } from "@playwright/test";
import {
  drawOnStory,
  mockEdit,
  mockJev,
  MOMENT_TIMEOUT,
  traceStage,
  waitForReveal,
} from "./story-mocks";

const response = {
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

async function startRoom(page: Page) {
  await page.route("**/api/interpret/scene", (route) =>
    route.fulfill({ json: response }),
  );
  await page.goto("/?mode=fixture");
  await page.getByRole("button", { name: "Start from scratch" }).click();
  await page
    .getByRole("button", { name: "Bring my world to life", exact: true })
    .click();
  // Every candidate is sure, so nothing needs a question.
  await page.getByRole("button", { name: "Start my story" }).click();
  await expect(
    page.getByRole("heading", { name: "Your Story Room" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "In this room" }),
  ).toBeVisible();
  await expect(page.getByTestId("presence-count")).toHaveText("1 person");
  await expect(page.getByTestId("room-presence")).toContainText(
    "You · director",
  );
  await waitForReveal(page);
}

test("Story Room plays a fresh server-directed sequence", async ({ page }) => {
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
            narration: "The server directs this committed moment.",
            mood: "curious",
            action: { type: "focus", entityId: "fox" },
          },
        ],
      },
    });
  });
  await startRoom(page);
  await expect(page.locator(".paper-theater-caption")).toContainText(
    "The server directs this committed moment.",
  );
});

test("Story Room explains API failure and plays the local fallback", async ({
  page,
}) => {
  await page.route("**/api/story/sequence", (route) =>
    route.fulfill({
      status: 502,
      json: {
        code: "PROVIDER_FAILED",
        message: "The story director had a problem.",
        retryable: true,
      },
    }),
  );
  await startRoom(page);
  await expect(page.getByRole("status")).toContainText(
    "playing the committed moment locally",
  );
  await expect(page.locator(".paper-theater-caption")).not.toHaveText(
    "The paper theater is ready.",
  );
});

test("a committed bridge stays visible while directing is delayed", async ({
  page,
}) => {
  let releaseBridge!: () => void;
  const bridgeGate = new Promise<void>((resolve) => {
    releaseBridge = resolve;
  });
  await page.route("**/api/story/sequence", async (route) => {
    const request = route.request().postDataJSON();
    if (request.committedEvent.revision > 0) await bridgeGate;
    const bridge = request.committedWorld.entities.find(
      (entity: { properties: string[] }) =>
        entity.properties.includes("carries"),
    );
    await route.fulfill({
      json: {
        mode: "fixture",
        requestId: request.requestId,
        sourceRevision: request.committedEvent.revision,
        sourceEventId: request.committedEvent.id,
        beats: [
          {
            id: "beat-1",
            narration: bridge ? "The bridge is ready." : "Fox looks ahead.",
            mood: "curious",
            action: bridge
              ? { type: "reveal", entityId: bridge.id }
              : { type: "focus", entityId: "fox" },
          },
        ],
      },
    });
  });
  await mockEdit(page, {
    name: "Bridge",
    properties: ["carries"],
    idPrefix: "bridge",
  });
  await startRoom(page);
  await drawOnStory(page);
  const bridge = page.locator('[data-entity-id^="bridge"]');
  await expect(bridge).toBeVisible();
  await expect(bridge).toHaveAttribute("data-reveal-state", "visible");
  releaseBridge();
  await expect(page.locator(".paper-theater-caption")).toContainText(
    "The bridge is ready.",
    { timeout: MOMENT_TIMEOUT },
  );
});

test("a delayed older response cannot replace the newest event", async ({
  page,
}) => {
  let releaseOpening!: () => void;
  const openingGate = new Promise<void>((resolve) => {
    releaseOpening = resolve;
  });
  let openingSettled = false;
  await page.route("**/api/story/sequence", async (route) => {
    const request = route.request().postDataJSON();
    if (request.committedEvent.revision === 0) await openingGate;
    const bridge = request.committedWorld.entities.find(
      (entity: { properties: string[] }) =>
        entity.properties.includes("carries"),
    );
    // The page may already have given up on the stale request.
    await route
      .fulfill({
        json: {
          mode: "fixture",
          requestId: request.requestId,
          sourceRevision: request.committedEvent.revision,
          sourceEventId: request.committedEvent.id,
          beats: [
            {
              id: "beat-1",
              narration: bridge
                ? "The newest bridge moment wins."
                : "This older opening must stay stale.",
              mood: "curious",
              action: bridge
                ? { type: "reveal", entityId: bridge.id }
                : { type: "focus", entityId: "fox" },
            },
          ],
        },
      })
      .catch(() => undefined);
    if (request.committedEvent.revision === 0) openingSettled = true;
  });
  await mockEdit(page, {
    name: "Bridge",
    properties: ["carries"],
    idPrefix: "bridge",
  });
  await startRoom(page);
  await drawOnStory(page);
  await expect(page.locator(".paper-theater-caption")).toContainText(
    "The newest bridge moment wins.",
    { timeout: MOMENT_TIMEOUT },
  );
  // Once the stale opening has been answered and the newest moment has
  // finished, it must never have reached the stage.
  const trace = await traceStage(page);
  releaseOpening();
  await expect.poll(() => openingSettled).toBe(true);
  await expect(page.locator(".paper-theater-stage")).toHaveAttribute(
    "data-action",
    "resting",
    { timeout: MOMENT_TIMEOUT },
  );
  expect((await trace()).captions).not.toContainEqual(
    expect.stringContaining("This older opening must stay stale."),
  );
});

test("starting a story opens an addressable room with the confirmed picture", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await startRoom(page);
  await expect(page).toHaveURL(/mode=fixture/);
  await expect(page).toHaveURL(/world=story-/);
  await expect(page.getByAltText("Your confirmed drawing")).toBeVisible();
  await expect(page.getByTestId("paper-theater")).toBeVisible();
  await expect(
    page.getByRole("img", { name: /Living paper theater/ }),
  ).toBeVisible();
  await expect(page.locator(".paper-theater-caption")).toBeVisible();
  await expect(page.getByText(/move only when.*commits/i)).toBeVisible();
  await expect(page.locator(".intro").getByText("Fox explores.")).toBeVisible();
  await page.getByRole("button", { name: "Copy guest link" }).click();
  const world = new URL(page.url()).searchParams.get("world");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
    "/join?mode=fixture&world=" + world,
  );
});

test("a drawn bridge that Jev lets cross opens the route and celebrates", async ({
  page,
}) => {
  // Two crossings, each a few 2–4 s beats after the opening.
  test.setTimeout(60_000);
  let releaseJev!: () => void;
  const inputs = await mockEdit(page, {
    name: "Bridge",
    properties: ["carries"],
    idPrefix: "bridge",
  });
  const asked = await mockJev(page, "crosses", {
    gate: new Promise<void>((resolve) => {
      releaseJev = resolve;
    }),
  });
  await startRoom(page);
  const hero = page.locator('[data-entity-id="fox"]');
  await expect(hero).toHaveAttribute("data-placement", "near-obstacle", {
    timeout: MOMENT_TIMEOUT,
  });
  const riverbankX = Number(await hero.getAttribute("data-logical-x"));
  await expect(page.getByText("River blocks the route")).toBeVisible();
  await expect(
    page.getByRole("button", { name: /sample bridge|storm cloud/i }),
  ).toHaveCount(0);
  await drawOnStory(page);
  // Gemini is sent the new lines over the faded picture, and where they are.
  expect(inputs[0]!.image).toMatch(/^data:image\/jpeg;base64,/);
  expect(inputs[0]!.changedRegion).toMatchObject({ width: expect.any(Number) });
  // The drawing commits before Jev answers, and adding it opens nothing.
  const bridge = page.locator('[data-entity-id="bridge-1"]');
  // The new drawing gets its own reveal moment before Jev decides anything.
  await expect(page.locator(".paper-theater-caption")).toContainText(
    "Bridge joins the story.",
    { timeout: MOMENT_TIMEOUT },
  );
  await expect(bridge).toHaveAttribute("data-reveal-state", "visible");
  await expect(page.getByTestId("pending-cutout")).toHaveCount(0);
  await expect(page.getByText(/01 · Bridge added/)).toBeVisible();
  await expect(page.getByText("River blocks the route")).toBeVisible();
  await expect(hero).toHaveAttribute("data-placement", "near-obstacle");
  expect(Number(await hero.getAttribute("data-logical-x"))).toBe(riverbankX);
  await expect.poll(() => asked).toEqual(["bridge-1"]);
  releaseJev();
  await expect(
    page.getByText(/02 · Bridge: a way across · route opened/),
  ).toBeVisible();
  await expect(page.getByText(/Fox made it across!/)).toBeVisible({
    timeout: MOMENT_TIMEOUT,
  });
  await expect(hero).toHaveAttribute("data-placement", "target-side");
  const targetSideX = Number(await hero.getAttribute("data-logical-x"));
  expect(targetSideX).toBeGreaterThan(riverbankX);
  await expect(page.getByText("Route opened", { exact: true })).toBeVisible();
  await expect(page.locator(".drawing-note")).toHaveText(
    "The bridge holds. Fox has a way through.",
  );

  // A second crossing on an open route keeps Fox where it is.
  const trace = await traceStage(page);
  await drawOnStory(page, [0.4, 0.75], [0.62, 0.77]);
  await expect(page.getByText(/04 · Bridge: a way across/)).toBeVisible();
  // Let its whole moment play (Fox crosses last), then check every caption.
  await expect
    .poll(async () => (await trace()).captions, { timeout: MOMENT_TIMEOUT })
    .toContainEqual(expect.stringContaining("Fox crosses"));
  await expect(page.locator(".paper-theater-stage")).toHaveAttribute(
    "data-action",
    "resting",
    { timeout: MOMENT_TIMEOUT },
  );
  const { captions } = await trace();
  expect(captions.filter((caption) => caption.includes("still"))).toEqual([]);
  await expect(hero).toHaveAttribute("data-placement", "target-side");
  expect(Number(await hero.getAttribute("data-logical-x"))).toBe(targetSideX);
});

test("slow strokes drawn close together become one drawing", async ({
  page,
}) => {
  const inputs = await mockEdit(page, {
    name: "Balloon",
    properties: ["flies", "carries"],
  });
  await mockJev(page, "flies_over");
  await startRoom(page);
  await page.getByRole("button", { name: "Draw something new" }).click();
  const layer = () =>
    page.getByTestId("story-drawing-layer").locator("canvas").last();
  const stroke = async (points: [number, number][], steps: number) => {
    const box = (await layer().boundingBox())!;
    await page.mouse.move(
      box.x + box.width * points[0]![0],
      box.y + box.height * points[0]![1],
    );
    await page.mouse.down();
    for (const [x, y] of points.slice(1)) {
      await page.mouse.move(box.x + box.width * x, box.y + box.height * y, {
        steps,
      });
      // Longer than the settle time while the pointer is still down.
      await page.waitForTimeout(400);
    }
    await page.mouse.up();
  };
  await stroke(
    [
      [0.45, 0.1],
      [0.55, 0.1],
      [0.55, 0.25],
      [0.45, 0.25],
    ],
    6,
  );
  await page.waitForTimeout(300);
  await stroke(
    [
      [0.47, 0.3],
      [0.53, 0.3],
      [0.53, 0.36],
      [0.47, 0.36],
    ],
    6,
  );
  // No Done: the drawing is read once the child pauses.
  await expect(page.getByText(/02 · Balloon: a flight over/)).toBeVisible();
  expect(inputs).toHaveLength(1);
  await expect(page.locator("[data-entity-id]")).toHaveCount(4);
  await expect(page.getByText(/Fox made it across!/)).toBeVisible({
    timeout: MOMENT_TIMEOUT,
  });
});

test("a stroke that ends outside the stage still becomes a drawing", async ({
  page,
}) => {
  const inputs = await mockEdit(page, {
    name: "Bridge",
    properties: ["carries"],
  });
  await mockJev(page, "crosses");
  await startRoom(page);
  await page.getByRole("button", { name: "Draw something new" }).click();
  const canvas = page
    .getByTestId("story-drawing-layer")
    .locator("canvas")
    .last();
  await canvas.scrollIntoViewIfNeeded();
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.55);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.9, box.y + box.height * 0.6, {
    steps: 10,
  });
  // Off the paper entirely, then let go there.
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height + 120, {
    steps: 10,
  });
  await page.mouse.up();
  await expect(page.getByTestId("pending-cutout")).toHaveCount(1);
  // No "Done drawing": the pause alone reads it.
  await expect(page.getByText(/02 · Bridge: a way across/)).toBeVisible();
  expect(inputs).toHaveLength(1);
});

test("the child can ask again when Jev could not decide", async ({ page }) => {
  await mockEdit(page, { name: "Bridge", properties: ["carries"] });
  let calls = 0;
  await page.route("**/api/interactions", async (route) => {
    calls += 1;
    if (calls === 1)
      return route.fulfill({
        status: 503,
        json: {
          code: "PROVIDER_RATE_LIMITED",
          message:
            "The world is busy deciding other things. Your drawing is still in the story; try again in a moment.",
          retryable: true,
        },
      });
    const body = route.request().postDataJSON();
    await route.fulfill({
      json: {
        mode: "live",
        outcome: "crosses",
        odds: 0.8,
        confidence: 0.9,
        actorId: body.entityId,
        characterId: "fox",
        obstacleId: "river",
      },
    });
  });
  await startRoom(page);
  await drawOnStory(page);
  await expect(page.locator(".drawing-note")).toContainText("try again");
  await expect(page.getByText(/01 · Bridge added/)).toBeVisible();
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByText(/02 · Bridge: a way across/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toHaveCount(0);
  expect(calls).toBe(2);
});

test("a funny failure from Jev keeps the route blocked", async ({ page }) => {
  await mockEdit(page, { name: "Raft", properties: ["floats"] });
  await mockJev(page, "splash");
  await startRoom(page);
  const hero = page.locator('[data-entity-id="fox"]');
  await drawOnStory(page);
  await expect(page.getByText(/02 · Raft: splash!/)).toBeVisible();
  await expect(page.locator(".paper-theater-caption")).toContainText(
    "Splash! Fox tumbles into River",
    { timeout: MOMENT_TIMEOUT },
  );
  await expect(page.locator(".drawing-note")).toContainText("Splash!");
  await expect(page.locator(".drawing-note")).not.toContainText(/wrong/i);
  await expect(page.getByText("River blocks the route")).toBeVisible();
  await expect(hero).toHaveAttribute("data-placement", "near-obstacle");
  await expect(page.locator(".paper-confetti")).toHaveCount(0);
});

test("without Jev a drawing still joins the story and the room says so kindly", async ({
  page,
}) => {
  // No mocks: the keyless API reads the drawing as a fixture and answers
  // PROVIDER_NOT_CONFIGURED for the interaction.
  const interactions: number[] = [];
  page.on("response", (response) => {
    if (response.url().endsWith("/api/interactions"))
      interactions.push(response.status());
  });
  await startRoom(page);
  await expect(page.locator("[data-entity-id]")).toHaveCount(3);
  await expect(
    page.getByRole("button", { name: /sample bridge|storm cloud/i }),
  ).toHaveCount(0);
  await drawOnStory(page);
  await expect(page.locator(".drawing-note")).toContainText("needs Jev");
  expect(interactions).toEqual([503]);
  await expect(page.locator("[data-entity-id]")).toHaveCount(4);
  await expect(page.getByTestId("pending-cutout")).toHaveCount(0);
  await expect(page.getByText(/01 · Bridge added/)).toBeVisible();
  await expect(page.getByText(/^Revision 1$/)).toBeVisible();
  await expect(page.getByText("River blocks the route")).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("the paper theater keeps its semantic playback on a reduced-motion mobile viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await mockEdit(page, { name: "Bridge", properties: ["carries"] });
  await mockJev(page, "crosses");
  await startRoom(page);
  await expect(page.getByTestId("paper-theater")).toBeVisible();
  await drawOnStory(page);
  await expect(page.getByText(/Fox made it across!/)).toBeVisible({
    timeout: MOMENT_TIMEOUT,
  });
  await expect(page.locator(".paper-confetti")).toHaveCount(0);
});

test("joining a fixture room without this page session cannot reopen it", async ({
  page,
}) => {
  await page.goto("/join?mode=fixture&world=story-missing");
  await expect(
    page.getByRole("heading", {
      name: "This local story is only on its first page",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Start a new drawing" }),
  ).toBeVisible();
});

async function entityPoint(page: Page, id: string) {
  const canvas = await page.locator(".story-stage-canvas").boundingBox();
  const piece = page.locator(`[data-entity-id="${id}"]`);
  const x = Number(await piece.getAttribute("data-center-x"));
  const y = Number(await piece.getAttribute("data-center-y"));
  return {
    x: canvas!.x + (x / 1000) * canvas!.width,
    y: canvas!.y + (y / 600) * canvas!.height,
  };
}

/**
 * Waits until the opening has played: the reveal is done, the opening moved
 * Fox to the riverbank, and the stage has come to rest after it.
 */
async function waitForRest(page: Page) {
  await waitForReveal(page);
  await expect(page.locator('[data-entity-id="fox"]')).toHaveAttribute(
    "data-placement",
    "near-obstacle",
    { timeout: MOMENT_TIMEOUT },
  );
  await expect(page.locator(".paper-theater-stage")).toHaveAttribute(
    "data-action",
    "resting",
    { timeout: MOMENT_TIMEOUT },
  );
}

/**
 * Stops the page clock (installed before the room opened) so the stage clock,
 * and with it every reaction and cooldown, only moves on `page.clock.runFor`.
 * `pauseAt` must be in the page's future even on a loaded machine; the stage
 * is at rest, so skipping ahead a moment changes nothing.
 */
async function freezeClock(page: Page) {
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 2000);
}

const MOTION = /^(giggle|jump|spin|wave)$/;

test("tapping a paper piece plays a local reaction with a cooldown", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.clock.install();
  await startRoom(page);
  await waitForRest(page);
  const revision = await page.getByText(/^Revision \d+$/).textContent();
  const caption = await page.locator(".paper-theater-caption").textContent();
  const fox = page.locator('[data-entity-id="fox"]');
  const castle = page.locator('[data-entity-id="castle"]');
  await freezeClock(page);

  const point = await entityPoint(page, "fox");
  await page.mouse.click(point.x, point.y);
  await expect(fox).toHaveAttribute("data-reaction-count", "1");
  await expect(fox).toHaveAttribute("data-reaction", MOTION);
  const first = await fox.getAttribute("data-reaction");
  // A second tap during the reaction is ignored, not stacked or queued. A tap
  // on another piece afterwards proves the fox tap was already handled.
  await page.mouse.click(point.x, point.y);
  const castlePoint = await entityPoint(page, "castle");
  await page.mouse.click(castlePoint.x, castlePoint.y);
  await expect(castle).toHaveAttribute("data-reaction-count", "1");
  await expect(fox).toHaveAttribute("data-reaction-count", "1");
  await expect(fox).toHaveAttribute("data-reaction", first!);

  // It finishes in under a second and leaves the story where it was.
  await page.clock.runFor(1000);
  await expect(fox).not.toHaveAttribute("data-reaction", /.+/);
  await expect(fox).toHaveAttribute("data-placement", "near-obstacle");

  // Keyboard users tickle the same piece from the accessible mirror.
  await page.getByRole("button", { name: "Tickle Fox" }).focus();
  await page.keyboard.press("Enter");
  await expect(fox).toHaveAttribute("data-reaction-count", "2");
  await expect(fox).toHaveAttribute("data-reaction", MOTION);
  expect(await fox.getAttribute("data-reaction")).not.toBe(first);

  await expect(page.getByText(/^Revision \d+$/)).toHaveText(revision!);
  await expect(page.locator(".paper-theater-caption")).toHaveText(caption!);
  expect(errors).toEqual([]);
});

test("reduced motion turns a tap into a gentle highlight", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.clock.install();
  await startRoom(page);
  await waitForRest(page);
  const revision = await page.getByText(/^Revision \d+$/).textContent();
  const castle = page.locator('[data-entity-id="castle"]');
  await freezeClock(page);
  const point = await entityPoint(page, "castle");
  await page.mouse.click(point.x, point.y);
  await expect(castle).toHaveAttribute("data-reaction", "highlight");
  await page.clock.runFor(1000);
  await expect(castle).not.toHaveAttribute("data-reaction", /.+/);
  await page.getByRole("button", { name: "Tickle Castle" }).focus();
  await page.keyboard.press("Enter");
  await expect(castle).toHaveAttribute("data-reaction", "highlight");
  await expect(castle).toHaveAttribute("data-reaction-count", "2");
  await expect(page.getByText(/^Revision \d+$/)).toHaveText(revision!);
});

test.describe("on a touch phone", () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true });

  test("a tap reacts and a swipe still scrolls the page", async ({ page }) => {
    await page.clock.install();
    await startRoom(page);
    await waitForRest(page);
    const fox = page.locator('[data-entity-id="fox"]');
    await page.locator(".story-stage-canvas").scrollIntoViewIfNeeded();
    await freezeClock(page);
    const point = await entityPoint(page, "fox");
    await page.touchscreen.tap(point.x, point.y);
    await expect(fox).toHaveAttribute("data-reaction-count", "1");
    await expect(fox).toHaveAttribute("data-reaction", MOTION);
    await page.clock.runFor(1000);
    await expect(fox).not.toHaveAttribute("data-reaction", /.+/);
    await page.clock.resume();

    // Pixi claims touch gestures by default; the canvas must hand vertical
    // swipes back to the page.
    await page.evaluate(() => window.scrollTo(0, 0));
    const canvas = (await page.locator(".story-stage-canvas").boundingBox())!;
    const x = canvas.x + canvas.width * 0.2;
    const y = canvas.y + canvas.height * 0.5;
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x, y }],
    });
    for (let step = 1; step <= 10; step++) {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x, y: y - step * 20 }],
      });
    }
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await expect
      .poll(() => page.evaluate(() => window.scrollY))
      .toBeGreaterThan(50);
    // A swipe is not a tap.
    await expect(fox).toHaveAttribute("data-reaction-count", "1");
  });
});
