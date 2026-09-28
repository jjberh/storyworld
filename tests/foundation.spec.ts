import { test, expect, type Page } from "@playwright/test";
import { mockJev } from "./story-mocks";

/** Draws one stroke on the Nova page, between fractions of the page. */
async function drawOnNova(
  page: Page,
  from: [number, number],
  to: [number, number],
) {
  const canvas = page.locator(".drawing-layer canvas").last();
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
}

test("fixture bridge opens route, cloud brings rain, and reset restores world", async ({
  page,
}) => {
  // Jev lets the bridge cross; the cloud is just part of the picture.
  await mockJev(page, (entity) =>
    entity.properties.includes("weather") ? "nothing_happens" : "crosses",
  );
  await page.goto("/?mode=fixture&fixture=nova");
  await expect(page.getByText("River blocks the route")).toBeVisible();
  await expect(
    page.getByRole("button", { name: /sample bridge|storm cloud/i }),
  ).toHaveCount(0);
  await drawOnNova(page, [0.38, 0.56], [0.59, 0.59]);
  await expect(
    page.getByText("Route opened", { exact: false }).first(),
  ).toBeVisible();
  await expect(page.getByLabel("Nova’s route is available")).toBeVisible();
  await expect(
    page.getByText("The bridge holds. Nova has a way through."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Cloud" }).click();
  await drawOnNova(page, [0.6, 0.15], [0.72, 0.2]);
  await expect(
    page.getByRole("button", { name: /Storm cloud added/ }),
  ).toBeVisible();
  await expect(
    page.getByText("Storm cloud is part of the picture now."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Reset world" }).click();
  await expect(page.getByText("River blocks the route")).toBeVisible();
  await expect(page.locator(".pixi-layer canvas")).toBeVisible();
});
test("mobile guest has contribution controls", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/join?mode=fixture&fixture=nova");
  await expect(page.locator(".drawing-layer canvas").last()).toBeVisible();
  await drawOnNova(page, [0.38, 0.56], [0.59, 0.59]);
  await expect(page.getByText("New guest contribution")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("a drawn bridge goes through the API and opens the route", async ({
  page,
}) => {
  await mockJev(page, "crosses");
  await page.goto("/?mode=fixture&fixture=nova");
  const canvas = page.locator(".drawing-layer canvas").last();
  await expect(canvas).toBeVisible();
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Drawing surface missing");
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.mouse.move(box.x + box.width * 0.38, box.y + box.height * 0.56);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.59, box.y + box.height * 0.59, {
    steps: 12,
  });
  const response = page.waitForResponse((r) =>
    r.url().endsWith("/api/interpret/edit"),
  );
  const interaction = page.waitForResponse((r) =>
    r.url().endsWith("/api/interactions"),
  );
  await page.mouse.up();
  expect((await response).status()).toBe(200);
  expect((await interaction).status()).toBe(200);
  await expect(
    page.getByText("Route opened", { exact: false }).first(),
  ).toBeVisible();
  await expect(
    page.getByText("The bridge holds. Nova has a way through."),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("without Jev the Nova drawing joins the world and the route stays blocked", async ({
  page,
}) => {
  await page.goto("/?mode=fixture&fixture=nova");
  await drawOnNova(page, [0.38, 0.56], [0.59, 0.59]);
  await expect(page.getByText(/needs Jev/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Bridge added/ }),
  ).toBeVisible();
  await expect(page.getByText("River blocks the route")).toBeVisible();
});
