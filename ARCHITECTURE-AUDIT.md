# JARVIS architecture audit and refactor — 2026-10-31

## Architecture found

The actual project is an ES-module JavaScript Node.js server and browser interface,
not Electron or TypeScript. `server/index.js` validates requests and streams agent
events. `server/agent.js` owns a native function-calling loop. ChatGPT authentication
is handled by `server/auth.js`, and inference by `server/chatgpt.js`, without an API
key requirement. An optional, pre-existing Ollama adapter remains opt-in.

`server/workspace.js` stores account-separated conversations, explicit memories,
notes and add-on preferences using atomic JSON writes in protected `.local/`
directories. The browser retains planner and live-panel state. Public-data add-ons
are read-only, explicitly enabled HTTPS manifests. No Composio integration or
working email/GitHub/private-file integration exists. `server/calendar.js` is an
unwired Google Calendar implementation; the running agent has only a local planner.

## Problems and implementation plan

Before editing, source inspection identified these changes to make in order:

1. Extract the oversized agent prompt and replace the conflicting legacy provider
   prompt, which incorrectly denied durable memory and conversation restoration.
2. Select relevant memory and project context locally before inference, preserving
   the existing storage, authentication and model loop.
3. Narrow tool definitions for clear requests while retaining an enabled-catalog
   fallback for ambiguous natural-language requests.
4. Bound recent history, retrieve relevant older exchanges and bound tool outputs.
5. Enforce explicit-request persistence in the executor, then verify regressions,
   source safety, startup and the project editor before committing.

Previously every turn included all saved facts, the whole active transcript, all
enabled tool descriptions, and panel state whether relevant or not. Persistence
authorization was expressed only in tool/prompt prose. Project records had no
separate home. The legacy provider prompt duplicated and contradicted the agent.

## Implemented flow and important files

Request → local routing → ranked memory and project selection → budgeted recent
history and older excerpts → selected enabled tools → existing provider loop →
validated, permission-checked execution → actual result/error → answer.

- `server/context.js`: transparent rules, categories, project names/aliases,
  ranked lexical retrieval, project selection and history budgeting.
- `server/prompt.js`: shared compact core, IGCSE defaults, development workflow,
  context assembly, unavailable-integration and untrusted-data boundaries.
- `server/agent.js`: integrates selection, keeps disabled-tool rechecks, returns
  failures to the model, and bounds tool results without losing call/output pairing.
- `server/permissions.js`: explicit-request checks for memory, note and project
  writes, including rejection of requests not to persist.
- `server/workspace.js`: backward-compatible account-separated project records,
  validation and an independent Project context add-on toggle.
- `public/workspace-ui.js`, `public/app.js`, `public/futuristic.css`: project
  creation/editing, project deep links and workspace presentation.
- `server/ollama.js`: reuses the core prompt; removes obsolete duplicated prose.
- `test/context.test.js`: nine new tests including the six requested scenarios,
  privacy toggles, failures, retrieval, permissions and durable project records.
- `README.md`: documents actual behavior and limits.

Budgets use characters, not model-specific token estimates: 48,000 for recent
history, 6,000 for matching older excerpts, 12 facts / 6,000 for memories, and
12,000 for project records. The latest user request is always preserved; older
transcripts are not overwritten. Tool results are bounded to 16,000 characters
each and approximately 64,000 cumulatively, retaining small error/output envelopes
after the budget is exhausted. Truncated results are explicitly labelled.

Measured tool-definition sizes after the change: 396 characters for the percentage
example, 2 (`[]`) for a greeting, and 907 for StageWrite work, versus 9,308 for the
full enabled catalog including the new project tools. The shared core is 1,289
characters. These measurements demonstrate reduced request overhead, not a live
model latency benchmark.

## Preservation and cleanup decisions

Authentication, billing route, provider selection, voice, UI rendering, public-page
protections, existing add-ons, saved conversations and their storage remain in
place. No new dependencies, key requirement, local-model requirement, vector
database or framework was added. All four dependencies have working consumers.
The unwired calendar module and older intent helpers were retained: they are
existing integration work or test-backed utilities, and deleting them was not
necessary for this refactor. No user credentials were rotated or deleted.

## Credential review

Reviewed authentication/storage paths, git exclusions, source and deployment
boundaries. Credential stores remain under ignored `.local/`; OAuth directories
use mode 0700 and token records use mode 0600. Source searches for private-key,
OpenAI-key, GitHub-token, AWS-key and JWT-like literals found no credential-like
values in server, public, test or scripts sources. No runtime secret values were
printed or copied into Git. This targeted review is not a full penetration test
or a guarantee about historical Git objects or every secret format.

## Verification

- `npm test`: **65 passed, 0 failed**, including existing authentication, renewal,
  streaming, add-on restrictions, browser pairing, UI, provider and new context
  regression tests. The first restricted run could not bind the existing mock
  provider's loopback server; rerunning with loopback permission passed.
- `npm run build:pages`: passed.
- JavaScript syntax checks: passed for source, public, scripts and test modules.
- Isolated startup: passed on loopback with temporary empty credential/workspace
  storage, leaving the user's signed-in runtime untouched.
- Browser verification: Projects tab opened; creating, reloading and editing a
  project record succeeded. The deep link also reopened the Projects tab.
- No TypeScript, lint or Electron build configuration exists; these checks are
  not applicable to this repository. No new live OAuth login or cloud inference
  was performed; authentication/provider behavior is covered by regression tests.

## Remaining limits and next steps

Populate project records with verified technical facts; none were invented from
project names. Retrieval is lexical and routing is heuristic: ambiguous tasks
retain broader enabled tools, and unfamiliar synonyms can require clearer wording.
Persisting important decisions is explicit rather than automatic. Saved archived
chats are not searched globally; older exchanges in the active submitted history
are selected by relevance. The browser still stores at most 39 exchanges per chat.

JARVIS cannot inspect or modify project source, send email, use Composio, or read
Google Calendar without actual integrations. This refactor does not fabricate
these capabilities. Future external write tools must implement server-validated
confirmations before exposure; the present catalog contains no consequential
external writes or destructive file/repository operations. Browser panel dispatch
still has no server-side rendering acknowledgment, so the prompt distinguishes
requested actions from confirmed outcomes.
