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
  fieldName: z.string().trim().min(1).max(200).optional(),
});

export const createExtractedFieldSchema = z.object({
  fieldName: z.string().trim().min(1).max(200),
  fieldKey: z.string().trim().min(1).max(120).optional(),
  fieldValue: z.string().max(8000).optional().default(""),
  dataType: z.string().trim().max(40).optional(),
  source: z.enum(["MANUAL", "AI", "SUGGESTED"]).optional().default("MANUAL"),
});
