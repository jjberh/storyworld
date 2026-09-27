import { test, expect, type Page } from "@playwright/test";

type Candidate = {
  id: string;
  name: string;
  role: string;
  description: string;
  properties: string[];
  confidence: number;
  imageBounds: { x: number; y: number; width: number; height: number };
};
const fox: Candidate = {
  id: "fox",
  name: "Fox",
  role: "character",
  description: "",
  properties: ["moves"],
  // Below the auto-accept threshold, so the child is asked about it.
  confidence: 0.6,
  imageBounds: { x: 0.1, y: 0.2, width: 0.2, height: 0.2 },
};
const castle: Candidate = {
  id: "castle",
  name: "Castle",
  role: "goal",
  description: "",
  properties: ["goal"],
  confidence: 1,
  imageBounds: { x: 0.7, y: 0.2, width: 0.2, height: 0.2 },
};
const response = {
  mode: "live",
  message: "A fox by a castle.",
  candidates: [fox, castle],
  characterCandidateId: "fox" as string | undefined,
  goalCandidateId: "castle",
  openingNarration: "Fox explores.",
  moodHints: ["curious"],
};
const sureScene = {
  ...response,
  candidates: [{ ...fox, confidence: 0.95 }, castle],
};

async function begin(
  page: Page,
  mode = "live",
  worldMode = "fixture",
  scene: object = response,
) {
  await page.route("**/api/interpret/scene", (route) =>
    route.fulfill({ json: { ...scene, mode } }),
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

const picture = (page: Page) =>
  page.getByLabel("Your picture with detected objects");
const question = (page: Page, name: string) =>
  page.getByRole("group", { name: `What is ${name}?` });
const start = (page: Page) =>
  page.getByRole("button", { name: "Start my story" });

async function expectStoryRoom(page: Page) {
  await expect(
    page.getByRole("heading", { name: "Your Story Room" }),
  ).toBeVisible();
}

/** Drags a box across the picture between two fractional points. */
async function drawBox(
  page: Page,
  from: [number, number],
  to: [number, number],
) {
  await picture(page).scrollIntoViewIfNeeded();
  const box = (await picture(page).boundingBox())!;
  await page.mouse.move(
    box.x + box.width * from[0],
    box.y + box.height * from[1],
  );
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * to[0], box.y + box.height * to[1]);
  await page.mouse.up();
}

test("sure objects are accepted without a question", async ({ page }) => {
  await begin(page, "live", "fixture", sureScene);
  await expect(
    page.getByRole("heading", { name: "Your picture is ready!" }),
  ).toBeVisible();
  await expect(page.getByRole("group", { name: /What is/ })).toHaveCount(0);
  await start(page).click();
  await expectStoryRoom(page);
});

test("an unsure object is asked about on the picture and answered by icon", async ({
  page,
}) => {
  await begin(page);
  await expect(
    page.getByRole("heading", { name: "Is this Fox?" }),
  ).toBeVisible();
  // Only the unsure fox is asked about; the sure castle is already accepted.
  await expect(page.getByRole("group", { name: /What is/ })).toHaveCount(1);
  const card = question(page, "Fox");
  await expect(card).toBeVisible();
  // The question is anchored on the picture, next to the fox's box.
  const cardBox = (await card.boundingBox())!;
  const pictureBox = (await picture(page).boundingBox())!;
  const foxBox = (await page
    .getByRole("button", { name: "Change Fox" })
    .boundingBox())!;
  expect(cardBox.x).toBeGreaterThanOrEqual(pictureBox.x);
  expect(cardBox.x + cardBox.width).toBeLessThanOrEqual(
    pictureBox.x + pictureBox.width,
  );
  expect(cardBox.y).toBeGreaterThanOrEqual(pictureBox.y);
  expect(cardBox.y + cardBox.height).toBeLessThanOrEqual(
    pictureBox.y + pictureBox.height,
  );
  expect(Math.abs(cardBox.y - (foxBox.y + foxBox.height))).toBeLessThan(20);
  // The model's guess is highlighted, and every answer is a labelled icon.
  await expect(
    card.getByRole("button", { name: "Main character" }),
  ).toHaveAttribute("aria-pressed", "true");
  for (const name of [
    "A place to reach",
    "Something in the way",
    "A helper",
    "Part of the scene",
    "Not in my picture",
  ])
    await expect(card.getByRole("button", { name })).toBeVisible();
  await expect(card.locator("svg")).toHaveCount(6);

  await expect(start(page)).toBeDisabled();
  await expect(
    page.getByText("Answer the quick question on your picture first."),
  ).toBeVisible();
  await card.getByRole("button", { name: "Main character" }).click();
  await expect(card).toHaveCount(0);
  await expect(start(page)).toBeEnabled();
  await start(page).click();
  await expectStoryRoom(page);
});

test("corrects an object, removes another, and starts the local story", async ({
  page,
}) => {
  await begin(page);
  await page.getByRole("button", { name: "Change its name" }).click();
  await page.getByLabel("What should we call it?").fill("Ember");
  await question(page, "Ember")
    .getByRole("button", { name: "Main character" })
    .click();
  await page.getByRole("button", { name: "Done" }).click();
  await page.getByRole("button", { name: "Change Castle" }).click();
  await question(page, "Castle")
    .getByRole("button", { name: "Not in my picture" })
    .click();
  await expect(page.getByRole("button", { name: "Change Castle" })).toHaveCount(
    0,
  );
  await start(page).click();
  await expectStoryRoom(page);
  await expect(page).toHaveURL(/world=story-/);
  await expect(page.getByText("Fox explores.")).toBeVisible();
  await expect(page.getByLabel("What happens in your story?")).toHaveCount(0);
});

test("tapping any object changes it, with the keyboard too", async ({
  page,
}) => {
  await begin(page, "live", "fixture", sureScene);
  await page.getByRole("button", { name: "Change Castle" }).focus();
  await page.keyboard.press("Enter");
  const card = question(page, "Castle");
  await expect(card).toBeVisible();
  // Focus moves to the current answer so the keyboard can pick another.
  await expect(
    card.getByRole("button", { name: "A place to reach" }),
  ).toBeFocused();
  await card.getByRole("button", { name: "A helper" }).press("Enter");
  await expect(card.getByRole("button", { name: "A helper" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByLabel("What should we call it?").fill("Kind tower");
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Change Kind tower" }),
  ).toBeFocused();
  await expect(page.getByRole("group", { name: /What is/ })).toHaveCount(0);
  await start(page).click();
  await expectStoryRoom(page);
});

test("without a character the child taps one of their objects", async ({
  page,
}) => {
  await begin(page, "live", "fixture", {
    ...response,
    candidates: [
      { ...fox, id: "blob", name: "Blob", role: "scenery", properties: [] },
      castle,
    ],
    characterCandidateId: undefined,
  });
  await expect(
    page.getByRole("heading", { name: "Tap your main character" }),
  ).toBeVisible();
  await expect(start(page)).toBeDisabled();
  await expect(
    page.getByText("Tap your main character on the picture first."),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Make Blob my main character" })
    .click();
  // Choosing the unsure blob as the hero also answers its question.
  await expect(page.getByRole("group", { name: /What is/ })).toHaveCount(0);
  await expect(start(page)).toBeEnabled();
  await start(page).click();
  await expectStoryRoom(page);
});

test("without a character the child can draw a box around them", async ({
  page,
}) => {
  await begin(page, "live", "fixture", {
    ...response,
    candidates: [castle],
    characterCandidateId: undefined,
  });
  await expect(
    page.getByRole("heading", { name: "Tap your main character" }),
  ).toBeVisible();
  // A tap on empty paper asks for a box around the character.
  const box = (await picture(page).boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.35, box.y + box.height * 0.6);
  await expect(
    page.getByText("Draw a box around your main character.", { exact: true }),
  ).toBeVisible();
  await drawBox(page, [0.3, 0.5], [0.45, 0.8]);
  await expect(
    page.getByRole("heading", { name: "Change My hero" }),
  ).toBeVisible();
  await expect(
    question(page, "My hero").getByRole("button", { name: "Main character" }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByLabel("What should we call it?").fill("Pip");
  await page.getByRole("button", { name: "Done" }).click();
  await start(page).click();
  await expectStoryRoom(page);
});

test("live scene creation waits for its committed world and document", async ({
  page,
}, testInfo) => {
  test.skip(
    process.env.TEST_SCENE_LIVE !== "1",
    "Requires an isolated local database and local-configured web server",
  );
  await begin(page, "live", "live");
  await question(page, "Fox")
    .getByRole("button", { name: "Main character" })
    .click();
  await start(page).click();
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
  await expect(start(page)).toBeHidden();
  await expect(page.getByRole("group", { name: /What is/ })).toHaveCount(0);
  await page
    .getByRole("button", { name: "Bring my world to life", exact: true })
    .click();
  await expect(
    question(page, "Fox").getByRole("button", { name: "Main character" }),
  ).toBeEnabled();
});
test("sample detections require explicit consent and only create local test worlds", async ({
  page,
}) => {
  await begin(page, "fixture");
  await question(page, "Fox")
    .getByRole("button", { name: "Main character" })
    .click();
  await start(page).click();
  await expect(
    page.getByText(
      "Choose the practice reading before starting this test story.",
    ),
  ).toBeVisible();
  await page.getByLabel("Use this practice reading").check();
  await start(page).click();
  await expectStoryRoom(page);
  await expect(page).toHaveURL(/mode=fixture.*world=story-/);
});

test("the keyless fixture scene asks about its unsure cloud", async ({
  page,
}) => {
  // No route mock: the keyless API returns the fixture scene.
  await page.goto("/?mode=fixture");
  await page.getByRole("button", { name: "Start from scratch" }).click();
  await page
    .getByRole("button", { name: "Bring my world to life", exact: true })
    .click();
  const card = question(page, "Cloud");
  await expect(card).toBeVisible();
  await expect(page.getByRole("group", { name: /What is/ })).toHaveCount(1);
  await card.getByRole("button", { name: "Part of the scene" }).click();
  await page.getByLabel("Use this practice reading").check();
  await start(page).click();
  await expectStoryRoom(page);
});

test("adds a missed object by marking its region and changing its type", async ({
  page,
}) => {
  await begin(page);
  await page.getByRole("button", { name: "I missed something" }).click();
  await drawBox(page, [0.3, 0.3], [0.5, 0.5]);
  await page.getByLabel("What should we call it?").fill("River");
  // A missed object waits for the child to say what it is.
  await expect(start(page)).toBeDisabled();
  await question(page, "River")
    .getByRole("button", { name: "Something in the way" })
    .click();
  await page.getByRole("button", { name: "Done" }).click();
  await question(page, "Fox")
    .getByRole("button", { name: "Main character" })
    .click();
  await start(page).click();
  await expectStoryRoom(page);
});

test("the question fits a 375px phone without sideways scrolling", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await begin(page, "live", "fixture", {
    ...response,
    candidates: [
      { ...fox, confidence: 0.95 },
      castle,
      {
        ...castle,
        id: "river",
        name: "River",
        role: "obstacle",
        properties: ["blocks"],
        confidence: 0.5,
        imageBounds: { x: 0.43, y: 0, width: 0.14, height: 1 },
      },
    ],
  });
  const card = question(page, "River");
  await expect(card).toBeVisible();
  const cardBox = (await card.boundingBox())!;
  const pictureBox = (await picture(page).boundingBox())!;
  expect(cardBox.x).toBeGreaterThanOrEqual(pictureBox.x);
  expect(cardBox.x + cardBox.width).toBeLessThanOrEqual(
    pictureBox.x + pictureBox.width,
  );
  expect(cardBox.y + cardBox.height).toBeLessThanOrEqual(
    pictureBox.y + pictureBox.height,
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await card.getByRole("button", { name: "Something in the way" }).click();
  await expect(start(page)).toBeEnabled();
});
