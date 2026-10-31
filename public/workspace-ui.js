const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};
export function initWorkspace({ api, onResume, onDelete, getAccount }) {
  let state = {
      addons: [],
      memory: [],
      notes: [],
      projects: [],
      chats: [],
      runs: [],
    },
    tab = "addons";
  const dialog = el("dialog", "workbench");
  dialog.id = "workbench";
  dialog.innerHTML =
    '<div class="settings-heading"><div><div class="visual-eyebrow">JARVIS WORKSPACE</div><h2>Your assistant, extended.</h2></div><button class="close-button" aria-label="Close workspace">×</button></div><div class="workbench-tabs"></div><div class="workbench-feedback" role="status"></div><div class="workbench-body"></div>';
  document.body.append(dialog);
  dialog.querySelector(".close-button").onclick = () => dialog.close();
  const tabs = dialog.querySelector(".workbench-tabs"),
    body = dialog.querySelector(".workbench-body"),
    feedback = dialog.querySelector(".workbench-feedback");
  async function action(data) {
    const r = await api("/api/workspace", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...data,
        expectedAccount: getAccount?.() || undefined,
      }),
    });
    const result = await r.json();
    if (!r.ok) throw new Error(result.error);
    return result;
  }
  async function refresh() {
    const r = await api("/api/workspace");
    if (!r.ok) throw new Error("Your workspace could not be loaded.");
    state = await r.json();
    if (dialog.open) draw();
    return state;
  }
  async function run(fn) {
    feedback.textContent = "";
    try {
      await fn();
      await refresh();
    } catch (e) {
      feedback.textContent = e.message;
    }
  }
  function open(next = "addons") {
    tab = next;
    if (!dialog.open) dialog.showModal();
    draw();
    refresh().catch((e) => (feedback.textContent = e.message));
  }
  function draw() {
    tabs.replaceChildren();
    for (const [id, name, count] of [
      ["addons", "Add-ons", state.addons.filter((a) => a.enabled).length],
      ["chats", "Conversations", state.chats.length],
      ["memory", "Memory", state.memory.length],
      ["notes", "Notes", state.notes.length],
      ["projects", "Projects", (state.projects || []).length],
      ["activity", "Activity", (state.runs || []).length],
    ]) {
      const button = el(
        "button",
        id === tab ? "selected" : "",
        `${name} ${count}`,
      );
      button.onclick = () => {
        tab = id;
        feedback.textContent = "";
        draw();
      };
      tabs.append(button);
    }
    body.replaceChildren();
    if (tab === "addons") {
      body.append(
        el(
          "p",
          "workbench-intro",
          "The AI chooses from enabled tools. Switch an add-on off to remove it from the AI’s available actions.",
        ),
      );
      const grid = el("div", "addon-grid");
      for (const a of state.addons) {
        const card = el("article", "addon-card"),
          head = el("div", "addon-heading"),
          icon = el("span", "addon-icon", a.icon || "⊞"),
          label = el("label", "addon-switch"),
          toggle = el("input");
        toggle.type = "checkbox";
        toggle.checked = a.enabled;
        toggle.setAttribute("aria-label", "Enable " + a.name);
        label.append(toggle, el("span", "", a.enabled ? "Enabled" : "Off"));
        head.append(icon, label);
        card.append(
          head,
          el("h3", "", a.name),
          el("p", "", a.description),
          el(
            "small",
            "",
            a.custom
              ? "CUSTOM · READ-ONLY PUBLIC API"
              : a.network
                ? "USES THE INTERNET"
                : "LOCAL DATA / COMPUTE",
          ),
        );
        toggle.onchange = () =>
          run(() =>
            action({ action: "settings", enabled: { [a.id]: toggle.checked } }),
          );
        if (a.custom) {
          const remove = el("button", "text-button", "Remove add-on");
          remove.onclick = () =>
            run(() => action({ action: "uninstall", id: a.id }));
          card.append(remove);
        }
        grid.append(card);
      }
      body.append(grid);
      const install = el("details", "addon-import");
      install.append(el("summary", "", "Install a public-data add-on"));
      const explanation = el(
        "p",
        "",
        "Import JSON for a read-only public HTTPS API. It installs switched off so you can inspect it before enabling. API keys, private networks, arbitrary code and write actions are not supported.",
      );
      const input = el("textarea");
      input.rows = 9;
      input.setAttribute("aria-label", "Add-on JSON");
      input.placeholder = JSON.stringify(
        {
          id: "public_example",
          name: "Public data",
          description: "Describe when the AI should use this API.",
          endpoint: "https://api.example.com/data",
          parameters: { query: "What to look up" },
        },
        null,
        2,
      );
      const button = el("button", "planner-add", "Install add-on");
      button.onclick = () =>
        run(async () => {
          let manifest;
          try {
            manifest = JSON.parse(input.value);
          } catch {
            throw new Error("Paste a valid JSON add-on document.");
          }
          await action({ action: "install", manifest });
        });
      const example = el("button", "text-button", "Use exchange-rate example");
      example.type = "button";
      example.onclick = () => {
        input.value = JSON.stringify(
          {
            id: "exchange_rates",
            name: "Exchange rates",
            description:
              "Get reference currency exchange rates for a base and target currency.",
            endpoint: "https://api.frankfurter.dev/v1/latest",
            parameters: {
              base: "Base ISO currency code, e.g. USD",
              symbols: "Target ISO currency code, e.g. THB",
            },
          },
          null,
          2,
        );
      };
      install.append(explanation, example, input, button);
      body.append(install);
    }
    if (tab === "chats") {
      body.append(
        el(
          "p",
          "workbench-intro",
          "Conversations save on this Mac. Resume one to restore its messages and visual panels. Up to 30 conversations are retained.",
        ),
      );
      if (!state.chats.length)
        body.append(
          el(
            "div",
            "workbench-empty",
            "Your conversations will appear here after the first reply.",
          ),
        );
      for (const c of state.chats) {
        const row = el("article", "workspace-row"),
          copy = el("div");
        copy.append(
          el("strong", "", c.title),
          el("small", "", new Date(c.updatedAt).toLocaleString()),
        );
        const resume = el("button", "planner-add", "Resume"),
          remove = el("button", "text-button", "Delete");
        resume.onclick = () =>
          run(async () => {
            const chat = await action({ action: "getChat", id: c.id });
            if (chat) {
              await onResume(chat);
              dialog.close();
            }
          });
        remove.onclick = () =>
          run(async () => {
            await action({ action: "deleteChat", id: c.id });
            onDelete(c.id);
          });
        row.append(copy, resume, remove);
        body.append(row);
      }
    }
    if (tab === "memory") {
      body.append(
        el(
          "p",
          "workbench-intro",
          "Relevant facts are retrieved for each request when Personal memory is enabled. Jarvis saves a fact only when you ask it to remember one. You can also add or delete facts here.",
        ),
      );
      const form = el("form", "workspace-form"),
        input = el("textarea");
      input.rows = 2;
      input.maxLength = 1000;
      input.placeholder = "A preference or fact you want Jarvis to remember…";
      input.setAttribute("aria-label", "Memory to save");
      const save = el("button", "planner-add", "Remember");
      form.append(input, save);
      form.onsubmit = (e) => {
        e.preventDefault();
        run(() => action({ action: "remember", text: input.value }));
      };
      body.append(form);
      for (const m of state.memory) {
        const row = el("article", "workspace-row");
        row.append(el("p", "", m.text));
        const remove = el("button", "text-button", "Forget");
        remove.onclick = () =>
          run(() => action({ action: "forget", id: m.id }));
        row.append(remove);
        body.append(row);
      }
      if (!state.memory.length)
        body.append(el("div", "workbench-empty", "No saved facts yet."));
    }
    if (tab === "projects") {
      body.append(
        el(
          "p",
          "workbench-intro",
          "Keep project purpose, architecture, stack, decisions, progress, bugs and deployment details here. Only relevant records accompany a request. Never store secrets.",
        ),
      );
      const form = el("form", "workspace-form"),
        name = el("input"),
        context = el("textarea"),
        save = el("button", "planner-add", "Save project");
      name.placeholder = "Project name (for example StageWrite Studio)";
      name.required = true;
      name.maxLength = 100;
      name.setAttribute("aria-label", "Project name");
      context.placeholder =
        "Purpose, architecture, stack, decisions, progress, bugs, repository and deployment…";
      context.rows = 8;
      context.maxLength = 10000;
      context.required = true;
      context.setAttribute("aria-label", "Project context");
      form.append(name, context, save);
      form.onsubmit = (e) => {
        e.preventDefault();
        run(() =>
          action({
            action: "saveProject",
            name: name.value,
            context: context.value,
          }),
        );
      };
      body.append(form);
      for (const p of state.projects || []) {
        const row = el("article", "workspace-note"),
          edit = el("button", "text-button", "Edit"),
          remove = el("button", "text-button", "Delete");
        edit.onclick = () => {
          name.value = p.name;
          context.value = p.context;
          name.focus();
        };
        remove.onclick = () =>
          run(() => action({ action: "deleteProject", id: p.id }));
        const actions = el("div", "project-actions");
        actions.append(edit, remove);
        row.append(el("h3", "", p.name), el("p", "", p.context), actions);
        body.append(row);
      }
    }
    if (tab === "activity") {
      body.append(
        el(
          "p",
          "workbench-intro",
          "Recent request progress is stored on this Mac. Relevant prior outcomes can accompany a follow-up. “Answered” means Jarvis replied, not that every action succeeded. Dispatched actions were sent to the browser; their display is not confirmed. No prompts, replies, tool arguments or credentials are recorded here.",
        ),
      );
      if (!state.runs?.length)
        body.append(
          el(
            "div",
            "workbench-empty",
            "Request progress will appear here after you chat.",
          ),
        );
      for (const run of state.runs || []) {
        const row = el("article", "workspace-note");
        row.append(
          el("h3", "", run.status.replace(/_/g, " ")),
          el(
            "small",
            "",
            new Date(run.startedAt).toLocaleString() + " · " + run.model,
          ),
        );
        for (const step of run.steps)
          row.append(
            el(
              "p",
              "",
              step.name.replace(/_/g, " ") +
                " — " +
                (step.outcome || step.status),
            ),
          );
        const details = el("details"),
          m = run.metrics || {};
        details.append(
          el("summary", "", "Request details"),
          el(
            "p",
            "",
            `Request: ${run.id} · Tools offered: ${m.selectedTools || 0} · Model calls: ${m.modelCalls || 0} · Memories: ${m.memoryCount || 0} · Projects: ${m.projectCount || 0} · Older messages omitted: ${m.omittedMessages || 0} · Prompt characters: ${m.promptChars || 0} · Tool-definition characters: ${m.toolDefinitionChars || 0} · Duration: ${((m.durationMs || 0) / 1000).toFixed(1)}s`,
          ),
        );
        if (run.selection)
          details.append(
            el(
              "p",
              "",
              "Routing: " +
                run.selection.mode +
                " · Tools offered: " +
                (run.selection.tools.join(", ") || "none"),
            ),
          );
        if (run.errorCode)
          details.append(el("p", "", "Error: " + run.errorCode));
        row.append(details);
        body.append(row);
      }
    }
    if (tab === "notes") {
      body.append(
        el(
          "p",
          "workbench-intro",
          "Ask Jarvis to save a note, or create one here. Notes are stored on this Mac and retrieved when needed.",
        ),
      );
      const form = el("form", "workspace-form"),
        title = el("input"),
        content = el("textarea"),
        save = el("button", "planner-add", "Save note");
      title.placeholder = "Note title";
      title.required = true;
      title.maxLength = 150;
      title.setAttribute("aria-label", "Note title");
      content.rows = 3;
      content.placeholder = "Your note…";
      content.maxLength = 20000;
      content.setAttribute("aria-label", "Note body");
      form.append(title, content, save);
      form.onsubmit = (e) => {
        e.preventDefault();
        run(() =>
          action({
            action: "saveNote",
            title: title.value,
            content: content.value,
          }),
        );
      };
      body.append(form);
      for (const n of state.notes) {
        const row = el("article", "workspace-note"),
          head = el("div", "addon-heading"),
          remove = el("button", "text-button", "Delete");
        head.append(el("h3", "", n.title), remove);
        remove.onclick = () =>
          run(() => action({ action: "deleteNote", id: n.id }));
        row.append(head, el("p", "", n.content));
        body.append(row);
      }
    }
  }
  return {
    open,
    refresh,
    action,
    get state() {
      return state;
    },
  };
}
export function renderResult(event, reply) {
  const card = el("section", "result-card"),
    label = el(
      "div",
      "visual-eyebrow",
      event.kind === "addon" ? "ADD-ON RESULT" : "LOCAL WORKSPACE",
    );
  card.append(label, el("h3", "", event.title));
  const data = event.data;
  if (event.kind === "calculation") {
    card.append(
      el("code", "calc-expression", data.expression),
      el("strong", "calc-value", String(data.value)),
    );
  } else if (event.kind === "note") card.append(el("p", "", data.content));
  else if (event.kind === "memory") card.append(el("p", "", data.text));
  else if (Array.isArray(data)) {
    for (const item of data) {
      const block = el("div", "result-item");
      if (item.title) block.append(el("strong", "", item.title));
      block.append(
        el("p", "", item.content || item.text || JSON.stringify(item)),
      );
      card.append(block);
    }
    if (!data.length) card.append(el("p", "", "Nothing saved here yet."));
  } else {
    const draw = (value, parent, depth = 0) => {
      if (depth > 2) {
        parent.append(
          el(
            "p",
            "",
            Array.isArray(value) ? `${value.length} items` : String(value),
          ),
        );
        return;
      }
      if (value && typeof value === "object" && !Array.isArray(value)) {
        const grid = el("div", "data-grid");
        for (const [key, item] of Object.entries(value).slice(0, 24)) {
          const block = el(
            "div",
            item && typeof item === "object" ? "data-group" : "data-fact",
          );
          block.append(el("span", "data-label", key.replace(/_/g, " ")));
          if (item && typeof item === "object") draw(item, block, depth + 1);
          else
            block.append(el("strong", "", item === null ? "—" : String(item)));
          grid.append(block);
        }
        parent.append(grid);
      } else if (Array.isArray(value)) {
        const list = el("div", "data-list");
        for (const item of value.slice(0, 15)) {
          const row = el("div", "data-row");
          draw(item, row, depth + 1);
          list.append(row);
        }
        parent.append(list);
      } else parent.append(el("strong", "data-scalar", String(value ?? "—")));
    };
    draw(data, card);
  }
  if (event.source) {
    try {
      const u = new URL(event.source);
      if (u.protocol === "https:") {
        const a = el("a", "result-source", "Source ↗");
        a.href = u.href;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        card.append(a);
      }
    } catch {}
  }
  reply.el.insertBefore(card, reply.content);
}
