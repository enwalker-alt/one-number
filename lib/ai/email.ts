import "server-only";
import OpenAI from "openai";
import { z } from "zod";

export const intentSchema = z.object({ action: z.enum(["send_email", "unsupported", "conversation"]), recipient_name: z.string().nullable(), recipient_email: z.string().email().nullable(), subject: z.string().nullable(), body: z.string().nullable(), missing_fields: z.array(z.enum(["recipient_name", "recipient_email", "body"])), requires_confirmation: z.boolean() });
export type EmailIntent = z.infer<typeof intentSchema>;
const schema = { type: "object", additionalProperties: false, properties: { action: { type: "string", enum: ["send_email", "unsupported", "conversation"] }, recipient_name: { type: ["string", "null"] }, recipient_email: { type: ["string", "null"] }, subject: { type: ["string", "null"] }, body: { type: ["string", "null"] }, missing_fields: { type: "array", items: { type: "string", enum: ["recipient_name", "recipient_email", "body"] } }, requires_confirmation: { type: "boolean" } }, required: ["action", "recipient_name", "recipient_email", "subject", "body", "missing_fields", "requires_confirmation"] };
export async function parseEmailRequest(transcript: string, draft?: Partial<EmailIntent>): Promise<EmailIntent> {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const input = `You are the intent parser for a phone assistant. Only email can be executed. Extract an email request from the caller's words. Preserve stated wording in body but write a concise neutral subject if useful. Do not invent recipient email. If request is rides, appointments, food, calendar, or anything other than email, action=unsupported. If mere small talk action=conversation. Draft already collected: ${JSON.stringify(draft || {})}. Caller: ${transcript}`;
  const response = await client.responses.create({ model: process.env.OPENAI_MODEL || "gpt-4.1-mini", input, text: { format: { type: "json_schema", name: "email_intent", strict: true, schema } } });
  return intentSchema.parse(JSON.parse(response.output_text));
}
