import {
  SCENE_AUTO_ACCEPT_CONFIDENCE,
  defaultPropertiesFor,
  type EntityRole,
  type ImageBounds,
  type SceneCandidate,
} from "@storyworld/contracts";

/**
 * What the child is reviewing. Objects the model was sure of are accepted as
 * soon as the picture is read; only the IDs in `unsure` still need an answer.
 */
export type SceneReview = {
  objects: SceneCandidate[];
  unsure: string[];
};

export type SceneReviewAction =
  /** The child picked a role for an object (the same role means "yes"). */
  | { type: "answer"; id: string; role: EntityRole }
  | { type: "remove"; id: string }
  | { type: "rename"; id: string; name: string }
  | { type: "reshape"; id: string; imageBounds: ImageBounds }
  /** A box the child drew; `unsure` objects still need their role picked. */
  | { type: "add"; object: SceneCandidate; unsure: boolean };

export function isSure(candidate: Pick<SceneCandidate, "confidence">) {
  return candidate.confidence >= SCENE_AUTO_ACCEPT_CONFIDENCE;
}

export function startReview(candidates: SceneCandidate[]): SceneReview {
  return {
    objects: candidates,
    unsure: candidates.filter((object) => !isSure(object)).map(({ id }) => id),
  };
}

export function sceneReviewReducer(
  state: SceneReview,
  action: SceneReviewAction,
): SceneReview {
  const id = action.type === "add" ? action.object.id : action.id;
  const resolved = state.unsure.filter((value) => value !== id);
  switch (action.type) {
    case "answer":
      return {
        objects: state.objects.map((object) =>
          object.id !== action.id || object.role === action.role
            ? object
            : // A retyped object takes the new role's defaults, so
              // "Something in the way" really blocks the path.
              {
                ...object,
                role: action.role,
                properties: defaultPropertiesFor(action.role),
              },
        ),
        unsure: resolved,
      };
    case "remove":
      return {
        objects: state.objects.filter((object) => object.id !== action.id),
        unsure: resolved,
      };
    case "rename":
      return {
        ...state,
        objects: state.objects.map((object) =>
          object.id === action.id ? { ...object, name: action.name } : object,
        ),
      };
    case "reshape":
      return {
        ...state,
        objects: state.objects.map((object) =>
          object.id === action.id
            ? { ...object, imageBounds: action.imageBounds }
            : object,
        ),
      };
    case "add":
      return {
        objects: [...state.objects, action.object],
        unsure: action.unsure ? [...resolved, id] : resolved,
      };
  }
}

export type ReviewBlocker =
  "no-character" | "unsure" | "many-characters" | "unnamed";

/**
 * Why "Start my story" is still disabled, or undefined when it is ready. The
 * confirmed-scene contract still validates the scene when the child starts.
 */
export function reviewBlocker(state: SceneReview): ReviewBlocker | undefined {
  const characters = state.objects.filter(
    ({ role }) => role === "character",
  ).length;
  if (characters === 0) return "no-character";
  if (state.unsure.length > 0) return "unsure";
  if (characters > 1) return "many-characters";
  if (state.objects.some(({ name }) => !name.trim())) return "unnamed";
  return undefined;
}

/** The unsure object to ask about next, in the order the objects appear. */
export function nextQuestion(state: SceneReview) {
  return state.objects.find(({ id }) => state.unsure.includes(id));
}

/**
 * Places a question card next to an object's box inside the picture: below it
 * when there is room, otherwise above it, otherwise on the roomier side and
 * kept inside the picture. All values are pixels in the picture's own space.
 */
export function placeQuestion(
  picture: { width: number; height: number },
  box: ImageBounds,
  card: { width: number; height: number },
  gap = 6,
) {
  const clamp = (value: number, min: number, max: number) =>
    Math.max(min, Math.min(max, value));
  const x = box.x * picture.width;
  const y = box.y * picture.height;
  const bottom = y + box.height * picture.height;
  const left = clamp(
    x + (box.width * picture.width) / 2 - card.width / 2,
    gap,
    picture.width - card.width - gap,
  );
  const below = bottom + gap;
  const above = y - gap - card.height;
  const top =
    below + card.height <= picture.height - gap
      ? below
      : above >= gap
        ? above
        : clamp(
            picture.height - bottom >= y ? below : above,
            gap,
            picture.height - card.height - gap,
          );
  return { left: Math.max(gap, left), top: Math.max(gap, top) };
}
