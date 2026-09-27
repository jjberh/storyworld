import { expect, test, type Page } from "@playwright/test";

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
  for (let index = 0; index < response.candidates.length; index++)
    await page.getByRole("button", { name: "Yes, that's right!" }).click();
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
  await startRoom(page);
  await page.getByRole("button", { name: "Add sample bridge" }).click();
  const bridge = page.locator('[data-entity-id^="bridge"]');
  await expect(bridge).toBeVisible();
  await expect(bridge).toHaveAttribute("data-reveal-state", "visible");
  releaseBridge();
  await expect(page.locator(".paper-theater-caption")).toContainText(
    "The bridge is ready.",
  );
});

test("a delayed older response cannot replace the newest event", async ({
  page,
}) => {
  let releaseOpening!: () => void;
  const openingGate = new Promise<void>((resolve) => {
    releaseOpening = resolve;
  });
  await page.route("**/api/story/sequence", async (route) => {
    const request = route.request().postDataJSON();
    if (request.committedEvent.revision === 0) await openingGate;
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
    });
  });
  await startRoom(page);
  await page.getByRole("button", { name: "Add sample bridge" }).click();
  await expect(page.locator(".paper-theater-caption")).toContainText(
    "The newest bridge moment wins.",
  );
  releaseOpening();
  await expect(page.locator(".paper-theater-caption")).not.toContainText(
    "This older opening must stay stale.",
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

test("a committed sample bridge crosses the river and celebrates", async ({
  page,
}) => {
  await startRoom(page);
  const hero = page.locator('[data-entity-id="fox"]');
  await expect(hero).toHaveAttribute("data-placement", "near-obstacle");
  const riverbankX = Number(await hero.getAttribute("data-logical-x"));
  await expect(page.getByText("River blocks the route")).toBeVisible();
  await page.getByRole("button", { name: "Add sample bridge" }).click();
  await expect(page.locator(".paper-theater-caption")).toContainText(
    "unfolds across the water",
  );
  await expect(hero).toHaveAttribute("data-placement", "near-obstacle");
  expect(Number(await hero.getAttribute("data-logical-x"))).toBe(riverbankX);
  await expect(
    page.getByText(/Paper bridge added · route opened/),
  ).toBeVisible();
  await expect(page.getByText(/Fox made it across!/)).toBeVisible();
  await expect(hero).toHaveAttribute("data-placement", "target-side");
  const targetSideX = Number(await hero.getAttribute("data-logical-x"));
  expect(targetSideX).toBeGreaterThan(riverbankX);
  await expect(page.getByText("Route opened", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Add sample bridge" }).click();
  await page.waitForTimeout(800);
  await expect(page.locator(".paper-theater-caption")).toContainText(
    "unfolds across the water",
  );
  await expect(page.locator(".paper-theater-caption")).not.toContainText(
    "still needs",
  );
  await expect(hero).toHaveAttribute("data-placement", "target-side");
  expect(Number(await hero.getAttribute("data-logical-x"))).toBe(targetSideX);
});

test("the paper theater keeps its semantic playback on a reduced-motion mobile viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await startRoom(page);
  await expect(page.getByTestId("paper-theater")).toBeVisible();
  await page.getByRole("button", { name: "Add sample bridge" }).click();
  await expect(page.getByText(/Fox made it across!/)).toBeVisible();
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

async function waitForRest(page: Page) {
  await expect(page.locator(".paper-theater-stage")).toHaveAttribute(
    "data-action",
    "resting",
  );
  await expect(page.locator('[data-entity-id="fox"]')).toHaveAttribute(
    "data-placement",
    "near-obstacle",
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
