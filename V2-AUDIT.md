# JARVIS V2 audit and implementation plan

## Source-backed inventory before editing

The shipped application is a Node.js ES-module JavaScript backend and a vanilla
browser frontend. There is no Electron or TypeScript configuration. The existing
ChatGPT OAuth/PKCE registration, JWT verification, rotating refresh and subscription
inference route remain the supported default; no API key is required. An older
optional Ollama adapter already exists and will not be introduced or expanded.

`server/index.js` validates local HTTP requests and streams events to
`public/app.js`. The single-user loopback boundary includes Host/Origin checks,
paired static-site clients and account-change guards. Workspace storage uses
account-hashed JSON paths, serialized writes and atomic replacement. The native
tool loop validates arguments and rechecks disabled tools before execution.
The first refactor already provides a compact shared prompt, selective context,
project records and character budgets; these are the starting point for V2.

No Composio, Gmail, GitHub, arbitrary filesystem or shell tool is wired into the
agent. The Google Calendar module is unwired; the actual calendar is a browser
planner. Voice uses fixed executable argument lists, not model-generated shell
commands. Dependencies are limited to `jose`, `marked`, `dompurify` and `leaflet`,
all with consumers. Tests use Node's test runner; Pages uses a source-only static
build and GitHub Actions. Runtime credentials and private data are gitignored.

## Findings to address

- Routing treats all GitHub/repository mentions as private, suppressing even
  explicit public-page reading. Some multi-intent and short follow-up requests
  lose tools when keywords are insufficient.
- Memory project scoping recognizes only four fixed names; custom projects and
  aliases do not receive the same isolation.
- Tool output and saved completed-tool text duplicate evidence in conversation
  context. Cumulative output limits are approximate and JSON truncation can grow
  when escaped. Browser dispatch is sometimes labelled `displayed:true` without
  an acknowledgment.
- Failed/cancelled turns remove the user message from active history despite
  already-executed tools, and do not save that partial progress.
- There is no durable per-request state, interruption record, or bounded local
  diagnostic view. Debugging cannot distinguish routing, provider, execution and
  browser-dispatch outcomes after reload.
- Persistence checks count quoted verbs and can mistake a request to discuss
  saving for authorization to save. Runtime errors can echo sensitive values.
- Provider prompts are indirectly coupled through the optional adapter, and
  static revision hashing omits some imported frontend modules.

## Targeted implementation order

1. Fix routing and dynamic project isolation with regression tests.
2. Harden explicit-request authorization and redact credentials from errors and
   diagnostics, without changing OAuth or installing integrations.
3. Add bounded account-separated run records, confirmed/dispatched outcomes,
   useful metrics, and same-conversation working-state retrieval. Do not create
   an autonomous task framework or automatically rerun interrupted actions.
4. Preserve partial progress in the browser and expose recent activity using the
   existing workspace. Keep diagnostics free of raw prompts, arguments, replies
   and token values.
5. Tighten context budgets and source hashing; verify tests, build, startup,
   browser behavior and publication against the existing repository.

This plan covers the supplied V2 requirements; the submitted specification ends
partway through section 4. No missing sections are assumed to have been supplied.

## Implemented results

The existing shared prompt is now **814 characters**, with detailed coding
workflow instructions loaded only for development work. It retains the IGCSE
schoolwork default and action-evidence, credential and untrusted-data boundaries.
The tools registry and argument validation now live in `server/tools.js`;
`server/agent.js` keeps its existing public exports for compatibility.

Routing preserves explicit public research even for GitHub and mixed requests,
handles terse follow-ups through a bounded antecedent window, and stops at the
latest named project. Custom project names, punctuation and aliases now receive
memory isolation. Dates accompany retrieved memories so newer explicit facts can
be distinguished from older conflicting ones. Neither correction guessing nor
automatic deletion of old memories was introduced.

Persistence checks strip quoted/code examples and reject discussion or negative
requests as authorization. Operational errors are credential-redacted. The model
loop rechecks cancellation before each execution, validates provider responses,
rejects add-on configuration changes mid-request, and validates browser panel
references against the supplied context or a panel issued in the same run.
A browser dispatch is recorded as dispatched, never as verified rendering.

`server/runs.js` keeps the last 40 request records per account under
`.local/workspace/activity/`. The existing atomic storage writer is reused with
an independent small journal and queue, rather than rewriting large transcripts
on every tool step. Records contain request IDs, conversation association, model,
routing metadata, counts, timings and tool outcomes. They contain no raw prompts,
replies, arguments, tool results, credentials or model reasoning.

Run statuses distinguish running, answered, failed, cancelled, timed out and
interrupted. Answered means a reply was generated, not that the overall goal was
achieved. Active conversations reject concurrent execution; unfinished records
are surfaced as interrupted after restart. Appropriate follow-ups can retrieve
previous action outcomes from the same account and conversation, with project
scope checks. This is execution continuity, not a new autonomous planning system.

The browser now saves interrupted/failed exchanges and completed tool outcomes,
instead of discarding the user request after earlier actions ran. Successful
history carries compact outcome summaries instead of repeated JSON results, and
tool arguments are no longer duplicated into saved tool-status events. The new
Activity workspace tab exposes durable progress and expandable diagnostic counts.

Tool-result envelopes now stay within **16,000 serialized characters per result**
and **64,000 cumulatively**, including JSON escaping and reserved error/output
slots. Retrieved-memory budgets also include serialized overhead; older excerpts
and browser context use valid, explicitly truncated envelopes when needed. Static
asset revisions include all public assets and the dependency lockfile, so editing
an imported UI module cannot leave a stale deployment revision.

No dependencies, services, credentials or provider requirements were added. The
actual Node/browser stack, subscription route, existing optional adapter, voice,
public-data integrations, pairing, saved data and build system remain in place.
Unused/unwired integration work was identified rather than aggressively deleted.

## Verification and scope of evidence

- Full regression suite: **80 passed, 0 failed** (65 existing, 15 added).
- Static Pages build: passed. A regression test changes only an imported UI
  module and verifies the revision changes and private runtime files stay out.
- Syntax checks: all **50 JavaScript modules** passed.
- Existing authentication, refresh rotation, native tool calling, provider errors,
  browser pairing, public-page restrictions and live-panel tests still pass.
- Isolated startup and HTTP checks passed, including invalid conversation IDs
  and expected-account mismatches. No real account files were used.
- In a browser fixture, a real local note save was followed by an intentionally
  simulated provider failure. Continue saw the confirmed action and did not
  repeat it. Reload retained both exchanges. Activity showed failed and answered
  requests separately, and the Notes count stayed at one.
- New tests cover account/conversation isolation, cancellation after persistence,
  concurrent requests, restart interruption, custom project scoping, public/private
  routing, quoted authorization, error redaction, exact JSON budgets and same-turn
  panel control.
- Targeted source scans found **zero credential-like literal matches** in server,
  public, test and script sources; runtime credential values were not printed.
- No TypeScript, Electron or lint configuration exists, so these checks are not
  applicable. Live ChatGPT login/inference, deployment completion and a full
  penetration test were not performed. Provider behavior is covered by regression
  tests and the browser recovery test deliberately uses a fixture provider.

## Important changed files

- `server/agent.js`, `server/tools.js`: model loop, selected tools, execution
  validation, result budgets, lifecycle and compatible exports.
- `server/context.js`, `server/prompt.js`: routing, retrieval, continuity and
  compact context construction.
- `server/runs.js`, `server/workspace.js`: bounded private execution records and
  atomic storage reuse.
- `server/permissions.js`, `server/privacy.js`: explicit persistence authorization
  and operational credential redaction.
- `server/index.js`, `server/chatgpt.js`: conversation/account validation, safe
  errors, request metadata and direct shared-prompt import.
- `public/app.js`, `public/workspace-ui.js`, `public/index.html`: partial progress,
  outcome labels, durable Activity tab and accurate context/privacy explanations.
- `scripts/build-pages.js`, `test/v2.test.js`, `test/build.test.js`, `README.md`:
  deployment revision fix, regression coverage and usage documentation.

## Remaining practical limits

Routing and memory retrieval remain local heuristics, not semantic search.
Ambiguous requests can retain a broader enabled catalog; unfamiliar phrasing can
still need clarification. The authorization grammar is conservative rather than
a natural-language permission proof. Project context is maintained explicitly;
JARVIS still cannot access arbitrary source files, run commands, use Composio,
send Gmail, inspect private GitHub or read Google Calendar without real adapters.

Execution records are not exactly-once transactions with tool writes. A process
crash between a confirmed storage write and its journal update can leave an
uncertain action. Restart never reruns it automatically; inspect saved data before
retrying. Browser operations have no acknowledgment channel. The journal is bounded
and is not a full task planner, event-sourcing system, or backup. Archived chats
remain separate; the existing 39-exchange per-chat storage limit is preserved.

Known-pattern error redaction is defense in depth, not a guarantee against every
possible secret format. Do not store credentials as notes, memories or project
records. No credentials were rotated, deleted or published. Restart the local
backend to load the updated modules; refresh the browser for the new workspace UI.
