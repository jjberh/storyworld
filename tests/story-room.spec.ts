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
  await page.getByRole("button", { name: "Yes, that's right!" }).click();
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
  await expect(page.getByText("Fox explores.")).toBeVisible();
  await page.getByRole("button", { name: "Copy guest link" }).click();
  const world = new URL(page.url()).searchParams.get("world");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
    "/join?mode=fixture&world=" + world,
  );
});

test("a sample bridge in the room becomes a story moment", async ({ page }) => {
  await startRoom(page);
  await page.getByRole("button", { name: "Add sample bridge" }).click();
  await expect(page.getByText(/Bridge added/)).toBeVisible();
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
