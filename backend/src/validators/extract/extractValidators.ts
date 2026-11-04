import { z } from "zod";

const keyList = z
  .array(z.string().trim().min(1).max(120))
  .max(200)
  .optional()
  .default([]);

export const extractTemplateSchema = z
  .object({
    id: z.string().trim().min(1).max(80).optional(),
    name: z.string().trim().max(120).optional().default(""),
    headerKeys: keyList,
    lineKeys: keyList,
  })
  .strict();

export const extractIdParamsSchema = z.object({
  id: z.string().uuid("Extract id must be a UUID."),
});

export type ExtractTemplateInput = z.infer<typeof extractTemplateSchema>;
