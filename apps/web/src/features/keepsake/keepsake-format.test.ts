import { describe, expect, it } from "vitest";
import {
  keepsakeSupport,
  movieFilename,
  MOVIE_MIME_TYPES,
  pickMovieFormat,
} from "./keepsake-format";

describe("pickMovieFormat", () => {
  it("prefers WebM with VP9", () => {
    expect(pickMovieFormat(() => true)).toEqual({
      mimeType: "video/webm;codecs=vp9",
      fileType: "video/webm",
      extension: "webm",
    });
  });

  it("falls through the WebM list in order", () => {
    const supported = new Set(["video/webm;codecs=vp8", "video/webm"]);
    expect(pickMovieFormat((type) => supported.has(type))?.mimeType).toBe(
      "video/webm;codecs=vp8",
    );
  });

  it("uses MP4 where only MP4 records (Safari)", () => {
    const safari = new Set(["video/mp4", "video/mp4;codecs=avc1"]);
    expect(pickMovieFormat((type) => safari.has(type))).toEqual({
      mimeType: "video/mp4;codecs=avc1",
      fileType: "video/mp4",
      extension: "mp4",
    });
    expect(pickMovieFormat((type) => type === "video/mp4")?.extension).toBe(
      "mp4",
    );
  });

  it("returns null when nothing is supported or the check throws", () => {
    expect(pickMovieFormat(() => false)).toBe(null);
    expect(
      pickMovieFormat(() => {
        throw new Error("nope");
      }),
    ).toBe(null);
  });

  it("asks in the documented order", () => {
    const asked: string[] = [];
    pickMovieFormat((type) => {
      asked.push(type);
      return false;
    });
    expect(asked).toEqual([...MOVIE_MIME_TYPES]);
  });
});

describe("movieFilename", () => {
  it("names the movie after the hero with the right extension", () => {
    expect(movieFilename("Fox", "webm")).toBe("storyworld-fox-movie.webm");
    expect(movieFilename("Captain Zoë!", "mp4")).toBe(
      "storyworld-captain-zoe-movie.mp4",
    );
  });

  it("keeps names safe and short", () => {
    expect(movieFilename("../../etc/passwd", "webm")).toBe(
      "storyworld-etc-passwd-movie.webm",
    );
    expect(movieFilename("A".repeat(80), "webm")).toBe(
      `storyworld-${"a".repeat(32)}-movie.webm`,
    );
  });

  it("falls back without a usable name", () => {
    expect(movieFilename(undefined, "webm")).toBe("storyworld-movie.webm");
    expect(movieFilename("🦊", "mp4")).toBe("storyworld-movie.mp4");
  });
});

describe("keepsakeSupport", () => {
  const captureStream = () => undefined;

  it("is supported with captureStream and a recordable type", () => {
    const support = keepsakeSupport({
      MediaRecorder: { isTypeSupported: (type) => type === "video/mp4" },
      canvasCaptureStream: captureStream,
    });
    expect(support).toMatchObject({
      supported: true,
      format: { extension: "mp4" },
    });
  });

  it("explains itself without MediaRecorder, captureStream or a type", () => {
    for (const env of [
      { canvasCaptureStream: captureStream },
      { MediaRecorder: { isTypeSupported: () => true } },
      {
        MediaRecorder: { isTypeSupported: () => false },
        canvasCaptureStream: captureStream,
      },
    ]) {
      const support = keepsakeSupport(env);
      expect(support.supported).toBe(false);
      if (!support.supported) expect(support.reason).toMatch(/can't make/);
    }
  });
});
