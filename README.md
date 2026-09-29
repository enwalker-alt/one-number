# One Number

**Connect the services you use once. Then just call.** This V1 lets a registered caller authenticate with a four-digit PIN and send Gmail email by voice. Every email requires a spoken, explicit confirmation before it is sent.

## What is included

- Supabase email/password authentication, profiles, contacts, activity, and persistent call sessions
- Google OAuth limited to `https://www.googleapis.com/auth/gmail.send`
- Encrypted-at-rest Gmail tokens (application-layer AES-256-GCM, using `TOKEN_ENCRYPTION_KEY`)
- Twilio programmable voice using `<Gather>` for DTMF PIN and speech turns
- OpenAI structured intent parsing, server-side Zod validation, and a deterministic confirmation gate
- Dashboard, onboarding, Gmail connect/disconnect, and contact CRUD

This is an MVP, not production-grade credential infrastructure: application-level token encryption depends on safeguarding and rotating the environment encryption key. Add key management, audit logging, rate limits, retention policies, legal/privacy review, and monitoring before broader use.

## 1. Install

Unzip the project, open the `one-number` folder in VS Code, then run:

```bash
npm install
cp .env.example .env.local
```

Fill in `.env.local` as the following sections explain. Generate `TOKEN_ENCRYPTION_KEY` with:

```bash
openssl rand -base64 32
```

## 2. Supabase

1. Create a project at [supabase.com/dashboard](https://supabase.com/dashboard).
2. In **Project Settings → API**, copy **Project URL** to `NEXT_PUBLIC_SUPABASE_URL`, copy the **Publishable key** to `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and copy the **service_role** secret to `SUPABASE_SERVICE_ROLE_KEY`. Never place the service role key in a `NEXT_PUBLIC_` variable.
3. Open **SQL Editor → New query**. Copy all of `supabase/migrations/001_initial_schema.sql`, run it, and confirm the five tables were created.
4. In **Authentication → URL Configuration**, set Site URL to `http://localhost:3000` locally. Add both `http://localhost:3000/**` and your eventual `https://YOUR-APP.vercel.app/**` to Redirect URLs.
5. In **Authentication → Providers → Email**, enable Email. For easiest early testing, disable “Confirm email” or confirm the signup email before continuing.

The app uses RLS for browser-facing records. Twilio/Gmail server operations use `SUPABASE_SERVICE_ROLE_KEY` only inside server-only files.

## 3. Google Cloud and Gmail

1. Go to [Google Cloud Console](https://console.cloud.google.com/), create/select a project, then open **APIs & Services → Library** and enable **Gmail API**.
2. In **OAuth consent screen**, select External for a personal MVP, enter app details, add yourself under **Test users**, and add the scope `https://www.googleapis.com/auth/gmail.send` under Data Access. Gmail send is a sensitive scope; external production use may need Google verification.
3. In **Credentials → Create Credentials → OAuth client ID**, choose **Web application**.
4. Add these Authorized redirect URIs exactly (replace the Vercel domain after deployment):

```text
http://localhost:3000/api/gmail/callback
https://YOUR-APP.vercel.app/api/gmail/callback
```

5. Copy Client ID into `GOOGLE_CLIENT_ID` and Client secret into `GOOGLE_CLIENT_SECRET`.
6. Locally set `GOOGLE_REDIRECT_URI=http://localhost:3000/api/gmail/callback`. In Vercel set it to `https://YOUR-APP.vercel.app/api/gmail/callback`.

## 4. OpenAI

Create an API key at [platform.openai.com/api-keys](https://platform.openai.com/api-keys), put it in `OPENAI_API_KEY`, and set `OPENAI_MODEL=gpt-4.1-mini` (or another Responses API model that supports JSON Schema structured output). API billing is separate from a ChatGPT subscription.

## 5. Twilio (voice setup)

1. Create/log into [Twilio Console](https://console.twilio.com/).
2. Buy a **voice-capable US phone number** under **Phone Numbers → Manage → Buy a number**.
3. Open **Phone Numbers → Manage → Active numbers**, select that number, and find **Voice Configuration**.
4. For **A call comes in**, choose **Webhook**, choose **POST**, and enter the exact endpoint:

```text
https://YOUR-APP.vercel.app/api/twilio/voice
```

5. Copy Account SID to `TWILIO_ACCOUNT_SID`, Auth Token to `TWILIO_AUTH_TOKEN`, and the purchased number in E.164 form (for example `+16155550123`) to `TWILIO_PHONE_NUMBER`.
6. Click Save. For local testing, install and authenticate [ngrok](https://ngrok.com/), run:

```bash
ngrok http 3000
```

Then put `https://YOUR-NGROK-DOMAIN.ngrok-free.app/api/twilio/voice` in Twilio and set `NEXT_PUBLIC_APP_URL` to that tunnel domain while testing Twilio. **Important:** also add the same tunnel base URL to Supabase redirects if signing in through the tunnel. Google’s redirect must still equal the exact `GOOGLE_REDIRECT_URI` you configured.
7. Trial Twilio accounts can call only verified phone numbers and play a trial announcement. Register the calling number in One Number in E.164 or a normal 10-digit US format; the app normalizes it to E.164.

Twilio webhook URL format: `https://YOUR-DOMAIN/api/twilio/voice` (POST).

## 6. Run locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Create an account, complete profile and Gmail connection, then configure Twilio as above. Production checks:

```bash
npm run typecheck
npm run lint
npm run build
```

## 7. GitHub

In the project folder:

```bash
git init
git add .
git commit -m "Initial One Number MVP"
git branch -M main
```

Create an empty GitHub repository in the browser (do not initialize it with a README), then run:

```bash
git remote add origin https://github.com/YOUR-USERNAME/YOUR-REPO.git
git push -u origin main
```

If you use GitHub CLI instead: `gh repo create one-number --private --source=. --push`.

## 8. Vercel

1. At [vercel.com/new](https://vercel.com/new), import the GitHub repository. Vercel recognizes Next.js automatically.
2. In **Environment Variables**, add every variable from `.env.example`, with production values. Do not paste `.env.local` into GitHub.
3. Set `NEXT_PUBLIC_APP_URL` to the deployed `https://YOUR-APP.vercel.app`; set `GOOGLE_REDIRECT_URI` to `https://YOUR-APP.vercel.app/api/gmail/callback`.
4. Deploy. Then add that production callback to Google Authorized redirect URIs and that deployment base URL to Supabase Auth Redirect URLs.
5. Update Twilio **A call comes in** to `https://YOUR-APP.vercel.app/api/twilio/voice` with POST, save, and test. Redeploy after any changed Vercel environment variable.

Google OAuth callback URL format: `https://YOUR-DOMAIN/api/gmail/callback`.

## 9. End-to-end verification

- [ ] Account created and profile completed
- [ ] Calling phone and four-digit PIN saved
- [ ] Gmail connects and shows Connected
- [ ] One Number is displayed
- [ ] Call arrives from the registered phone
- [ ] Correct PIN is accepted
- [ ] Ask it to email yourself
- [ ] Assistant confirms recipient and message; say “yes”
- [ ] Email arrives and activity appears on dashboard
- [ ] Tell it “Alex is alex@example.com” in a successful email flow; on the next call, “Email Alex…” resolves the saved contact

If Twilio returns 401, verify that `NEXT_PUBLIC_APP_URL` matches the public URL Twilio calls. Twilio signatures are checked against the actual request URL. Do not proxy/modify that URL after Twilio signs it.
