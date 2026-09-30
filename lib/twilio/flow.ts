import "server-only";

import { parseEmailRequest, type EmailIntent } from "@/lib/ai/email";
import { sendGmail } from "@/lib/google/gmail";
import { admin } from "@/lib/supabase/admin";
import { emailSchema } from "@/lib/validation";
import { appUrl, escapeXml, hashPin, isAffirmative, isNegative } from "@/lib/utils";

type Session = {
  id: string;
  call_sid: string;
  user_id: string;
  state: string;
  draft_recipient_name: string | null;
  draft_recipient_email: string | null;
  draft_subject: string | null;
  draft_body: string | null;
  confirmation_pending: boolean;
  history: unknown[] | null;
};

type Draft = Partial<EmailIntent>;
type Contact = { name: string; email: string };

// Kept in one place so the voice can be changed without touching call logic.
const TTS_VOICE = process.env.TWILIO_TTS_VOICE || "Polly.Joanna-Neural";
const TTS_LANGUAGE = "en-US";
const STT_MODEL = "googlev2_telephony";
const STT_LANGUAGE = "en-US";
const GOODBYE = "Alright. I'll stop pretending to be your secretary now. Bye.";

const say = (text: string) =>
  `<Say voice="${TTS_VOICE}" language="${TTS_LANGUAGE}">${escapeXml(text)}</Say>`;
const actionUrl = (sessionId: string) =>
  appUrl(`/api/twilio/gather?session=${encodeURIComponent(sessionId)}`);
const end = (text: string) => `${say(text)}<Hangup/>`;

function gatherSpeech(
  sessionId: string,
  text: string,
  { timeout = 4, hints = [] }: { timeout?: number; hints?: string[] } = {}
) {
  const hintAttribute = hints.length
    ? ` hints="${escapeXml(hints.join(", "))}"`
    : "";

  // actionOnEmptyResult removes the need for a Redirect after Gather: an empty
  // turn posts directly to the same state handler instead of making a second hop.
  return `<Gather input="speech" action="${actionUrl(sessionId)}" method="POST" language="${STT_LANGUAGE}" speechModel="${STT_MODEL}" speechTimeout="1" timeout="${timeout}" actionOnEmptyResult="true"${hintAttribute}>${say(text)}</Gather>`;
}

function gatherPin(sessionId: string, text: string) {
  return `<Gather input="dtmf" numDigits="4" action="${actionUrl(sessionId)}" method="POST" timeout="5" actionOnEmptyResult="true">${say(text)}</Gather>`;
}

async function update(id: string, values: Record<string, unknown>) {
  const { error } = await admin()
    .from("call_sessions")
    .update({ ...values, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

function draftOf(session: Session): Draft {
  return {
    recipient_name: session.draft_recipient_name,
    recipient_email: session.draft_recipient_email,
    subject: session.draft_subject,
    body: session.draft_body,
  };
}

function clearDraft() {
  return {
    draft_recipient_name: null,
    draft_recipient_email: null,
    draft_subject: null,
    draft_body: null,
    confirmation_pending: false,
  };
}

function confirmation(session: Pick<Session, "draft_recipient_name" | "draft_recipient_email" | "draft_body">) {
  const recipient = session.draft_recipient_name || session.draft_recipient_email || "that recipient";
  return `Email ${recipient} saying ${session.draft_body}. Send it?`;
}

function normalizeName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function spokenEmail(value: string) {
  const direct = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]?.replace(/[.,;:!?]+$/, "");
  if (direct && emailSchema.safeParse(direct.toLowerCase()).success) return direct.toLowerCase();

  if (!/\b(at|dot|period)\b/i.test(value)) return null;
  const candidate = value
    .toLowerCase()
    .trim()
    .replace(/^(?:my|his|her|their|the)?\s*e-?mail(?:\s+address)?\s*(?:is)?\s*/i, "")
    .replace(/\bat\s+sign\b/g, "@").replace(/\bat\b/g, "@")
    .replace(/\b(?:dot|period)\b/g, ".")
    .replace(/[^a-z0-9@._+\-\s]/g, "")
    .replace(/\s+/g, "");
  return emailSchema.safeParse(candidate).success ? candidate : null;
}

async function contactsFor(userId: string) {
  const { data } = await admin().from("contacts").select("name,email").eq("user_id", userId).limit(50);
  return (data || []) as Contact[];
}

async function recipientHints(userId: string) {
  const contacts = await contactsFor(userId);
  return [...new Set(contacts.map((contact) => contact.name.trim()).filter((name) => name && name.length <= 100))].slice(0, 25);
}

function findContact(name: string, contacts: Contact[]) {
  const requested = normalizeName(name);
  const exact = contacts.filter((contact) => normalizeName(contact.name) === requested);
  if (exact.length === 1) return { contact: exact[0], choices: [] as Contact[] };

  const plausible = contacts.filter((contact) => {
    const candidate = normalizeName(contact.name);
    return candidate.includes(requested) || requested.includes(candidate);
  });
  return plausible.length === 1
    ? { contact: plausible[0], choices: [] as Contact[] }
    : { contact: null, choices: plausible.slice(0, 3) };
}

async function speechGatherFor(session: Session, prompt: string, timeout = 4) {
  return gatherSpeech(session.id, prompt, { timeout, hints: await recipientHints(session.user_id) });
}

export async function incomingCall(from: string, sid: string) {
  const db = admin();
  const { data: profile } = await db
    .from("profiles")
    .select("id,full_name,pin_hash")
    .eq("phone_number", from)
    .maybeSingle();
  if (!profile?.pin_hash) {
    return end("Sorry, this phone number isn't connected to a One Number account yet. Visit our website to get started.");
  }

  const { data: existing } = await db.from("call_sessions").select("id,state").eq("call_sid", sid).maybeSingle();
  if (existing?.id) {
    if (existing.state === "completed") return end("This call is already finished. Goodbye.");
    return gatherPin(existing.id, `Hi ${profile.full_name || "there"}. Enter your four digit PIN.`);
  }

  const { data: created } = await db
    .from("call_sessions")
    .insert({ call_sid: sid, user_id: profile.id, state: "awaiting_pin", history: [] })
    .select("id")
    .single();
  if (!created?.id) return end("I couldn't start your session. Please try again.");
  return gatherPin(created.id, `Hi ${profile.full_name || "there"}. Enter your four digit PIN.`);
}

export async function processGather(session: Session, speech: string, digits: string) {
  if (session.state === "completed" || session.state === "send_failed") {
    return end("This request is already finished. Goodbye.");
  }
  if (session.state === "sending") return end("That email is already being sent. Goodbye.");

  if (session.state === "awaiting_pin") {
    const { data: profile } = await admin().from("profiles").select("pin_hash,full_name").eq("id", session.user_id).single();
    if (!digits || hashPin(digits) !== profile?.pin_hash) {
      return gatherPin(session.id, "That PIN doesn't match. Try again.");
    }
    await update(session.id, { state: "awaiting_request" });
    return speechGatherFor(session, `Thanks${profile.full_name ? `, ${profile.full_name}` : ""}. What can I do for you?`);
  }

  if (session.state === "awaiting_another_request") {
    if (isNegative(speech)) {
      await update(session.id, { state: "completed", confirmation_pending: false });
      return end(GOODBYE);
    }
    if (isAffirmative(speech)) {
      await update(session.id, { ...clearDraft(), state: "awaiting_request" });
      return speechGatherFor(session, "What else can I do?");
    }
    // A caller may simply state a new request instead of saying "yes" first.
    await update(session.id, { ...clearDraft(), state: "awaiting_request" });
    return handleIntent({ ...session, ...clearDraft(), state: "awaiting_request" }, speech, {});
  }

  if (session.state === "awaiting_recipient") return handleRecipientEmail(session, speech);
  if (session.state === "awaiting_contact_choice") return handleContactChoice(session, speech);

  if (session.state === "awaiting_confirmation") {
    if (isAffirmative(speech)) return sendDraft(session);
    if (isNegative(speech)) {
      await update(session.id, { ...clearDraft(), state: "awaiting_another_request" });
      return gatherSpeech(session.id, "Okay. Anything else?");
    }
    // A correction such as "Actually Sarah" or "Make that twenty-five" is
    // an email edit, not an ambiguous confirmation response.
    return handleIntent(session, speech, draftOf(session));
  }

  if (!speech.trim()) return speechGatherFor(session, "I didn't catch that. What can I do for you?");
  const savedDraft = draftOf(session);
  const hasSavedDraft = Object.values(savedDraft).some(Boolean);
  return handleIntent(session, speech, hasSavedDraft ? savedDraft : {});
}

async function handleRecipientEmail(session: Session, speech: string) {
  const email = spokenEmail(speech);
  if (!email) {
    // A clear correction is allowed without discarding the draft. Otherwise
    // keep this fast, deterministic email-address turn out of the LLM.
    if (/\b(actually|instead|change|make that)\b/i.test(speech)) {
      return handleIntent(session, speech, draftOf(session));
    }
    return gatherSpeech(session.id, "Please say the email address, like john at gmail dot com.", { timeout: 6 });
  }

  const next = { ...draftOf(session), recipient_email: email };
  await update(session.id, { draft_recipient_email: email, state: "awaiting_confirmation", confirmation_pending: true });
  if (session.draft_recipient_name) {
    await admin().from("contacts").upsert(
      { user_id: session.user_id, name: session.draft_recipient_name, email },
      { onConflict: "user_id,name" }
    );
  }
  return gatherSpeech(session.id, confirmation({
    draft_recipient_name: next.recipient_name || null,
    draft_recipient_email: email,
    draft_body: next.body || null,
  }));
}

async function handleContactChoice(session: Session, speech: string) {
  const directEmail = spokenEmail(speech);
  if (directEmail) return handleRecipientEmail({ ...session, state: "awaiting_recipient" }, speech);

  const { contact, choices } = findContact(speech.trim(), await contactsFor(session.user_id));
  if (!contact) {
    const names = choices.map((choice) => choice.name).join(" or ");
    return speechGatherFor(session, names ? `Did you mean ${names}?` : "Which contact do you mean?");
  }
  await update(session.id, {
    draft_recipient_name: contact.name,
    draft_recipient_email: contact.email,
    state: "awaiting_confirmation",
    confirmation_pending: true,
  });
  return gatherSpeech(session.id, confirmation({
    draft_recipient_name: contact.name,
    draft_recipient_email: contact.email,
    draft_body: session.draft_body,
  }));
}

async function handleIntent(session: Session, speech: string, draft: Draft) {
  const deterministicEmail = spokenEmail(speech);
  let intent: EmailIntent;
  try {
    intent = await parseEmailRequest(speech, draft);
  } catch {
    if (!deterministicEmail) return speechGatherFor(session, "I didn't catch that. Who would you like to email?");
    intent = {
      action: "send_email", recipient_name: null, recipient_email: deterministicEmail,
      subject: null, body: null, missing_fields: [], requires_confirmation: true,
    };
  }

  if (intent.action === "unsupported") return speechGatherFor(session, "I can send emails. Who would you like to email?");
  if (intent.action === "conversation") return speechGatherFor(session, "I can send an email. Who would you like to email?");

  const suppliedName = intent.recipient_name?.trim() || null;
  const nameChanged = Boolean(suppliedName && draft.recipient_name && normalizeName(suppliedName) !== normalizeName(draft.recipient_name));
  const recipientName = suppliedName || draft.recipient_name || null;
  let recipientEmail = deterministicEmail || intent.recipient_email || (nameChanged ? null : draft.recipient_email) || null;
  const body = intent.body?.trim() || draft.body || null;
  const subject = intent.subject?.trim() || (intent.body?.trim() ? intent.body.trim().slice(0, 70) : draft.subject) || (body ? body.slice(0, 70) : null);

  if (!recipientName && !recipientEmail) {
    await update(session.id, { draft_body: body, draft_subject: subject, state: "awaiting_request" });
    return speechGatherFor(session, "Who would you like to email?");
  }

  if (!recipientEmail && recipientName) {
    const { contact, choices } = findContact(recipientName, await contactsFor(session.user_id));
    if (contact) recipientEmail = contact.email;
    else if (choices.length > 1) {
      await update(session.id, {
        draft_recipient_name: recipientName, draft_recipient_email: null, draft_body: body, draft_subject: subject,
        state: "awaiting_contact_choice", confirmation_pending: false,
      });
      return speechGatherFor(session, `I found ${choices.map((choice) => choice.name).join(" or ")}. Which one?`);
    }
  }

  const state = !recipientEmail ? "awaiting_recipient" : !body ? "awaiting_request" : "awaiting_confirmation";
  await update(session.id, {
    draft_recipient_name: recipientName,
    draft_recipient_email: recipientEmail,
    draft_body: body,
    draft_subject: subject,
    history: [{ role: "caller", content: speech }],
    state,
    confirmation_pending: state === "awaiting_confirmation",
  });

  if (!recipientEmail) return gatherSpeech(session.id, `What is ${recipientName}'s email address?`, { timeout: 6 });
  if (!body) return speechGatherFor(session, "What would you like the email to say?");
  return gatherSpeech(session.id, confirmation({
    draft_recipient_name: recipientName,
    draft_recipient_email: recipientEmail,
    draft_body: body,
  }));
}

async function sendDraft(session: Session) {
  if (!session.draft_recipient_email || !session.draft_body || !session.draft_subject) {
    return speechGatherFor(session, "I need the recipient and message. What would you like to email?");
  }

  // Claim this confirmation atomically. A duplicate Twilio webhook can no
  // longer enter the Gmail call after the first request has changed the state.
  const { data: claim } = await admin()
    .from("call_sessions")
    .update({ state: "sending", confirmation_pending: false, updated_at: new Date().toISOString() })
    .eq("id", session.id)
    .eq("state", "awaiting_confirmation")
    .eq("confirmation_pending", true)
    .select("id");
  if (!claim?.length) return end("That email has already been handled. Goodbye.");

  try {
    await sendGmail(session.user_id, session.draft_recipient_email, session.draft_subject, session.draft_body);
    await admin().from("actions").insert({
      user_id: session.user_id, call_sid: session.call_sid, type: "send_email",
      recipient_email: session.draft_recipient_email, recipient_name: session.draft_recipient_name,
      subject: session.draft_subject, body: session.draft_body, status: "sent",
    });
    await update(session.id, { state: "awaiting_another_request", confirmation_pending: false });
    return gatherSpeech(session.id, "Sent. Anything else?");
  } catch (error) {
    await admin().from("actions").insert({
      user_id: session.user_id, call_sid: session.call_sid, type: "send_email",
      recipient_email: session.draft_recipient_email, recipient_name: session.draft_recipient_name,
      subject: session.draft_subject, body: session.draft_body, status: "failed",
    });
    await update(session.id, { state: "send_failed", confirmation_pending: false });
    if ((error as Error).message === "GMAIL_DISCONNECTED") {
      return end("Your Gmail account isn't connected. Open your One Number dashboard to reconnect it.");
    }
    return end("I wasn't able to send that email. Nothing else was sent.");
  }
}
