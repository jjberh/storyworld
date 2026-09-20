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

export const entityKindSchema = z.enum([
  "character",
  "castle",
  "river",
  "bridge",
  "cloud",
  "shelter",
]);

export const entitySchema = z
  .object({
    id: entityIdSchema,
    name: z.string().trim().min(1).max(80),
    kind: entityKindSchema,
    bounds: boundsSchema,
  })
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
    pathStatus: z.enum(["idle", "blocked", "available"]),
    weather: z.enum(["clear", "rain"]),
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
    if (world.goal) {
      if (entities.get(world.goal.characterId)?.kind !== "character")
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
