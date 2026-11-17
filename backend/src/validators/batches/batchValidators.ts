import { z } from "zod";

const optionalText = (max: number) =>
  z.preprocess((value) => {
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim();
    return trimmed || undefined;
  }, z.string().max(max).optional());

export const batchIdParamsSchema = z.object({
  id: z.string().uuid("Batch id must be a UUID."),
});

export const createBatchBodySchema = z.object({
  jobName: optionalText(160),
  templateId: z.preprocess((value) => {
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim();
    return trimmed || undefined;
  }, z.string().uuid().optional()),
});

export type CreateBatchBody = z.infer<typeof createBatchBodySchema>;
