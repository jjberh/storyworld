import { test, expect, type Page } from "@playwright/test";

const response = {
  mode: "live",
  message: "A fox by a castle.",
  candidates: [
    {
      id: "fox",
      name: "Fox",
      kind: "character",
      confidence: 0.6,
      imageBounds: { x: 0.1, y: 0.2, width: 0.2, height: 0.2 },
    },
    {
      id: "castle",
      name: "Castle",
      kind: "castle",
      confidence: 1,
      imageBounds: { x: 0.7, y: 0.2, width: 0.2, height: 0.2 },
    },
  ],
  characterCandidateId: "fox",
  goalCandidateId: "castle",
  openingNarration: "Fox explores.",
  moodHints: ["curious"],
};
async function begin(page: Page, mode = "live", worldMode = "fixture") {
  await page.route("**/api/interpret/scene", (route) =>
    route.fulfill({ json: { ...response, mode } }),
  );
  await page.goto("/?mode=" + worldMode);
  await page.getByRole("button", { name: "Start from scratch" }).click();
  await page.getByLabel("What happens in your story?").fill("My fox explores");
  await page
    .getByRole("button", { name: "Bring my world to life", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Check your picture" }),
  ).toBeVisible();
}
test("corrects an object, removes another, and starts the local story", async ({
  page,
}) => {
  await begin(page);
  await expect(
    page.getByRole("heading", { name: "Is this Fox?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Change it" }).click();
  await page.getByLabel("What should we call it?").fill("Ember");
  await page.getByRole("button", { name: "Yes, that's right!" }).click();
  await page.getByRole("button", { name: "That is not in my picture" }).click();
  await page.getByRole("button", { name: "Start my story" }).click();
  await expect(
    page.getByRole("heading", { name: "Your Story Room" }),
  ).toBeVisible();
  await expect(page).toHaveURL(/world=story-/);
  await expect(page.getByText("Fox explores.")).toBeVisible();
  await expect(page.getByLabel("What happens in your story?")).toHaveCount(0);
});

test("live scene creation waits for its committed world and document", async ({
  page,
}, testInfo) => {
  test.skip(
    process.env.TEST_SCENE_LIVE !== "1",
    "Requires an isolated local database and local-configured web server",
  );
  await begin(page, "live", "live");
  await page.getByRole("button", { name: "Yes, that's right!" }).click();
  await page.getByRole("button", { name: "Yes, that's right!" }).click();
  await page.getByRole("button", { name: "Start my story" }).click();
  await expect(
    page.getByRole("heading", { name: "Your Story Room" }),
  ).toBeVisible({
    timeout: 20000,
  });
  await expect(page).toHaveURL(/mode=live.*world=story-/);
  await page
    .getByAltText("Your confirmed drawing")
    .screenshot({ path: testInfo.outputPath("confirmed-scene.png") });
});
test("requires reinterpretation after changing the child prompt", async ({
  page,
}) => {
  await begin(page);
  await page
    .getByLabel("What happens in your story?")
    .fill("A different beginning");
  await expect(page.getByText(/Your picture changed/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Start my story" }),
  ).toBeHidden();
  await page
    .getByRole("button", { name: "Bring my world to life", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Yes, that's right!" }),
  ).toBeEnabled();
});
test("sample detections require explicit consent and only create local test worlds", async ({
  page,
}) => {
  await begin(page, "fixture");
  await page.getByRole("button", { name: "Yes, that's right!" }).click();
  await page.getByRole("button", { name: "Yes, that's right!" }).click();
  await page.getByRole("button", { name: "Start my story" }).click();
  await expect(
    page.getByText(
      "Choose the practice reading before starting this test story.",
    ),
  ).toBeVisible();
  await page.getByLabel("Use this practice reading").check();
  await page.getByRole("button", { name: "Start my story" }).click();
  await expect(
    page.getByRole("heading", { name: "Your Story Room" }),
  ).toBeVisible();
  await expect(page).toHaveURL(/mode=fixture.*world=story-/);
});

test("adds a missed object by marking its region and changing its type", async ({
  page,
}) => {
  await begin(page);
  await page.getByRole("button", { name: "I missed something" }).click();
  const picture = page.getByLabel("Your picture with detected objects");
  await picture.scrollIntoViewIfNeeded();
  const box = (await picture.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.mouse.up();
  await page.getByLabel("What should we call it?").fill("River");
  await page.getByLabel("What kind of thing is it?").selectOption("river");
  await page.getByRole("button", { name: "Yes, that's right!" }).click();
  await page.getByRole("button", { name: "Yes, that's right!" }).click();
  await page.getByRole("button", { name: "Yes, that's right!" }).click();
  await page.getByRole("button", { name: "Start my story" }).click();
  await expect(
    page.getByRole("heading", { name: "Your Story Room" }),
  ).toBeVisible();
});
