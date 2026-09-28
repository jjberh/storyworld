import { expect, type Page } from "@playwright/test";

type Entity = { id: string; properties: string[] };

/**
 * Stands in for Jev: answers POST /api/interactions with `outcome` (or the
 * outcome `pick` chooses for the new drawing) for whatever drawing the page
 * asks about. Returns the entity IDs it was asked about.
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
    await route.fulfill({
      json: {
        mode: "live",
        outcome: typeof pick === "string" ? pick : pick(entity),
        odds: 0.8,
        confidence: 0.9,
        actorId: body.entityId,
        characterId: body.world.goal?.characterId ?? null,
        obstacleId: "river",
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
