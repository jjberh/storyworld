import { expect, test, type Page } from "@playwright/test";

const response = {
  mode: "live",
  message: "A fox by a castle.",
  candidates: [
    {
      id: "fox",
      name: "Fox",
      kind: "character",
      confidence: 1,
      imageBounds: { x: 0.1, y: 0.2, width: 0.2, height: 0.2 },
    },
    {
      id: "castle",
      name: "Castle",
      kind: "castle",
      confidence: 1,
      imageBounds: { x: 0.7, y: 0.2, width: 0.2, height: 0.2 },
    },
    {
      id: "river",
      name: "River",
      kind: "river",
      confidence: 1,
      imageBounds: { x: 0.45, y: 0.05, width: 0.12, height: 0.9 },
    },
  ],
  characterCandidateId: "fox",
  goalCandidateId: "castle",
  openingNarration: "Fox explores.",
  moodHints: ["curious"],
};

async function startRoom(page: Page) {
  await page.route("**/api/interpret/scene", (route) =>
    route.fulfill({ json: response }),
  );
  await page.goto("/?mode=fixture");
  await page.getByRole("button", { name: "Start from scratch" }).click();
  await page
    .getByRole("button", { name: "Bring my world to life", exact: true })
    .click();
  for (let index = 0; index < response.candidates.length; index++)
    await page.getByRole("button", { name: "Yes, that's right!" }).click();
  await page.getByRole("button", { name: "Start my story" }).click();
  await expect(
    page.getByRole("heading", { name: "Your Story Room" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "In this room" }),
  ).toBeVisible();
  await expect(page.getByTestId("presence-count")).toHaveText("1 person");
  await expect(page.getByTestId("room-presence")).toContainText(
    "You · director",
  );
}

test("starting a story opens an addressable room with the confirmed picture", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await startRoom(page);
  await expect(page).toHaveURL(/mode=fixture/);
  await expect(page).toHaveURL(/world=story-/);
  await expect(page.getByAltText("Your confirmed drawing")).toBeVisible();
  await expect(page.getByTestId("paper-theater")).toBeVisible();
  await expect(
    page.getByRole("img", { name: /Living paper theater/ }),
  ).toBeVisible();
  await expect(page.locator(".paper-theater-caption")).toBeVisible();
  await expect(page.getByText(/move only when.*commits/i)).toBeVisible();
  await expect(page.getByText("Fox explores.")).toBeVisible();
  await page.getByRole("button", { name: "Copy guest link" }).click();
  const world = new URL(page.url()).searchParams.get("world");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
    "/join?mode=fixture&world=" + world,
  );
});

test("a committed sample bridge crosses the river and celebrates", async ({
  page,
}) => {
  await startRoom(page);
  const hero = page.locator('[data-entity-id="fox"]');
  await expect(hero).toHaveAttribute("data-placement", "near-obstacle");
  const riverbankX = Number(await hero.getAttribute("data-logical-x"));
  await expect(page.getByText("River blocks the route")).toBeVisible();
  await page.getByRole("button", { name: "Add sample bridge" }).click();
  await expect(page.locator(".paper-theater-caption")).toContainText(
    "unfolds across the water",
  );
  await expect(hero).toHaveAttribute("data-placement", "near-obstacle");
  expect(Number(await hero.getAttribute("data-logical-x"))).toBe(riverbankX);
  await expect(
    page.getByText(/Paper bridge added · route opened/),
  ).toBeVisible();
  await expect(page.getByText(/Fox made it across!/)).toBeVisible();
  await expect(hero).toHaveAttribute("data-placement", "target-side");
  const targetSideX = Number(await hero.getAttribute("data-logical-x"));
  expect(targetSideX).toBeGreaterThan(riverbankX);
  await expect(page.getByText("Route opened", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Add sample bridge" }).click();
  await page.waitForTimeout(800);
  await expect(page.locator(".paper-theater-caption")).toContainText(
    "unfolds across the water",
  );
  await expect(page.locator(".paper-theater-caption")).not.toContainText(
    "still needs",
  );
  await expect(hero).toHaveAttribute("data-placement", "target-side");
  expect(Number(await hero.getAttribute("data-logical-x"))).toBe(targetSideX);
});

test("the paper theater keeps its semantic playback on a reduced-motion mobile viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await startRoom(page);
  await expect(page.getByTestId("paper-theater")).toBeVisible();
  await page.getByRole("button", { name: "Add sample bridge" }).click();
  await expect(page.getByText(/Fox made it across!/)).toBeVisible();
  await expect(page.locator(".paper-confetti")).toHaveCount(0);
});

test("joining a fixture room without this page session cannot reopen it", async ({
  page,
}) => {
  await page.goto("/join?mode=fixture&world=story-missing");
  await expect(
    page.getByRole("heading", {
      name: "This local story is only on its first page",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Start a new drawing" }),
  ).toBeVisible();
});
