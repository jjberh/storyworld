import { test, expect } from "@playwright/test";
test("live director and contributor synchronize an approved bridge", async ({
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
    // A second identity may use the root room URL. It must become a contributor
    // instead of attempting the director-only reducer.
    await b.goto("/?mode=live&world=" + room);
    await expect(
      b.getByText(
        "This room belongs to another director. Propose a change instead.",
      ),
    ).toBeVisible();
    await b.getByRole("button", { name: "Propose sample bridge" }).click();
    await expect(a.getByText("New guest contribution")).toBeVisible();
    await a.getByRole("button", { name: "Accept", exact: true }).click();
    await expect(
      a.getByText("Route opened", { exact: false }).first(),
    ).toBeVisible();
    await expect(
      b.getByText("Route opened", { exact: false }).first(),
    ).toBeVisible();
    await a.reload();
    await b.reload();
    await expect(
      a.getByText("Route opened", { exact: false }).first(),
    ).toBeVisible();
    await expect(
      b.getByText("Route opened", { exact: false }).first(),
    ).toBeVisible();
    await a
      .getByRole("button", { name: /The adventure begins/ })
      .first()
      .click();
    await expect(a.getByText("River blocks the route")).toBeVisible();
    await expect(b.getByText("River blocks the route")).toBeVisible();
  } finally {
    await director.close();
    await guest.close();
  }
});
