# Kenta’s JARVIS

A personal assistant with a futuristic Doge interface, native AI tool calling, visual answers, local voice, saved conversations, notes, personal memory and configurable add-ons.

## GitHub website

The interface is deployed with GitHub Pages at https://intouchktakizawa.github.io/jarvis-local-assistant/. The AI backend runs on your Mac; keep Jarvis running there while using the website. This setup works in a browser on that Mac, not on another device.

Open the local app at http://127.0.0.1:3210/, click **⌁**, and generate a pairing code. Enter that code in **Connect to Mac** on the GitHub website. If your browser asks for local network access, allow the connection to your own Mac. Sign in to ChatGPT in the local app. Paired browsers expire after 90 days and can be revoked from the local app.

GitHub contains source and static assets only. Tokens, notes, memory and saved chats remain in the ignored `.local/` directory on the Mac.

## Start

Double-click **Start-JARVIS.command**, or run `npm install` followed by `npm start`. Open **http://127.0.0.1:3210/**. The launcher starts the installed local Whisper recognizer when available. Node.js 22.9 or newer is required.

The default model is **GPT-6-Luna** through the existing official ChatGPT sign-in. Use Settings to sign in or choose another available model. No API key is required for this configured route. Your selected account’s ChatGPT usage limits apply; requests never silently switch to paid API-key billing or another provider. Access can still be refused by OpenAI based on account, region, policy or usage.

## What changed

Typed chat requests now all go to the model with an enabled-tool catalog. The model chooses native function calls, Jarvis executes validated tools locally, displays their real results, and sends those results back to the model. Tool status appears in the conversation. An image request is no longer routed by a list of particular phrases.

The tool loop supports multiple calls and follow-ups, with a limit of 12 tool executions across seven model turns for one request. Tool errors are returned to the AI as errors, and unavailable/disabled tools cannot execute. The direct Find images button remains an explicit manual feature.

The ChatGPT connection uses namespaced function tools, `store:false`, `stream:true`, explicit conversation context, and `function_call_output` messages. Completed SSE output items are retained even when the final response’s output array is empty. See the official [preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations) and [function-calling guide](https://developers.openai.com/api/docs/guides/function-calling).

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

- One conversation retains up to 39 complete user/assistant exchanges in model context.
- Up to 30 saved conversations are retained. Other archived chats are not automatically all included in prompts.
- Up to 100 explicit personal-memory facts, at most 1,000 characters each, can be saved.
- Up to 100 notes, at most 20,000 characters each, can be saved.
- New chat clears the active context while leaving saved conversations and personal memory available.
- Reload restores the active saved conversation. Export/backup the protected workspace folder yourself if you need an independent backup.

Storage is local, but model inference is cloud-based by default. The active chat context and enabled personal-memory facts are sent to the connected model. Tool results used for a reply are also sent. Do not save secrets as personal memory.

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

Run `npm test`. Tests cover authentication, streaming, tool-loop execution, disabled add-ons, safe arithmetic, account-separated durable storage, manifest validation, public-page protections and existing visual data services. Browser checks exercise natural requests, real photos/maps/weather, conversation restoration, memory across new chats, notes, add-on installation and mobile layouts.
