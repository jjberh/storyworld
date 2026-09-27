// Which video format this browser can record, and what to call the file.
// Chrome, Edge and Firefox record WebM; Safari's MediaRecorder only records
// MP4, so the list falls through to it.

export const MOVIE_MIME_TYPES = [
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
  "video/mp4;codecs=avc1",
  "video/mp4",
] as const;

export type MovieFormat = {
  /** Passed to MediaRecorder. */
  mimeType: string;
  /** The container type for the saved file, without codecs. */
  fileType: "video/webm" | "video/mp4";
  extension: "webm" | "mp4";
};

/** The first supported type from `MOVIE_MIME_TYPES`, or null. */
export function pickMovieFormat(
  isTypeSupported: (mimeType: string) => boolean,
): MovieFormat | null {
  for (const mimeType of MOVIE_MIME_TYPES) {
    let supported = false;
    try {
      supported = isTypeSupported(mimeType);
    } catch {
      supported = false;
    }
    if (!supported) continue;
    const webm = mimeType.startsWith("video/webm");
    return {
      mimeType,
      fileType: webm ? "video/webm" : "video/mp4",
      extension: webm ? "webm" : "mp4",
    };
  }
  return null;
}

/** "storyworld-fox-movie.webm"; the name is reduced to safe characters. */
export function movieFilename(
  heroName: string | undefined,
  extension: MovieFormat["extension"],
) {
  const slug = (heroName ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32)
    .replace(/-+$/g, "");
  return slug
    ? `storyworld-${slug}-movie.${extension}`
    : `storyworld-movie.${extension}`;
}

export type KeepsakeSupport =
  | { supported: true; format: MovieFormat }
  | { supported: false; reason: string };

export const UNSUPPORTED_REASON =
  "This browser can't make movies yet. Try the newest Chrome, Edge, Firefox or Safari.";

/** Whether this browser can record the stage canvas to a video file. */
export function keepsakeSupport(
  env: {
    MediaRecorder?: { isTypeSupported?: (mimeType: string) => boolean };
    canvasCaptureStream?: unknown;
  } = {
    MediaRecorder:
      typeof MediaRecorder === "undefined" ? undefined : MediaRecorder,
    canvasCaptureStream:
      typeof HTMLCanvasElement === "undefined"
        ? undefined
        : HTMLCanvasElement.prototype.captureStream,
  },
): KeepsakeSupport {
  const isTypeSupported = env.MediaRecorder?.isTypeSupported;
  if (typeof env.canvasCaptureStream !== "function" || !isTypeSupported)
    return { supported: false, reason: UNSUPPORTED_REASON };
  const format = pickMovieFormat((type) =>
    isTypeSupported.call(env.MediaRecorder, type),
  );
  return format
    ? { supported: true, format }
    : { supported: false, reason: UNSUPPORTED_REASON };
}
