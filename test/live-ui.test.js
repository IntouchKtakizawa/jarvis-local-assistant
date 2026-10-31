import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  validateUISpec,
  initialUIState,
  applyUIAction,
  timerRemaining,
  stopwatchElapsed,
  restoreUIState,
} from "../public/ui-spec.js";
import { Workspace } from "../server/workspace.js";
import { runAgent, toolDefinitions } from "../server/agent.js";
const timer = () =>
  validateUISpec({
    id: "focus",
    title: "Focus timer",
    components: [
      { id: "clock", type: "timer", duration_seconds: 1500, autostart: true },
    ],
  });
test("timer uses absolute deadlines, survives serialized reload, pauses and resumes without drift", () => {
  const spec = timer(),
    state = initialUIState(spec, 1000);
  assert.equal(timerRemaining(state.clock, 61000), 1440);
  const restored = JSON.parse(JSON.stringify(state));
  assert.equal(timerRemaining(restored.clock, 121000), 1380);
  applyUIAction(
    spec,
    restored,
    { operation: "pause", target: "clock" },
    121000,
  );
  assert.equal(timerRemaining(restored.clock, 700000), 1380);
  applyUIAction(
    spec,
    restored,
    { operation: "start", target: "clock" },
    700000,
  );
  assert.equal(timerRemaining(restored.clock, 760000), 1320);
  assert.equal(timerRemaining(restored.clock, 3000000), 0);
  applyUIAction(
    spec,
    restored,
    { operation: "reset", target: "clock" },
    3000000,
  );
  assert.equal(restored.clock.running, false);
  assert.equal(restored.clock.remaining, 1500);
});
test("stopwatch remains continuous across reload and repeated start does not reset it", () => {
  const spec = validateUISpec({
      id: "run",
      title: "Run",
      components: [{ id: "clock", type: "stopwatch", autostart: true }],
    }),
    state = initialUIState(spec, 1000);
  applyUIAction(spec, state, { operation: "start", target: "clock" }, 10000);
  assert.equal(stopwatchElapsed(state.clock, 21000), 20);
  applyUIAction(spec, state, { operation: "pause", target: "clock" }, 21000);
  assert.equal(stopwatchElapsed(state.clock, 90000), 20);
  applyUIAction(spec, state, { operation: "start", target: "clock" }, 90000);
  assert.equal(stopwatchElapsed(state.clock, 95000), 25);
});
test("declarative controls bind inputs to actions and retain checklist state", () => {
  const spec = validateUISpec({
      id: "tasks",
      title: "Tasks",
      components: [
        { id: "name", type: "input", value: "Read a chapter" },
        { id: "list", type: "checklist", items: [] },
        {
          id: "add",
          type: "button",
          label: "Add",
          actions: [
            { operation: "append_item", target: "list", value_from: "name" },
          ],
        },
        { id: "count", type: "metric", value: 0 },
      ],
    }),
    state = initialUIState(spec);
  applyUIAction(spec, state, spec.components[2].actions[0], 1000);
  assert.equal(state.list[0].text, "Read a chapter");
  applyUIAction(spec, state, {
    operation: "toggle",
    target: "list",
    value: state.list[0].id,
  });
  assert.equal(state.list[0].done, true);
  applyUIAction(spec, state, {
    operation: "increment",
    target: "count",
    value: "2",
  });
  assert.equal(state.count, 2);
  applyUIAction(spec, state, { operation: "clear_completed", target: "list" });
  assert.equal(state.list.length, 0);
});
test("UI contract rejects executable components, bad bindings, invalid durations, and unbounded content", () => {
  assert.throws(() =>
    validateUISpec({
      id: "bad",
      title: "Bad",
      components: [{ id: "code", type: "script", text: "fetch(secret)" }],
    }),
  );
  assert.throws(() =>
    validateUISpec({
      id: "bad",
      title: "Bad",
      components: [{ id: "clock", type: "timer", duration_seconds: -1 }],
    }),
  );
  assert.throws(() =>
    validateUISpec({
      id: "bad",
      title: "Bad",
      components: [
        {
          id: "button",
          type: "button",
          actions: [{ operation: "fetch", target: "button" }],
        },
      ],
    }),
  );
  assert.throws(() =>
    validateUISpec({
      id: "bad",
      title: "Bad",
      components: [{ id: "metric", type: "metric", formula: "{missing}+1" }],
    }),
  );
  assert.throws(() =>
    validateUISpec({
      id: "bad",
      title: "Bad",
      components: Array.from({ length: 25 }, (_, i) => ({
        id: "item" + i,
        type: "text",
      })),
    }),
  );
  const spec = timer(),
    state = initialUIState(spec);
  assert.throws(() =>
    applyUIAction(spec, state, {
      operation: "set",
      target: "clock",
      value: "NaN",
    }),
  );
  assert.throws(() =>
    applyUIAction(spec, state, {
      operation: "increment",
      target: "clock",
      value: "10",
    }),
  );
});
test("native AI can open a composed UI with internet off; disabled capability cannot execute", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jarvis-ui-agent-"));
  try {
    const workspace = new Workspace(dir);
    let round = 0;
    const events = [];
    const provider = {
      agentTurn: async (input, model, tools) => {
        if (++round === 1) {
          assert.ok(tools.some((t) => t.name === "show_ui"));
          assert.ok(!tools.some((t) => t.name === "show_weather"));
          return {
            calls: [
              {
                name: "show_ui",
                call_id: "ui1",
                arguments: JSON.stringify({ spec: JSON.stringify(timer()) }),
              },
            ],
            output: [],
            text: "",
          };
        }
        assert.equal(JSON.parse(input.at(-1).output).panel_id, "focus");
        return { calls: [], output: [], text: "Your focus timer is ready." };
      },
    };
    await runAgent({
      provider,
      model: "test",
      messages: [
        {
          role: "user",
          content: "Give me a focused half hour minus five minutes",
        },
      ],
      workspace,
      account: "test",
      services: {},
      internet: false,
      emit: (e) => events.push(e),
    });
    assert.equal(
      events.find((e) => e.type === "ui").spec.components[0].duration_seconds,
      1500,
    );
    assert.ok(Number.isFinite(events.find((e) => e.type === "ui").issuedAt));
    await workspace.action("test", {
      action: "settings",
      enabled: { live_ui: false },
    });
    assert.ok(
      !toolDefinitions(await workspace.get("test")).some(
        (t) => t.name === "show_ui",
      ),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("stored UI state ignores malformed timers and recovers valid deadlines", () => {
  const spec = timer();
  const bad = restoreUIState(
    spec,
    { clock: { remaining: "broken", deadline: null, running: true } },
    1000,
  );
  assert.equal(timerRemaining(bad.clock, 1000), 1500);
  assert.equal(bad.clock.running, false);
  const good = restoreUIState(
    spec,
    { clock: { remaining: 1500, deadline: 1501000, running: true } },
    61000,
  );
  assert.equal(timerRemaining(good.clock, 61000), 1440);
});

test("a metric reference expression is normalized into a real calculation", () => {
  const spec = validateUISpec({
    id: "budget",
    title: "Budget",
    components: [
      { id: "cost", type: "input", input_type: "number", value: 120 },
      { id: "total", type: "metric", value: "{cost}*2" },
    ],
  });
  assert.equal(spec.components[1].formula, "{cost}*2");
  assert.throws(() =>
    validateUISpec({
      id: "x",
      title: "X",
      components: [{ id: "total", type: "metric", value: "{unknown}+1" }],
    }),
  );
});
