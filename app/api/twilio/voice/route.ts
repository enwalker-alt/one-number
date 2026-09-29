import { incomingCall } from "@/lib/twilio/flow"; import { verifyTwilio } from "@/lib/twilio/verify"; import { twiml } from "@/lib/utils";
export const runtime = "nodejs";
export async function POST(request: Request) { const formData = await request.formData(); const data = Object.fromEntries([...formData.entries()].map(([k, v]) => [k, String(v)])); if (!verifyTwilio(request, data)) return new Response("Unauthorized", { status: 401 }); return twiml(await incomingCall(data.From || "", data.CallSid || "")); }
