// Deterministic selection: no extra model call, embeddings or external storage.
const words = (text) =>
  new Set(
    (text.toLowerCase().match(/[a-z0-9]+/g) || []).filter(
      (w) => w.length > 2 && !STOP.has(w),
    ),
  );
const STOP = new Set(
  "the and for you your with this that what how when can please want have from about are was does into".split(
    " ",
  ),
);
const groups = {
  school:
    /\b(school|igcse|homework|exam|test|psychology|biology|chemistry|physics|maths|mathematics|study|academic)\b/i,
  programming:
    /\b(code|coding|programming|software|bug|fix|repository|github|git|develop\w*|architecture|dependencies|debug|refactor|typescript|javascript|lint|test suite|run tests)\b/i,
  music: /\b(music|song|playlist|spotify|piano|guitar)\b/i,
  theatre: /\b(theatre|theater|rehearsal|production|stage)\b/i,
  devices: /\b(device|macbook|computer|setup|microphone|headphones)\b/i,
};
export const PROJECT_NAMES = [
  "StageWrite Studio",
  "OpenBridge",
  "KineticForm",
  "Town Simulation",
];
const containsName = (text, name) =>
  name &&
  new RegExp(
    "(?:^|\\W)" + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?=$|\\W)",
    "i",
  ).test(text);
const refersBack = (text) =>
  text.length < 240 &&
  /\b(it|those|them|there|same|continue|resume|retry|again)\b|\b(?:that|this)\s+(?:one|bug|project|panel)\b|\bthat[!?.\s]*$|^(yes|go on|carry on|stop|pause|run tests)[!?.\s]*$/i.test(
    text,
  );
export function routeRequest(messages, projects = []) {
  const request = messages.at(-1)?.content || "";
  const names = [
    ...new Set([...PROJECT_NAMES, ...projects.map((p) => p.name)]),
  ];
  const knownProjects = names.map((name) => ({
    name,
    aliases: [
      name,
      name.replace(/ Studio$/i, ""),
      ...(projects.find((p) => p.name === name)?.aliases || []),
    ],
  }));
  const mentions = (text, p) =>
    p.aliases.some((alias) => containsName(text, alias));
  // Carry bounded antecedents through terse follow-ups, stopping at the latest topic.
  const followup = refersBack(request),
    antecedents = [];
  if (followup && !knownProjects.some((p) => mentions(request, p)))
    for (const message of messages
      .slice(0, -1)
      .filter((m) => m.role === "user")
      .slice(-6)
      .reverse()) {
      antecedents.unshift(message.content);
      if (
        !refersBack(message.content) ||
        knownProjects.some((p) => mentions(message.content, p))
      )
        break;
    }
  const query =
    request + (antecedents.length ? "\n" + antecedents.join("\n") : "");
  const projectNames = knownProjects
    .filter((p) => mentions(query, p))
    .map((p) => p.name);
  const categories = Object.entries(groups)
    .filter(([, pattern]) => pattern.test(query))
    .map(([name]) => name);
  if (projectNames.length && !categories.includes("programming"))
    categories.push("programming");
  const addons = new Set();
  const add = (...ids) => ids.forEach((id) => addons.add(id));
  if (
    /\b(calculat\w*|multiply|divide|percentage|percent|sqrt|arithmetic)\b|\d\s*[+*/^%-]\s*\d/i.test(
      query,
    )
  )
    add("calculator");
  if (/\b(photo\w*|picture\w*|image\w*)\b/i.test(query)) add("images");
  if (/\b(map|where is|directions|geograph\w*)\b/i.test(query)) add("maps");
  if (/\b(weather|forecast|rain|temperature)\b/i.test(query)) add("weather");
  if (
    /\b(calendar|planner|schedule|appointment|next .*test|next .*exam)\b/i.test(
      query,
    )
  )
    add("planner", "notes");
  const explicitWeb =
    /\b(search|research|look up|browse|read (?:this|the|https)|web|online)\b|https:\/\//i.test(
      query,
    );
  if (
    explicitWeb ||
    (/\b(latest|current\w*|today|news)\b/i.test(query) &&
      !addons.has("weather") &&
      !addons.has("planner"))
  )
    add("web");
  if (
    /\b(overview|compare|comparison|visuali[sz]e|illustrat\w*)\b/i.test(query)
  )
    add("information");
  if (
    /\b(timer|stopwatch|countdown|counter|checklist|tracker|dashboard|form|panel|popup|pop out|window)\b/i.test(
      query,
    )
  )
    add("live_ui");
  if (/\b(note|notes|notebook)\b/i.test(query)) add("notes");
  if (/\b(remember|memory|memories|forget)\b/i.test(query)) add("memory");
  if (categories.includes("programming")) add("projects");
  const privateService =
    /\b(email|emails|gmail|inbox)\b|\b(?:my|our|private)\s+(?:github|repositories|repository|repo)\b/i.test(
      query,
    );
  if (privateService && !explicitWeb) addons.delete("web"); // Explicit public research remains available in mixed requests.
  const casual =
    /^(hi|hello|hey|thanks|thank you|good morning|good night|how are you|how is it going)[!?,.\s]*$/i.test(
      request,
    );
  const simple =
    addons.size > 0 || categories.length > 0 || casual || privateService;
  return {
    request,
    query,
    projectNames,
    categories,
    addons,
    simple,
    privateService,
    followup,
    knownProjects,
  };
}
export function retrieveMemory(memory, route, maxChars = 6000) {
  const query = words(route.query + " " + route.categories.join(" "));
  const ranked = memory
    .map((m, index) => {
      const tokens = words(m.text);
      let score = 0;
      for (const token of query) if (tokens.has(token)) score++;
      const profile =
        /\b(call me|my name|concise|communication|reply style|response style)\b|\b(prefer|preference)\b.*\b(replies|answers|responses|explanations|tone|language)\b/i.test(
          m.text,
        );
      const scoped = (
        route.knownProjects ||
        PROJECT_NAMES.map((name) => ({
          name,
          aliases: [name, name.replace(/ Studio$/i, "")],
        }))
      ).filter((p) => p.aliases.some((alias) => containsName(m.text, alias)));
      if (
        scoped.length &&
        !scoped.some((p) => route.projectNames.includes(p.name))
      )
        score = 0;
      else if (profile && !scoped.length) score += 0.5;
      return {
        m,
        score,
        index,
        time: Date.parse(m.updatedAt || m.createdAt) || 0,
      };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || b.time - a.time || b.index - a.index);
  const selected = [];
  let size = 2;
  for (const { m } of ranked) {
    const item = {
        id: m.id,
        text: m.text,
        ...(m.updatedAt || m.createdAt
          ? { updatedAt: m.updatedAt || m.createdAt }
          : {}),
      },
      cost = JSON.stringify(item).length + (selected.length ? 1 : 0);
    if (size + cost > maxChars) continue;
    selected.push(item);
    size += cost;
    if (selected.length === 12) break;
  }
  return selected;
}
export function selectProjects(projects, route, maxChars = 12000) {
  let size = 0;
  return projects
    .filter((p) => route.projectNames.includes(p.name))
    .filter((p) => {
      const length = JSON.stringify(p).length;
      if (size + length > maxChars) return false;
      size += length;
      return true;
    });
}
export function budgetHistory(messages, maxChars = 48000) {
  // Preserve whole recent exchanges. Retrieve matching older turns as labelled excerpts.
  let start = messages.length,
    size = 0;
  while (start > 0) {
    let next = start - 1;
    while (next > 0 && messages[next].role !== "user") next--;
    const cost = messages
      .slice(next, start)
      .reduce((n, m) => n + m.content.length, 0);
    if (size + cost > maxChars && start < messages.length) break;
    size += cost;
    start = next;
  }
  const recent = messages
    .slice(start)
    .map(({ role, content }) => ({ role, content }));
  const query = words(messages.at(-1)?.content || "");
  let remaining = 6000;
  const older = messages
    .slice(0, start)
    .map((m, i) => ({ m, i }))
    .filter(
      ({ m }) =>
        m.role === "user" && [...words(m.content)].some((w) => query.has(w)),
    )
    .slice(-3)
    .map(({ m, i }) => {
      const reply =
        messages[i + 1]?.role === "assistant" ? messages[i + 1].content : "";
      const text =
        "User: " +
        m.content.slice(0, 1000) +
        "\nAssistant: " +
        reply.slice(0, 1000);
      const excerpt = text.slice(0, remaining);
      remaining -= excerpt.length;
      return excerpt;
    });
  return { messages: recent, older, omitted: start };
}

export function serializeToolResult(value, maxChars = 16000) {
  const text = JSON.stringify(value);
  if (text.length <= maxChars) return text;
  const envelope = (preview) =>
    JSON.stringify({
      truncated: true,
      note: "Excerpt only; do not infer omitted details.",
      preview,
    });
  let low = 0,
    high = Math.min(text.length, maxChars);
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (envelope(text.slice(0, mid)).length <= maxChars) low = mid;
    else high = mid - 1;
  }
  return envelope(text.slice(0, low));
}
