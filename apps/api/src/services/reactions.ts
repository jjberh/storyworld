import { z } from "zod";
import {
  entitySchema,
  type ReactionCue,
  type StoryMood,
} from "@storyworld/contracts";

// Only the parts of a committed world the reaction needs. Extra fields on a
// full WorldEvent (bounds, rules, actor, summary) are ignored, not rejected.
const reactionState = z.object({
  pathStatus: z.enum(["idle", "blocked", "available"]),
  weather: z.enum(["clear", "rain"]),
  goal: z
    .object({ characterId: z.string().max(80) })
    .nullable()
    .optional(),
  entities: z
    .array(
      z.object({
        id: entitySchema.shape.id,
        kind: entitySchema.shape.kind,
        name: entitySchema.shape.name,
      }),
    )
    .max(100),
});
type ReactionState = z.infer<typeof reactionState>;

/**
 * A confirmed WorldEvent plus the world state before it. Reactions are derived
 * from what the committed event changed, never from a button press or from
 * unconfirmed model output.
 */
export const reactionRequest = z.object({
  event: z.object({
    id: z.string().min(1).max(80),
    revision: z.number().int().min(0),
    state: reactionState,
  }),
  previousState: reactionState.nullable().optional(),
});
export type ReactionRequest = z.infer<typeof reactionRequest>;

type ReactionKind = "route_opened" | "bridge_blocked" | "rain_began";

const emotions: Record<ReactionKind, StoryMood> = {
  route_opened: "delighted",
  bridge_blocked: "worried",
  rain_began: "curious",
};

// {hero} is the character's name. Several lines per kind keep repeats fresh.
const lines: Record<ReactionKind, string[]> = {
  route_opened: [
    "Hooray! The bridge is open, and {hero} can finally cross the river!",
    "Wow, look at that bridge! {hero} can reach the castle now!",
    "You did it! The way across the river is open!",
  ],
  bridge_blocked: [
    "Oh no, that bridge does not reach both banks. {hero} still cannot cross the river.",
    "Hmm, the bridge is too short. The river is still in the way!",
    "Almost! The bridge needs to touch both sides of the river.",
  ],
  rain_began: [
    "Ooh, a storm cloud! I can feel the rain starting.",
    "Look up! Rain is falling on the whole world.",
    "Splish, splash! The storm cloud brought the rain.",
  ],
};

// FNV-1a: a stable pick per event, so one event always gets the same line.
function pick(seed: string, count: number) {
  let hash = 0x811c9dc5;
  for (const char of seed) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % count;
}

function heroName(state: ReactionState) {
  const hero =
    state.entities.find((e) => e.id === state.goal?.characterId) ??
    state.entities.find((e) => e.kind === "character");
  // Names can come from a child's picture; keep only what is safe to speak.
  const name = [...(hero?.name ?? "")]
    .map((char) => {
      const code = char.charCodeAt(0);
      return code < 32 || code === 127 ? " " : char;
    })
    .join("")
    .trim()
    .slice(0, 40);
  return name || "our hero";
}

function classify(
  state: ReactionState,
  previous: ReactionState | null,
): ReactionKind | null {
  const before = new Set(previous?.entities.map((e) => e.id));
  const now = new Set(state.entities.map((e) => e.id));
  const added = state.entities.filter((e) => !before.has(e.id));
  // Removals mean a reset or rewind: the world was restored, not changed.
  const removed = previous?.entities.some((e) => !now.has(e.id)) ?? false;
  if (added.length === 0 || removed) return null;

  if (added.some((e) => e.kind === "bridge")) {
    if (
      state.pathStatus === "available" &&
      previous?.pathStatus !== "available"
    )
      return "route_opened";
    if (state.pathStatus === "blocked") return "bridge_blocked";
    return null;
  }
  if (
    added.some((e) => e.kind === "cloud") &&
    state.weather === "rain" &&
    previous?.weather !== "rain"
  )
    return "rain_began";
  return null;
}

/** The caption and emotion for a committed event, or null when it needs none. */
export function reactionFor(request: ReactionRequest): ReactionCue | null {
  const { event, previousState } = request;
  const kind = classify(event.state, previousState ?? null);
  if (!kind) return null;
  const options = lines[kind];
  return {
    eventId: event.id,
    emotion: emotions[kind],
    text: options[pick(event.id, options.length)]!.replace(
      "{hero}",
      heroName(event.state),
    ),
  };
}
