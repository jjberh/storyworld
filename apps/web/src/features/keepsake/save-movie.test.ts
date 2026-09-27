import { afterEach, describe, expect, it, vi } from "vitest";
import { shareMovie } from "./save-movie";

const file = { name: "storyworld-fox-movie.webm" } as File;

function shareRejecting(name: string) {
  vi.stubGlobal("navigator", {
    share: () => Promise.reject(new DOMException("no", name)),
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("shareMovie", () => {
  it("reports a completed share", async () => {
    vi.stubGlobal("navigator", { share: () => Promise.resolve() });
    await expect(shareMovie(file, "Fox's story")).resolves.toBe("shared");
  });

  it("treats a cancelled sheet as no error", async () => {
    shareRejecting("AbortError");
    await expect(shareMovie(file, "Fox's story")).resolves.toBe("cancelled");
  });

  it("treats a second share while the sheet is open as a no-op", async () => {
    shareRejecting("InvalidStateError");
    await expect(shareMovie(file, "Fox's story")).resolves.toBe("busy");
  });

  it("passes other refusals on so the caller can download instead", async () => {
    shareRejecting("NotAllowedError");
    await expect(shareMovie(file, "Fox's story")).rejects.toThrow("no");
  });
});
