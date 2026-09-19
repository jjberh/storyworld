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
    page.getByRole("region", { name: "Confirm your scene" }),
  ).toBeVisible();
}
test("corrects uncertain objects, removes the destination and commits the local world", async ({
  page,
}) => {
  await begin(page);
  await expect(
    page.getByText("Please check this uncertain detection."),
  ).toBeVisible();
  await page.getByLabel("Object 1 name").fill("Ember");
  await page.getByRole("button", { name: "Remove object 2" }).click();
  await page.getByRole("button", { name: "Create confirmed world" }).click();
  await expect(
    page.getByText("Check each object before creating your world."),
  ).toBeVisible();
  await page.getByLabel("This object is correct").check();
  await page.getByRole("button", { name: "Create confirmed world" }).click();
  await expect(page.getByText(/Local test world created:/)).toBeVisible();
  await expect(page.getByLabel("Object 1 name")).toBeDisabled();
  await expect(page.getByLabel("What happens in your story?")).toBeDisabled();
});

test("live scene creation waits for its committed world and document", async ({
  page,
}, testInfo) => {
  test.skip(
    process.env.TEST_SCENE_LIVE !== "1",
    "Requires an isolated local database and local-configured web server",
  );
  await begin(page, "live", "live");
  for (const checkbox of await page.getByLabel("This object is correct").all())
    await checkbox.check();
  await page.getByRole("button", { name: "Create confirmed world" }).click();
  await expect(page.getByText(/^World created:/)).toBeVisible({
    timeout: 20000,
  });
  await page
    .getByRole("region", { name: "Confirm your scene" })
    .screenshot({ path: testInfo.outputPath("confirmed-scene.png") });
});
test("requires reinterpretation after changing the child prompt", async ({
  page,
}) => {
  await begin(page);
  await page
    .getByLabel("What happens in your story?")
    .fill("A different beginning");
  await expect(
    page.getByText(/Your picture or story words changed/),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Create confirmed world" }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Bring my world to life", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Create confirmed world" }),
  ).toBeEnabled();
});
test("sample detections require explicit consent and only create local test worlds", async ({
  page,
}) => {
  await begin(page, "fixture");
  for (const checkbox of await page.getByLabel("This object is correct").all())
    await checkbox.check();
  await page.getByRole("button", { name: "Create confirmed world" }).click();
  await expect(
    page.getByText(
      "Confirm that you want to use the sample detections for a local test.",
    ),
  ).toBeVisible();
  await page.getByLabel("Use sample detections for a local test").check();
  await page.getByRole("button", { name: "Create confirmed world" }).click();
  await expect(page.getByText(/Local test world created:/)).toBeVisible();
});

test("adds a missed object by marking its region and changing its type", async ({
  page,
}) => {
  await begin(page);
  await page.getByRole("button", { name: "Add a missed object" }).click();
  const picture = page.getByLabel("Object regions");
  await picture.scrollIntoViewIfNeeded();
  const box = (await picture.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.mouse.up();
  await page.getByLabel("Object 3 name").fill("River");
  await page.getByLabel("Object 3 type").selectOption("river");
  await page
    .getByLabel("Afraid of a river? (optional)")
    .selectOption({ label: "River" });
  for (const checkbox of await page.getByLabel("This object is correct").all())
    await checkbox.check();
  await page.getByRole("button", { name: "Create confirmed world" }).click();
  await expect(page.getByText(/Local test world created:/)).toBeVisible();
});
