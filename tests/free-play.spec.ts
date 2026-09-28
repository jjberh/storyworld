import { expect, test, type Page } from "@playwright/test";
import {
  drawOnStory,
  mockEdit,
  mockJev,
  MOMENT_TIMEOUT,
  traceStage,
  waitForReveal,
} from "./story-mocks";

// "Bring it to life": a picture with a character and no place to reach
// starts a story in free play. Nothing blocks the child from just playing.

const noGoalScene = {
  mode: "live",
  message: "A fox under a tree on a sunny day.",
  candidates: [
    {
      id: "fox",
      name: "Fox",
      role: "character",
      description: "",
      properties: ["moves"],
      confidence: 1,
      imageBounds: { x: 0.1, y: 0.5, width: 0.15, height: 0.3 },
    },
    {
      id: "tree",
      name: "Tree",
      role: "scenery",
      description: "",
      properties: [],
      confidence: 1,
      imageBounds: { x: 0.55, y: 0.35, width: 0.2, height: 0.5 },
    },
    {
      id: "sun",
      name: "Sun",
      role: "scenery",
      description: "",
      properties: [],
      confidence: 1,
      imageBounds: { x: 0.8, y: 0.04, width: 0.12, height: 0.18 },
    },
  ],
  characterCandidateId: "fox",
  openingNarration: "Fox explores.",
  moodHints: ["curious"],
};

async function confirmNoGoalScene(page: Page) {
  await page.route("**/api/interpret/scene", (route) =>
    route.fulfill({ json: noGoalScene }),
  );
  await page.goto("/?mode=fixture");
  await page.getByRole("button", { name: "Start from scratch" }).click();
  await page
    .getByRole("button", { name: "Bring my world to life", exact: true })
    .click();
}

test("a picture with no place to reach starts a free-play story", async ({
  page,
}) => {
  // The opening, the drawing's reveal and its moment, each 2–4 s beats.
  test.setTimeout(60_000);
  const inputs = await mockEdit(page, {
    name: "Ball",
    properties: [],
    idPrefix: "ball",
  });
  const jevBodies: { world: { goal: unknown; pathStatus: string } }[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/api/interactions"))
      jevBodies.push(request.postDataJSON());
  });
  let releaseJev!: () => void;
  await mockJev(page, "nothing_happens", {
    gate: new Promise<void>((resolve) => {
      releaseJev = resolve;
    }),
  });
  await confirmNoGoalScene(page);

  // Only a character and scenery: Start is ready without a place to reach.
  const start = page.getByRole("button", { name: "Start my story" });
  await expect(start).toBeEnabled();
  await start.click();
  await expect(
    page.getByRole("heading", { name: "Your Story Room" }),
  ).toBeVisible();
  const trace = await traceStage(page);
  await waitForReveal(page);

  const status = page.locator(".world-status");
  await expect(status).toHaveText("Free play: draw anything!");
  await expect(
    page.getByRole("img", { name: "Living paper theater. Free play." }),
  ).toBeVisible();
  // The opening explores the picture: Fox wanders to the tree beside it.
  const hero = page.locator('[data-entity-id="fox"]');
  await expect
    .poll(async () => (await trace()).captions, { timeout: MOMENT_TIMEOUT })
    .toContainEqual("Fox wanders over to Tree.");
  await expect(hero).toHaveAttribute("data-placement", "target-side");

  // Something new drawn mid-story gets its own free-play moment.
  await drawOnStory(page, [0.3, 0.7], [0.4, 0.72]);
  expect(inputs).toHaveLength(1);
  await expect(page.getByText(/01 · Ball added/)).toBeVisible();
  // Before Jev answers, Fox notices the new drawing.
  await expect
    .poll(async () => (await trace()).captions, { timeout: MOMENT_TIMEOUT })
    .toContainEqual("Fox spots Ball!");
  expect((await trace()).captions).toContain("Ball joins the story.");
  releaseJev();
  await expect(page.getByText(/02 · Ball: a new friend/)).toBeVisible({
    timeout: MOMENT_TIMEOUT,
  });
  await expect
    .poll(async () => (await trace()).captions, { timeout: MOMENT_TIMEOUT })
    .toContainEqual("Fox and Ball play together!");
  await expect(page.locator(".paper-theater-stage")).toHaveAttribute(
    "data-action",
    "resting",
    { timeout: MOMENT_TIMEOUT },
  );
  const { captions } = await trace();
  expect(captions).toEqual(
    expect.arrayContaining([
      "Fox spots Ball and smiles.",
      "Fox skips over to Ball.",
    ]),
  );
  // Jev was asked about a world with no goal, in free play.
  expect(jevBodies).toHaveLength(1);
  expect(jevBodies[0]!.world.goal).toBeNull();
  expect(jevBodies[0]!.world.pathStatus).toBe("free_play");
  await expect(page.locator(".drawing-note")).toHaveText(
    "Ball is part of the picture now.",
  );

  // Nothing about a route anywhere, and the label is unchanged.
  await expect(status).toHaveText("Free play: draw anything!");
  expect(
    captions.filter((caption) =>
      /route|in the way|stops the way/i.test(caption),
    ),
  ).toEqual([]);
  await expect(page.getByText(/route opened|No route yet/i)).toHaveCount(0);
  await expect(page.getByText("River blocks the route")).toHaveCount(0);
});
