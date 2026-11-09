import { z } from "zod";

export const documentIdParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export const extractedFieldParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
  fieldId: z.string().uuid(),
});

export const updateExtractedFieldSchema = z.object({
  fieldValue: z.string().max(8000),
});
