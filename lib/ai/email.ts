import "server-only";
import OpenAI from "openai";
import { z } from "zod";

export const intentSchema = z.object({ action: z.enum(["send_email", "unsupported", "conversation"]), recipient_name: z.string().nullable(), recipient_email: z.string().email().nullable(), subject: z.string().nullable(), body: z.string().nullable(), missing_fields: z.array(z.enum(["recipient_name", "recipient_email", "body"])), requires_confirmation: z.boolean() });
export type EmailIntent = z.infer<typeof intentSchema>;
const schema = { type: "object", additionalProperties: false, properties: { action: { type: "string", enum: ["send_email", "unsupported", "conversation"] }, recipient_name: { type: ["string", "null"] }, recipient_email: { type: ["string", "null"] }, subject: { type: ["string", "null"] }, body: { type: ["string", "null"] }, missing_fields: { type: "array", items: { type: "string", enum: ["recipient_name", "recipient_email", "body"] } }, requires_confirmation: { type: "boolean" } }, required: ["action", "recipient_name", "recipient_email", "subject", "body", "missing_fields", "requires_confirmation"] };
export async function parseEmailRequest(transcript: string, draft?: Partial<EmailIntent>): Promise<EmailIntent> {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const input = `You are the structured intent parser for a concise phone email assistant.
Only email can be executed. Return only fields stated or clearly changed by the caller; use null for fields that are not mentioned. Never discard a supplied draft field just because this turn omits it. Never invent an email address.

Rules:
- "Email John and tell him hello" is an email request and has recipient_name="John" and body="hello".
- A follow-up such as "His email is john@example.com" fills recipient_email only; it must not erase the existing recipient name or body.
- A correction such as "Actually send it to Sarah" changes recipient_name only; a correction such as "Make that twenty-five minutes" changes body only.
- Preserve the caller's wording in body. Create a short neutral subject only when a body is supplied or changed and no useful existing subject is available.
- If request is rides, appointments, food, calendar, or anything other than email, action=unsupported. If it is only small talk, action=conversation.

Persisted draft (authoritative context): ${JSON.stringify(draft || {})}
Caller: ${transcript}`;
  const response = await client.responses.create({ model: process.env.OPENAI_MODEL || "gpt-4.1-mini", input, text: { format: { type: "json_schema", name: "email_intent", strict: true, schema } } });
  return intentSchema.parse(JSON.parse(response.output_text));
}
