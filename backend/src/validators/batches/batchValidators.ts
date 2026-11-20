import { z } from "zod";

const optionalText = (max: number) =>
  z.preprocess((value) => {
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim();
    return trimmed || undefined;
  }, z.string().max(max).optional());

export const batchIdParamsSchema = z.object({
  id: z.string().regex(/^\d+$/, "Document id is required."),
});

const optionalFlag = z.preprocess((value) => {
  if (value === undefined || value === null || value === "") return undefined;
  if (value === true || value === "true" || value === "1") return true;
  if (value === false || value === "false" || value === "0") return false;
  return value;
}, z.boolean().optional());

export const createBatchBodySchema = z.object({
  jobName: optionalText(160),
  templateId: z.preprocess((value) => {
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim();
    return trimmed || undefined;
  }, z.string().uuid().optional()),
  /** When false, compress each file and do not start extraction. */
  run: optionalFlag,
  /** When true, leave template_id empty so extraction uses the active template later. */
  deferTemplate: optionalFlag,
});

export type CreateBatchBody = z.infer<typeof createBatchBodySchema>;
