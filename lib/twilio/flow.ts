import "server-only";
import { admin } from "@/lib/supabase/admin";
import { appUrl, escapeXml, hashPin, isAffirmative, isNegative } from "@/lib/utils";
import { parseEmailRequest, type EmailIntent } from "@/lib/ai/email";
import { sendGmail } from "@/lib/google/gmail";

type Session = { id: string; call_sid: string; user_id: string; state: string; draft_recipient_name: string | null; draft_recipient_email: string | null; draft_subject: string | null; draft_body: string | null; history: unknown[] | null; };
const say = (text: string) => `<Say voice="Polly.Joanna">${escapeXml(text)}</Say>`;
const gather = (sessionId: string, text: string, input = "speech") => `<Gather input="${input}" action="${appUrl(`/api/twilio/gather?session=${encodeURIComponent(sessionId)}`)}" method="POST" speechTimeout="auto" actionOnEmptyResult="true" timeout="6">${say(text)}</Gather><Redirect method="POST">${appUrl(`/api/twilio/gather?session=${encodeURIComponent(sessionId)}`)}</Redirect>`;
const end = (text: string) => `${say(text)}<Hangup/>`;
async function update(id: string, values: Record<string, unknown>) { const { error } = await admin().from("call_sessions").update({ ...values, updated_at: new Date().toISOString() }).eq("id", id); if (error) throw error; }
function draftOf(s: Session): Partial<EmailIntent> { return { recipient_name: s.draft_recipient_name, recipient_email: s.draft_recipient_email, subject: s.draft_subject, body: s.draft_body }; }
function confirmation(s: Session) { return `You want me to email ${s.draft_recipient_email} and say, ${s.draft_body}. Should I send it?`; }
function emailFromSpeech(text: string) { const compact = text.toLowerCase().replace(/\s+(at|@)\s+/g, "@").replace(/\s+(dot|period)\s+/g, ".").replace(/\s/g, ""); return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(compact) ? compact : null; }

export async function incomingCall(from: string, sid: string) {
  const db = admin(); const { data: profile } = await db.from("profiles").select("id,full_name,pin_hash").eq("phone_number", from).maybeSingle();
  if (!profile?.pin_hash) return end("Sorry, this phone number isn't connected to a One Number account yet. Visit our website to get started.");
  const { data: existing } = await db.from("call_sessions").select("id").eq("call_sid", sid).maybeSingle();
  const sessionId = existing?.id || (await db.from("call_sessions").insert({ call_sid: sid, user_id: profile.id, state: "awaiting_pin", history: [] }).select("id").single()).data?.id;
  if (!sessionId) return end("I couldn't start your session. Please try again.");
  return gather(sessionId, `Hi ${profile.full_name || "there"}. Please enter your four digit PIN.`, "dtmf");
}
export async function processGather(session: Session, speech: string, digits: string) {
  const db = admin();
  if (session.state === "awaiting_pin") { const { data: profile } = await db.from("profiles").select("pin_hash,full_name").eq("id", session.user_id).single(); if (!digits || hashPin(digits) !== profile?.pin_hash) return gather(session.id, "That PIN doesn't match. Please try again.", "dtmf"); await update(session.id, { state: "awaiting_request" }); return gather(session.id, `Thanks${profile.full_name ? `, ${profile.full_name}` : ""}. What can I do for you?`); }
  if (session.state === "awaiting_recipient") { const email = emailFromSpeech(speech); if (!email) return gather(session.id, "Please say the email address, like name at example dot com."); const next = { ...draftOf(session), recipient_email: email }; await update(session.id, { draft_recipient_email: email, state: "awaiting_confirmation" }); if (session.draft_recipient_name) await db.from("contacts").upsert({ user_id: session.user_id, name: session.draft_recipient_name, email }, { onConflict: "user_id,name" }); const local = { ...session, draft_recipient_email: email }; return gather(session.id, confirmation(local)); }
  if (session.state === "awaiting_confirmation") { if (isAffirmative(speech)) return sendDraft(session); if (isNegative(speech)) { await update(session.id, { state: "awaiting_correction" }); return gather(session.id, "Okay. What should I change?"); } return gather(session.id, "Please say yes to send it, or tell me what to change."); }
  if (session.state === "awaiting_correction") return handleIntent(session, speech, draftOf(session));
  return handleIntent(session, speech, {});
}
async function handleIntent(session: Session, speech: string, draft: Partial<EmailIntent>) {
  let intent: EmailIntent; try { intent = await parseEmailRequest(speech, draft); } catch { return gather(session.id, "I didn't catch that. Please tell me who to email and what to say."); }
  if (intent.action === "unsupported") return gather(session.id, "I can't do that yet. Right now I can send emails for you. Who would you like to email?");
  if (intent.action === "conversation") return gather(session.id, "I can send an email for you. Who would you like to email?");
  const db = admin(); let recipientEmail = intent.recipient_email || draft.recipient_email || null; const name = intent.recipient_name || draft.recipient_name || null;
  if (!recipientEmail && name) { const { data: contact } = await db.from("contacts").select("email").eq("user_id", session.user_id).ilike("name", name).maybeSingle(); recipientEmail = contact?.email || null; }
  const body = intent.body || draft.body || null; const subject = intent.subject || draft.subject || (body ? body.slice(0, 70) : null);
  await update(session.id, { draft_recipient_name: name, draft_recipient_email: recipientEmail, draft_body: body, draft_subject: subject, history: [{ role: "caller", content: speech }], state: !recipientEmail ? "awaiting_recipient" : !body ? "awaiting_request" : "awaiting_confirmation" });
  if (!name && !recipientEmail) return gather(session.id, "Who would you like me to email?"); if (!recipientEmail) return gather(session.id, `What is ${name}'s email address?`); if (!body) return gather(session.id, "What would you like the email to say?");
  return gather(session.id, confirmation({ ...session, draft_recipient_name: name, draft_recipient_email: recipientEmail, draft_body: body, draft_subject: subject }));
}
async function sendDraft(session: Session) {
  if (!session.draft_recipient_email || !session.draft_body || !session.draft_subject) return gather(session.id, "I need the recipient and message again. What would you like to email?");
  try { await sendGmail(session.user_id, session.draft_recipient_email, session.draft_subject, session.draft_body); await admin().from("actions").insert({ user_id: session.user_id, call_sid: session.call_sid, type: "send_email", recipient_email: session.draft_recipient_email, recipient_name: session.draft_recipient_name, subject: session.draft_subject, body: session.draft_body, status: "sent" }); await update(session.id, { state: "sent", confirmation_pending: false }); return gather(session.id, "Done. I sent the email. Is there anything else you need?"); } catch (error) { if ((error as Error).message === "GMAIL_DISCONNECTED") return end("Your Gmail account isn't connected. Open your One Number dashboard to reconnect it."); await admin().from("actions").insert({ user_id: session.user_id, call_sid: session.call_sid, type: "send_email", recipient_email: session.draft_recipient_email, subject: session.draft_subject, body: session.draft_body, status: "failed" }); return end("I wasn't able to send that email. Nothing was sent."); }
}
