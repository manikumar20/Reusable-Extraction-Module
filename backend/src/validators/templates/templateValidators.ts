import { z } from "zod";
import { FIELD_TYPES } from "../../db/templates/templateDb.js";

const trimmed = (max: number) => z.string().trim().min(1).max(max);

const optionalTrimmed = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value ? value : undefined));

export const sampleBoxSchema = z
  .object({
    page: z.number().int().min(1),
    x: z.number().finite(),
    y: z.number().finite(),
    w: z.number().finite().positive(),
    h: z.number().finite().positive(),
  })
  .strict();

export const templateFieldSchema = z
  .object({
    id: z.string().trim().min(1).max(80).optional(),
    name: trimmed(120),
    type: z.enum(FIELD_TYPES),
    required: z.boolean().optional().default(false),
    hint: optionalTrimmed(300),
    format: optionalTrimmed(80),
    validation: optionalTrimmed(300),
    catalogKey: optionalTrimmed(80),
    level: z.enum(["header", "line"]).optional(),
    sampleBox: sampleBoxSchema.optional(),
  })
  .strict();

export const templateFormSchema = z
  .object({
    name: trimmed(120),
    // Drafts may be created with no fields yet; uniqueness still enforced when present.
    fields: z.array(templateFieldSchema).default([]),
  })
  .strict()
  .superRefine((body, ctx) => {
    const seen = new Set<string>();
    body.fields.forEach((field, index) => {
      const key = field.name.toLowerCase();
      if (seen.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Field names must be unique.",
          path: ["fields", index, "name"],
        });
        return;
      }
      seen.add(key);
    });
  });

const queryString = (max: number) =>
  z
    .preprocess((value) => {
      if (Array.isArray(value)) return value[0];
      return value;
    }, z.string().trim().max(max).optional())
    .transform((value) => value || undefined);

export const listTemplatesQuerySchema = z.object({
  q: queryString(120),
});

const templateRef = z
  .string()
  .min(1, "Template id is required.")
  .refine(
    (value) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) ||
      /^\d+$/.test(value),
    "Template id must be a UUID or numeric id.",
  );

export const templateIdParamsSchema = z.object({
  id: templateRef,
});

export const templateDocumentParamsSchema = z.object({
  id: templateRef,
  docId: z.string().uuid("Document id must be a UUID."),
});

export type TemplateFormInput = z.infer<typeof templateFormSchema>;
