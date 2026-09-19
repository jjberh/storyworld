import { z } from "zod";
export * from "./model";
// Types only: the schemas import `storyMoodSchema` from this file, so a value
// re-export would be a circular import. Use `@storyworld/contracts/story-beat`
// for the schemas and `validateStorySequenceForWorld`.
export type {
  StoryAction,
  StoryBeat,
  StorySequence,
  StorySequenceValidation,
} from "./story-beat";
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
export const imageBoundsSchema = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().positive().max(1),
    height: z.number().positive().max(1),
  })
  .strict()
  .refine(
    ({ x, width }) => x + width <= 1,
    "Image bounds must fit horizontally",
  )
  .refine(
    ({ y, height }) => y + height <= 1,
    "Image bounds must fit vertically",
  );
export const sceneCandidateSchema = z
  .object({
    id: z.string().min(1).max(80),
    name: z.string().min(1).max(80),
    kind: entitySchema.shape.kind,
    confidence: z.number().min(0).max(1),
    imageBounds: imageBoundsSchema,
  })
  .strict();
export const sceneInterpretationResponseSchema = z
  .object({
    mode: z.enum(["fixture", "live"]),
    message: z.string().min(1).max(200),
    candidates: z.array(sceneCandidateSchema).min(1).max(8),
    openingNarration: z.string().min(1).max(600),
    characterCandidateId: z.string().min(1).max(80),
    goalCandidateId: z.string().min(1).max(80).optional(),
    moodHints: z.array(storyMoodSchema).min(1).max(3),
  })
  .strict()
  .superRefine((response, context) => {
    const candidatesById = new Map(
      response.candidates.map((candidate) => [candidate.id, candidate]),
    );
    if (candidatesById.size !== response.candidates.length)
      context.addIssue({
        code: "custom",
        path: ["candidates"],
        message: "Candidate IDs must be unique",
      });
    if (candidatesById.get(response.characterCandidateId)?.kind !== "character")
      context.addIssue({
        code: "custom",
        path: ["characterCandidateId"],
        message: "Character reference must identify a character candidate",
      });
    if (
      response.goalCandidateId &&
      candidatesById.get(response.goalCandidateId)?.kind !== "castle"
    )
      context.addIssue({
        code: "custom",
        path: ["goalCandidateId"],
        message: "Goal reference must identify a castle candidate",
      });
  });
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
export const drawingDataSchema = z
  .object({
    strokes: z.array(z.array(z.number()).min(4)).max(2_000),
    compositeImage: z.string().min(1).max(4_000_000),
  })
  .strict();
/** The durable browser draft for a child's picture before it becomes a world. */
export const storyDocumentSchema = z
  .object({
    sourceImage: z.string().min(1).max(4_000_000),
    drawing: drawingDataSchema,
    description: z.string().max(2_000).optional(),
  })
  .strict();
export const sceneDraftSchema = z
  .object({
    document: storyDocumentSchema,
    interpretation: sceneInterpretationResponseSchema.optional(),
  })
  .strict();
export type InterpretationInput = z.infer<typeof interpretationInput>;
export type InterpretationOutput = z.infer<typeof interpretationOutput>;
export type DrawingData = z.infer<typeof drawingDataSchema>;
export type StoryDocument = z.infer<typeof storyDocumentSchema>;
export type SceneDraft = z.infer<typeof sceneDraftSchema>;

export const confirmedSceneSchema = z
  .object({
    document: storyDocumentSchema,
    mode: z.enum(["live", "fixture"]),
    objects: z
      .array(
        sceneCandidateSchema.extend({ name: z.string().trim().min(1).max(80) }),
      )
      .min(1)
      .max(20),
    characterId: z.string().min(1),
    goalId: z.string().optional(),
    fearedRiverId: z.string().optional(),
    openingNarration: z.string().trim().min(1).max(600),
    moodHints: z.array(storyMoodSchema).min(1).max(3),
  })
  .strict()
  .superRefine((scene, ctx) => {
    const objects = new Map(scene.objects.map((o) => [o.id, o]));
    const issue = (message: string) =>
      ctx.addIssue({ code: "custom", message });
    if (objects.size !== scene.objects.length)
      issue("Object IDs must be unique.");
    if (
      scene.objects.filter((o) => o.kind === "character").length !== 1 ||
      objects.get(scene.characterId)?.kind !== "character"
    )
      issue("Choose exactly one main character.");
    if (scene.goalId && objects.get(scene.goalId)?.kind !== "castle")
      issue("Choose a confirmed castle as the destination.");
    if (
      scene.fearedRiverId &&
      objects.get(scene.fearedRiverId)?.kind !== "river"
    )
      issue("Choose a confirmed river for the fear rule.");
  });
export type ConfirmedScene = z.infer<typeof confirmedSceneSchema>;
