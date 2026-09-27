import { z } from "zod";
import { storyMoodSchema } from "./story-schema";
import { boundsSchema, entitySchema, operationSchema } from "./world-schema";
import { isBlocker } from "./entity-traits";
export * from "./model";
export * from "./entity-traits";
export { storyMoodSchema };
export {
  entityIdSchema,
  entityPropertySchema,
  entityRoleSchema,
  ruleSchema,
  worldStateSchema,
} from "./world-schema";
export { boundsSchema, entitySchema, operationSchema };
// Story-beat values stay on their focused subpath; types are safe to re-export.
export type {
  StoryAction,
  StoryBeat,
  StorySequence,
  StorySequenceValidation,
} from "./story-beat";
export {
  storySequenceRequestSchema,
  type StorySequenceRequest,
} from "./story-sequence";
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
    role: entitySchema.shape.role,
    description: entitySchema.shape.description,
    properties: entitySchema.shape.properties,
    confidence: z.number().min(0).max(1),
    imageBounds: imageBoundsSchema,
  })
  .strict();
/**
 * Scene candidates the model is at least this sure of are accepted without a
 * question; only the rest are asked about on the picture. Gemini is generous
 * with confidence: in live checks clearly drawn objects scored 0.95 while
 * guesses at unclear shapes scored 0.75 to 0.85 (and up to 0.95 before the
 * scene prompt named this line). A lower, more intuitive line such as 0.75
 * would almost never ask, so it sits at 0.9.
 */
export const SCENE_AUTO_ACCEPT_CONFIDENCE = 0.9;
export const sceneInterpretationResponseSchema = z
  .object({
    mode: z.enum(["fixture", "live"]),
    message: z.string().min(1).max(200),
    candidates: z.array(sceneCandidateSchema).min(1).max(8),
    openingNarration: z.string().min(1).max(600),
    // Absent only when no candidate is a character; the child then taps or
    // draws their hero before the scene can be confirmed.
    characterCandidateId: z.string().min(1).max(80).optional(),
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
    if (response.characterCandidateId) {
      if (
        candidatesById.get(response.characterCandidateId)?.role !== "character"
      )
        context.addIssue({
          code: "custom",
          path: ["characterCandidateId"],
          message: "Character reference must identify a character candidate",
        });
    } else if (
      response.candidates.some((candidate) => candidate.role === "character")
    )
      context.addIssue({
        code: "custom",
        path: ["characterCandidateId"],
        message: "A character candidate needs a character reference",
      });
    if (
      response.goalCandidateId &&
      candidatesById.get(response.goalCandidateId)?.role !== "goal"
    )
      context.addIssue({
        code: "custom",
        path: ["goalCandidateId"],
        message: "Goal reference must identify a goal candidate",
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
    /** The edit tool the child picked. Fixture trusts it; live treats it as advisory. */
    hint: z.enum(["bridge", "cloud", "shelter"]).optional(),
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
    fearedObstacleId: z.string().optional(),
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
      scene.objects.filter((o) => o.role === "character").length !== 1 ||
      objects.get(scene.characterId)?.role !== "character"
    )
      issue("Choose exactly one main character.");
    if (scene.goalId && objects.get(scene.goalId)?.role !== "goal")
      issue("Choose a confirmed place to reach as the destination.");
    if (scene.fearedObstacleId) {
      const feared = objects.get(scene.fearedObstacleId);
      if (!feared || !isBlocker(feared))
        issue("Choose a confirmed obstacle that blocks for the fear rule.");
    }
  });
export type ConfirmedScene = z.infer<typeof confirmedSceneSchema>;
