// Handing the finished movie to the child: the share sheet on phones and
// tablets, a plain download everywhere else.

/**
 * True when the browser can share this file and the device is touch-first.
 * Desktop Chrome on Windows and macOS can also share files, but there a
 * download is what people expect from "Save".
 */
export function shouldShareMovie(file: File) {
  if (typeof navigator.canShare !== "function") return false;
  if (!window.matchMedia?.("(pointer: coarse)").matches) return false;
  try {
    return navigator.canShare({ files: [file] });
  } catch {
    return false;
  }
}

/**
 * Opens the share sheet. Must run inside a fresh tap: recording takes longer
 * than a browser's user-activation window. A cancelled sheet is not an error,
 * and neither is a share refused because another sheet is still open
 * ("busy": the first share carries on).
 */
export async function shareMovie(
  file: File,
  title: string,
): Promise<"shared" | "cancelled" | "busy"> {
  try {
    await navigator.share({ files: [file], title });
    return "shared";
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError")
      return "cancelled";
    if (error instanceof DOMException && error.name === "InvalidStateError")
      return "busy";
    throw error;
  }
}

/** Saves the movie through a temporary object URL and `<a download>`. */
export function downloadMovie(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoking straight after the click can cancel the download in some
  // browsers, so give it a moment first.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
