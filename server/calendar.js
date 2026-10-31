import { mkdir, readFile, writeFile, rename, chmod } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { AuthError, equal } from "./auth.js";
export const CALENDAR_SCOPE =
  "https://www.googleapis.com/auth/calendar.events.readonly";
const GOOGLE_KEYS = createRemoteJWKSet(
  new URL("https://www.googleapis.com/oauth2/v3/certs"),
);
const random = () => randomBytes(32).toString("base64url");
export function calendarIntent(text) {
  return (
    typeof text === "string" &&
    /\b(my (?:calendar|schedule|agenda|meetings|appointments)|what(?:'s| is) on (?:my )?calendar|show (?:my )?calendar)\b/i.test(
      text,
    )
  );
}
export function calendarRange(text) {
  return /\btomorrow\b/i.test(text)
    ? "tomorrow"
    : /\btoday\b/i.test(text)
      ? "today"
      : "week";
}
function parts(date, tz) {
  const out = {};
  for (const p of new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date))
    if (p.type !== "literal") out[p.type] = Number(p.value);
  return out;
}
export function calendarWindow(
  range = "week",
  timeZone = "UTC",
  now = new Date(),
) {
  if (!["today", "tomorrow", "week"].includes(range))
    throw new AuthError(
      "Choose today, tomorrow or week.",
      "invalid_range",
      400,
    );
  try {
    new Intl.DateTimeFormat("en", { timeZone }).format(now);
  } catch {
    throw new AuthError("Invalid time zone.", "invalid_timezone", 400);
  }
  const local = parts(now, timeZone),
    base = Date.UTC(local.year, local.month - 1, local.day);
  const midnight = (day) => {
    const wall = base + day * 86400000;
    let instant = wall;
    for (let i = 0; i < 3; i++) {
      const p = parts(new Date(instant), timeZone);
      const represented = Date.UTC(
        p.year,
        p.month - 1,
        p.day,
        p.hour,
        p.minute,
        p.second,
      );
      instant += wall - represented;
    }
    return new Date(instant).toISOString();
  };
  const offset = range === "tomorrow" ? 1 : 0;
  return {
    timeMin: midnight(offset),
    timeMax: midnight(offset + (range === "week" ? 7 : 1)),
    timeZone,
    range,
  };
}
async function verifyGoogle(token, clientId, nonce) {
  const { payload } = await jwtVerify(token, GOOGLE_KEYS, {
    issuer: ["https://accounts.google.com", "accounts.google.com"],
    audience: clientId,
    algorithms: ["RS256"],
    requiredClaims: ["sub", "exp", "iat"],
  });
  if (!equal(payload.nonce, nonce))
    throw new AuthError(
      "Google identity verification failed. Please connect again.",
    );
  return {
    subject: payload.sub,
    email: typeof payload.email === "string" ? payload.email : null,
  };
}
export class GoogleCalendar {
  constructor({ dir, origin, fetcher = fetch, verify = verifyGoogle } = {}) {
    this.dir = dir;
    this.origin = origin;
    this.fetch = fetcher;
    this.verify = verify;
    this.pending = null;
    this.refreshing = null;
    this.generation = 0;
    this.disconnecting = false;
    this.ready = this.load();
  }
  async load() {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    await chmod(this.dir, 0o700);
    try {
      this.data = JSON.parse(
        await readFile(join(this.dir, "calendar.json"), "utf8"),
      );
      await chmod(join(this.dir, "calendar.json"), 0o600);
    } catch (e) {
      if (e.code !== "ENOENT")
        throw new Error("Cannot read protected Google Calendar storage.");
      this.data = {};
    }
  }
  save() {
    this.writing = (this.writing || Promise.resolve()).then(async () => {
      const tmp = join(this.dir, randomUUID() + ".tmp");
      await writeFile(tmp, JSON.stringify(this.data), { mode: 0o600 });
      await rename(tmp, join(this.dir, "calendar.json"));
    });
    return this.writing;
  }
  async status() {
    await this.ready;
    return {
      configured: Boolean(this.data.client),
      connected: Boolean(this.data.tokens?.access_token) && !this.disconnecting,
      email: this.data.identity?.email ?? null,
      readOnly: true,
      pending: Boolean(this.pending && this.pending.expires > Date.now()),
      error: this.error || null,
    };
  }
  async configure(document) {
    await this.ready;
    if (this.data.tokens || this.pending)
      throw new AuthError(
        "Disconnect or cancel Google Calendar before replacing its OAuth client.",
        "calendar_busy",
        409,
      );
    const c = document?.installed;
    if (
      !c ||
      typeof c.client_id !== "string" ||
      !c.client_id.endsWith(".apps.googleusercontent.com") ||
      typeof c.client_secret !== "string" ||
      !c.client_secret ||
      c.client_id.length > 300 ||
      c.client_secret.length > 500
    )
      throw new AuthError(
        "Import the JSON for a Google OAuth Desktop app, not a service-account key or Web client.",
        "invalid_google_client",
        400,
      );
    this.data.client = {
      client_id: c.client_id,
      client_secret: c.client_secret,
    };
    await this.save();
    this.error = null;
  }
  async start(binding) {
    await this.ready;
    if (!this.data.client)
      throw new AuthError(
        "Set up and import your Google OAuth Desktop client in Settings first.",
        "google_setup_required",
        409,
      );
    if (this.pending?.exchanging || this.refreshing || this.disconnecting)
      throw new AuthError(
        "A Calendar operation is running. Please wait.",
        "calendar_busy",
        409,
      );
    const p = {
      state: random(),
      nonce: random(),
      verifier: random(),
      binding,
      expires: Date.now() + 10 * 60000,
      redirect: `${this.origin}/auth/google/callback`,
    };
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.search = new URLSearchParams({
      client_id: this.data.client.client_id,
      redirect_uri: p.redirect,
      response_type: "code",
      scope: `openid email ${CALENDAR_SCOPE}`,
      access_type: "offline",
      prompt: "consent",
      state: p.state,
      nonce: p.nonce,
      code_challenge_method: "S256",
      code_challenge: createHash("sha256")
        .update(p.verifier)
        .digest("base64url"),
    });
    p.url = url.href;
    this.pending = p;
    this.error = null;
    return p.url;
  }
  async resume(binding) {
    await this.ready;
    const p = this.pending;
    if (!p || p.expires < Date.now() || p.exchanging)
      throw new AuthError(
        "Calendar sign-in expired. Cancel and start again.",
        "calendar_expired",
        409,
      );
    if (!equal(binding, p.binding))
      throw new AuthError(
        "Calendar sign-in started in another browser. Cancel and start again here.",
        "calendar_browser_mismatch",
        403,
      );
    return p.url;
  }
  async token(params) {
    const response = await this.fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ ...params, ...this.data.client }),
      signal: AbortSignal.timeout(15000),
      redirect: "error",
    });
    if (!response.ok) {
      let code = "google_token_failed";
      try {
        const d = await response.json();
        if (typeof d.error === "string") code = d.error;
      } catch {}
      throw new AuthError(
        `Google Calendar sign-in failed (${code}). Check the OAuth client setup or reconnect.`,
        code,
        response.status,
      );
    }
    return response.json();
  }
  fields(tokens, previous) {
    if (
      typeof tokens.access_token !== "string" ||
      tokens.token_type?.toLowerCase() !== "bearer" ||
      !Number.isFinite(tokens.expires_in)
    )
      throw new AuthError("Google returned an invalid token response.");
    const scopes =
      typeof tokens.scope === "string"
        ? tokens.scope.split(/\s+/)
        : previous?.scopes;
    if (!scopes?.includes(CALENDAR_SCOPE))
      throw new AuthError(
        "Google did not grant read-only event access. Connect again and approve Calendar access.",
        "calendar_permission_missing",
        403,
      );
    return {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token || previous?.refresh_token,
      expires_at: Date.now() + tokens.expires_in * 1000,
      scopes,
    };
  }
  async callback(params, binding) {
    await this.ready;
    const p = this.pending;
    if (
      !p ||
      p.exchanging ||
      p.expires < Date.now() ||
      !equal(params.get("state"), p.state) ||
      !equal(binding, p.binding)
    )
      throw new AuthError(
        "Calendar sign-in verification failed. Start again from JARVIS.",
        "invalid_calendar_state",
        400,
      );
    p.exchanging = true;
    try {
      if (params.has("error"))
        throw new AuthError(
          "Google Calendar access was declined or unavailable.",
          "calendar_consent_declined",
          400,
        );
      const code = params.get("code");
      if (!code || code.length > 8192)
        throw new AuthError(
          "Google did not return a valid authorization code.",
        );
      const tokens = await this.token({
        grant_type: "authorization_code",
        code,
        code_verifier: p.verifier,
        redirect_uri: p.redirect,
      });
      const identity = await this.verify(
        tokens.id_token,
        this.data.client.client_id,
        p.nonce,
      );
      const fields = this.fields(tokens);
      this.data.tokens = fields;
      this.data.identity = identity;
      this.generation++;
      await this.save();
      this.error = null;
    } catch (e) {
      this.error =
        e instanceof AuthError
          ? e.message
          : "Google identity verification failed. Please connect again.";
      throw new AuthError(
        this.error,
        e.code || "calendar_identity_invalid",
        400,
      );
    } finally {
      this.pending = null;
    }
  }
  cancel() {
    if (this.pending?.exchanging)
      throw new AuthError(
        "Calendar sign-in is being verified. Please wait.",
        "calendar_busy",
        409,
      );
    this.pending = null;
    this.error = null;
  }
  async access(force = false) {
    await this.ready;
    const t = this.data.tokens;
    if (this.disconnecting || !t?.access_token)
      throw new AuthError(
        "Connect Google Calendar in Settings first.",
        "calendar_not_connected",
        401,
      );
    if (!force && t.expires_at > Date.now() + 60000) return t.access_token;
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      if (!t.refresh_token)
        throw new AuthError(
          "Google Calendar session expired. Connect again.",
          "calendar_reconnect",
          401,
        );
      try {
        const result = await this.token({
          grant_type: "refresh_token",
          refresh_token: t.refresh_token,
        });
        this.data.tokens = this.fields(result, t);
        await this.save();
        return this.data.tokens.access_token;
      } catch (e) {
        if (["invalid_grant", "invalid_token"].includes(e.code)) {
          delete this.data.tokens;
          delete this.data.identity;
          await this.save();
        }
        throw e;
      }
    })().finally(() => (this.refreshing = null));
    return this.refreshing;
  }
  async events(range, timeZone, signal) {
    await this.ready;
    const window = calendarWindow(range, timeZone);
    const generation = this.generation;
    let token = await this.access();
    const u = new URL(
      "https://www.googleapis.com/calendar/v3/calendars/primary/events",
    );
    u.search = new URLSearchParams({
      ...window,
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: "50",
      showDeleted: "false",
      fields:
        "summary,timeZone,items(id,summary,start,end,location,htmlLink),nextPageToken",
    });
    u.searchParams.delete("range");
    const request = () =>
      this.fetch(u, {
        headers: { Authorization: `Bearer ${token}` },
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(15000)])
          : AbortSignal.timeout(15000),
        redirect: "error",
      });
    let r = await request();
    if (r.status === 401) {
      await r.body?.cancel();
      token = await this.access(true);
      r = await request();
    }
    if (!r.ok)
      throw new AuthError(
        r.status === 403
          ? "Google denied Calendar access. Enable Google Calendar API in your Cloud project and check consent permissions."
          : `Google Calendar request failed (${r.status}).`,
        "calendar_api_error",
        r.status,
      );
    const data = await r.json();
    if (this.disconnecting || generation !== this.generation)
      throw new AuthError(
        "Calendar connection changed. Please try again.",
        "calendar_changed",
        409,
      );
    return {
      calendar: data.summary || "Primary calendar",
      ...window,
      truncated: Boolean(data.nextPageToken),
      events: (data.items || [])
        .slice(0, 50)
        .map((e) => ({
          id: String(e.id || ""),
          title: String(e.summary || "Untitled event").slice(0, 300),
          start: e.start?.dateTime || e.start?.date,
          end: e.end?.dateTime || e.end?.date,
          allDay: Boolean(e.start?.date),
          location: String(e.location || "").slice(0, 300),
          url: typeof e.htmlLink === "string" ? e.htmlLink : null,
        }))
        .filter((e) => e.start),
    };
  }
  async disconnect() {
    await this.ready;
    if (this.pending?.exchanging)
      throw new AuthError(
        "Calendar sign-in is being verified. Please wait.",
        "calendar_busy",
        409,
      );
    this.disconnecting = true;
    this.pending = null;
    try {
      if (this.refreshing) await this.refreshing.catch(() => {});
      this.generation++;
      const token =
        this.data.tokens?.refresh_token || this.data.tokens?.access_token;
      let revoked = !token;
      if (token) {
        try {
          const r = await this.fetch("https://oauth2.googleapis.com/revoke", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ token }),
            signal: AbortSignal.timeout(10000),
            redirect: "error",
          });
          revoked = r.status === 200;
        } catch {}
      }
      delete this.data.tokens;
      delete this.data.identity;
      await this.save();
      this.error = null;
      return {
        revoked,
        message: revoked
          ? "Google Calendar disconnected."
          : "Disconnected locally. Google revocation was not confirmed; remove JARVIS access in your Google Account settings.",
      };
    } finally {
      this.disconnecting = false;
    }
  }
}
