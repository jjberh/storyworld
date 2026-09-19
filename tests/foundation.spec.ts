import { test, expect } from "@playwright/test";
test("fixture bridge opens route, cloud brings rain, and reset restores world", async ({
  page,
}) => {
  await page.goto("/?mode=fixture&fixture=nova");
  await expect(page.getByText("River blocks the route")).toBeVisible();
  await page.getByRole("button", { name: "Add sample bridge" }).click();
  await expect(
    page.getByText("Route opened", { exact: false }).first(),
  ).toBeVisible();
  await expect(page.getByLabel("Nova’s route is available")).toBeVisible();
  await page.getByRole("button", { name: "Add storm cloud" }).click();
  await expect(
    page.getByRole("button", { name: /Storm cloud added/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Reset world" }).click();
  await expect(page.getByText("River blocks the route")).toBeVisible();
  await expect(page.locator(".pixi-layer canvas")).toBeVisible();
});
test("mobile guest has contribution controls", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/join?mode=fixture&fixture=nova");
  await expect(
    page.getByRole("button", { name: "Propose storm cloud" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Propose storm cloud" }).click();
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
  await page.mouse.up();
  expect((await response).status()).toBe(200);
  await expect(
    page.getByText("Route opened", { exact: false }).first(),
  ).toBeVisible();
  await expect(
    page.getByText("The bridge holds. Nova has a way through."),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
