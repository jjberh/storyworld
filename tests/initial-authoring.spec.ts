import { expect, test } from "@playwright/test";

const interpretedScene = {
  mode: "live",
  message: "Picture saved.",
  candidates: [
    {
      id: "character",
      kind: "character",
      name: "Character",
      confidence: 1,
      imageBounds: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
    },
  ],
  openingNarration: "A new story begins.",
  characterCandidateId: "character",
  moodHints: ["curious"],
};

test("the default flow begins with the two authoring choices", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Start from scratch" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Upload a drawing" }),
  ).toBeVisible();
  await expect(page.getByText("Nova")).toHaveCount(0);
  await page.getByRole("button", { name: "Start from scratch" }).click();
  await expect(
    page.getByText("Tell your story what happens next."),
  ).toBeVisible();
  await expect(page.locator(".drawing-layer canvas").last()).toBeVisible();
  await page
    .locator(".drawing-layer canvas")
    .last()
    .click({
      position: { x: 100, y: 100 },
    });
  await expect(page.getByText("Your canvas is ready")).toBeVisible();
});

test("a source image and later strokes stay in the scene draft when retrying", async ({
  page,
}) => {
  const inputs: unknown[] = [];
  await page.route("**/api/interpret/scene", (route) => {
    inputs.push(route.request().postDataJSON());
    return route.fulfill(
      inputs.length === 1
        ? { status: 504, json: { message: "Timed out", retryable: true } }
        : { json: interpretedScene },
    );
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Start from scratch" }).click();
  const canvas = page.locator(".drawing-layer canvas").last();
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + 100, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 180, box.y + 140, { steps: 4 });
  await page.mouse.up();
  await page
    .getByLabel("What happens in your story?")
    .fill("My bright character");
  await page.getByRole("button", { name: "Bring my world to life" }).click();
  await expect(
    page.getByRole("button", { name: "Try bringing it to life again" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Try bringing it to life again" })
    .click();
  await expect(page.getByText(/We found the beginnings/)).toBeVisible();
  expect(inputs).toHaveLength(2);
  expect(inputs[0]).toEqual(inputs[1]);
});

test("an uploaded source stays beneath later drawing changes", async ({
  page,
}) => {
  const inputs: Array<{ image: string; transcript?: string }> = [];
  await page.route("**/api/interpret/scene", (route) => {
    inputs.push(route.request().postDataJSON());
    return route.fulfill({ json: interpretedScene });
  });
  await page.goto("/");
  await page
    .getByLabel("Choose a drawing file")
    .setInputFiles("apps/web/src/assets/figma/castle.png");
  await expect(page.locator(".drawing-layer canvas").last()).toBeVisible();
  await page.getByRole("button", { name: "Bring my world to life" }).click();
  await expect(page.getByText(/We found the beginnings/)).toBeVisible();

  const canvas = page.locator(".drawing-layer canvas").last();
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + 100, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 180, box.y + 140, { steps: 4 });
  await page.mouse.up();
  await expect(page.getByText(/We found the beginnings/)).toHaveCount(0);
  await page
    .getByLabel("What happens in your story?")
    .fill("The character explores");
  await page.getByRole("button", { name: "Bring my world to life" }).click();

  expect(inputs).toHaveLength(2);
  expect(inputs[0]!.image).not.toEqual(inputs[1]!.image);
  expect(inputs[1]!.transcript).toBe("The character explores");
});

test("choosing another drawing clears the abandoned error", async ({
  page,
}) => {
  await page.route("**/api/interpret/scene", (route) =>
    route.fulfill({
      status: 504,
      json: { message: "Timed out", retryable: true },
    }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Start from scratch" }).click();
  await page.getByRole("button", { name: "Bring my world to life" }).click();
  await expect(page.getByText("Timed out")).toBeVisible();
  await page
    .getByRole("button", { name: "Choose another drawing" })
    .first()
    .click();
  await expect(
    page.getByRole("button", { name: "Start from scratch" }),
  ).toBeVisible();
  await expect(page.getByText("Timed out")).toHaveCount(0);
});
