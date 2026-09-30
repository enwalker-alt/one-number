import "server-only";

import twilio from "twilio";

export function verifyTwilio(
  request: Request,
  form: Record<string, string>
) {
  const token = process.env.TWILIO_AUTH_TOKEN?.trim();
  const expectedAccountSid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const signature = request.headers.get("x-twilio-signature");

  // Twilio Console trial inbound flow is reaching us without
  // X-Twilio-Signature. Permit it only while explicitly in trial mode
  // and only when the posted AccountSid matches this Twilio account.
  if (
    process.env.TWILIO_TRIAL_MODE === "true" &&
    !signature &&
    expectedAccountSid &&
    form.AccountSid === expectedAccountSid
  ) {
    return true;
  }

  if (!token || !signature) {
    return false;
  }

  const incomingUrl = new URL(request.url);

  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, "") ??
    incomingUrl.origin;

  const validationUrl =
    `${baseUrl}${incomingUrl.pathname}${incomingUrl.search}`;

  return twilio.validateRequest(
    token,
    signature,
    validationUrl,
    form
  );
}