import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Workspace } from "../server/workspace.js";
import { runAgent, toolDefinitions } from "../server/agent.js";
import { RunJournal, selectWorkingState } from "../server/runs.js";
import {
  routeRequest,
  retrieveMemory,
  serializeToolResult,
} from "../server/context.js";
import { authorizeTool } from "../server/permissions.js";
import { redactSensitive } from "../server/privacy.js";
const user = (content) => ({ role: "user", content });
async function temporary(fn) {
  const dir = await mkdtemp(join(tmpdir(), "jarvis-v2-"));
  try {
    await fn(new Workspace(dir), dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
const answer = { calls: [], output: [], text: "Ready." };
const call = (name, args, id = "call") => ({
  name,
  arguments: JSON.stringify(args),
  call_id: id,
});
const turn = (tool) => ({
  text: "",
  calls: [tool],
  output: [{ type: "function_call", ...tool }],
});

test("public GitHub research and mixed public/private requests keep web tools", () => {
  const state = { enabled: {}, custom: [] };
  for (const text of [
    "Read https://github.com/example/public/blob/main/README.md",
    "Research the latest GitHub release",
    "Check my emails and research public theatre news",
  ]) {
    assert.ok(
      toolDefinitions(state, true, routeRequest([user(text)])).some(
        (t) => t.name === "search_web",
      ),
      text,
    );
  }
  assert.ok(
    !toolDefinitions(
      state,
      true,
      routeRequest([user("Check my latest emails")]),
    ).some((t) => t.name === "search_web"),
  );
  assert.ok(
    !toolDefinitions(
      state,
      false,
      routeRequest([user("Research GitHub")]),
    ).some((t) => t.name === "search_web"),
  );
});
test("custom projects and aliases receive the same memory isolation as built-ins", () => {
  const projects = [
    { name: "C++ Studio", aliases: ["Nova"], context: "New project" },
  ];
  const memories = [
    { text: "Nova: I prefer concise code reviews." },
    { text: "I prefer concise answers." },
  ];
  assert.equal(
    retrieveMemory(memories, routeRequest([user("Hello")], projects)).length,
    1,
  );
  assert.equal(
    retrieveMemory(memories, routeRequest([user("Continue Nova")], projects))
      .length,
    2,
  );
  assert.deepEqual(
    routeRequest([user("Continue C++ Studio")], projects).projectNames,
    ["C++ Studio"],
  );
});
test("terse follow-ups retain the latest project without pulling in older topics", () => {
  const history = [
    user("Research current news"),
    user("Continue StageWrite"),
    user("Fix that bug"),
    user("Yes"),
  ];
  const route = routeRequest(history);
  assert.deepEqual(route.projectNames, ["StageWrite Studio"]);
  assert.ok(!route.addons.has("web"));
  const memory = routeRequest([
    ...history,
    user("Remember that I prefer concise answers"),
  ]);
  assert.deepEqual(memory.projectNames, []);
  const pause = routeRequest([
    user("Start a timer for 25 minutes"),
    user("Pause"),
  ]);
  assert.ok(pause.addons.has("live_ui"));
});
test("quoted commands and discussion cannot authorize persistence", () => {
  for (const request of [
    'Explain "save a note about this"',
    "Translate `remember this`",
    "Explain how to write a note",
    "Do not ever save a note",
    "Don’t remember this",
    "Remember how we solved this?",
    "> Remember this\nExplain the quote.",
  ]) {
    for (const name of ["remember_fact", "save_note", "save_project_context"])
      assert.throws(() => authorizeTool(name, request), request + " / " + name);
  }
  authorizeTool("remember_fact", 'Please remember "I prefer concise answers"');
  authorizeTool("save_note", "Could you save this as a note?");
  authorizeTool(
    "save_project_context",
    "Update the StageWrite project context.",
  );
});
test("escaped tool results respect the exact character budget and remain valid JSON", () => {
  const value = { payload: '\\\n"'.repeat(20000) };
  for (const limit of [128, 1000, 16000]) {
    const result = serializeToolResult(value, limit);
    assert.ok(result.length <= limit);
    assert.equal(JSON.parse(result).truncated, true);
  }
  assert.deepEqual(JSON.parse(serializeToolResult({ value: 42 })), {
    value: 42,
  });
});
test("operational redaction removes credentials without exposing their values", () => {
  const token = "sk-" + "x".repeat(30),
    jwt = ["eyJhbGciOiJ0ZXN0In0", "payload", "signature"].join(".");
  const text = redactSensitive(
    `Failure: Bearer abcdef; api_key=${token} password=testsecret token=${jwt}`,
  );
  assert.ok(!text.includes(token));
  assert.ok(!text.includes(jwt));
  assert.ok(!text.includes("testsecret"));
  assert.ok(!text.includes("abcdef"));
});
test("run records are private, bounded and separate from large workspace transcripts", () =>
  temporary(async (w, dir) => {
    const events = [];
    await runAgent({
      workspace: w,
      account: "alice",
      conversationId: "chat",
      provider: { agentTurn: async () => answer },
      model: "test",
      messages: [user("Hello private prompt marker")],
      services: {},
      emit: (e) => events.push(e),
    });
    const record = (await w.getRuns("alice")).runs[0];
    assert.equal(record.status, "answered");
    assert.equal(record.metrics.modelCalls, 1);
    assert.ok(record.metrics.promptChars > 0);
    assert.equal((await w.getRuns("bob")).runs.length, 0);
    assert.ok(!JSON.stringify(record).includes("private prompt marker"));
    assert.ok(
      !Object.hasOwn(
        JSON.parse(await readFile(w.path("alice"), "utf8").catch(() => "{}")),
        "runs",
      ),
    );
    assert.equal(events.at(-1).runId, record.id);
    for (let i = 0; i < 42; i++) {
      const journal = new RunJournal(w, "alice", "other", "test");
      await journal.start();
      await journal.update({ status: "answered" });
      journal.release();
    }
    assert.equal((await w.getRuns("alice")).runs.length, 40);
  }));
test("confirmed actions survive provider failure and working state is conversation scoped", () =>
  temporary(async (w) => {
    let rounds = 0;
    const tool = call("remember_fact", { text: "I prefer concise answers." });
    const provider = {
      agentTurn: async () => {
        if (++rounds === 1) return turn(tool);
        throw new Error("Provider disconnected");
      },
    };
    await assert.rejects(
      runAgent({
        workspace: w,
        account: "a",
        conversationId: "work",
        provider,
        model: "test",
        messages: [user("Remember I prefer concise answers.")],
        services: {},
        emit: () => {},
      }),
      /disconnected/,
    );
    const runs = (await w.getRuns("a")).runs;
    assert.equal(runs[0].status, "failed");
    assert.equal(runs[0].steps[0].outcome, "confirmed");
    assert.equal((await w.get("a")).memory.length, 1);
    assert.ok(
      selectWorkingState(runs, "work", routeRequest([user("Continue")])),
    );
    assert.equal(
      selectWorkingState(runs, "another", routeRequest([user("Continue")])),
      null,
    );
    assert.equal(
      selectWorkingState(
        runs,
        "work",
        routeRequest([user("What's 27/30 as a percentage?")]),
      ),
      null,
    );
    assert.equal(
      selectWorkingState(
        runs,
        "work",
        routeRequest([user("Continue OpenBridge")]),
      ),
      null,
    );
    let sawWorkingState = false;
    await runAgent({
      workspace: w,
      account: "a",
      conversationId: "work",
      provider: {
        agentTurn: async (input, model, tools, signal, prompt) => {
          sawWorkingState =
            prompt.includes("Previous execution state") &&
            prompt.includes("remember_fact");
          return answer;
        },
      },
      model: "test",
      messages: [user("Continue")],
      services: {},
      emit: () => {},
    });
    assert.equal(sawWorkingState, true);
  }));
test("cancellation after a confirmed write preserves it and stops later calls", () =>
  temporary(async (w) => {
    const controller = new AbortController();
    let rounds = 0;
    const provider = {
      agentTurn: async () =>
        ++rounds === 1
          ? turn(call("remember_fact", { text: "I prefer short answers." }))
          : answer,
    };
    await assert.rejects(
      runAgent({
        workspace: w,
        account: "a",
        conversationId: "cancel",
        provider,
        model: "test",
        messages: [user("Remember I prefer short answers")],
        signal: controller.signal,
        services: {},
        emit: (e) => {
          if (e.type === "tool" && e.status === "complete") controller.abort();
        },
      }),
    );
    const record = (await w.getRuns("a")).runs[0];
    assert.equal(record.status, "cancelled");
    assert.equal(record.steps[0].outcome, "confirmed");
    assert.equal((await w.get("a")).memory.length, 1);
    assert.equal(rounds, 1);
  }));
test("simultaneous requests cannot run twice in the same conversation", () =>
  temporary(async (w) => {
    const journal = new RunJournal(w, "a", "chat", "test");
    await journal.start();
    try {
      const other = new RunJournal(w, "a", "chat", "test");
      await assert.rejects(other.start(), { code: "conversation_busy" });
      assert.equal((await w.getRuns("a")).runs.length, 1);
    } finally {
      journal.release();
    }
  }));
test("abandoned running records become interrupted after restart", () =>
  temporary(async (w, dir) => {
    const journal = new RunJournal(w, "a", "chat", "test");
    await journal.start();
    assert.equal((await w.getRuns("a")).runs[0].status, "running");
    assert.equal(
      (await new Workspace(dir).getRuns("a")).runs[0].status,
      "interrupted",
    );
    journal.release();
  }));
test("browser dispatch is not reported as confirmed rendering and missing panels fail", () =>
  temporary(async (w) => {
    const events = [];
    let rounds = 0;
    const tool = call("show_ui", {
      spec: JSON.stringify({
        id: "focus",
        title: "Focus",
        components: [
          { id: "clock", type: "timer", duration_seconds: 60, autostart: true },
        ],
      }),
    });
    await runAgent({
      workspace: w,
      account: "a",
      provider: {
        agentTurn: async () => (++rounds === 1 ? turn(tool) : answer),
      },
      model: "test",
      messages: [user("Start a one minute timer")],
      services: {},
      emit: (e) => events.push(e),
    });
    assert.equal(
      events.find((e) => e.type === "tool" && e.status === "complete").outcome,
      "dispatched",
    );
    assert.equal((await w.getRuns("a")).runs[0].steps[0].outcome, "dispatched");
    rounds = 0;
    const missing = call("control_ui", {
      panel_id: "missing",
      component_id: "clock",
      operation: "pause",
      value: "",
    });
    await runAgent({
      workspace: w,
      account: "a",
      provider: {
        agentTurn: async () => (++rounds === 1 ? turn(missing) : answer),
      },
      model: "test",
      messages: [user("Pause the timer")],
      services: {},
      emit: (e) => events.push(e),
    });
    assert.ok(!events.some((e) => e.type === "ui_control"));
    assert.equal((await w.getRuns("a")).runs[0].steps[0].status, "failed");
  }));

test("memory budgets include JSON escaping and facts retain their update dates", () => {
  const memories = Array.from({ length: 10 }, (_, i) => ({
    text: "I prefer concise answers " + String(i) + "\\".repeat(900),
    createdAt: new Date(1700000000000 + i * 1000).toISOString(),
  }));
  const selected = retrieveMemory(
    memories,
    routeRequest([user("Hello")]),
    3000,
  );
  assert.ok(JSON.stringify(selected).length <= 3000);
  assert.equal(selected[0].updatedAt, memories.at(-1).createdAt);
});

test("a newly dispatched panel can be controlled in the same turn without a false confirmation", () =>
  temporary(async (w) => {
    const spec = {
      id: "focus",
      title: "Focus",
      components: [
        { id: "clock", type: "timer", duration_seconds: 60, autostart: true },
      ],
    };
    const calls = [
      call("show_ui", { spec: JSON.stringify(spec) }, "create"),
      call(
        "control_ui",
        {
          panel_id: "focus",
          component_id: "clock",
          operation: "pause",
          value: "",
        },
        "pause",
      ),
    ];
    let rounds = 0;
    const events = [];
    await runAgent({
      workspace: w,
      account: "a",
      model: "test",
      messages: [user("Create a timer panel and pause it")],
      services: {},
      provider: {
        agentTurn: async () =>
          ++rounds === 1
            ? {
                text: "",
                calls,
                output: calls.map((c) => ({ type: "function_call", ...c })),
              }
            : answer,
      },
      emit: (e) => events.push(e),
    });
    assert.ok(events.some((e) => e.type === "ui_control"));
    assert.deepEqual(
      events.at(-1).trace.map((t) => t.outcome),
      ["dispatched", "dispatched"],
    );
  }));
