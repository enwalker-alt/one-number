import { incomingCall } from "@/lib/twilio/flow";
import { verifyTwilio } from "@/lib/twilio/verify";
import { twiml } from "@/lib/utils";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const formData = await request.formData();

  const data = Object.fromEntries(
    [...formData.entries()].map(([key, value]) => [key, String(value)])
  );

  const signature = request.headers.get("x-twilio-signature");

  // Temporary compatibility for Twilio's free-trial inbound tester,
  // which is reaching this endpoint without X-Twilio-Signature.
  const isUnsignedTrialRequest =
    !signature &&
    Boolean(process.env.TWILIO_ACCOUNT_SID) &&
    data.AccountSid === process.env.TWILIO_ACCOUNT_SID;

  if (!isUnsignedTrialRequest && !verifyTwilio(request, data)) {
    return new Response("Unauthorized", { status: 401 });
  }

  return twiml(
    await incomingCall(
      data.From || "",
      data.CallSid || ""
    )
  );
}