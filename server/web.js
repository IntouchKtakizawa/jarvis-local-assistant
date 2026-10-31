import https from "node:https";
import { lookup } from "node:dns/promises";
import { isIP, BlockList } from "node:net";

const blocked = new BlockList();
for (const [ip, bits] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
])
  blocked.addSubnet(ip, bits, "ipv4");
for (const [ip, bits] of [
  ["::", 128],
  ["::1", 128],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
  ["2001:db8::", 32],
  ["2001::", 32],
  ["2002::", 16],
  ["64:ff9b::", 96],
])
  blocked.addSubnet(ip, bits, "ipv6");
export function publicAddress(address) {
  const family = isIP(address);
  if (!family) return false;
  return !blocked.check(address, family === 4 ? "ipv4" : "ipv6");
}
export function publicURL(value) {
  try {
    const u = new URL(value);
    const h = u.hostname.toLowerCase();
    if (
      u.protocol !== "https:" ||
      u.username ||
      u.password ||
      (u.port && u.port !== "443") ||
      !h.includes(".") ||
      h.endsWith(".") ||
      h.endsWith(".localhost") ||
      h.endsWith(".local") ||
      h.endsWith(".internal") ||
      isIP(h) ||
      h.includes(":") ||
      h.startsWith("[")
    )
      return null;
    u.hash = "";
    return u.href;
  } catch {
    return null;
  }
}
const entities = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};
export function decode(s) {
  return s.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (m, v) => {
    if (v[0] !== "#") return entities[v.toLowerCase()] || m;
    const n =
      v[1].toLowerCase() === "x"
        ? parseInt(v.slice(2), 16)
        : Number(v.slice(1));
    return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "";
  });
}
export function textOnly(html) {
  return decode(
    html
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(
        /<(script|style|noscript|svg|nav|header|footer|form|aside)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,
        " ",
      )
      .replace(/<[^>]*>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}
// Each connection is pinned to a validated public DNS address; redirects repeat validation.
export async function publicFetch(
  value,
  signal,
  redirects = 0,
  acceptJSON = false,
) {
  const safe = publicURL(value);
  if (!safe) throw new Error("Use a public HTTPS web page.");
  const u = new URL(safe);
  const addresses = await lookup(u.hostname, { all: true });
  signal?.throwIfAborted();
  if (!addresses.length || addresses.some((a) => !publicAddress(a.address)))
    throw new Error("Only public internet pages can be read.");
  const address = addresses.find((a) => a.family === 4) || addresses[0];
  return new Promise((resolve, reject) => {
    const request = https.get(
      u,
      {
        signal,
        autoSelectFamily: false,
        family: address.family,
        lookup: (_host, _opts, cb) => cb(null, address.address, address.family),
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; JarvisAssistant/0.4; public page reader)",
          Accept: acceptJSON
            ? "application/json"
            : "text/html,application/xhtml+xml,text/plain;q=0.9",
        },
      },
      (response) => {
        if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
          response.resume();
          if (redirects >= 3 || !response.headers.location)
            return reject(new Error("Too many page redirects."));
          let next;
          try {
            next = new URL(response.headers.location, u).href;
          } catch {
            return reject(new Error("Invalid page redirect."));
          }
          return resolve(publicFetch(next, signal, redirects + 1, acceptJSON));
        }
        if (response.statusCode !== 200) {
          response.resume();
          return reject(new Error(`Website returned ${response.statusCode}.`));
        }
        if (
          !(
            acceptJSON &&
            /^application\/(?:[\w.-]+\+)?json\b/i.test(
              response.headers["content-type"] || "",
            )
          ) &&
          !/^(text\/(html|plain)|application\/xhtml\+xml)\b/i.test(
            response.headers["content-type"] || "",
          )
        ) {
          response.resume();
          return reject(new Error("This page is not readable text or HTML."));
        }
        let size = 0;
        const chunks = [];
        response.on("data", (chunk) => {
          size += chunk.length;
          if (size > 1_500_000) {
            response.destroy(new Error("Page is too large to read."));
            return;
          }
          chunks.push(chunk);
        });
        response.on("error", reject);
        response.on("end", () =>
          resolve({
            url: u.href,
            html: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );
    request.setTimeout(9000, () =>
      request.destroy(new Error("Website timed out.")),
    );
    request.on("error", reject);
  });
}
export function searchResults(html) {
  const links = [
    ...html.matchAll(
      /<a\b[^>]*class=["'][^"']*\bresult__a\b[^"']*["'][^>]*>[\s\S]*?<\/a>/gi,
    ),
  ];
  const seen = new Set(),
    results = [];
  for (let i = 0; i < links.length && results.length < 5; i++) {
    const tag = links[i][0],
      href = tag.match(/\bhref=["']([^"']*)["']/i)?.[1];
    if (!href) continue;
    let url;
    try {
      const target = new URL(decode(href), "https://duckduckgo.com");
      url = publicURL(target.searchParams.get("uddg") || target.href);
    } catch {
      continue;
    }
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const block = html.slice(
      links[i].index + tag.length,
      links[i + 1]?.index ?? html.length,
    );
    const snippet =
      block.match(
        /<(?:a|div|span)\b[^>]*class=["'][^"']*\bresult__snippet\b[^"']*["'][^>]*>([\s\S]*?)<\/(?:a|div|span)>/i,
      )?.[1] || "";
    results.push({
      title: textOnly(tag).slice(0, 220),
      url,
      extract: textOnly(snippet).slice(0, 1100),
      kind: "web",
      read: false,
    });
  }
  return results;
}
export function webQuery(text) {
  if (typeof text !== "string") return null;
  const s = text.trim();
  if (!s || s.length > 2000) return null;
  const urls = s.match(/https:\/\/[^\s<>"']+/g);
  if (urls)
    return { url: urls[0].replace(/[),.!?;]+$/, ""), query: s.slice(0, 300) };
  const explicit =
    /\b(search (?:the )?(?:web|internet)|search for|look up|look online|browse|google|check online|find online)\b/i.test(
      s,
    );
  if (
    !explicit &&
    /\b(my|our|password|secret|token|email|symptoms|diagnosis|bank|account|relationship)\b|[\w.+-]+@[\w.-]+/i.test(
      s,
    )
  )
    return null;
  if (
    !explicit &&
    !/\b(latest|current|currently|today|tomorrow|news|weather|price|recent|this week|right now|who|what|when|where|how|tell me about|explain)\b/i.test(
      s,
    )
  )
    return null;
  const q = s
    .replace(
      /^(?:please\s+)?(?:search (?:the )?(?:web|internet)(?: for)?|search for|look up|google|check online|find online)\s*:?\s*/i,
      "",
    )
    .slice(0, 300);
  return { query: q };
}
export class WebProvider {
  constructor({ fetcher = publicFetch, now = Date.now } = {}) {
    this.fetch = fetcher;
    this.now = now;
    this.requests = [];
  }
  async read(url, signal) {
    const page = await this.fetch(url, signal);
    const title = textOnly(
      page.html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ||
        new URL(page.url).hostname,
    ).slice(0, 220);
    const main =
      page.html.match(
        /<(?:main|article)\b[^>]*>([\s\S]*?)<\/(?:main|article)>/i,
      )?.[1] || page.html;
    const extract = textOnly(main).slice(0, 10000);
    if (extract.length < 80)
      throw new Error("This page has too little readable text.");
    return {
      title,
      url: page.url,
      extract,
      kind: "web",
      read: true,
      retrievedAt: new Date(this.now()).toISOString(),
    };
  }
  async lookup(input, signal) {
    this.requests = this.requests.filter((t) => t > this.now() - 60000);
    if (this.requests.length >= 15)
      throw new Error("Web search is cooling down. Try again in a minute.");
    this.requests.push(this.now());
    const bounded = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(20000)])
      : AbortSignal.timeout(20000);
    if (input.url)
      return {
        query: input.url,
        references: [await this.read(input.url, bounded)],
      };
    const url = new URL("https://html.duckduckgo.com/html/");
    url.searchParams.set("q", input.query);
    const page = await this.fetch(url.href, bounded);
    let references = searchResults(page.html);
    if (!references.length)
      throw new Error(
        "Search returned no readable results. Try a different query or paste a public page URL.",
      );
    const reads = await Promise.allSettled(
      references
        .slice(0, 3)
        .map((r) =>
          this.read(
            r.url,
            AbortSignal.any([bounded, AbortSignal.timeout(8000)]),
          ),
        ),
    );
    references = references.map((r, i) =>
      reads[i]?.status === "fulfilled"
        ? reads[i].value
        : { ...r, retrievedAt: new Date(this.now()).toISOString() },
    );
    return { query: input.query, references };
  }
}
