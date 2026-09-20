import { z } from "zod";
import { worldStateSchema } from "./world-schema";

const idSchema = z.string().trim().min(1).max(100);

// These snapshots and IDs are client-supplied correlation/freshness data.
// This contract checks shape and internal consistency, not database provenance.
export const storySequenceRequestSchema = z
  .object({
    requestId: idSchema,
    committedEvent: z
      .object({
        id: idSchema,
        revision: z.number().int().min(0),
        summary: z.string().trim().min(1).max(500),
      })
      .strict(),
    committedWorld: worldStateSchema,
    previousCommittedWorld: worldStateSchema.nullable(),
    childDescription: z.string().trim().min(1).max(2_000).optional(),
    openingNarration: z.string().trim().min(1).max(600).optional(),
  })
  .strict()
  .superRefine((request, ctx) => {
    if (request.committedEvent.revision !== request.committedWorld.revision)
      ctx.addIssue({
        code: "custom",
        path: ["committedEvent", "revision"],
        message: "Committed event and world revisions must match.",
      });
    const previous = request.previousCommittedWorld;
    if (!previous && request.committedWorld.revision !== 0)
      ctx.addIssue({
        code: "custom",
        path: ["previousCommittedWorld"],
        message: "Only an initial revision may omit the previous world.",
      });
    if (previous) {
      if (previous.id !== request.committedWorld.id)
        ctx.addIssue({
          code: "custom",
          path: ["previousCommittedWorld", "id"],
          message: "Previous and current worlds must have the same ID.",
        });
      if (previous.revision + 1 !== request.committedWorld.revision)
        ctx.addIssue({
          code: "custom",
          path: ["previousCommittedWorld", "revision"],
          message:
            "Previous revision must immediately precede current revision.",
        });
    }
  });

export type StorySequenceRequest = z.infer<typeof storySequenceRequestSchema>;
