import { describe, expect, it } from "vitest";
import {
  SCENE_AUTO_ACCEPT_CONFIDENCE,
  confirmedSceneSchema,
  type SceneCandidate,
} from "@storyworld/contracts";
import {
  nextQuestion,
  placeQuestion,
  reviewBlocker,
  sceneReviewReducer,
  startReview,
  type SceneReview,
  type SceneReviewAction,
} from "./scene-review";

function candidate(
  id: string,
  role: SceneCandidate["role"],
  confidence: number,
): SceneCandidate {
  return {
    id,
    name: id[0]!.toUpperCase() + id.slice(1),
    role,
    description: "",
    properties: role === "character" ? ["moves"] : [],
    confidence,
    imageBounds: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
  };
}

const fox = candidate("fox", "character", 0.95);
const castle = candidate("castle", "goal", SCENE_AUTO_ACCEPT_CONFIDENCE);
const blob = candidate("blob", "scenery", SCENE_AUTO_ACCEPT_CONFIDENCE - 0.01);

function run(state: SceneReview, ...actions: SceneReviewAction[]) {
  return actions.reduce(sceneReviewReducer, state);
}

describe("scene review", () => {
  it("accepts objects at or above the threshold and asks about the rest", () => {
    const review = startReview([fox, castle, blob]);
    expect(review.unsure).toEqual(["blob"]);
    expect(nextQuestion(review)?.id).toBe("blob");
    expect(reviewBlocker(review)).toBe("unsure");
    expect(reviewBlocker(startReview([fox, castle]))).toBeUndefined();
  });

  it("an icon answer resolves the question and retypes with defaults", () => {
    const same = run(startReview([fox, blob]), {
      type: "answer",
      id: "blob",
      role: "scenery",
    });
    expect(same.unsure).toEqual([]);
    expect(same.objects[1]).toEqual(blob);
    expect(reviewBlocker(same)).toBeUndefined();

    const retyped = run(startReview([fox, blob]), {
      type: "answer",
      id: "blob",
      role: "obstacle",
    });
    expect(retyped.objects[1]).toMatchObject({
      role: "obstacle",
      properties: ["blocks"],
    });
    expect(retyped.unsure).toEqual([]);
  });

  it("'not in my picture' removes the object and its question", () => {
    const review = run(startReview([fox, blob]), {
      type: "remove",
      id: "blob",
    });
    expect(review.objects.map(({ id }) => id)).toEqual(["fox"]);
    expect(review.unsure).toEqual([]);
  });

  it("tap to change can rename, reshape and retype a sure object", () => {
    const imageBounds = { x: 0.5, y: 0.5, width: 0.1, height: 0.1 };
    const review = run(
      startReview([fox, castle]),
      { type: "rename", id: "castle", name: "Tower" },
      { type: "reshape", id: "castle", imageBounds },
      { type: "answer", id: "castle", role: "helper" },
    );
    expect(review.objects[1]).toMatchObject({
      name: "Tower",
      role: "helper",
      properties: ["carries"],
      imageBounds,
    });
    expect(reviewBlocker(review)).toBeUndefined();
    expect(
      reviewBlocker(run(review, { type: "rename", id: "castle", name: " " })),
    ).toBe("unnamed");
  });

  it("without a character, tapping an object makes it the character", () => {
    const review = startReview([castle, blob]);
    expect(reviewBlocker(review)).toBe("no-character");
    const chosen = run(review, {
      type: "answer",
      id: "blob",
      role: "character",
    });
    expect(chosen.objects[1]).toMatchObject({
      role: "character",
      properties: ["moves"],
    });
    expect(reviewBlocker(chosen)).toBeUndefined();
  });

  it("without a character, a drawn box can become the character", () => {
    const drawn = { ...candidate("object-1", "character", 1), name: "My hero" };
    const review = run(startReview([castle]), {
      type: "add",
      object: drawn,
      unsure: false,
    });
    expect(reviewBlocker(review)).toBeUndefined();
    const scene = confirmedSceneSchema.safeParse({
      document: {
        sourceImage: "picture",
        drawing: { strokes: [], compositeImage: "picture" },
      },
      mode: "live",
      objects: review.objects,
      characterId: "object-1",
      goalId: "castle",
      openingNarration: "My hero explores.",
      moodHints: ["curious"],
    });
    expect(scene.success).toBe(true);
  });

  it("starts with a character and no place to reach", () => {
    const tree = candidate("tree", "scenery", 0.95);
    const review = startReview([fox, tree]);
    expect(reviewBlocker(review)).toBeUndefined();
    // Retyping the only place to reach away leaves Start enabled too.
    expect(
      reviewBlocker(
        run(startReview([fox, castle]), {
          type: "answer",
          id: "castle",
          role: "scenery",
        }),
      ),
    ).toBeUndefined();
    const scene = confirmedSceneSchema.safeParse({
      document: {
        sourceImage: "picture",
        drawing: { strokes: [], compositeImage: "picture" },
      },
      mode: "live",
      objects: review.objects,
      characterId: "fox",
      openingNarration: "Fox explores.",
      moodHints: ["curious"],
    });
    expect(scene.success).toBe(true);
    expect(scene.data?.goalId).toBeUndefined();
    // Still exactly one character.
    expect(reviewBlocker(startReview([tree]))).toBe("no-character");
  });

  it("a missed object waits for its answer", () => {
    const missed = { ...candidate("object-2", "scenery", 1), name: "New" };
    const review = run(startReview([fox]), {
      type: "add",
      object: missed,
      unsure: true,
    });
    expect(nextQuestion(review)?.id).toBe("object-2");
    expect(reviewBlocker(review)).toBe("unsure");
  });

  it("keeps Start disabled until there is exactly one character", () => {
    const two = run(startReview([fox, castle]), {
      type: "answer",
      id: "castle",
      role: "character",
    });
    expect(reviewBlocker(two)).toBe("many-characters");
    expect(
      reviewBlocker(run(two, { type: "answer", id: "fox", role: "helper" })),
    ).toBeUndefined();
    expect(
      reviewBlocker(run(startReview([fox]), { type: "remove", id: "fox" })),
    ).toBe("no-character");
  });
});

describe("question placement", () => {
  const picture = { width: 340, height: 204 };
  const card = { width: 300, height: 80 };

  it("sits below a box when there is room, centred and inside", () => {
    const place = placeQuestion(
      picture,
      { x: 0.1, y: 0.05, width: 0.2, height: 0.2 },
      card,
    );
    expect(place.top).toBeCloseTo(0.25 * 204 + 6);
    expect(place.left).toBe(6);
  });

  it("goes above a low box and stays inside for a full-height box", () => {
    expect(
      placeQuestion(picture, { x: 0.6, y: 0.7, width: 0.2, height: 0.25 }, card)
        .top,
    ).toBeCloseTo(0.7 * 204 - 6 - 80);
    const tall = placeQuestion(
      picture,
      { x: 0.43, y: 0, width: 0.14, height: 1 },
      card,
    );
    expect(tall.top).toBeGreaterThanOrEqual(6);
    expect(tall.top + card.height).toBeLessThanOrEqual(204 - 6);
    expect(tall.left + card.width).toBeLessThanOrEqual(340 - 6);
  });
});
