import { z } from "zod";

export const AnalyzeDiffInputSchema = z
  .object({
    repository_root: z.string().trim().min(1).max(4_096),
    commit_range: z.string().trim().min(1).max(256).optional(),
    file_filter: z.string().trim().optional(),
  })
  .strict();

export type AnalyzeDiffInput = z.infer<typeof AnalyzeDiffInputSchema>;

export const AnalyzeDiffResultSchema = z
  .object({
    summary: z.string(),
    changed_files_count: z.number().int().nonnegative(),
    additions: z.number().int().nonnegative(),
    deletions: z.number().int().nonnegative(),
    impact_rating: z.enum(["low", "medium", "high"]),
    architectural_notes: z.array(z.string()),
  })
  .strict();

export type AnalyzeDiffResult = z.infer<typeof AnalyzeDiffResultSchema>;
