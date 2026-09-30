import { processGather } from "@/lib/twilio/flow";
import { admin } from "@/lib/supabase/admin";
import { verifyTwilio } from "@/lib/twilio/verify";
import { twiml } from "@/lib/utils";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const url = new URL(request.url);
  const formData = await request.formData();
  const data = Object.fromEntries(
    [...formData.entries()].map(([key, value]) => [key, String(value)])
  );

  if (!verifyTwilio(request, data)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const id = url.searchParams.get("session");
  if (!id) return new Response("Missing session", { status: 400 });

  const { data: session } = await admin()
    .from("call_sessions")
    .select("*")
    .eq("id", id)
    .single();
  if (!session) return new Response("Missing session", { status: 404 });

  return twiml(await processGather(session, data.SpeechResult || "", data.Digits || ""));
}
