import "server-only";
import twilio from "twilio";
export function verifyTwilio(request: Request, form: Record<string, string>) {
  if (process.env.NODE_ENV !== "production" && !process.env.TWILIO_AUTH_TOKEN) return true;
  const signature = request.headers.get("x-twilio-signature"); if (!signature || !process.env.TWILIO_AUTH_TOKEN) return false;
  return twilio.validateRequest(process.env.TWILIO_AUTH_TOKEN, signature, request.url, form);
}
