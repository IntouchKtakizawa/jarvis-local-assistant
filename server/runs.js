import { randomUUID } from "node:crypto";
import { redactSensitive } from "./privacy.js";

const safeName = (value) => {
  const name = redactSensitive(value);
  return /^[a-zA-Z][\w.:-]{0,79}$/.test(name) ? name : "unavailable_tool";
};
export function resultOutcome(result) {
  if (result?.requested)
    return result.found === false ? "no_results" : "dispatched";
  return "confirmed";
}
export function selectWorkingState(runs, conversationId, route) {
  if (!conversationId || !route.followup) return null;
  const run = runs.find(
    (r) =>
      r.conversationId === conversationId &&
      r.steps.length &&
      (!route.projectNames.length ||
        r.selection?.projects?.some((name) =>
          route.projectNames.includes(name),
        )),
  );
  return run
    ? {
        id: run.id,
        status: run.status,
        steps: run.steps.map(({ name, status, outcome }) => ({
          name,
          status,
          outcome,
        })),
        note: "Historical execution evidence only. Answered means a reply was generated, not that the overall goal succeeded. Do not rerun writes or restart timers merely because a reply was interrupted.",
      }
    : null;
}

// Bounded operational metadata lives with the existing account-separated workspace.
// No prompts, replies, tool arguments/results, credentials or reasoning are logged.
export class RunJournal {
  constructor(workspace, account, conversationId, model) {
    this.workspace = workspace;
    this.account = account;
    this.key = conversationId ? account + "\0" + conversationId : null;
    this.run = {
      id: randomUUID(),
      conversationId: conversationId || null,
      model: redactSensitive(model).slice(0, 160),
      status: "running",
      startedAt: new Date().toISOString(),
      steps: [],
      metrics: {},
    };
  }
  async start() {
    const w = this.workspace;
    w.activeConversations ??= new Set();
    if (this.key && w.activeConversations.has(this.key)) {
      const e = new Error(
        "A reply is already running for this conversation. Stop it before retrying.",
      );
      e.code = "conversation_busy";
      e.status = 409;
      throw e;
    }
    if (this.key) w.activeConversations.add(this.key);
    w.activeRuns.add(this.run.id);
    try {
      await w.updateRuns(this.account, (s) => {
        s.runs = [this.run, ...(s.runs || [])].slice(0, 40);
      });
    } catch (e) {
      this.release();
      throw e;
    }
  }
  async update({ step, metrics, status, errorCode } = {}) {
    if (step)
      this.run.steps.push({
        name: safeName(step.name),
        status: step.ok ? "succeeded" : "failed",
        outcome: step.ok ? step.outcome : "failed",
        ms: Math.max(0, step.ms || 0),
      });
    if (metrics)
      for (const [key, value] of Object.entries(metrics))
        if (/^[a-zA-Z]+$/.test(key) && Number.isFinite(value) && value >= 0)
          this.run.metrics[key] = value;
    if (status) {
      this.run.status = status;
      this.run.finishedAt = new Date().toISOString();
    }
    if (errorCode) {
      const code = redactSensitive(errorCode);
      this.run.errorCode = /^[a-zA-Z0-9_-]{1,80}$/.test(code)
        ? code
        : "request_failed";
    }
    await this.workspace.updateRuns(this.account, (s) => {
      const i = s.runs.findIndex((r) => r.id === this.run.id);
      if (i >= 0) s.runs[i] = structuredClone(this.run);
    });
  }
  release() {
    this.workspace.activeRuns.delete(this.run.id);
    if (this.key) this.workspace.activeConversations.delete(this.key);
  }
}
