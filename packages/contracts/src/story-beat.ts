import { z } from "zod";
import { storyMoodSchema } from "./index";
import type { EntityKind, WorldState } from "./model";

// Presentation-only language shared by Gemini and the renderer. A beat never
// mutates the world: it points at entities that a committed WorldState already
// contains, and the renderer alone decides positions, timing and visuals.
// Exposed as the `@storyworld/contracts/story-beat` subpath (like `scene`)
// because it needs `storyMoodSchema` from `./index`, so `./index` may only
// re-export its types, which are erased and cannot form an import cycle.

const entityId = z.string().min(1).max(80);

export const storyActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("focus"), entityId }).strict(),
  z
    .object({
      type: z.literal("move_toward"),
      entityId,
      targetId: entityId,
    })
    .strict(),
  z
    .object({
      type: z.literal("blocked_by"),
      entityId,
      obstacleId: entityId,
    })
    .strict(),
  z.object({ type: z.literal("reveal"), entityId }).strict(),
  z
    .object({
      type: z.literal("weather_shift"),
      weather: z.enum(["clear", "rain"]),
      causeEntityId: entityId.optional(),
    })
    .strict(),
  z.object({ type: z.literal("celebrate"), entityId }).strict(),
]);

export const storyBeatSchema = z
  .object({
    id: z.string().min(1).max(80),
    narration: z.string().trim().min(1).max(240),
    mood: storyMoodSchema,
    action: storyActionSchema,
  })
  .strict();

// `mode`, `requestId`, `sourceRevision` and `sourceEventId` are attached by
// the API server, never by the model. A client compares them with its current
// state to discard a stale sequence.
export const storySequenceSchema = z
  .object({
    mode: z.enum(["fixture", "live"]),
    requestId: z.string().min(1).max(100),
    sourceRevision: z.number().int().min(0),
    sourceEventId: z.string().min(1).max(100),
    beats: z.array(storyBeatSchema).min(1).max(3),
  })
  .strict()
  .superRefine((sequence, ctx) => {
    const seen = new Set<string>();
    sequence.beats.forEach((beat, index) => {
      if (seen.has(beat.id))
        ctx.addIssue({
          code: "custom",
          path: ["beats", index, "id"],
          message: `Beat ID "${beat.id}" is used more than once.`,
        });
      seen.add(beat.id);
    });
  });

export type StoryAction = z.infer<typeof storyActionSchema>;
export type StoryBeat = z.infer<typeof storyBeatSchema>;
export type StorySequence = z.infer<typeof storySequenceSchema>;

export type StorySequenceValidation =
  { ok: true; sequence: StorySequence } | { ok: false; errors: string[] };

/**
 * Checks a sequence against one committed world: every referenced entity must
 * exist, and the golden-loop roles must fit (a character moves or is blocked, a
 * river blocks, a cloud causes weather, and presented weather matches the
 * committed state). Accepts unparsed input, never mutates the sequence or the
 * world, and returns a validated copy.
 */
export function validateStorySequenceForWorld(
  input: unknown,
  world: WorldState,
): StorySequenceValidation {
  const parsed = storySequenceSchema.safeParse(input);
  if (!parsed.success)
    return {
      ok: false,
      errors: parsed.error.issues.map(
        (issue) => [...issue.path, issue.message].join(": ") || issue.message,
      ),
    };

  const entities = new Map(world.entities.map((entity) => [entity.id, entity]));
  const errors: string[] = [];
  parsed.data.beats.forEach((beat) => {
    const where = `Beat "${beat.id}"`;
    const find = (field: string, id: string) => {
      const entity = entities.get(id);
      if (!entity)
        errors.push(`${where}: ${field} "${id}" is not in this world.`);
      return entity;
    };
    const requireKind = (
      field: string,
      id: string,
      kind: EntityKind,
      label: string,
    ) => {
      const entity = find(field, id);
      if (entity && entity.kind !== kind)
        errors.push(`${where}: ${field} "${id}" must be ${label}.`);
    };
    const { action } = beat;
    switch (action.type) {
      case "focus":
      case "reveal":
      case "celebrate":
        find("entityId", action.entityId);
        break;
      case "move_toward":
        requireKind("entityId", action.entityId, "character", "a character");
        find("targetId", action.targetId);
        break;
      case "blocked_by":
        requireKind("entityId", action.entityId, "character", "a character");
        requireKind("obstacleId", action.obstacleId, "river", "a river");
        break;
      case "weather_shift":
        if (action.weather !== world.weather)
          errors.push(
            `${where}: weather "${action.weather}" does not match this world's committed weather "${world.weather}".`,
          );
        if (action.causeEntityId)
          requireKind(
            "causeEntityId",
            action.causeEntityId,
            "cloud",
            "a cloud",
          );
        break;
    }
  });
  return errors.length > 0
    ? { ok: false, errors }
    : { ok: true, sequence: parsed.data };
}
