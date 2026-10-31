import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  routeRequest,
  retrieveMemory,
  selectProjects,
  budgetHistory,
} from "../server/context.js";
import { authorizeTool } from "../server/permissions.js";
import { Workspace } from "../server/workspace.js";
import { runAgent, toolDefinitions } from "../server/agent.js";
const route = (text) => routeRequest([{ role: "user", content: text }]);
const projects = [
  {
    name: "StageWrite Studio",
    context: "Electron theatre editor",
    aliases: ["SW Studio"],
  },
  { name: "OpenBridge", context: "Bridge project" },
];
test("six requested routing cases select only relevant capabilities and context", () => {
  const cases = [
    ["What's 27/30 as a percentage?", ["calculator"], []],
    ["When is my next psychology test?", ["planner", "notes"], []],
    ["Continue working on StageWrite.", ["projects"], ["StageWrite Studio"]],
    ["Check my latest emails.", [], []],
    ["Fix this bug in StageWrite.", ["projects"], ["StageWrite Studio"]],
    ["Hello!", [], []],
  ];
  const state = { enabled: {}, custom: [] };
  for (const [text, addons, names] of cases) {
    const r = route(text);
    assert.deepEqual([...r.addons], addons, text);
    assert.deepEqual(r.projectNames, names, text);
    assert.deepEqual(
      selectProjects(projects, r).map((p) => p.name),
      names,
    );
    assert.ok(
      !toolDefinitions(state, true, r).some((t) => t.name === "show_weather"),
      text,
    );
  }
  assert.equal(route("Check my latest emails.").privateService, true);
  assert.deepEqual(route("How are you?").addons, new Set());
  assert.equal(toolDefinitions(state, true, route("How are you?")).length, 0);
});
test("retrieval excludes unrelated projects and selects school facts and preferences", () => {
  const memory = [
    { text: "StageWrite uses an editor." },
    { text: "OpenBridge uses a bridge." },
    { text: "Psychology test is on Monday." },
    { text: "I prefer concise answers." },
    { text: "I prefer piano music." },
  ];
  assert.deepEqual(
    retrieveMemory(memory, route("What's 27/30 as a percentage?")).map(
      (m) => m.text,
    ),
    ["I prefer concise answers."],
  );
  assert.ok(
    retrieveMemory(memory, route("When is my next psychology test?")).some(
      (m) => m.text.includes("Monday"),
    ),
  );
  assert.ok(
    !retrieveMemory(memory, route("Continue StageWrite")).some((m) =>
      m.text.includes("OpenBridge"),
    ),
  );
  assert.equal(
    selectProjects(
      projects,
      routeRequest([{ role: "user", content: "Continue SW Studio" }], projects),
    )[0].name,
    "StageWrite Studio",
  );
});
test("follow-ups resolve an antecedent without leaking a project into new tasks", () => {
  const previous = { role: "user", content: "Continue StageWrite" };
  assert.deepEqual(
    routeRequest([previous, { role: "user", content: "Fix that bug" }])
      .projectNames,
    ["StageWrite Studio"],
  );
  assert.deepEqual(
    routeRequest([
      previous,
      { role: "user", content: "What's 27/30 as a percentage?" },
    ]).projectNames,
    [],
  );
});
test("history budget preserves complete recent exchanges and retrieves relevant older context", () => {
  const messages = [
    { role: "user", content: "StageWrite design " + "x".repeat(1000) },
    { role: "assistant", content: "Decision: preserve architecture." },
    ...Array.from({ length: 12 }, (_, i) => [
      { role: "user", content: "Question " + i + "y".repeat(600) },
      { role: "assistant", content: "Answer " + i + "z".repeat(600) },
    ]).flat(),
    { role: "user", content: "Continue StageWrite design" },
  ];
  const h = budgetHistory(messages, 4000);
  assert.ok(h.omitted > 0);
  assert.equal(h.messages[0].role, "user");
  assert.equal(h.messages.at(-1).content, "Continue StageWrite design");
  assert.ok(h.messages.reduce((n, m) => n + m.content.length, 0) <= 4000);
  assert.ok(h.older.some((t) => t.includes("StageWrite")));
});
test("persistence rejects unsolicited model writes and allows explicit requests", () => {
  for (const name of ["remember_fact", "save_note", "save_project_context"])
    assert.throws(() => authorizeTool(name, "Explain psychology"));
  assert.throws(() => authorizeTool("remember_fact", "Don't remember this"));
  authorizeTool("remember_fact", "Remember I like concise replies");
  authorizeTool("save_note", "Save a note about psychology");
  authorizeTool(
    "save_project_context",
    "Update the StageWrite project context",
  );
});
test("project records survive reload and remain account isolated", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jarvis-project-test-"));
  try {
    const w = new Workspace(dir);
    await w.action("a", {
      action: "saveProject",
      name: "StageWrite Studio",
      context: "Keep the existing architecture",
    });
    await w.action("a", {
      action: "saveProject",
      name: "stagewrite studio",
      context: "Decision verified",
    });
    assert.equal((await new Workspace(dir).get("a")).projects.length, 1);
    assert.equal((await w.get("b")).projects.length, 0);
    await assert.rejects(
      w.action("a", {
        action: "saveProject",
        name: "Bad",
        context: "x".repeat(10001),
      }),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("agent supplies selected memory and refuses model-initiated unsolicited persistence", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jarvis-context-test-"));
  try {
    const w = new Workspace(dir);
    await w.action("a", {
      action: "remember",
      text: "StageWrite uses TypeScript.",
    });
    await w.action("a", {
      action: "remember",
      text: "I prefer concise replies.",
    });
    let count = 0;
    const events = [];
    const provider = {
      agentTurn: async (input, model, tools, signal, instructions) => {
        assert.ok(!instructions.includes("StageWrite uses TypeScript"));
        assert.ok(instructions.includes("concise replies"));
        if (++count === 1)
          return {
            text: "",
            output: [
              {
                type: "function_call",
                name: "save_note",
                call_id: "bad",
                arguments: '{"title":"Unwanted","content":"No"}',
              },
            ],
            calls: [
              {
                name: "save_note",
                call_id: "bad",
                arguments: '{"title":"Unwanted","content":"No"}',
              },
            ],
          };
        assert.match(input.at(-1).output, /error/);
        return { text: "Hello.", calls: [], output: [] };
      },
    };
    await runAgent({
      provider,
      model: "test",
      workspace: w,
      account: "a",
      messages: [{ role: "user", content: "Hello!" }],
      services: {},
      emit: (e) => events.push(e),
    });
    assert.equal((await w.get("a")).notes.length, 0);
    assert.ok(events.some((e) => e.status === "failed"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("disabled memory and projects never enter model context", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jarvis-disabled-context-"));
  try {
    const w = new Workspace(dir);
    await w.action("a", {
      action: "remember",
      text: "StageWrite private memory marker",
    });
    await w.action("a", {
      action: "saveProject",
      name: "StageWrite Studio",
      context: "Private architecture marker",
    });
    await w.action("a", {
      action: "settings",
      enabled: { projects: false, memory: false },
    });
    const provider = {
      agentTurn: async (input, model, tools, signal, instructions) => {
        assert.ok(!instructions.includes("Private architecture marker"));
        assert.ok(!instructions.includes("private memory marker"));
        assert.ok(!tools.some((t) => t.name === "save_project_context"));
        return { text: "Ready.", calls: [], output: [] };
      },
    };
    await runAgent({
      provider,
      model: "test",
      workspace: w,
      account: "a",
      messages: [{ role: "user", content: "Continue StageWrite" }],
      services: {},
      emit: () => {},
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("tool failures reach the model and never create a successful trace", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jarvis-failure-test-"));
  try {
    const w = new Workspace(dir),
      events = [];
    let count = 0;
    const call = {
      name: "search_web",
      call_id: "lookup",
      arguments: '{"query":"latest news"}',
    };
    const provider = {
      agentTurn: async (input) => {
        if (++count === 1)
          return {
            text: "",
            calls: [call],
            output: [{ type: "function_call", ...call }],
          };
        assert.match(input.at(-1).output, /Integration unavailable/);
        return { text: "The lookup failed.", calls: [], output: [] };
      },
    };
    await runAgent({
      provider,
      model: "test",
      workspace: w,
      account: "a",
      messages: [{ role: "user", content: "Search the latest news" }],
      services: {
        web: {
          lookup: async () => {
            throw new Error("Integration unavailable");
          },
        },
      },
      emit: (e) => events.push(e),
    });
    assert.equal(events.at(-1).trace[0].ok, false);
    assert.ok(
      !events.some((e) => e.type === "tool" && e.status === "complete"),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
