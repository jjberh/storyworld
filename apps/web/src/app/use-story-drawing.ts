import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ConfirmedScene } from "@storyworld/contracts";
import type { WorldClient } from "@storyworld/contracts/model";
import { captureDrawing, sketchImage } from "../features/canvas/drawing-image";
import { interpretEdit } from "../services/intelligence-client";
import { StoryDrawingSession } from "./story-drawing-session";

export type { PendingCutout } from "./story-drawing-session";

function loadImage(source: string) {
  return new Promise<HTMLImageElement | undefined>((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(undefined);
    image.src = source;
  });
}

/**
 * Drawing mid-story in the Story Room (see StoryDrawingSession). Gemini sees
 * the new lines over a faded copy of the confirmed picture, with where they
 * were drawn. The story itself plays from the committed events, so a new
 * moment waits for the beat on stage.
 */
export function useStoryDrawing({
  client,
  scene,
  contributor,
}: {
  client: WorldClient | undefined;
  scene: ConfirmedScene | undefined;
  contributor: boolean;
}) {
  const latest = useRef({ client, scene, contributor });
  latest.current = { client, scene, contributor };
  const [session] = useState(
    () =>
      new StoryDrawingSession({
        client: () => latest.current.client,
        guest: () => latest.current.contributor,
        picture: sketchImage,
        read: async (cutout) => {
          const activeScene = latest.current.scene;
          const background = activeScene
            ? await loadImage(activeScene.document.drawing.compositeImage)
            : undefined;
          const result = await interpretEdit({
            image: captureDrawing(cutout.strokes, background, 0.35),
            changedRegion: cutout.bounds,
          });
          return result.candidates[0]?.operation;
        },
      }),
  );
  useEffect(() => {
    session.activate();
    return () => session.dispose();
  }, [session]);
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  return {
    ...state,
    startStroke: () => session.startStroke(),
    cancelStroke: () => session.cancelStroke(),
    addStrokes: (strokes: number[][]) => session.addStrokes(strokes),
    finish: () => session.finish(),
    retry: (id: string) => session.retry(id),
    retryInteraction: () => session.retryInteraction(),
    acceptProposal: session.acceptProposal.bind(session),
  };
}
