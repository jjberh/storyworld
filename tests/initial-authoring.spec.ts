import { expect, test } from "@playwright/test";

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
        : {
            json: {
              mode: "fixture",
              message: "Picture saved.",
              candidates: [
                {
                  id: "hero",
                  kind: "character",
                  name: "Hero",
                  confidence: 1,
                  imageBounds: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
                },
              ],
              openingNarration: "A new story begins.",
              characterCandidateId: "hero",
              moodHints: ["curious"],
            },
          },
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
  await page.getByLabel("What happens in your story?").fill("My bright hero");
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
