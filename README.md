# Kenta’s JARVIS

IMPORTANT : THIS AI IS MADE FOR ME PERSONALLY WHICH MEANS YOU NEED TO FINE TUNE IT TO YOUR LIKING


A personal assistant with a futuristic Doge interface, native AI tool calling, visual answers, local voice, saved conversations, notes, personal memory and configurable add-ons.

## GitHub website

The interface is deployed with GitHub Pages at https://intouchktakizawa.github.io/jarvis-local-assistant/. The AI backend runs on your Mac; keep Jarvis running there while using the website. This setup works in a browser on that Mac, not on another device.

Open the local app at http://127.0.0.1:3210/, click **⌁**, and generate a pairing code. Enter that code in **Connect to Mac** on the GitHub website. If your browser asks for local network access, allow the connection to your own Mac. Sign in to ChatGPT in the local app. Paired browsers expire after 90 days and can be revoked from the local app.

GitHub contains source and static assets only. Tokens, notes, memory and saved chats remain in the ignored `.local/` directory on the Mac.

## Start

Double-click **Start-JARVIS.command**, or run `npm install` followed by `npm start`. Open **http://127.0.0.1:3210/**. The launcher starts the installed local Whisper recognizer when available. Node.js 22.9 or newer is required.

The default model is **GPT-6-Luna** through the existing official ChatGPT sign-in. Use Settings to sign in or choose another available model. No API key is required for this configured route. Your selected account’s ChatGPT usage limits apply; requests never silently switch to paid API-key billing or another provider. Access can still be refused by OpenAI based on account, region, policy or usage.

## What changed

Typed chat requests go to the model with a task-selected tool catalog. The model chooses native function calls, Jarvis executes validated tools locally, displays their real results, and sends those results back to the model. Tool status appears in the conversation. An image request is no longer routed by a list of particular phrases.

The tool loop supports multiple calls and follow-ups, with a limit of 12 tool executions across seven model turns for one request. Tool errors are returned to the AI as errors, and unavailable/disabled tools cannot execute. The direct Find images button remains an explicit manual feature.

The ChatGPT connection uses namespaced function tools, `store:false`, `stream:true`, explicit conversation context, and `function_call_output` messages. Completed SSE output items are retained even when the final response’s output array is empty. See the official [preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations) and [function-calling guide](https://developers.openai.com/api/docs/guides/function-calling).

## Live interactive panels

Ask naturally for an interface: “Start a timer for 25 minutes,” “Build a trip budget with editable costs and a running total,” “Make a packing checklist,” or “Give me a counter and a progress tracker.” The AI calls `show_ui` with a declarative component specification; the browser renders real controls. There is no phrase-based timer routing and no generated JavaScript execution.

Panels support countdowns, stopwatches, editable checklists, text/number/date/time fields, sliders, selects, calculated metrics, progress bars, charts, tables, and buttons with local actions. Formulas can reference inputs, such as `{price}*{quantity}`. Chat follow-ups can pause a timer or change a panel value using `control_ui`. Panel titles are drag handles; arrow keys also move a focused title bar. Minimize sends a window to the panel dock, and Live panels brings windows back.

Visual answers have **Pop out** controls, and the AI can move weather, maps, image galleries, planners and information cards into floating windows. These visual popouts last for the current page session. Composed live panels and their values persist per account in this browser. Current panel values accompany your chat requests so the AI can refer to and control them. Timers use absolute deadlines, so a reload does not restart them; alerts appear in the page while it remains open. Closed browsers cannot show completion alerts. Opening an old conversation does not restart or reopen its timers automatically.

This is a composable interface system for local browser interactions. Actions that use external accounts, run applications, or change external services still require an actual supported integration. Live panels can be disabled in Add-ons.

## Add-ons and workspace

Click **⊞** in the top-right toolbar to open the workspace:

- **Add-ons:** enable/disable web research, image galleries, maps, weather, visual answers, the local planner, calculator, notes and personal memory.
- **Conversations:** resume or delete automatically saved chats. Up to 30 are retained on this Mac, including their visual panels.
- **Memory:** view, add or remove facts that carry into new chats. The model saves facts only when you explicitly ask it to remember something. Disable Personal memory to exclude saved facts from model context.
- **Notes:** create, search or delete local notes.

Example requests:

- “I’d love to see what the surface of Mars looks like. Put some photographs here.”
- “Is it likely to rain in Tokyo tomorrow? Show me the temperature curve.”
- “I want to understand where Iceland is geographically. Open an interactive view.”
- “Give me a place to arrange my coming seven days.”
- “What is 18 percent of 245?”
- “Remember that I prefer concise answers.”
- “Save a note titled Trip ideas with these three places…”

## Custom public-data add-ons

Expand **Install a public-data add-on** in the Add-ons tab. Paste a manifest or choose the exchange-rate example. Imported add-ons start **disabled** so you can inspect them before enabling. The working example is also in `public/addons/exchange-rates.json`.

A manifest contains `id`, `name`, `description`, a public HTTPS JSON `endpoint`, and a `parameters` object mapping simple query-parameter names to descriptions. The AI receives a function definition; argument values become URL query parameters in a read-only GET request. A structured result card displays the returned JSON data.

Custom add-ons cannot run arbitrary code, access local networks, inject browser HTML, make write requests, or reuse this chat’s connected app credentials. Authenticated services and Google Calendar sync need separate integration work. A public endpoint can still rate-limit or fail.

## Saved conversations and memory

Conversations, notes, preferences and custom manifests are kept in protected, account-separated JSON files under `.local/workspace/`. Chat credentials remain in `.local/auth/`; neither directory belongs in source control or source packages.

- One conversation stores up to 39 complete user/assistant exchanges. Model context uses a 48,000-character recent-history budget, preserving complete exchanges and the latest request; matching older exchanges are included as bounded, labelled excerpts.
- Up to 30 saved conversations are retained. Other archived chats are not automatically all included in prompts.
- Up to 100 explicit personal-memory facts, at most 1,000 characters each, can be saved.
- Up to 100 notes, at most 20,000 characters each, can be saved.
- New chat clears the active context while leaving saved conversations and personal memory available.
- Reload restores the active saved conversation. Export/backup the protected workspace folder yourself if you need an independent backup.

Storage is local, but model inference is cloud-based by default. The active chat context and relevant personal-memory facts and selected project records are sent to the connected model. Tool results used for a reply are also sent. Do not save secrets as personal memory.

## Selective context and project records

JARVIS classifies the current request using a small local ruleset before calling the model. Clear requests receive relevant tool groups only; ambiguous requests retain the enabled catalog as a compatibility fallback. Disabled add-ons and Internet restrictions still apply at execution. Email/GitHub requests never substitute public web search for absent private integrations. A percentage calculation uses only the local calculator; greetings use no tools.

Memory retrieval ranks lexical matches, task categories and communication preferences, capped at 12 facts / 6,000 characters. Memory remains local and account-separated. It is not a semantic search engine; use clear names and keywords for reliable retrieval.

Open **Workspace → Projects** to add or edit purpose, architecture, stack, decisions, current progress, bugs, repository and deployment information. Add future projects by name without changing code. Records are stored per account alongside notes, independently of the core prompt. StageWrite Studio, OpenBridge, KineticForm and Town Simulation names are recognized, but no technical facts are invented or preloaded. Chat can retrieve records and save them when explicitly requested. Disabling Project context excludes records and their tools.

The core prompt is shared by both existing provider adapters. Relevant records have a 12,000-character budget; relevant older conversation excerpts have a 6,000-character budget. Tool outputs are limited to 16,000 serialized characters each and 64,000 cumulatively, with explicit truncation notices; model tool-call records remain paired with outputs. Saved transcripts are preserved. These are character budgets, not model-specific token guarantees.

The tool runner enforces explicit-request checks for model-originated memory, note and project writes. Existing tools cannot send email, publish, modify repositories, or delete files. Future consequential integrations need a real confirmation flow. UI results describe browser operations as requested where no rendering acknowledgment exists.

## V2 request progress and diagnostics

Open **Workspace → Activity** for the last 40 requests. It shows which tools were offered and used, confirmed results versus browser dispatch, failures, cancellations and interruptions. Request details show model-call counts, selected memory/project counts, omitted messages, context character counts and duration. These are operational measurements, not billing/token estimates or a guarantee that the overall task succeeded.

Activity is stored in small account-separated files under `.local/workspace/activity/`, independently of saved transcripts. It contains no raw prompts, replies, tool arguments, tool results or credentials. A server restart marks unfinished records interrupted; it never automatically retries an action. Follow-ups can receive relevant prior execution status from the same conversation.

Failed and cancelled replies now save the user request, the failure and completed tool outcomes. Reloading or continuing a chat preserves partial progress, including a note or memory saved before a provider failure. This does not guarantee exactly-once execution across a crash between a write and its activity update; check saved data before repeating an uncertain action.

V2 also handles public GitHub research without pretending to have private GitHub access, scopes memories to custom project names/aliases, rejects quoted persistence commands, redacts credential-like operational errors, and uses exact serialized tool-output budgets. The existing stack, sign-in and enabled integrations remain in place. See `V2-AUDIT.md` for the implementation audit and verification limits.

## Local voice

Whisper recognizes speech on this Mac. The default macOS `Daniel` voice reads replies locally. Live voice is turn-based: speak, pause, hear a response, then listening resumes. End live voice or Escape stops it. It is not OpenAI’s Realtime Voice service and cannot be interrupted by speaking over the assistant.

For manual speech-recognition startup:

```sh
whisper-server --host 127.0.0.1 --port 8080 -m models/ggml-base.en.bin -l en
```

On a fresh Mac, install whisper.cpp and download a compatible English model first. On this Mac the runtime and model are already installed. Browser microphone permission is needed for actual recording.

## Entirely local model option

Set `AI_PROVIDER=ollama`, `OLLAMA_URL=http://127.0.0.1:11434`, and `OLLAMA_MODEL` in `.env`, then restart. Choose an Ollama model that supports tool calling. This adapter supports native tool calls, but the live end-to-end tests for this release use the connected GPT-6-Luna model. Internet add-ons still contact external services; disabling Internet removes network tools from the model’s catalog.

## Visuals and limitations

Weather comes from Open-Meteo, with current values, a 24-hour graph and seven-day forecasts. Bangkok is the default city unless another city is known; set `WEATHER_CITY` to change that default. Forecast results are cached for five minutes.

Maps use Leaflet, Nominatim geocoding and OpenStreetMap tiles with attribution. Geocoding requests are cached and serialized at no more than one per second. Photos use credited Wikimedia images. Public page reading validates and pins public DNS addresses, checks redirects, rejects private-network targets, and bounds response size/time.

The calendar is an editable **local planner**, not connected Google Calendar data. Plans persist separately in browser storage, scoped to the selected Jarvis account. No email sending, computer control, private-file search, authenticated third-party services or background reminders are available in this build.

Remote content is untrusted data. It cannot replace assistant instructions. Markdown is sanitized, raw model HTML is disabled, and direct image embeds are restricted to Wikimedia. The model can still make mistakes; visible tool results and source links show what was actually fetched or executed.

## Checks

Run `npm test`. V2 adds interruption recovery, task-state isolation, permission and routing edge cases, privacy redaction and exact serialization-budget checks. Tests also cover authentication, streaming, tool-loop execution, disabled add-ons, safe arithmetic, account-separated durable storage, manifest validation, public-page protections and existing visual data services. Browser checks exercise natural requests, real photos/maps/weather, conversation restoration, memory across new chats, notes, add-on installation and mobile layouts.
