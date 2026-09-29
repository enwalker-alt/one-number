import "server-only";
import { google } from "googleapis";
import { admin } from "@/lib/supabase/admin";
import { decrypt, encrypt } from "@/lib/utils";

const scope = "https://www.googleapis.com/auth/gmail.send";
export function oauthClient() { return new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, process.env.GOOGLE_REDIRECT_URI); }
export function gmailAuthUrl(state: string) { return oauthClient().generateAuthUrl({ access_type: "offline", prompt: "consent", scope, state }); }
export async function saveGoogleTokens(userId: string, code: string) {
  const client = oauthClient(); const { tokens } = await client.getToken(code); if (!tokens.refresh_token) throw new Error("Google did not return a refresh token. Disconnect the app in Google Account permissions, then connect Gmail again.");
  const db = admin(); const { error } = await db.from("integrations").upsert({ user_id: userId, provider: "gmail", status: "connected", access_token_encrypted: tokens.access_token ? encrypt(tokens.access_token) : null, refresh_token_encrypted: encrypt(tokens.refresh_token), token_expiry: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null, updated_at: new Date().toISOString() }, { onConflict: "user_id,provider" }); if (error) throw error;
}
export async function sendGmail(userId: string, to: string, subject: string, body: string) {
  const db = admin(); const { data: integration } = await db.from("integrations").select("*").eq("user_id", userId).eq("provider", "gmail").eq("status", "connected").maybeSingle();
  if (!integration?.refresh_token_encrypted) throw new Error("GMAIL_DISCONNECTED");
  const client = oauthClient(); client.setCredentials({ refresh_token: decrypt(integration.refresh_token_encrypted) });
  client.on("tokens", async (tokens) => { if (tokens.access_token || tokens.refresh_token) await db.from("integrations").update({ access_token_encrypted: tokens.access_token ? encrypt(tokens.access_token) : integration.access_token_encrypted, refresh_token_encrypted: tokens.refresh_token ? encrypt(tokens.refresh_token) : integration.refresh_token_encrypted, token_expiry: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : integration.token_expiry, updated_at: new Date().toISOString() }).eq("id", integration.id); });
  const raw = Buffer.from([`To: ${to}`, `Subject: ${subject}`, "Content-Type: text/plain; charset=utf-8", "", body].join("\r\n")).toString("base64url");
  const result = await google.gmail({ version: "v1", auth: client }).users.messages.send({ userId: "me", requestBody: { raw } }); return result.data.id;
}
