# JARVIS · ChatGPT subscription edition

**Each person runs their own copy and signs into their own ChatGPT account. No developer account or credentials are included.**

A personal, locally hosted sci-fi assistant with an animated orb/HUD, streamed chat, microphone transcription, and an original British-style synthetic assistant voice.

**Default AI authentication: OpenAI’s official Sign in with ChatGPT and ChatGPT plan usage flow. No API key, client secret, or paid API billing configuration is required.** This uses the documented local-app OAuth flow directly; it does not read Codex’s credential files, reuse a first-party client ID, or call private ChatGPT endpoints.

Chat prompts and the current conversation history are sent to OpenAI. Your account/workspace must be eligible and authorise ChatGPT plan usage; plan/app limits and any credits choices you authorise in ChatGPT apply. Local hosting does not make cloud inference offline or unlimited. Speech-to-text and text-to-speech remain local.

## Run and sign in

Requires Node.js 22.9+ (Node 24+ recommended).

```sh
npm ci
npm start
```

Open **http://127.0.0.1:3210**. `localhost` redirects to the canonical `127.0.0.1` origin so browser binding and the OAuth callback stay consistent.

1. Click **Continue with ChatGPT**. An OpenAI sign-in window opens; if the browser blocks it, use the **Open ChatGPT sign-in** link.
2. Sign in with **your own account** on OpenAI’s website and authorise JARVIS to use your ChatGPT plan. New registrations can ask you to name the app and choose a workspace/usage allowance.
3. The callback returns to JARVIS. The original tab checks for completion automatically. A one-time welcome explains plan usage.
4. Select an account-available model, type a prompt, and press Enter. Shift+Enter adds a line. Responses stream into the conversation.

**You must complete the OpenAI sign-in yourself.** The app never asks for your password or asks you to paste tokens. Successful sign-in is not proof of access to every model; a completed inference request verifies access for that request. OpenAI can reject plan access, policy/region eligibility, or usage independently.

Use **Manage usage** near the model/composer to review the app’s access and usage in [ChatGPT Settings](https://chatgpt.com/settings/usage). Usage-limit and entitlement errors stop the request. The app never silently switches to API-key billing or another account/provider.

The account selector keeps registrations separate, including registrations sharing the same email. Choose **Add another ChatGPT account**, then Continue with ChatGPT. Select a saved registration to switch; the conversation clears to avoid sending an old account’s history through a new account. Sign out removes local tokens and attempts remote session revocation. Stop a current response before switching or signing out. If revocation cannot be confirmed, the app says so and points you to ChatGPT Settings.

Run a single JARVIS server per project copy. A runtime lock prevents concurrent processes from racing refresh-token rotation. Stop with Ctrl+C. If a process crashed, its stale PID lock is recovered at next startup; do not delete a live process’s lock.

## Local voice

Ollama is no longer required for the default mode. For microphone transcription, start Whisper in another terminal:

```sh
whisper-server --host 127.0.0.1 --port 8080 \
  -m models/ggml-base.en.bin --public public
```

Install whisper.cpp and download its model separately. On macOS with Homebrew:

```sh
brew install whisper-cpp
mkdir -p models
curl -L --fail -o models/ggml-base.en.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin
```

Click Refresh connections after starting Whisper. Click the microphone, grant browser microphone permission, speak, then click again to finish. Maximum recording length is 45 seconds. The transcript appears in the composer for review before Send. No wake word, automatic submission, or browser cloud SpeechRecognition service is used. The browser converts PCM capture into a 16 kHz mono WAV; ffmpeg is unnecessary.

Click **Listen to your assistant** for a sample, enable **Speak replies**, or use **Listen** beneath a reply. Speech uses this Mac’s installed **Daniel** British English system voice, at a measured pace. This is an available synthetic voice with an original assistant personality; no actor cloning or impersonation. Voice quality depends on the installed voice. Click **Stop voice** or press Escape to stop playback; Escape also cancels a response or transcription. Read-aloud truncates at 5,000 characters. Audio autoplay may require a click. Physical microphone use needs browser permission; use Safari or Chrome if the in-app browser cannot grant it.

Other operating systems can use the implemented optional [Piper](https://github.com/OHF-Voice/piper1-gpl) adapter. Install a compatible Piper executable and a licensed UK English ONNX voice, with its matching `.onnx.json` file alongside it. Set TTS_PROVIDER, PIPER_BIN and PIPER_MODEL. Piper was not exercised on this Mac.

## Configuration

Defaults work without `.env`. For optional local overrides:

```sh
cp .env.example .env
```

Restart the server after editing.

| Setting | Default | Purpose |
| --- | --- | --- |
| PORT | 3210 | Web app and loopback OAuth callback port |
| AI_PROVIDER | chatgpt | `chatgpt` subscription auth or explicit `ollama` fallback |
| WHISPER_URL | http://127.0.0.1:8080 | Local whisper.cpp server |
| TTS_PROVIDER | macos on Mac; none elsewhere | `macos` or `piper` |
| MACOS_VOICE | Daniel | Installed macOS voice; list with `say -v '?'` |
| PIPER_BIN | piper | Optional Piper executable |
| PIPER_MODEL | unset | Optional absolute ONNX voice path |
| OLLAMA_URL | http://127.0.0.1:11434 | Only used with `AI_PROVIDER=ollama` |
| OLLAMA_MODEL | qwen2.5:3b | Ollama-only default model |

The ChatGPT model selector loads the signed-in account’s visible models from the official model catalog rather than hard-coding a model or assuming subscription entitlement.

To explicitly return to fully local AI, set `AI_PROVIDER=ollama`, start `ollama serve`, download a model with `ollama pull qwen2.5:3b`, and restart JARVIS. ChatGPT remains the default; there is no automatic fallback.

## Authentication and credential security

Implementation follows [OpenAI’s registration and sign-in guide](https://developers.openai.com/siwc/token-sharing-open-source/sign-in):

- First registration uses `dynamic_agent_client`, app name `JARVIS`, and a persistent opaque host ID. It exchanges the callback’s issued client ID, then reuses that registration for future sign-ins.
- Each attempt generates state, nonce and an S256 PKCE challenge. A short-lived HttpOnly, SameSite cookie binds the callback to the initiating browser. The callback validates state and binding before exchanging the code; duplicate/expired callbacks are rejected.
- `jose` verifies ID-token signatures using OpenAI JWKS, issuer, issued-client audience, expiry, subject and nonce. Returning sign-ins must match the saved identity. Identity sign-in without `chatgpt.tokens.use.direct` never enables inference.
- Tokens are kept only in **`.local/auth/accounts.json`** under the app folder, as an owner-only file (`0600`) inside an owner-only directory (`0700`). Writes are queued and atomic. This is protected plaintext local storage, not a keychain or encryption at rest.
- `.local/`, `.env`, models, dependencies and logs are ignored by source control. The source ZIP uses an explicit file allowlist and excludes runtime credentials. **Do not share a raw copy of a signed-in project folder, its `.local` directory, or sign-in URLs containing identity hints.**
- Tokens never enter browser storage, chat context, application logs, or the status endpoint. Retained ID-token hints are sent only to OpenAI’s authorisation endpoint. The app does not read or modify your existing Codex/ChatGPT login.
- Refreshes are single-flight within the sole owning process; rotated access/refresh tokens are saved together. Terminal refresh failures require sign-in again. Logout revokes the renewable session where possible, then clears local tokens while retaining the registration/host mapping.
- The app binds only to loopback, validates Host and Origin, and requires a custom header on mutation endpoints to block cross-site form requests. Static routes are allowlisted; auth storage cannot be served as a file. Keep this personal app off public networks.

The public OAuth flow is intended for local/open-source apps. Hosting or commercial distribution requires reviewing OpenAI’s current integration requirements. It is not a general-purpose proxy for sharing one subscription among users.

## Architecture

```text
public/             responsive HUD, chat, account controls, voice capture/playback
server/index.js     loopback HTTP routes and mutation protection
server/auth.js      official OAuth, identity validation, accounts, refresh, revocation
server/chatgpt.js   OAuth-backed public Responses API + SSE adapter
server/ollama.js    optional explicit local-model adapter
server/voice.js     Whisper HTTP and macOS/Piper adapters
server/runtime-lock.js  exclusive owner for rotating credentials
test/              auth/security and provider stream tests
.local/            ignored runtime credentials and host identity
models/            ignored Whisper model binaries
```

```text
Continue with ChatGPT → auth.openai.com → /auth/callback
                     → validate state + browser binding + signed ID token
                     → protected local account record
Chat → /api/chat → public api.openai.com/v1/responses with OAuth Bearer token
                → store:false, stream:true → streamed text → HUD
Microphone → local PCM/WAV → local whisper.cpp → editable transcript
Reply → local macOS say / Piper → temporary WAV → browser playback
```

`GET /api/status` returns safe account summaries, model choices and service status; no tokens. The browser’s `/api/auth/*` routes start/cancel sign-in, select accounts, acknowledge the welcome, and sign out. Authenticated requests go only to public OpenAI endpoints. No private backend-api endpoints, imported Codex tokens, or API keys are used.

Both model adapters yield `{type:"token",content}` and `{type:"done",tokens}`. ChatGPT success requires `response.completed`; failed/incomplete/interrupted streams are not reported as complete. Voice files are temporary and removed after synthesis. No app actions, arbitrary command execution, internet search, or persistent chat memory are enabled.

## Tests and verification

```sh
npm test
curl http://127.0.0.1:3210/api/status
```

17 tests cover the initial Ollama adapter plus OAuth/PKCE wiring, browser/state/replay rejection, real RSA-signed ID-token validation, audience/issuer/expiry/nonce failures, missing plan permission, registration substitution, refresh rotation, protected file permissions, logout/revocation failure, account-specific model filtering, split UTF-8 SSE frames, late usage failures, cancellation, and bounded 401 retry.

Authentication and Responses tests use synthetic credentials and mocked OpenAI endpoints. Live OpenAI subscription inference requires the user to finish sign-in; no existing Codex credential was copied to bypass that step. The initial local edition was smoke-tested with a real Ollama reply, a generated Daniel WAV and a Whisper synthetic-speech transcription. Physical microphone capture and Piper still need testing with the target devices/runtime.

Troubleshooting:

- **Sign-in window blocked:** use Open ChatGPT sign-in, or open JARVIS in a regular browser.
- **Sign-in verification failed:** start a fresh attempt from the same browser, then finish within 10 minutes. Keep the app server running.
- **Plan permission missing:** select the saved account and Continue with ChatGPT to authorise plan usage. A valid identity login alone does not grant inference.
- **No models / policy denial / region restriction:** the app shows the upstream error; verify account/workspace eligibility. It does not change billing routes.
- **Usage limit reached:** open Manage usage. An app-specific limit can apply even when other ChatGPT usage is available.
- **Revocation not confirmed:** tokens are cleared locally; disconnect the JARVIS registration in ChatGPT Settings.
- **Voice unavailable:** start Whisper, refresh connections, and check installed macOS voices or Piper configuration.

Official references: [Sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in), [sessions and credentials](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions), [models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference), [preview requirements](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations), [UI and plan usage](https://developers.openai.com/siwc/ui-ux-guidelines).
