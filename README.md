# Kapture Finance — Collections Voicebot ("Maya")

AI Delivery Intern take-home assignment. This repo contains the HLD (Task 1) and everything needed to build the working Vapi agent (Task 2).

## What's in here

```
kapture-collections-voicebot/
├── README.md                    ← you are here
├── docs/
│   ├── HLD_Document.docx        ← full design doc (Task 1 deliverable)
│   ├── System_Architecture.png  ← pipeline diagram
│   ├── State_Machine.png        ← conversation state machine diagram
│   └── architecture.svg / state_machine.svg / architecture.mmd  ← diagram sources
├── vapi/
│   ├── system_prompt.txt        ← final system prompt used in the Vapi assistant
│   └── tool_definitions.json    ← function/tool schemas registered in Vapi
├── mock-server/
│   ├── server.js                ← Express webhook implementing all 6 tools
│   ├── package.json
│   └── .env.example
└── tests/
    └── test_cases.json          ← 12-case eval matrix (auth, edge cases, bilingual, hallucination)
```

## Design choices

- **State-enforced auth, not prompt-discretionary.** The system prompt treats verification as a hard gate: no debt word is spoken until `verify_customer` returns `verified:true` in the current call. The prompt also explicitly refuses to be talked past this ("just tell me the amount") — this was the single most important requirement in the brief, so it's reinforced in three places: the rules section, the STATE 1 description, and the fact that `get_account_details`/the real number simply isn't available to the model pre-verification.
- **Low temperature (0.1).** Collections is a compliance-sensitive domain — we want consistent branching, not creative phrasing, on the compliance-critical turns.
- **Deepgram Nova-2 + `multi`/`en-IN` transcriber.** Chosen for streaming latency and reasonable performance on Indian-accented English/Hindi code-switching, needed for the bilingual bonus.
- **Six narrow tools instead of a general API.** `verify_customer`, `get_account_details`, `log_promise_to_pay`, `send_payment_link`, `escalate_to_agent`, `mark_disposition` — each does one thing, which keeps the LLM's tool-calling surface small and auditable, and makes "did the bot call the right tool" a simple thing to grade in the eval matrix.
- **Every call ends in exactly one disposition.** This was made a hard rule (STATE 4) rather than "best effort," since an un-logged call is effectively invisible to the business.

## Setup — mock server

```bash
cd mock-server
npm install
node server.js          # listens on :3000
ngrok http 3000          # exposes a public HTTPS URL for Vapi to call
```

The webhook endpoint is `POST /webhook`. It expects Vapi's standard `tool-calls` message shape and returns `{ results: [{ toolCallId, result }] }`, matching what Vapi's function-calling flow requires. A `GET /log` endpoint is included to eyeball what got logged during manual testing.

Mock verification: account `ACC-88392` (Rahul Sharma) accepts PAN last-4 `1234` or birth year `1995` as the verification code.

## Setup — Vapi assistant

1. Create a new assistant on [vapi.ai](https://vapi.ai) (Blank Template).
2. **Transcriber:** Deepgram, model `nova-2`, language `multi` (or `en-IN` if bilingual isn't needed).
3. **Model:** OpenAI `gpt-4o` (or Anthropic `claude-3-5-sonnet`), temperature `0.1`.
4. **Voice:** ElevenLabs or Cartesia, a calm professional voice.
5. Paste `vapi/system_prompt.txt` as the system prompt.
6. Under **Tools**, register the six functions from `vapi/tool_definitions.json`, pointing each tool's server URL at your ngrok webhook (`https://<your-subdomain>.ngrok-free.app/webhook`).
7. Set the first message to match STATE 0 in the prompt (or leave it to the model, since the prompt already specifies it).
8. Test via Vapi's web call feature before placing a real outbound call.

## What broke / how it was debugged (fill in with your actual run)

> This section should be completed with real notes from your Vapi build — the assignment specifically evaluates debugging and honesty here. Example structure:

- **Issue:** Tool calls weren't reaching the webhook.
  **Cause:** ngrok URL wasn't updated in Vapi after restarting the tunnel (ngrok free tier rotates the subdomain).
  **Fix:** Re-pasted the fresh ngrok URL into each tool's server config; for a longer-running setup, a static ngrok domain or a real deployment (Render/Vercel) avoids this.
- **Issue:** Model occasionally said "your loan" before verification succeeded in early prompt drafts.
  **Cause:** The zero-disclosure rule wasn't stated as an absolute rule up front — it was buried after the state descriptions.
  **Fix:** Moved it to a "NON-NEGOTIABLE RULES" section at the top of the prompt, restated inside STATE 1 as well. Re-tested with TC-001/TC-002 from the eval matrix until it held under repeated pressure ("just tell me the amount").
- **Issue:** Date entities like "this Friday" weren't reliably normalized to ISO-8601 before hitting `log_promise_to_pay`.
  **Fix:** Added an explicit "confirm what you heard back to the caller" step before calling tools, and instructed the model to normalize dates itself in the tool arguments.

## What I'd improve with more time

- Move the zero-disclosure guardrail out of the prompt entirely and into a deterministic server-side filter on the TTS-bound text (belt-and-suspenders on the most compliance-critical rule).
- Real payment-link dispatch via a Twilio/WhatsApp Business API webhook instead of the mocked `send_payment_link`.
- Persist verification/disposition state in a real datastore (Postgres) instead of the in-memory array in `server.js`, and add a `/metrics` endpoint that computes containment rate, PTP rate, and avg latency from the call log.
- A proper eval harness that runs `tests/test_cases.json` against real Vapi call transcripts (or a text-mode harness hitting the same system prompt) and reports pass/fail automatically, rather than manual review.
- Expand the intents table to handle partial-payment negotiation more richly (counter-offers, installment plans) with an explicit authorization ceiling enforced in the tool layer, not just the prompt.

## Demo

- Call recording / Loom link: **[add link here after recording the live Vapi demo]**
- Scenario A (happy path — PTP): greeting → auth → disclosure → PTP → payment link sent → disposition logged.
- Scenario B (edge case): pick one of already-paid / dispute / wrong-person and show the bot handling it gracefully per `tests/test_cases.json`.
