# README-OPENROUTER — turn on free AI for local testing

OpenRouter gives Flow Motion AI recommendations on your own computer at no cost. It is for **development only** (decisions D-24, D-33): it works only under `npm run dev` with `APP_URL` on localhost, and the deployed worker always refuses it. Production will use Anthropic.

> **Wait** until the Phase 2b security review says the scanner fixes (S2R-1) pass before you put a key in `.env.local`. Free models may log or train on what they receive, so the scanner must hide every secret first.

## 1. Get a key
1. Go to https://openrouter.ai and sign up (Google, GitHub, or email).
2. Open your account menu → **Keys** → **Create Key**. Give it a name such as `flowmotion-dev`. Do not add a payment method; free models do not need one.
3. Copy the key (it starts with `sk-or-`). It is shown only once. Store it in your password manager.

## 2. Pick a free model
1. Go to https://openrouter.ai/models and filter by **Free** (or search `:free`).
2. Pick a model with a large context window (100k+ tokens) because Flow Motion can send up to 120k tokens per analysis.
3. Copy its id. Free ids end in `:free`, for example `vendor/model-name:free`.

## 3. Put the values in `.env.local`
Open `.env.local` yourself and set these four lines. The key goes in `OPENROUTER_API_KEY`, **not** in `ANALYSIS_MODEL`.

| Variable | Value |
|---|---|
| `ANALYSIS_PROVIDER` | `openrouter` |
| `ANALYSIS_MODEL` | the model id from step 2, for example `vendor/model-name:free` |
| `OPENROUTER_API_KEY` | the `sk-or-...` key from step 1 |
| `APP_URL` | `http://localhost:3000` |

Then stop and restart `npm run dev`.

## 4. Test
Open a project of **your own** (for example `booklod`) and press Analyze. The analysis should end with recommendations instead of "AI analysis is not enabled yet". If it still says AI is off, check the four values, check that the app runs at `http://localhost:3000`, and restart `npm run dev`.

## Rules
- Never paste the key into a chat, a commit, Supabase, or Vercel. It lives only in `.env.local` on your computer.
- Analyze only your own test repositories.
- Free models have daily request limits. If analyses fail with a rate-limit error, wait or pick another free model.
- To turn AI off again: `ANALYSIS_PROVIDER=disabled`, then restart `npm run dev`.
- If the key leaks, delete it on the OpenRouter **Keys** page and create a new one.
