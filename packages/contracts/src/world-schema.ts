import { z } from "zod";

export const entityIdSchema = z.string().trim().min(1).max(80);

export const boundsSchema = z
  .object({
    x: z.number().min(0).max(1000),
    y: z.number().min(0).max(600),
    width: z.number().positive().max(1000),
    height: z.number().positive().max(600),
  })
  .strict();

export const entityRoleSchema = z.enum([
  "character",
  "goal",
  "obstacle",
  "helper",
  "scenery",
]);

export const entityPropertySchema = z.enum([
  "moves",
  "flies",
  "swims",
  "floats",
  "carries",
  "launches",
  "blocks",
  "burns",
  "scares",
  "shelters",
  "weather",
  "goal",
]);

// Required, not defaulted: the module compares canonical JSON for idempotent
// scene initialization, so a parse must never add fields.
export const entityDescriptionSchema = z.string().trim().max(200);

export const entityPropertiesSchema = z
  .array(entityPropertySchema)
  .max(6)
  .refine(
    (properties) => new Set(properties).size === properties.length,
    "Properties must not repeat.",
  );

/** Most numbers a sketch may hold, so an operation stays under 10 kB. */
export const MAX_SKETCH_NUMBERS = 1600;

// World coordinates, so a stroke stays inside the 1000x600 page.
const strokeSchema = z
  .array(z.number().int().min(0).max(1000))
  .min(4)
  .max(MAX_SKETCH_NUMBERS)
  .refine(
    (points) =>
      points.length % 2 === 0 &&
      points.every((value, index) => index % 2 === 0 || value <= 600),
    "A stroke is a list of x, y pairs inside the page.",
  );

export const entitySketchSchema = z
  .object({ strokes: z.array(strokeSchema).min(1).max(40) })
  .strict()
  .refine(
    ({ strokes }) =>
      strokes.reduce((total, stroke) => total + stroke.length, 0) <=
      MAX_SKETCH_NUMBERS,
    "The sketch has too many points.",
  );

export const interactionOutcomeSchema = z.enum([
  "crosses",
  "flies_over",
  "rides_across",
  "launched_across",
  "almost",
  "splash",
  "blocked",
  "scared",
  "sheltered",
  "nothing_happens",
]);

export const entitySchema = z
  .object({
    id: entityIdSchema,
    role: entityRoleSchema,
    name: z.string().trim().min(1).max(80),
    description: entityDescriptionSchema,
    properties: entityPropertiesSchema,
    bounds: boundsSchema,
    sketch: entitySketchSchema.optional(),
    outcome: interactionOutcomeSchema.optional(),
  })
  .strict();

const probabilitySchema = z.number().min(0).max(1);

export const interactionSchema = z
  .object({
    entityId: entityIdSchema,
    outcome: interactionOutcomeSchema,
    // Null in free play (no goal, so Jev's odds question is not asked).
    odds: probabilitySchema.nullable(),
    confidence: probabilitySchema,
    obstacleId: entityIdSchema.nullable(),
    revision: z.number().int().min(0),
  })
  .strict();

export const routeCrossingSchema = z
  .object({ obstacleId: entityIdSchema, helperId: entityIdSchema })
  .strict();

export const ruleSchema = z
  .object({
    id: entityIdSchema,
    subjectId: entityIdSchema,
    predicate: z.literal("afraid_of"),
    objectId: entityIdSchema,
  })
  .strict();

export const operationSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("CREATE_ENTITY"), entity: entitySchema }).strict(),
  z
    .object({ type: z.literal("REMOVE_ENTITY"), entityId: entityIdSchema })
    .strict(),
  z.object({ type: z.literal("ADD_RULE"), rule: ruleSchema }).strict(),
  z
    .object({
      type: z.literal("SET_GOAL"),
      characterId: entityIdSchema,
      targetId: entityIdSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("RESOLVE_INTERACTION"),
      entityId: entityIdSchema,
      outcome: interactionOutcomeSchema,
      // Null exactly when the world has no goal; the reducer checks which.
      odds: probabilitySchema.nullable(),
      confidence: probabilitySchema,
      obstacleId: entityIdSchema.nullable(),
    })
    .strict(),
]);

export const worldStateSchema = z
  .object({
    id: z.string().trim().min(1).max(100),
    revision: z.number().int().min(0),
    schemaVersion: z.number().int().positive(),
    entities: z.array(entitySchema).max(100),
    rules: z.array(ruleSchema).max(200),
    goal: z
      .object({
        characterId: entityIdSchema,
        targetId: entityIdSchema,
      })
      .strict()
      .nullable(),
    pathStatus: z.enum(["idle", "free_play", "blocked", "available"]),
    weather: z.enum(["clear", "rain"]),
    interaction: interactionSchema.nullable(),
    crossings: z.array(routeCrossingSchema).max(100),
  })
  .strict()
  .superRefine((world, ctx) => {
    const entities = new Map(
      world.entities.map((entity) => [entity.id, entity]),
    );
    if (entities.size !== world.entities.length)
      ctx.addIssue({
        code: "custom",
        path: ["entities"],
        message: "Entity IDs must be unique.",
      });
    const ruleIds = new Set(world.rules.map((rule) => rule.id));
    if (ruleIds.size !== world.rules.length)
      ctx.addIssue({
        code: "custom",
        path: ["rules"],
        message: "Rule IDs must be unique.",
      });
    world.rules.forEach((rule, index) => {
      if (!entities.has(rule.subjectId))
        ctx.addIssue({
          code: "custom",
          path: ["rules", index, "subjectId"],
          message: "Rule subject must exist in the world.",
        });
      if (!entities.has(rule.objectId))
        ctx.addIssue({
          code: "custom",
          path: ["rules", index, "objectId"],
          message: "Rule object must exist in the world.",
        });
    });
    if (world.interaction) {
      if (!entities.has(world.interaction.entityId))
        ctx.addIssue({
          code: "custom",
          path: ["interaction", "entityId"],
          message: "The interaction's drawing must exist in the world.",
        });
      if (
        world.interaction.obstacleId &&
        !entities.has(world.interaction.obstacleId)
      )
        ctx.addIssue({
          code: "custom",
          path: ["interaction", "obstacleId"],
          message: "The interaction's obstacle must exist in the world.",
        });
    }
    world.crossings.forEach((crossing, index) => {
      if (
        !entities.has(crossing.obstacleId) ||
        !entities.has(crossing.helperId)
      )
        ctx.addIssue({
          code: "custom",
          path: ["crossings", index],
          message: "A crossing must refer to entities in the world.",
        });
    });
    if (world.goal) {
      if (entities.get(world.goal.characterId)?.role !== "character")
        ctx.addIssue({
          code: "custom",
          path: ["goal", "characterId"],
          message: "Goal character must identify a character.",
        });
      if (!entities.has(world.goal.targetId))
        ctx.addIssue({
          code: "custom",
          path: ["goal", "targetId"],
          message: "Goal target must exist in the world.",
        });
    }
  });
