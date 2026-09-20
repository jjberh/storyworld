import { z } from "zod";

export const storyMoodSchema = z.enum(["curious", "worried", "delighted"]);
