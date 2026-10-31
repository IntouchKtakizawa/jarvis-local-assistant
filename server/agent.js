import { authorizeTool } from "./permissions.js";
import {
  routeRequest,
  retrieveMemory,
  selectProjects,
  budgetHistory,
  serializeToolResult,
} from "./context.js";
import { RunJournal, resultOutcome, selectWorkingState } from "./runs.js";
import { safeError, redactSensitive } from "./privacy.js";
import { buildInstructions } from "./prompt.js";
import { validateUISpec } from "../public/ui-spec.js";
import { toolDefinitions, validateArgs } from "./tools.js";
export { toolDefinitions } from "./tools.js";
import { calculate } from "./calculator.js";
import { publicFetch } from "./web.js";
import { informationMessages, parseInformation } from "./information.js";
export async function runAgent(options) {
  const { workspace, account, conversationId, model, emit, signal } = options;
  const previousRuns = (await workspace.getRuns(account)).runs;
  const journal = new RunJournal(workspace, account, conversationId, model),
    started = Date.now();
  let done;
  await journal.start();
  const record = async (patch) => {
    try {
      await journal.update(patch);
    } catch {
      emit({
        type: "warning",
        text: "Activity could not be saved. Tool outcomes in this reply remain valid; keep this tab open.",
      });
    }
  };
  try {
    emit({ type: "run", id: journal.run.id });
    await executeAgent({
      ...options,
      previousRuns,
      onMetrics: (metrics) => Object.assign(journal.run.metrics, metrics),
      onSelection: (selection) => {
        journal.run.selection = selection;
      },
      onStep: (step) => record({ step }),
      emit: (event) => {
        if (event.type === "done") done = event;
        else emit(event);
      },
    });
    await record({
      status: "answered",
      metrics: { durationMs: Date.now() - started },
    });
    emit({ ...done, runId: journal.run.id });
  } catch (cause) {
    const error =
      cause instanceof Error ? cause : new Error("The request failed.");
    const status = signal?.aborted
      ? signal.reason?.name === "TimeoutError"
        ? "timed_out"
        : "cancelled"
      : "failed";
    await record({
      status,
      errorCode: error.code || status,
      metrics: { durationMs: Date.now() - started },
    });
    error.runId = journal.run.id;
    error.progress = journal.run.steps;
    throw error;
  } finally {
    journal.release();
  }
}

async function executeAgent({
  provider,
  model,
  messages,
  signal,
  emit,
  workspace,
  account,
  services,
  internet = true,
  timeZone = "Asia/Bangkok",
  defaultCity = "Bangkok",
  liveUI = [],
  conversationId,
  previousRuns = [],
  onMetrics,
  onSelection,
  onStep,
}) {
  let state = await workspace.get(account);
  const route = routeRequest(messages, state.projects);
  const history = budgetHistory(messages);
  const tools = toolDefinitions(state, internet, route);
  let calls = 0;
  const trace = [],
    context = [];
  let now;
  try {
    now = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      dateStyle: "full",
      timeStyle: "short",
    }).format(new Date());
  } catch {
    timeZone = "Asia/Bangkok";
    now = new Date().toISOString();
  }
  const memory =
      state.enabled.memory !== false ? retrieveMemory(state.memory, route) : [],
    projects =
      state.enabled.projects !== false
        ? selectProjects(state.projects || [], route)
        : [];
  const instructions = buildInstructions({
    now,
    timeZone,
    defaultCity,
    state,
    route,
    memory,
    projects,
    history,
    liveUI,
    workingState: selectWorkingState(previousRuns, conversationId, route),
  });
  const metrics = {
    selectedTools: tools.length,
    memoryCount: memory.length,
    projectCount: projects.length,
    omittedMessages: history.omitted,
    promptChars: instructions.length,
    historyChars: JSON.stringify(history.messages).length,
    toolDefinitionChars: JSON.stringify(tools).length,
    modelCalls: 0,
    toolResultChars: 0,
  };
  onMetrics(metrics);
  const input = history.messages;
  let toolChars = 0;
  const panels = new Map(
    liveUI.filter((p) => p && typeof p.id === "string").map((p) => [p.id, p]),
  );
  onSelection({
    mode: route.simple ? "selected" : "fallback",
    groups: [...route.addons],
    tools: tools.map((t) => t.name),
    projects: route.projectNames.map(redactSensitive),
  });
  for (let round = 0; round < 7; round++) {
    signal?.throwIfAborted();
    emit({
      type: "activity",
      text: round ? "Considering the results…" : "Deciding how to help…",
    });
    metrics.modelCalls++;
    metrics.peakInputChars = Math.max(
      metrics.peakInputChars || 0,
      JSON.stringify(input).length,
    );
    onMetrics(metrics);
    const turn = await provider.agentTurn(
      input,
      model,
      tools,
      signal,
      instructions,
    );
    if (
      !turn ||
      !Array.isArray(turn.calls) ||
      !Array.isArray(turn.output) ||
      typeof turn.text !== "string"
    )
      throw new Error(
        "The model returned an invalid tool response. Retry or choose another available model.",
      );
    if (!turn.calls.length) {
      if (!turn.text.trim())
        throw new Error("The AI returned no answer. Please retry.");
      emit({ type: "token", content: turn.text });
      emit({
        type: "done",
        trace,
        context: context.join(" | ").slice(0, 12000),
      });
      return;
    }
    input.push(...turn.output);
    for (const call of turn.calls) {
      signal?.throwIfAborted();
      if (++calls > 12)
        throw new Error(
          "This request reached the 12-tool limit. Ask a smaller follow-up to continue.",
        );
      const name =
        typeof call.name === "string" ? call.name.replace(/^jarvis\./, "") : "";
      let result;
      const started = Date.now();
      try {
        const def = tools.find((t) => t.name === name);
        if (!def) throw new Error("That add-on is disabled or unavailable.");
        const args =
          typeof call.arguments === "string"
            ? JSON.parse(call.arguments)
            : call.arguments;
        validateArgs(def, args);
        authorizeTool(name, route.request);
        // Recheck the current enabled setting, even if it changed during this turn.
        const current = await workspace.get(account),
          currentDefs = toolDefinitions(current, internet);
        if (!currentDefs.some((t) => t.name === name))
          throw new Error("This add-on has been switched off.");
        if (
          name.startsWith("addon_") &&
          JSON.stringify(state.custom.find((a) => "addon_" + a.id === name)) !==
            JSON.stringify(current.custom.find((a) => "addon_" + a.id === name))
        )
          throw new Error(
            "This add-on changed during the reply. Retry with its current configuration.",
          );
        emit({ type: "tool", name, status: "running", arguments: args });
        result = await execute(name, args);
        if (result?.error || result?.ok === false)
          throw new Error(result.error || "The tool did not confirm success.");
        const outcome = resultOutcome(result);
        context.push(
          name +
            ": " +
            outcome +
            (name === "calculate" ? "; value=" + result.value : ""),
        );
        trace.push({ name, ok: true, outcome, ms: Date.now() - started });
        emit({ type: "tool", name, status: "complete", outcome });
      } catch (e) {
        const error = safeError(e);
        result = { error };
        trace.push({ name, ok: false, error, ms: Date.now() - started });
        emit({ type: "tool", name, status: "failed", error });
      }
      await onStep(trace.at(-1));
      signal?.throwIfAborted();
      const limit = Math.min(16000, 64000 - toolChars - (12 - calls) * 128),
        output = serializeToolResult(result, limit);
      toolChars += output.length;
      metrics.toolResultChars = toolChars;
      onMetrics(metrics);
      input.push({
        type: "function_call_output",
        call_id: call.call_id,
        output,
      });
    }
  }
  throw new Error(
    "The AI reached its step limit. Your completed panels are still available.",
  );
  async function execute(name, args) {
    const { images, web, weather, maps } = services;
    if (name === "show_ui") {
      const spec = validateUISpec(args.spec),
        issuedAt = Date.now();
      panels.set(spec.id, spec);
      emit({ type: "ui", spec, issuedAt });
      return {
        requested: true,
        panel_id: spec.id,
        title: spec.title,
        components: spec.components.map((c) => ({ id: c.id, type: c.type })),
        note: "The browser opens this interactive panel. Buttons and inputs operate locally. Do not claim external side effects.",
      };
    }
    if (name === "control_ui") {
      if (
        !/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(args.panel_id) ||
        (args.component_id &&
          !/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(args.component_id))
      )
        throw Error("Use panel and component ids from the live UI context.");
      const panel = panels.get(args.panel_id);
      if (!panel)
        throw new Error(
          "That panel is not present in this browser context. Ask to open it first.",
        );
      if (
        !["close", "minimize", "restore"].includes(args.operation) &&
        !panel.components?.some((c) => c.id === args.component_id)
      )
        throw new Error("That component is not present in the panel.");
      if (args.operation === "close") panels.delete(args.panel_id);
      emit({ type: "ui_control", ...args });
      return {
        requested: true,
        ...args,
        note: "Operation sent to the current browser panel. The browser reports if the panel is unavailable.",
      };
    }
    if (name === "pop_out_panel") {
      emit({ type: "ui_popout", panel: args.panel });
      return { requested: true, panel: args.panel };
    }
    if (name === "show_images") {
      if (args.query.length > 160)
        throw new Error("Use a shorter image topic.");
      const r = await images.images(args.query, signal);
      emit({ type: "images", ...r });
      return {
        requested: true,
        found: r.images.length > 0,
        panel: "image_gallery",
        count: r.images.length,
        query: r.query,
        note: "Gallery data sent to the browser; image rendering is not acknowledged.",
      };
    }
    if (name === "show_map") {
      const map = await maps.lookup(args.place.slice(0, 160), signal);
      emit({ type: "map", map });
      return {
        requested: true,
        dataFetched: true,
        place: map.title,
        description: map.description,
      };
    }
    if (name === "show_weather") {
      const forecast = await weather.lookup(
        {
          city: args.city.slice(0, 100),
          day: args.day,
          fahrenheit: args.unit === "fahrenheit",
        },
        signal,
      );
      emit({ type: "weather", forecast });
      return {
        requested: true,
        dataFetched: true,
        location: forecast.location,
        current: forecast.current,
        unit: forecast.unit,
        daily: forecast.daily,
        selectedDay: args.day,
      };
    }
    if (name === "show_planner") {
      let startDate = args.start_date;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
        const p = Object.fromEntries(
          new Intl.DateTimeFormat("en", {
            timeZone,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
          })
            .formatToParts(new Date())
            .map((x) => [x.type, x.value]),
        );
        startDate = `${p.year}-${p.month}-${p.day}`;
      }
      const planner = {
        startDate,
        today: new Intl.DateTimeFormat("sv-SE", { timeZone }).format(
          new Date(),
        ),
        timeZone,
        days: 7,
        mode: "local",
        synced: false,
      };
      emit({ type: "planner", planner });
      return {
        requested: true,
        synced: false,
        note: "Editable local planner opened. No Google Calendar data was accessed.",
      };
    }
    if (name === "search_web" || name === "read_page") {
      const r = await web.lookup(
        name === "read_page"
          ? { url: args.url }
          : { query: args.query.slice(0, 300) },
        signal,
      );
      emit({ type: "references", ...r });
      return r;
    }
    if (name === "show_information") {
      const query = args.query.slice(0, 300),
        r = await web.lookup({ query }, signal);
      emit({ type: "references", ...r });
      const imagePromise =
        (await workspace.get(account)).enabled.images !== false
          ? images.lookup(query.slice(0, 160), signal).catch(() => null)
          : Promise.resolve(null);
      let output = "",
        done = false;
      metrics.modelCalls++;
      onMetrics(metrics);
      for await (const item of provider.chat(
        informationMessages([{ role: "user", content: query }]),
        model,
        signal,
        r.references,
      )) {
        if (item.type === "token") output += item.content;
        if (item.type === "done") done = true;
      }
      if (!done) throw new Error("The visual overview was interrupted.");
      const info = parseInformation(output, r.references.length);
      if (!info)
        throw new Error(
          "Could not format a visual overview. Try a narrower topic.",
        );
      info.image =
        (await imagePromise)?.references?.find((r) => r.image)?.image || null;
      emit({ type: "information", info });
      return {
        requested: true,
        dataFetched: true,
        panel: "information_card",
        imageCount: info.image ? 1 : 0,
        notAnImageGallery: true,
        ...info,
      };
    }
    if (name === "calculate") {
      const value = calculate(args.expression);
      emit({
        type: "result",
        kind: "calculation",
        title: "Calculation",
        data: value,
      });
      return value;
    }
    if (name === "list_project_contexts") {
      const projects = (await workspace.get(account)).projects || [];
      return {
        projects: args.query
          ? projects.filter((p) =>
              p.name.toLowerCase().includes(args.query.toLowerCase()),
            )
          : projects.map(({ name, updatedAt }) => ({ name, updatedAt })),
      };
    }
    if (name === "save_project_context") {
      const project = await workspace.action(account, {
        action: "saveProject",
        ...args,
      });
      emit({ type: "workspace_changed" });
      return { saved: true, project };
    }
    if (name === "save_note") {
      const note = await workspace.action(account, {
        action: "saveNote",
        ...args,
      });
      emit({ type: "result", kind: "note", title: note.title, data: note });
      emit({ type: "workspace_changed" });
      return { saved: true, ...note };
    }
    if (name === "find_notes") {
      const notes = (await workspace.get(account)).notes
        .filter((n) =>
          (n.title + " " + n.content)
            .toLowerCase()
            .includes(args.query.toLowerCase()),
        )
        .slice(0, 10);
      emit({ type: "result", kind: "notes", title: "Your notes", data: notes });
      return { notes };
    }
    if (name === "remember_fact") {
      const memory = await workspace.action(account, {
        action: "remember",
        text: args.text,
      });
      emit({
        type: "result",
        kind: "memory",
        title: "Saved to memory",
        data: memory,
      });
      emit({ type: "workspace_changed" });
      return { saved: true, ...memory };
    }
    if (name === "list_memories") {
      const memory = (await workspace.get(account)).memory;
      emit({
        type: "result",
        kind: "memories",
        title: "Personal memory",
        data: memory,
      });
      return { memory };
    }
    const addon = state.custom.find((a) => "addon_" + a.id === name);
    if (!addon) throw new Error("Unknown tool.");
    const url = new URL(addon.endpoint);
    for (const [key, value] of Object.entries(args))
      url.searchParams.set(key, value);
    const response = await publicFetch(url.href, signal, 0, true);
    let value;
    try {
      value = JSON.parse(response.html);
    } catch {
      throw new Error("This add-on did not return valid JSON.");
    }
    emit({
      type: "result",
      kind: "addon",
      title: addon.name,
      data: value,
      source: response.url,
    });
    return { data: value, source: response.url, untrusted: true };
  }
}
