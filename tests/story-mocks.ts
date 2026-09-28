import { expect, type Page } from "@playwright/test";

type Entity = { id: string; role: string; properties: string[] };

/**
 * How long to wait for a story moment to reach the stage. Beats hold 2 to 4 s,
 * a newer moment waits for the beat on stage to finish, and the line waited
 * for may be its second or third beat, so this allows for several beats.
 */
export const MOMENT_TIMEOUT = 15_000;

export type StageTrace = { captions: string[]; actions: string[] };

/**
 * Records every caption and action the live stage shows from now on, so an
 * assertion sees every beat, however briefly it was on stage, and can wait
 * for a moment to finish instead of sleeping.
 */
export async function traceStage(page: Page) {
  await page.evaluate(() => {
    const trace: StageTrace = { captions: [], actions: [] };
    (window as unknown as { stageTrace: StageTrace }).stageTrace = trace;
    const note = () => {
      const caption =
        document.querySelector(".paper-theater-caption")?.textContent ?? "";
      if (caption !== trace.captions.at(-1)) trace.captions.push(caption);
      const action =
        document
          .querySelector(".paper-theater-stage")
          ?.getAttribute("data-action") ?? "";
      if (action !== trace.actions.at(-1)) trace.actions.push(action);
    };
    new MutationObserver(note).observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["data-action"],
    });
    note();
  });
  return () =>
    page.evaluate(
      () => (window as unknown as { stageTrace: StageTrace }).stageTrace,
    );
}

/**
 * Waits for the Story Room's lift-off reveal (about 3 to 4 s after "Start my
 * story") to finish, so the pieces have landed and the opening sequence may
 * play.
 */
export async function waitForReveal(page: Page) {
  await expect(page.locator(".paper-theater-stage")).toHaveAttribute(
    "data-intro",
    "done",
    { timeout: 10_000 },
  );
}

/**
 * Stands in for Jev: answers POST /api/interactions with `outcome` (or the
 * outcome `pick` chooses for the new drawing) for whatever drawing the page
 * asks about. In free play (no goal) it answers with no odds and no
 * obstacle, as the server does. Returns the entity IDs it was asked about.
 */
export async function mockJev(
  page: Page,
  pick: string | ((entity: Entity) => string),
  options: { gate?: Promise<void>; characterId?: string } = {},
) {
  const asked: string[] = [];
  await page.route("**/api/interactions", async (route) => {
    const body = route.request().postDataJSON() as {
      entityId: string;
      world: { entities: Entity[]; goal: { characterId: string } | null };
    };
    asked.push(body.entityId);
    if (options.gate) await options.gate;
    const entity = body.world.entities.find(
      (item) => item.id === body.entityId,
    )!;
    const freePlay = body.world.goal === null;
    await route.fulfill({
      json: {
        mode: "live",
        outcome: typeof pick === "string" ? pick : pick(entity),
        odds: freePlay ? null : 0.8,
        confidence: 0.9,
        actorId: body.entityId,
        characterId:
          body.world.goal?.characterId ??
          body.world.entities.find((item) => item.role === "character")?.id ??
          null,
        obstacleId: freePlay ? null : "river",
      },
    });
  });
  return asked;
}

/** Stands in for Gemini reading one new drawing: always the same helper. */
export async function mockEdit(
  page: Page,
  entity: { name: string; properties: string[]; idPrefix?: string },
) {
  let count = 0;
  const inputs: { image?: string; changedRegion?: object }[] = [];
  await page.route("**/api/interpret/edit", async (route) => {
    const input = route.request().postDataJSON();
    inputs.push(input);
    count += 1;
    await route.fulfill({
      json: {
        mode: "live",
        message: `A ${entity.name.toLowerCase()}.`,
        candidates: [
          {
            confidence: 0.95,
            operation: {
              type: "CREATE_ENTITY",
              entity: {
                id: `${entity.idPrefix ?? "drawn"}-${count}`,
                role: "helper",
                name: entity.name,
                description: "",
                properties: entity.properties,
                bounds: input.changedRegion,
              },
            },
          },
        ],
      },
    });
  });
  return inputs;
}

/**
 * Draws one stroke on the Story Room stage, from and to points given as
 * fractions of the stage, then finishes drawing so it is read at once.
 */
export async function drawOnStory(
  page: Page,
  from: [number, number] = [0.4, 0.55],
  to: [number, number] = [0.62, 0.57],
) {
  const toggle = page.getByRole("button", { name: "Draw something new" });
  if (await toggle.isVisible()) await toggle.click();
  const canvas = page
    .getByTestId("story-drawing-layer")
    .locator("canvas")
    .last();
  await expect(canvas).toBeVisible();
  await canvas.scrollIntoViewIfNeeded();
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(
    box.x + box.width * from[0],
    box.y + box.height * from[1],
  );
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * to[0], box.y + box.height * to[1], {
    steps: 12,
  });
  await page.mouse.up();
  // The lines lift off onto a wobbling paper cutout straight away.
  await expect(page.getByTestId("pending-cutout").first()).toBeVisible();
  await page.getByRole("button", { name: "Done drawing" }).click();
}
