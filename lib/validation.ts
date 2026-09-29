import { z } from "zod";
export const profileSchema = z.object({ full_name: z.string().trim().min(1).max(80), phone_number: z.string().trim().min(10).max(25), pin: z.string().regex(/^\d{4}$/, "PIN must be exactly four digits") });
export const contactSchema = z.object({ name: z.string().trim().min(1).max(100), email: z.string().trim().email().max(255) });
