import { test, expect, type Page } from "@playwright/test";
import type { InterpretationInput } from "@storyworld/contracts";

async function drawBridge(page: Page) {
  const canvas = page.locator(".drawing-layer canvas");
  await expect(canvas).toBeVisible();
  await canvas.scrollIntoViewIfNeeded();
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.38, box.y + box.height * 0.56);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.59, box.y + box.height * 0.59, {
    steps: 12,
  });
  await page.mouse.up();
}

const response = {
  mode: "fixture",
  message: "A bridge for Nova.",
  candidates: [
    {
      confidence: 0.95,
      operation: {
        type: "CREATE_ENTITY",
        entity: {
          id: "test-bridge",
          name: "Bridge",
          kind: "bridge",
          bounds: { x: 385, y: 330, width: 190, height: 55 },
        },
      },
    },
  ],
};

test("rewinding after a failed interpretation discards the stale retry", async ({
  page,
}) => {
  await page.route("**/api/interpret/edit", (route) =>
    route.fulfill({ status: 504, json: { message: "Timed out" } }),
  );
  await page.goto("/?mode=fixture");
  await drawBridge(page);
  await expect(
    page.getByRole("button", { name: "Try my drawing again" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "00 · The adventure begins" }).click();
  await expect(
    page.getByRole("button", { name: "Try my drawing again" }),
  ).toHaveCount(0);
});

test("dismissing a preview allows reinterpretation with revised narration", async ({
  page,
}) => {
  const inputs: InterpretationInput[] = [];
  await page.route("**/api/interpret/edit", (route) => {
    inputs.push(route.request().postDataJSON());
    return route.fulfill({
      json: {
        ...response,
        candidates: [{ ...response.candidates[0], confidence: 0.5 }],
      },
    });
  });
  await page.goto("/?mode=fixture");
  await drawBridge(page);
  await page.getByRole("button", { name: "Keep drawing" }).click();
  await page.getByLabel("The story so far").fill("It is a bridge for Nova.");
  await page.getByRole("button", { name: "Try my drawing again" }).click();
  await expect(
    page.getByRole("button", { name: "Make it a Bridge" }),
  ).toBeVisible();
  expect(inputs).toHaveLength(2);
  expect(inputs[1]!.transcript).toBe("It is a bridge for Nova.");
});

test("a timeout preserves the drawing and retries its image with updated narration", async ({
  page,
}) => {
  const inputs: InterpretationInput[] = [];
  await page.route("**/api/interpret/edit", async (route) => {
    inputs.push(route.request().postDataJSON());
    await route.fulfill(
      inputs.length === 1
        ? {
            status: 504,
            json: {
              code: "PROVIDER_TIMEOUT",
              retryable: true,
              message: "Timed out",
            },
          }
        : { json: response },
    );
  });
  await page.goto("/?mode=fixture");
  await drawBridge(page);
  await expect(
    page.getByRole("button", { name: "Try my drawing again" }),
  ).toBeVisible();
  await expect(page.getByText("River blocks the route")).toBeVisible();
  const preserved = await page
    .locator(".drawing-layer canvas")
    .evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
  await page.getByLabel("The story so far").fill("Nova crosses my bridge.");
  await page.getByRole("button", { name: "Try my drawing again" }).click();
  await expect(
    page.getByText("The bridge holds. Nova has a way through."),
  ).toBeVisible();
  expect(inputs).toHaveLength(2);
  expect(inputs[0]!.image).toMatch(/^data:image\/jpeg;base64,/);
  expect(inputs[1]!.image).toEqual(inputs[0]!.image);
  expect(inputs[1]!.changedRegion).toEqual(inputs[0]!.changedRegion);
  expect(inputs[1]!.transcript).toBe("Nova crosses my bridge.");
  expect(
    await page
      .locator(".drawing-layer canvas")
      .evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL()),
  ).toBe(preserved);
});

test("uncertain interpretations wait for confirmation before changing the world", async ({
  page,
}) => {
  await page.route("**/api/interpret/edit", (route) =>
    route.fulfill({
      json: {
        ...response,
        candidates: [{ ...response.candidates[0], confidence: 0.5 }],
      },
    }),
  );
  await page.goto("/?mode=fixture");
  await drawBridge(page);
  await expect(
    page.getByRole("group", { name: "Choose what your drawing becomes" }),
  ).toBeVisible();
  await expect(page.getByText("River blocks the route")).toBeVisible();
  await page.getByRole("button", { name: "Make it a Bridge" }).click();
  await expect(
    page.getByText("The bridge holds. Nova has a way through."),
  ).toBeVisible();
});

test("a guest confirmation creates a proposal without opening the route", async ({
  page,
}) => {
  await page.route("**/api/interpret/edit", (route) =>
    route.fulfill({ json: response }),
  );
  await page.goto("/join?mode=fixture");
  await drawBridge(page);
  await expect(
    page.getByText("Your proposal is ready for the director."),
  ).toBeVisible();
  await expect(page.getByText("New guest contribution")).toBeVisible();
  await expect(page.getByText("River blocks the route")).toBeVisible();
});

test("an uploaded reference survives an interpretation failure", async ({
  page,
}) => {
  await page.route("**/api/interpret/edit", (route) =>
    route.fulfill({ status: 504, json: { message: "Timed out" } }),
  );
  await page.goto("/?mode=fixture");
  const image = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 100;
    canvas.height = 60;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "blue";
    context.fillRect(0, 0, 100, 60);
    return canvas.toDataURL("image/png").split(",")[1]!;
  });
  await page.getByLabel("Upload a drawing").setInputFiles({
    name: "drawing.png",
    mimeType: "image/png",
    buffer: Buffer.from(image, "base64"),
  });
  await expect(
    page.getByText(
      "Your drawing is on the page. Trace the part you want to bring to life.",
    ),
  ).toBeVisible();
  await drawBridge(page);
  await expect(
    page.getByRole("button", { name: "Try my drawing again" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Hide uploaded drawing" }),
  ).toBeVisible();
});
