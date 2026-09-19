import { z } from "zod";
export * from "./model";
export const boundsSchema = z
  .object({
    x: z.number().min(0).max(1000),
    y: z.number().min(0).max(600),
    width: z.number().positive().max(1000),
    height: z.number().positive().max(600),
  })
  .strict();
export const entitySchema = z
  .object({
    id: z.string().min(1).max(80),
    name: z.string().min(1).max(80),
    kind: z.enum([
      "character",
      "castle",
      "river",
      "bridge",
      "cloud",
      "shelter",
    ]),
    bounds: boundsSchema,
  })
  .strict();
export const ruleSchema = z
  .object({
    id: z.string().min(1).max(80),
    subjectId: z.string(),
    predicate: z.literal("afraid_of"),
    objectId: z.string(),
  })
  .strict();
export const operationSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("CREATE_ENTITY"), entity: entitySchema }).strict(),
  z.object({ type: z.literal("REMOVE_ENTITY"), entityId: z.string() }).strict(),
  z.object({ type: z.literal("ADD_RULE"), rule: ruleSchema }).strict(),
  z
    .object({
      type: z.literal("SET_GOAL"),
      characterId: z.string(),
      targetId: z.string(),
    })
    .strict(),
]);
export const storyMoodSchema = z.enum(["curious", "worried", "delighted"]);
export const initialSceneResponseSchema = z
  .object({
    operations: z.array(operationSchema).max(20),
    openingNarration: z.string().min(1).max(2_000),
    character: z
      .object({
        id: z.string().min(1).max(80),
        name: z.string().min(1).max(80),
      })
      .strict(),
    moodHints: z.array(storyMoodSchema).min(1).max(3),
  })
  .strict();
export const interpretationInput = z
  .object({
    transcript: z.string().max(2000).optional(),
    image: z.string().max(4_000_000).optional(),
    changedRegion: boundsSchema.optional(),
    entityKind: z.enum(["bridge", "cloud", "shelter"]).optional(),
  })
  .strict();
export const interpretationOutput = z.object({
  mode: z.enum(["fixture", "live"]),
  candidates: z.array(
    z.object({
      operation: operationSchema,
      confidence: z.number().min(0).max(1),
    }),
  ),
  message: z.string(),
});
export type InterpretationInput = z.infer<typeof interpretationInput>;
export type InterpretationOutput = z.infer<typeof interpretationOutput>;
