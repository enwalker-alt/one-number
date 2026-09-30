import "server-only";

import twilio from "twilio";

export function verifyTwilio(
  request: Request,
  form: Record<string, string>
) {
  const token = process.env.TWILIO_AUTH_TOKEN?.trim();
  const expectedAccountSid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const signature = request.headers.get("x-twilio-signature");

  const incomingUrl = new URL(request.url);

  const configuredBase = process.env.NEXT_PUBLIC_APP_URL
    ?.trim()
    .replace(/\/+$/, "");

  const forwardedHost = request.headers
    .get("x-forwarded-host")
    ?.split(",")[0]
    ?.trim();

  const forwardedProto = request.headers
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim();

  const host = request.headers.get("host");

  const candidates = new Set<string>();

  candidates.add(request.url);

  if (configuredBase) {
    candidates.add(
      `${configuredBase}${incomingUrl.pathname}${incomingUrl.search}`
    );
  }

  if (host) {
    candidates.add(
      `https://${host}${incomingUrl.pathname}${incomingUrl.search}`
    );
  }

  if (forwardedHost) {
    candidates.add(
      `${forwardedProto || "https"}://${forwardedHost}${incomingUrl.pathname}${incomingUrl.search}`
    );
  }

  const results =
    token && signature
      ? [...candidates].map((url) => ({
          url,
          valid: twilio.validateRequest(token, signature, url, form),
        }))
      : [];

  const valid = results.some((result) => result.valid);

  if (!valid) {
    console.error(
      "TWILIO_VERIFY_DEBUG",
      JSON.stringify({
        signaturePresent: Boolean(signature),
        authTokenPresent: Boolean(token),
        envAccountSidPresent: Boolean(expectedAccountSid),
        postedAccountSidPresent: Boolean(form.AccountSid),
        accountSidMatches:
          Boolean(expectedAccountSid) &&
          Boolean(form.AccountSid) &&
          expectedAccountSid === form.AccountSid,
        requestUrl: request.url,
        host,
        forwardedHost,
        forwardedProto,
        candidates: results,
        formKeys: Object.keys(form).sort(),
      })
    );
  }

  return valid;
}