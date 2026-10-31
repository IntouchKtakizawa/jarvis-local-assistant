import {
  validateUISpec,
  initialUIState,
  applyUIAction,
  timerRemaining,
  stopwatchElapsed,
  restoreUIState,
} from "./ui-spec.js";
import { calculate } from "./ui-math.js";
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};
const time = (seconds) => {
  const s = Math.max(0, Math.ceil(seconds)),
    h = Math.floor(s / 3600),
    m = Math.floor((s % 3600) / 60);
  return (
    (h ? String(h).padStart(2, "0") + ":" : "") +
    String(m).padStart(2, "0") +
    ":" +
    String(s % 60).padStart(2, "0")
  );
};
export function initFloatingUI() {
  let account = null,
    records = [],
    z = 40,
    saveTimer;
  const windows = new Map(),
    visuals = new Map(),
    tickers = new Map();
  const layer = el("div", "floating-layer");
  layer.setAttribute("aria-label", "Live panel windows");
  document.body.append(layer);
  const dock = el("div", "floating-dock");
  dock.setAttribute("aria-label", "Minimized panels");
  document.body.append(dock);
  const alert = el("div", "panel-toast");
  alert.setAttribute("role", "status");
  alert.hidden = true;
  document.body.append(alert);
  let toastTimer;
  const nav = el("button", "rail-button");
  nav.id = "live-panels-open";
  nav.title = "Live panels";
  nav.setAttribute("aria-label", "Live panels");
  nav.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M3 9h18M8 4v5"/></svg><span class="nav-label">Live panels</span><span class="live-panel-count">0</span>';
  document
    .querySelector(".rail")
    .insertBefore(nav, document.querySelector("#connection-open"));
  const key = () => (account ? "jarvis.live-ui.v1." + account : null);
  function notify(text) {
    alert.textContent = text;
    alert.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (alert.hidden = true), 7000);
  }
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        if (key())
          localStorage.setItem(key(), JSON.stringify(records.slice(-24)));
      } catch {
        notify(
          "Browser storage is full. Keep this tab open to retain your live panels.",
        );
      }
    }, 150);
  }
  const liveRecords = () => records.filter((r) => !r.closed);
  function clockComponent(r) {
    return r.spec.components.find(
      (c) => c.type === "timer" || c.type === "stopwatch",
    );
  }
  function clockText(r) {
    const c = clockComponent(r);
    return c
      ? time(
          c.type === "timer"
            ? timerRemaining(r.state[c.id])
            : stopwatchElapsed(r.state[c.id]),
        )
      : "";
  }
  function updateDockClocks() {
    for (const node of dock.querySelectorAll("[data-clock-panel]")) {
      const r = records.find((r) => r.spec.id === node.dataset.clockPanel);
      if (r) node.textContent = clockText(r);
    }
  }
  function updateDock() {
    dock.replaceChildren();
    nav.querySelector(".live-panel-count").textContent = String(
      liveRecords().length + visuals.size,
    );
    for (const r of liveRecords().filter((r) => r.minimized)) {
      const b = el("button", "dock-panel");
      b.append(el("span", "dock-panel-title", r.spec.title));
      if (clockComponent(r)) {
        const clock = el("span", "dock-clock", clockText(r));
        clock.dataset.clockPanel = r.spec.id;
        b.append(clock);
      }
      if (r.completed) b.classList.add("has-alert");
      b.onclick = () => {
        r.minimized = false;
        show(r);
        save();
      };
      dock.append(b);
    }
    for (const [id, v] of visuals)
      if (v.minimized) {
        const b = el("button", "dock-panel", v.title);
        b.onclick = () => {
          v.minimized = false;
          v.window.hidden = false;
          updateDock();
        };
        dock.append(b);
      }
    dock.hidden = !dock.childElementCount;
  }
  function focus(w) {
    w.style.zIndex = String(++z);
  }
  function clamp(w, x, y) {
    const width = w.getBoundingClientRect().width;
    return {
      x: Math.max(8, Math.min(x, Math.max(8, innerWidth - width - 8))),
      y: Math.max(
        8,
        Math.min(y, innerHeight - (innerWidth <= 540 ? 230 : 160)),
      ),
    };
  }
  function position(w, r) {
    const p = clamp(
      w,
      r.x ?? Math.max(12, innerWidth - 460 - (windows.size % 3) * 24),
      r.y ?? 100 + (windows.size % 3) * 32,
    );
    w.style.left = p.x + "px";
    w.style.top = p.y + "px";
    w.style.maxHeight =
      Math.max(120, innerHeight - p.y - (innerWidth <= 540 ? 78 : 12)) + "px";
    r.x = p.x;
    r.y = p.y;
  }
  function shell(id, title, r, { close, minimize }) {
    const w = el("section", "floating-window");
    w.dataset.panelId = id;
    w.setAttribute("role", "region");
    w.setAttribute("aria-label", title + " panel");
    w.tabIndex = -1;
    const head = el("div", "floating-titlebar");
    head.tabIndex = 0;
    head.setAttribute("aria-label", "Move " + title + " panel");
    head.title = "Drag to move. Use arrow keys when focused.";
    const grip = el("span", "floating-grip", "⠿"),
      name = el("strong", "", title),
      clock = el("output", "floating-clock"),
      tools = el("div", "floating-tools");
    const min = el("button", "", "−"),
      closeButton = el("button", "", "×");
    min.type = closeButton.type = "button";
    min.setAttribute("aria-label", "Minimize " + title);
    closeButton.setAttribute("aria-label", "Close " + title);
    min.onclick = minimize;
    closeButton.onclick = close;
    tools.append(min, closeButton);
    head.append(grip, name, clock, tools);
    const content = el("div", "floating-content");
    w.append(head, content);
    layer.append(w);
    position(w, r);
    focus(w);
    w.addEventListener("pointerdown", () => focus(w));
    let drag = null;
    head.addEventListener("pointerdown", (e) => {
      if (e.target.closest("button") || e.button !== 0) return;
      const rect = w.getBoundingClientRect();
      drag = { x: e.clientX, y: e.clientY, left: rect.left, top: rect.top };
      head.setPointerCapture(e.pointerId);
      w.classList.add("dragging");
      e.preventDefault();
    });
    head.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const p = clamp(
        w,
        drag.left + e.clientX - drag.x,
        drag.top + e.clientY - drag.y,
      );
      w.style.left = p.x + "px";
      w.style.top = p.y + "px";
      w.style.maxHeight =
        Math.max(120, innerHeight - p.y - (innerWidth <= 540 ? 78 : 12)) + "px";
      r.x = p.x;
      r.y = p.y;
    });
    const end = () => {
      if (drag) {
        drag = null;
        w.classList.remove("dragging");
        save();
      }
    };
    head.addEventListener("pointerup", end);
    head.addEventListener("pointercancel", end);
    head.addEventListener("keydown", (e) => {
      if (e.target !== head) return;
      const moves = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
      };
      if (!moves[e.key]) return;
      e.preventDefault();
      const [dx, dy] = moves[e.key],
        step = e.shiftKey ? 40 : 10;
      position(w, Object.assign(r, { x: r.x + dx * step, y: r.y + dy * step }));
      save();
    });
    const observer = new ResizeObserver(() => {
      if (w.hidden) return;
      const height = w.getBoundingClientRect().height;
      w.classList.toggle("panel-compact", height < 340);
      w.classList.toggle("panel-tiny", height < 190);
    });
    observer.observe(w);
    return { window: w, content, observer };
  }
  function removeWindow(id) {
    const w = windows.get(id);
    if (w) {
      w.observer.disconnect();
      w.window.remove();
    }
    windows.delete(id);
    tickers.delete(id);
  }
  function close(id) {
    const r = records.find((r) => r.spec.id === id);
    if (!r) return;
    r.closed = true;
    r.completed = false;
    removeWindow(id);
    save();
    updateDock();
  }
  function minimize(id) {
    const r = records.find((r) => r.spec.id === id);
    if (!r) return;
    r.minimized = true;
    const w = windows.get(id);
    if (w) w.window.hidden = true;
    save();
    updateDock();
  }
  function mutate(r, a) {
    try {
      applyUIAction(r.spec, r.state, a);
      r.completed = false;
      draw(r);
      save();
      updateDock();
    } catch (e) {
      notify(e.message);
    }
  }
  function fieldValue(r, c) {
    if (!c.formula) return r.state[c.id];
    try {
      const expression = c.formula.replace(/\{([^}]+)\}/g, (_, id) => {
        const source = r.state[id];
        const value = Array.isArray(source)
          ? source.filter((i) => i.done).length
          : Number(source);
        if (!Number.isFinite(value)) throw Error();
        return "(" + value + ")";
      });
      return calculate(expression).value;
    } catch {
      return "—";
    }
  }
  function draw(r) {
    const view = windows.get(r.spec.id);
    if (!view) return;
    const body = view.content,
      active = document.activeElement,
      focusId = active?.dataset?.componentId,
      selection = active?.selectionStart;
    body.replaceChildren();
    const ticking = [];
    const clock = clockComponent(r);
    view.window.classList.toggle("has-live-clock", Boolean(clock));
    view.window.classList.toggle(
      "clock-only",
      r.spec.components.every(
        (c) => c.type === "timer" || c.type === "stopwatch",
      ),
    );
    const headerClock = view.window.querySelector(".floating-clock");
    headerClock.textContent = clockText(r);
    const single = r.spec.components.length === 1 ? r.spec.components[0] : null,
      description =
        single?.type === "timer"
          ? "Countdown · " + time(single.duration_seconds)
          : single?.type === "stopwatch"
            ? "Measure elapsed time"
            : r.spec.description;
    if (description) body.append(el("p", "floating-description", description));
    const grid = el(
      "div",
      "live-component-grid " + (r.spec.layout === "grid" ? "is-grid" : ""),
    );
    body.append(grid);
    for (const c of r.spec.components) {
      const block = el(
        "div",
        "live-component live-" + (c.type === "input" ? "field" : c.type),
      );
      block.dataset.component = c.id;
      grid.append(block);
      if (c.label && c.type !== "button")
        block.append(el("div", "live-label", c.label));
      if (c.type === "text") {
        block.append(el("p", "live-text", c.text));
        continue;
      }
      if (c.type === "timer" || c.type === "stopwatch") {
        const display = el("output", "live-time"),
          status = el("span", "live-timer-status"),
          ring = el("div", "live-timer-face");
        display.setAttribute("aria-label", c.label || c.type);
        ring.append(display, status);
        block.append(ring);
        const controls = el("div", "live-timer-controls"),
          toggle = el("button", "live-primary"),
          reset = el("button", "live-secondary", "Reset");
        toggle.onclick = () =>
          mutate(r, {
            target: c.id,
            operation: r.state[c.id].running ? "pause" : "start",
          });
        reset.onclick = () => mutate(r, { target: c.id, operation: "reset" });
        controls.append(toggle, reset);
        block.append(controls);
        const tick = () => {
          const s = r.state[c.id],
            seconds =
              c.type === "timer" ? timerRemaining(s) : stopwatchElapsed(s);
          display.textContent = time(seconds);
          if (c === clock) headerClock.textContent = time(seconds);
          toggle.textContent = s.running
            ? "Pause"
            : seconds <= 0 && c.type === "timer"
              ? "Start again"
              : "Start";
          status.textContent =
            c.type === "timer"
              ? seconds <= 0
                ? "Time’s up"
                : s.running
                  ? "In progress"
                  : c.autostart || s.remaining < c.duration_seconds
                    ? "Paused"
                    : "Ready when you are"
              : s.running
                ? "Counting up"
                : "Paused";
          ring.style.setProperty(
            "--timer-progress",
            String(
              c.type === "timer"
                ? Math.min(100, (seconds / c.duration_seconds) * 100)
                : 100,
            ),
          );
          if (c.type === "timer" && s.running && seconds <= 0) {
            s.running = false;
            s.remaining = 0;
            s.completed = true;
            r.completed = true;
            ring.classList.add("is-complete");
            notify(r.spec.title + " — time’s up.");
            updateDock();
            save();
          }
          toggle.textContent = s.running
            ? "Pause"
            : seconds <= 0 && c.type === "timer"
              ? "Start again"
              : "Start";
        };
        ticking.push(tick);
        tick();
        continue;
      }
      if (c.type === "input" || c.type === "slider" || c.type === "select") {
        const input = el(
          c.type === "select"
            ? "select"
            : c.input_type === "textarea"
              ? "textarea"
              : "input",
          "live-input",
        );
        input.dataset.componentId = c.id;
        input.setAttribute("aria-label", c.label || c.id);
        if (c.type === "select") {
          for (const option of c.options) {
            const item = el("option", "", option);
            item.value = option;
            input.append(item);
          }
        } else {
          input.type = c.type === "slider" ? "range" : c.input_type || "text";
          if (c.type !== "slider") input.placeholder = c.placeholder || "";
          if (c.type === "slider") {
            input.min = c.min;
            input.max = c.max;
            input.step = c.step;
          }
        }
        input.value = r.state[c.id];
        const out =
          c.type === "slider"
            ? el(
                "output",
                "live-slider-value",
                String(r.state[c.id]) + (c.unit ? " " + c.unit : ""),
              )
            : null;
        input.addEventListener("input", () => {
          r.state[c.id] =
            input.type === "number" || input.type === "range"
              ? Number.isFinite(input.valueAsNumber)
                ? input.valueAsNumber
                : 0
              : input.value.slice(0, 3000);
          if (out)
            out.textContent =
              String(r.state[c.id]) + (c.unit ? " " + c.unit : "");
          for (const f of ticking) f();
          updateComputed(r);
          save();
        });
        block.append(input);
        if (out) block.append(out);
        continue;
      }
      if (c.type === "metric") {
        const value = el("output", "live-metric");
        value.dataset.computed = c.id;
        value.textContent =
          String(fieldValue(r, c)) + (c.unit ? " " + c.unit : "");
        block.append(value);
        continue;
      }
      if (c.type === "progress") {
        const progress = el("progress", "live-progress");
        progress.max = c.max;
        progress.value = Number(fieldValue(r, c)) || 0;
        progress.dataset.computed = c.id;
        progress.setAttribute("aria-label", c.label || "Progress");
        const value = el(
          "output",
          "live-progress-label",
          String(fieldValue(r, c)) +
            " / " +
            c.max +
            (c.unit ? " " + c.unit : ""),
        );
        value.dataset.progressLabel = c.id;
        block.append(progress, value);
        continue;
      }
      if (c.type === "button") {
        const b = el(
          "button",
          c.style === "quiet" ? "live-secondary" : "live-primary",
          c.label || "Apply",
        );
        b.onclick = () => {
          try {
            for (const a of c.actions) applyUIAction(r.spec, r.state, a);
            draw(r);
            save();
          } catch (e) {
            notify(e.message);
          }
        };
        block.append(b);
        continue;
      }
      if (c.type === "checklist") {
        const list = el("div", "live-checklist");
        for (const item of r.state[c.id]) {
          const row = el("div", "live-check-row"),
            label = el("label"),
            check = el("input"),
            name = el("span", "", item.text);
          check.type = "checkbox";
          check.checked = item.done;
          check.onchange = () =>
            mutate(r, { operation: "toggle", target: c.id, value: item.id });
          label.append(check, name);
          if (item.done) row.classList.add("is-done");
          row.append(label);
          if (c.editable) {
            const del = el("button", "live-remove", "×");
            del.setAttribute("aria-label", "Remove " + item.text);
            del.onclick = () => {
              r.state[c.id] = r.state[c.id].filter((i) => i.id !== item.id);
              draw(r);
              save();
            };
            row.append(del);
          }
          list.append(row);
        }
        block.append(list);
        const count = el(
          "span",
          "live-check-count",
          r.state[c.id].filter((i) => i.done).length +
            " of " +
            r.state[c.id].length +
            " complete",
        );
        block.append(count);
        if (c.editable) {
          const form = el("form", "live-add-item"),
            input = el("input", "live-input"),
            add = el("button", "live-secondary", "Add");
          input.placeholder = "Add an item…";
          input.setAttribute("aria-label", "Add item to " + (c.label || c.id));
          input.maxLength = 300;
          form.append(input, add);
          form.onsubmit = (e) => {
            e.preventDefault();
            mutate(r, {
              operation: "append_item",
              target: c.id,
              value: input.value,
            });
          };
          block.append(form);
        }
        continue;
      }
      if (c.type === "table") {
        const scroll = el("div", "live-table-scroll"),
          table = el("table"),
          thead = el("thead"),
          tr = el("tr");
        for (const col of c.columns) tr.append(el("th", "", col));
        thead.append(tr);
        const tbody = el("tbody");
        for (const row of c.rows) {
          const tr = el("tr");
          for (const value of row) tr.append(el("td", "", value));
          tbody.append(tr);
        }
        table.append(thead, tbody);
        scroll.append(table);
        block.append(scroll);
        continue;
      }
      if (c.type === "chart") {
        const chart = el("div", "live-bar-chart");
        chart.setAttribute("role", "img");
        chart.setAttribute("aria-label", c.label || "Data chart");
        const max = Math.max(1, ...c.points.map((p) => Math.abs(p.value)));
        for (const p of c.points) {
          const row = el("div", "live-bar-row"),
            bar = el("span", "live-bar"),
            track = el("div", "live-bar-track");
          bar.style.width = Math.max(0, (Math.abs(p.value) / max) * 100) + "%";
          track.append(bar);
          row.append(
            el("span", "live-bar-label", p.label),
            track,
            el(
              "span",
              "live-bar-value",
              p.value + (c.unit ? " " + c.unit : ""),
            ),
          );
          chart.append(row);
        }
        block.append(chart);
      }
    }
    tickers.set(r.spec.id, ticking);
    if (focusId) {
      const input = [...body.querySelectorAll("[data-component-id]")].find(
        (e) => e.dataset.componentId === focusId,
      );
      if (input) {
        input.focus({ preventScroll: true });
        try {
          input.setSelectionRange(selection, selection);
        } catch {}
      }
    }
  }
  function updateComputed(r) {
    const view = windows.get(r.spec.id);
    if (!view) return;
    for (const c of r.spec.components) {
      if (!["metric", "progress"].includes(c.type)) continue;
      const value = fieldValue(r, c),
        node = [...view.content.querySelectorAll("[data-computed]")].find(
          (n) => n.dataset.computed === c.id,
        );
      if (!node) continue;
      if (c.type === "metric")
        node.textContent = String(value) + (c.unit ? " " + c.unit : "");
      else {
        node.value = Number(value) || 0;
        const label = [
          ...view.content.querySelectorAll("[data-progress-label]"),
        ].find((n) => n.dataset.progressLabel === c.id);
        if (label)
          label.textContent =
            value + " / " + c.max + (c.unit ? " " + c.unit : "");
      }
    }
  }
  function show(r) {
    if (r.closed) return;
    if (!windows.has(r.spec.id)) {
      if (windows.size + visuals.size >= 12)
        throw Error("Close a panel before opening more than twelve.");
      const view = shell(r.spec.id, r.spec.title, r, {
        close: () => close(r.spec.id),
        minimize: () => minimize(r.spec.id),
      });
      windows.set(r.spec.id, view);
      draw(r);
    }
    const w = windows.get(r.spec.id).window;
    w.hidden = r.minimized;
    focus(w);
    updateDock();
  }
  function open(spec, issuedAt = Date.now(), replay = false) {
    spec = validateUISpec(spec);
    let r = records.find((r) => r.spec.id === spec.id);
    if (replay) return r || null;
    if (liveRecords().length + visuals.size >= 12 && (!r || r.closed))
      throw Error("Close a live panel before opening another.");
    if (r) removeWindow(spec.id);
    r = {
      spec,
      state: initialUIState(spec, issuedAt),
      closed: false,
      minimized: false,
      x: r?.x,
      y: r?.y,
      completed: false,
    };
    records = records.filter((r) => r.spec.id !== spec.id);
    records.push(r);
    records = records.slice(-24);
    show(r);
    save();
    return r;
  }
  function reopen(spec) {
    let r = records.find((r) => r.spec.id === spec.id);
    if (r) {
      if (r.closed && liveRecords().length + visuals.size >= 12)
        throw Error("Close another panel first.");
      r.closed = false;
      r.minimized = false;
      show(r);
      save();
    } else open(spec);
  }
  function control({ panel_id, component_id, operation, value }) {
    const r = records.find((r) => r.spec.id === panel_id && !r.closed);
    if (!r)
      throw Error(
        "That panel is closed or belongs to a different browser. Ask Jarvis to open it again.",
      );
    if (operation === "close") return close(panel_id);
    if (operation === "minimize") return minimize(panel_id);
    if (operation === "restore") {
      r.minimized = false;
      show(r);
      save();
      return;
    }
    mutate(r, { target: component_id, operation, value });
  }
  function setAccount(id) {
    if (account === id) return;
    clearTimeout(saveTimer);
    if (key()) {
      try {
        localStorage.setItem(key(), JSON.stringify(records.slice(-24)));
      } catch {}
    }
    for (const id of [...windows.keys()]) removeWindow(id);
    for (const v of visuals.values()) {
      for (const card of v.window.querySelectorAll(".map-card,.planner-card"))
        card.dispatchEvent(new Event("jarvis-dispose"));
      v.observer.disconnect();
      v.window.remove();
    }
    visuals.clear();
    account = id;
    records = [];
    if (key()) {
      try {
        const saved = JSON.parse(localStorage.getItem(key()) || "[]");
        if (Array.isArray(saved))
          for (const r of saved.slice(-24)) {
            try {
              const spec = validateUISpec(r.spec);
              records.push({
                spec,
                state: restoreUIState(spec, r.state),
                closed: r.closed === true,
                minimized: r.minimized === true,
                completed: r.completed === true,
                x: Number.isFinite(r.x) ? r.x : undefined,
                y: Number.isFinite(r.y) ? r.y : undefined,
              });
            } catch {}
          }
      } catch {
        notify("Saved panels could not be loaded. New panels will still work.");
      }
    }
    for (const r of liveRecords().slice(0, 12)) {
      try {
        show(r);
      } catch {}
    }
    updateDock();
  }
  function context() {
    return liveRecords().map((r) => ({
      id: r.spec.id,
      title: r.spec.title,
      minimized: r.minimized,
      components: r.spec.components.map((c) => ({
        id: c.id,
        type: c.type,
        label: c.label,
        value:
          c.type === "timer"
            ? {
                seconds_remaining: Math.ceil(timerRemaining(r.state[c.id])),
                running: r.state[c.id].running,
              }
            : c.type === "stopwatch"
              ? {
                  seconds_elapsed: Math.floor(stopwatchElapsed(r.state[c.id])),
                  running: r.state[c.id].running,
                }
              : c.type === "metric" || c.type === "progress"
                ? fieldValue(r, c)
                : c.type === "checklist"
                  ? r.state[c.id].slice(0, 20)
                  : typeof r.state[c.id] === "string"
                    ? r.state[c.id].slice(0, 300)
                    : r.state[c.id],
      })),
    }));
  }
  function popOut(host, title, type) {
    if (host.closest(".floating-window")) return;
    if (windows.size + visuals.size >= 12)
      throw Error("Close a panel before opening another.");
    const id = "visual_" + crypto.randomUUID(),
      anchor = document.createComment("Panel returns here");
    host.before(anchor);
    const r = { x: Math.max(12, innerWidth - 600), y: 90 };
    let entry;
    const view = shell(id, title, r, {
      close: () => {
        if (anchor.isConnected) {
          anchor.replaceWith(host);
          host.querySelector(".panel-popout").hidden = false;
        } else
          for (const card of host.querySelectorAll(".map-card,.planner-card"))
            card.dispatchEvent(new Event("jarvis-dispose"));
        view.observer.disconnect();
        view.window.remove();
        visuals.delete(id);
        updateDock();
      },
      minimize: () => {
        entry.minimized = true;
        view.window.hidden = true;
        updateDock();
      },
    });
    view.window.classList.add("visual-floating-window");
    host.querySelector(".panel-popout").hidden = true;
    view.content.append(host);
    entry = { ...view, title, type, minimized: false };
    visuals.set(id, entry);
    updateDock();
    return entry;
  }
  function enhance(node, type, title) {
    if (node.closest(".panel-host")) return;
    const host = el("div", "panel-host"),
      tools = el("div", "panel-host-tools"),
      button = el("button", "panel-popout", "↗ Pop out");
    button.type = "button";
    button.setAttribute("aria-label", "Pop out " + title);
    node.before(host);
    tools.append(button);
    host.append(tools, node);
    host.dataset.visualType = type;
    button.onclick = () => {
      try {
        popOut(host, title, type);
      } catch (e) {
        notify(e.message);
      }
    };
  }
  function floatVisual(type) {
    const hosts = [...document.querySelectorAll(".panel-host")].filter(
      (n) => n.dataset.visualType === type && !n.closest(".floating-window"),
    );
    if (!hosts.length)
      throw Error("No " + type + " panel is available to pop out.");
    const host = hosts.at(-1);
    popOut(host, type[0].toUpperCase() + type.slice(1), type);
  }
  nav.onclick = () => {
    if (!liveRecords().length && !visuals.size) {
      notify(
        "Ask Jarvis for a timer, checklist, counter, calculator, or a custom dashboard.",
      );
      return;
    }
    for (const r of liveRecords()) {
      r.minimized = false;
      show(r);
    }
    for (const v of visuals.values()) {
      v.minimized = false;
      v.window.hidden = false;
      focus(v.window);
    }
    save();
    updateDock();
  };
  const interval = setInterval(() => {
    for (const fs of tickers.values()) for (const f of fs) f();
    for (const r of liveRecords().filter((r) => r.minimized))
      for (const c of r.spec.components)
        if (c.type === "timer") {
          const s = r.state[c.id];
          if (s.running && timerRemaining(s) <= 0) {
            s.running = false;
            s.remaining = 0;
            s.completed = true;
            r.completed = true;
            notify(r.spec.title + " — time’s up.");
            save();
            updateDock();
          }
        }
    updateDockClocks();
  }, 250);
  window.addEventListener("resize", () => {
    for (const r of liveRecords()) {
      const v = windows.get(r.spec.id);
      if (v) position(v.window, r);
    }
  });
  window.addEventListener("pagehide", () => {
    clearInterval(interval);
    clearTimeout(saveTimer);
    if (key())
      try {
        localStorage.setItem(key(), JSON.stringify(records.slice(-24)));
      } catch {}
  });
  return {
    setAccount,
    open,
    reopen,
    control,
    context,
    enhance,
    floatVisual,
    notify,
  };
}
