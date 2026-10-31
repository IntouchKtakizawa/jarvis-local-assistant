export function mapRequest(messages) {
  const text = messages.at(-1)?.content?.trim() || "";
  if (
    /\b(?:code|source map|javascript|mind map|map function|array)\b/i.test(text)
  )
    return null;
  const recent = messages
    .slice(0, -1)
    .filter((m) => m.role === "user")
    .reverse()
    .find((m) => /\bmap\b/i.test(m.content));
  let location = text.match(
    /\bmap(?:\s+(?:of|for))?\s+(.+?)(?=\s+(?:please|with|and|as a|in a)\b|[?!]|$)/i,
  )?.[1];
  if (!location)
    location = text.match(
      /\b(?:show|find|locate)\s+(?:me\s+)?(.+?)\s+on (?:a |the )?map\b/i,
    )?.[1];
  if (
    !location &&
    recent &&
    /\b(?:picture|image|visual|interactive|actual)\b/i.test(text)
  )
    location = mapRequest([{ role: "user", content: recent.content }])?.query;
  if (!location || /^(?:please|up|it|this|a map|the map)$/i.test(location))
    return null;
  return {
    query: location
      .trim()
      .replace(/[.,]+$/, "")
      .slice(0, 160),
  };
}
function dateInZone(timeZone, now) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(now)
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}`;
}
export function plannerRequest(
  messages,
  timeZone = "Asia/Bangkok",
  now = new Date(),
) {
  const text = messages.at(-1)?.content || "";
  const recent = messages
    .slice(0, -1)
    .filter((m) => m.role === "user")
    .reverse()
    .find((m) => /\b(calendar|schedule|planner|agenda)\b/i.test(m.content));
  if (
    !/\b(calendar|schedule|planner|agenda|week view|seven.day view|7.day view|next (?:7|seven) days)\b/i.test(
      text,
    ) &&
    !(
      recent &&
      /^(?:show |make |for |the |next |a )*(?:7|seven) days[?!. ]*$/i.test(
        text.trim(),
      )
    )
  )
    return null;
  if (
    /\b(?:code|implement|api|poem|history of|what is|explain|write a)\b/i.test(
      text,
    )
  )
    return null;
  try {
    new Intl.DateTimeFormat("en", { timeZone }).format(now);
  } catch {
    timeZone = "Asia/Bangkok";
  }
  const today = dateInZone(timeZone, now);
  let startDate = today;
  if (/\btomorrow\b/i.test(text)) {
    const d = new Date(startDate + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() + 1);
    startDate = d.toISOString().slice(0, 10);
  }
  return { startDate, today, timeZone, days: 7, mode: "local", synced: false };
}
export class MapProvider {
  constructor({ fetcher = fetch, now = Date.now } = {}) {
    this.fetch = fetcher;
    this.now = now;
    this.cache = new Map();
    this.nextRequest = 0;
    this.queue = Promise.resolve();
  }
  async lookup(query, signal) {
    const key = query.toLowerCase().trim(),
      hit = this.cache.get(key);
    if (hit) return hit;
    const task = this.queue
      .catch(() => {})
      .then(async () => {
        signal?.throwIfAborted();
        const hit = this.cache.get(key);
        if (hit) return hit;
        const wait = Math.max(0, this.nextRequest - this.now());
        if (wait)
          await new Promise((resolve, reject) => {
            const timer = setTimeout(resolve, wait);
            signal?.addEventListener(
              "abort",
              () => {
                clearTimeout(timer);
                reject(signal.reason);
              },
              { once: true },
            );
          });
        this.nextRequest = this.now() + 1100;
        const url = new URL("https://nominatim.openstreetmap.org/search");
        url.search = new URLSearchParams({
          q: query,
          format: "jsonv2",
          limit: "1",
          "accept-language": "en",
        });
        const response = await this.fetch(url, {
          signal: signal
            ? AbortSignal.any([signal, AbortSignal.timeout(10000)])
            : AbortSignal.timeout(10000),
          redirect: "error",
          headers: {
            "User-Agent":
              "JarvisLocalAssistant/0.5 (https://github.com/IntouchKtakizawa/jarvis-local-assistant)",
            Accept: "application/json",
          },
        });
        if (!response.ok)
          throw new Error("Map lookup is unavailable. Please try again.");
        const place = (await response.json())?.[0];
        const lat = Number(place?.lat),
          lon = Number(place?.lon),
          bounds = place?.boundingbox?.map(Number);
        if (
          !place ||
          !Number.isFinite(lat) ||
          !Number.isFinite(lon) ||
          Math.abs(lat) > 90 ||
          Math.abs(lon) > 180 ||
          !bounds ||
          bounds.length !== 4 ||
          bounds.some((n) => !Number.isFinite(n))
        )
          throw new Error(
            `I couldn’t locate “${query}”. Try a city, country, or address.`,
          );
        const result = {
          title: place.name || query,
          description: String(place.display_name || query).slice(0, 450),
          lat,
          lon,
          bounds,
          source: `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=6/${lat}/${lon}`,
        };
        if (this.cache.size >= 100)
          this.cache.delete(this.cache.keys().next().value);
        this.cache.set(key, result);
        return result;
      });
    this.queue = task;
    return task;
  }
}
