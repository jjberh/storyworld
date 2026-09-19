import { test, expect } from "@playwright/test";
test("live director and guest synchronize an approved bridge", async ({
  browser,
}) => {
  test.skip(
    !process.env.TEST_LIVE,
    "Enable TEST_LIVE with a local module configured.",
  );
  const director = await browser.newContext(),
    guest = await browser.newContext();
  try {
    const a = await director.newPage(),
      b = await guest.newPage();
    const room = "browser-" + Date.now();
    await a.goto("/?mode=live&world=" + room);
    await a.getByRole("button", { name: "Create " + room }).click();
    await expect(a.getByText("River blocks the route")).toBeVisible();
    await b.goto("/join?mode=live&world=" + room);
    await b.getByRole("button", { name: "Propose sample bridge" }).click();
    await expect(a.getByText("New guest contribution")).toBeVisible();
    await a.getByRole("button", { name: "Accept", exact: true }).click();
    await expect(
      a.getByText("Route opened", { exact: false }).first(),
    ).toBeVisible();
    await expect(
      b.getByText("Route opened", { exact: false }).first(),
    ).toBeVisible();
  } finally {
    await director.close();
    await guest.close();
  }
});
