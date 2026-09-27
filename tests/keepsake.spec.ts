import { readFile } from "node:fs/promises";
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
}

/** Loads a recorded movie into a <video> and reports duration and frames. */
async function inspectMovie(page: Page, base64: string, mimeType: string) {
  return page.evaluate(
    async ({ base64, mimeType }) => {
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
      const video = document.createElement("video");
      video.muted = true;
      video.preload = "auto";
      /** One `name` event, failing on a media error or after 5 s. */
      const once = (name: string) =>
        new Promise<void>((resolve, reject) => {
          const cleanup = () => {
            clearTimeout(timer);
            video.removeEventListener(name, onEvent);
            video.removeEventListener("error", onError);
          };
          const onEvent = () => {
            cleanup();
            resolve();
          };
          const onError = () => {
            cleanup();
            reject(new Error(`video error: ${video.error?.message ?? "?"}`));
          };
          const timer = setTimeout(() => {
            cleanup();
            reject(new Error(`no "${name}" event within 5 s`));
          }, 5000);
          video.addEventListener(name, onEvent);
          video.addEventListener("error", onError);
        });
      const loaded = once("loadedmetadata");
      video.src = url;
      await loaded;
      // MediaRecorder WebM has no duration until the player has seen the end.
      if (!Number.isFinite(video.duration)) {
        let changes = once("durationchange");
        video.currentTime = 1e6;
        for (let attempt = 0; attempt < 10; attempt++) {
          await changes;
          if (Number.isFinite(video.duration) || attempt === 9) break;
          changes = once("durationchange");
        }
        if (!Number.isFinite(video.duration))
          throw new Error("the movie never reported a finite duration");
      }
      const duration = video.duration;
      const seek = async (time: number) => {
        const seeked = once("seeked");
        video.currentTime = time;
        await seeked;
      };
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const context = canvas.getContext("2d", { willReadFrequently: true })!;
      await seek(5);
      context.drawImage(video, 0, 0);
      const pixels = context.getImageData(
        0,
        0,
        canvas.width,
        canvas.height,
      ).data;
      const colors = new Set<number>();
      for (let index = 0; index < pixels.length; index += 4 * 97)
        colors.add(
          ((pixels[index] >> 4) << 8) |
            ((pixels[index + 1] >> 4) << 4) |
            (pixels[index + 2] >> 4),
        );
      URL.revokeObjectURL(url);
      return {
        duration,
        width: video.videoWidth,
        height: video.videoHeight,
        distinctColors: colors.size,
      };
    },
    { base64, mimeType },
  );
}

test("Save my movie records a playable keepsake without disturbing the stage", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await startRoom(page);
  const fox = page.locator('[data-entity-id="fox"]');
  await expect(fox).toHaveAttribute("data-placement", "near-obstacle");
  await page.getByRole("button", { name: "Add sample bridge" }).click();
  await expect(page.getByText(/Fox made it across!/)).toBeVisible();
  await expect(fox).toHaveAttribute("data-placement", "target-side");
  await expect(page.locator(".paper-theater-stage")).toHaveAttribute(
    "data-action",
    "resting",
  );
  const revision = await page.getByText(/^Revision \d+$/).textContent();
  const caption = await page.locator(".paper-theater-caption").textContent();

  const keepsake = page.getByTestId("keepsake");
  const download = page.waitForEvent("download", { timeout: 45_000 });
  await keepsake.getByRole("button", { name: "Save my movie" }).click();
  await expect(
    keepsake.getByRole("button", { name: "Making your movie…" }),
  ).toBeDisabled();
  await expect(keepsake.getByRole("progressbar")).toBeVisible();
  // The hidden recording stage is not interactive and lives off-screen.
  await expect(page.locator("[data-keepsake-stage] canvas")).toHaveCount(1);

  // The child's own stage keeps reacting while the movie records.
  const before = Number(await fox.getAttribute("data-reaction-count"));
  await page.getByRole("button", { name: "Tickle Fox" }).focus();
  await page.keyboard.press("Enter");
  await expect(fox).toHaveAttribute("data-reaction-count", String(before + 1));

  const file = await download;
  expect(file.suggestedFilename()).toBe("storyworld-fox-movie.webm");
  await expect(keepsake).toContainText("Saved!");
  await expect(page.locator("[data-keepsake-stage]")).toHaveCount(0);
  await expect(page.getByText(/^Revision \d+$/)).toHaveText(revision!);
  await expect(page.locator(".paper-theater-caption")).toHaveText(caption!);
  await expect(fox).toHaveAttribute("data-placement", "target-side");

  const bytes = await readFile((await file.path())!);
  expect(bytes.length).toBeGreaterThan(20 * 1024);
  expect([...bytes.subarray(0, 4)]).toEqual([0x1a, 0x45, 0xdf, 0xa3]);

  const movie = await inspectMovie(
    page,
    bytes.toString("base64"),
    "video/webm",
  );
  expect(movie.duration).toBeGreaterThan(9.5);
  expect(movie.duration).toBeLessThan(16);
  expect(movie.width).toBe(960);
  expect(movie.height).toBe(576);
  expect(movie.distinctColors).toBeGreaterThan(8);
});

test("Save my movie explains when the browser cannot record", async ({
  page,
}) => {
  await page.addInitScript(() => {
    // @ts-expect-error simulate a browser without MediaRecorder
    delete window.MediaRecorder;
  });
  await startRoom(page);
  const keepsake = page.getByTestId("keepsake");
  await expect(
    keepsake.getByRole("button", { name: "Save my movie" }),
  ).toBeDisabled();
  await expect(keepsake).toContainText("can't make movies yet");
});
