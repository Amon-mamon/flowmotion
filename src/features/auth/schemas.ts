import { z } from "zod";

const email = z
  .string()
  .trim()
  .min(1, "Enter your email")
  .pipe(z.email("Enter a valid email address"));

export const loginSchema = z.object({
  email,
  password: z.string().min(1, "Enter your password"),
});
export type LoginValues = z.infer<typeof loginSchema>;

export const signupSchema = z.object({
  email,
  password: z.string().min(8, "Password must be at least 8 characters"),
  // Optional; when given it becomes `options.data.display_name` (1..80 after trim).
  displayName: z.string().trim().max(80, "Display name must be 80 characters or fewer"),
});
export type SignupValues = z.infer<typeof signupSchema>;
