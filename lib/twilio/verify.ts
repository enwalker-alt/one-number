import "server-only";

import twilio from "twilio";

export function verifyTwilio(
  request: Request,
  form: Record<string, string>
) {
  if (
    process.env.NODE_ENV !== "production" &&
    !process.env.TWILIO_AUTH_TOKEN
  ) {
    return true;
  }

  const signature = request.headers.get("x-twilio-signature");

  if (!signature || !process.env.TWILIO_AUTH_TOKEN) {
    return false;
  }

  const incomingUrl = new URL(request.url);

  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ??
    incomingUrl.origin;

  const validationUrl =
    `${baseUrl}${incomingUrl.pathname}${incomingUrl.search}`;

  return twilio.validateRequest(
    process.env.TWILIO_AUTH_TOKEN,
    signature,
    validationUrl,
    form
  );
}