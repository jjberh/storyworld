import { z } from "zod";
import type { EntityProperty, EntityRole, WorldState } from "./model";
import { storyMoodSchema } from "./story-schema";

// Presentation-only language shared by Gemini and the renderer. A beat never
// mutates the world: it points at entities that a committed WorldState already
// contains, and the renderer alone decides positions, timing and visuals.
// Exposed as the `@storyworld/contracts/story-beat` subpath (like `scene`).

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
  // Something that flies passes over something that blocks.
  z
    .object({
      type: z.literal("fly_over"),
      entityId,
      obstacleId: entityId,
    })
    .strict(),
  // The character is carried by a helper, optionally toward a target.
  z
    .object({
      type: z.literal("ride"),
      entityId,
      carrierId: entityId,
      targetId: entityId.optional(),
    })
    .strict(),
  // Something is thrown or bounced by a launcher, optionally toward a target.
  z
    .object({
      type: z.literal("launch"),
      entityId,
      launcherId: entityId,
      targetId: entityId.optional(),
    })
    .strict(),
  // A funny failure: the character tumbles into something that blocks.
  z
    .object({
      type: z.literal("splash"),
      entityId,
      obstacleId: entityId,
    })
    .strict(),
  // A character's short reaction to something new.
  z
    .object({
      type: z.literal("react"),
      entityId,
      causeId: entityId,
      reaction: z.enum(["surprised", "scared", "happy"]),
    })
    .strict()
    .refine((action) => action.causeId !== action.entityId, {
      message: "A reaction needs a cause other than the reacting entity.",
      path: ["causeId"],
    }),
]);

export const storyBeatSchema = z
  .object({
    id: z.string().min(1).max(80),
    narration: z.string().trim().min(1).max(240),
    mood: storyMoodSchema,
    action: storyActionSchema,
  })
  .strict();

// `mode`, `requestId`, `sourceRevision` and `sourceEventId` are constructed by
// the API server, never by the model. The IDs and revision are echoed from the
// validated request as correlation/freshness tokens; this API does not
// authenticate their database provenance.
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
 * exist, and roles and properties must fit (a character moves, is blocked or
 * rides; an obstacle `blocks`; a cause of weather has `weather`; a flyer
 * `flies`; a carrier `carries`; a launcher `launches`), and presented weather
 * matches the committed state. Accepts unparsed input, never mutates the sequence or the
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
    const requireRole = (
      field: string,
      id: string,
      role: EntityRole,
      label: string,
    ) => {
      const entity = find(field, id);
      if (entity && entity.role !== role)
        errors.push(`${where}: ${field} "${id}" must be ${label}.`);
    };
    const requireProperty = (
      field: string,
      id: string,
      property: EntityProperty,
      label: string,
    ) => {
      const entity = find(field, id);
      if (entity && !entity.properties.includes(property))
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
        requireRole("entityId", action.entityId, "character", "a character");
        find("targetId", action.targetId);
        break;
      case "blocked_by":
        requireRole("entityId", action.entityId, "character", "a character");
        requireProperty(
          "obstacleId",
          action.obstacleId,
          "blocks",
          "something that blocks",
        );
        break;
      case "weather_shift":
        if (action.weather !== world.weather)
          errors.push(
            `${where}: weather "${action.weather}" does not match this world's committed weather "${world.weather}".`,
          );
        if (action.causeEntityId)
          requireProperty(
            "causeEntityId",
            action.causeEntityId,
            "weather",
            "something that changes the weather",
          );
        break;
      case "fly_over":
        requireProperty(
          "entityId",
          action.entityId,
          "flies",
          "something that flies",
        );
        requireProperty(
          "obstacleId",
          action.obstacleId,
          "blocks",
          "something that blocks",
        );
        break;
      case "ride":
        requireRole("entityId", action.entityId, "character", "a character");
        requireProperty(
          "carrierId",
          action.carrierId,
          "carries",
          "something that carries",
        );
        if (action.targetId) find("targetId", action.targetId);
        break;
      case "launch":
        find("entityId", action.entityId);
        requireProperty(
          "launcherId",
          action.launcherId,
          "launches",
          "something that launches",
        );
        if (action.targetId) find("targetId", action.targetId);
        break;
      case "splash":
        requireRole("entityId", action.entityId, "character", "a character");
        requireProperty(
          "obstacleId",
          action.obstacleId,
          "blocks",
          "something that blocks",
        );
        break;
      case "react":
        requireRole("entityId", action.entityId, "character", "a character");
        find("causeId", action.causeId);
        break;
    }
  });
  return errors.length > 0
    ? { ok: false, errors }
    : { ok: true, sequence: parsed.data };
}
