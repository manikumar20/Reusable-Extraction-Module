import { z } from "zod";
import { AUTH_LIMITS } from "../../services/auth/authConstants.js";

export const loginBodySchema = z.object({
  email: z
    .string()
    .min(1, "Email is required.")
    .email("Please enter a valid email address."),
  password: z.string().min(1, "Password is required."),
});

export const registerBodySchema = z.object({
  email: z
    .string()
    .min(1, "Email is required.")
    .email("Please enter a valid email address."),
  password: z
    .string()
    .min(AUTH_LIMITS.MIN_PASSWORD_LENGTH, `Password must be at least ${AUTH_LIMITS.MIN_PASSWORD_LENGTH} characters.`),
  name: z.string().trim().min(1, "Name is required."),
  organization: z.string().trim().optional(),
  role: z.string().trim().optional(),
});

export const updateProfileBodySchema = z.object({
  name: z.string().trim().min(1, "Name is required."),
  email: z
    .string()
    .min(1, "Email is required.")
    .email("Please enter a valid email address."),
  organization: z.string().trim().optional().default(""),
  role: z.string().trim().optional().default("Document reviewer"),
});

export type LoginBody = z.infer<typeof loginBodySchema>;
export type RegisterBody = z.infer<typeof registerBodySchema>;
export type UpdateProfileBody = z.infer<typeof updateProfileBodySchema>;
