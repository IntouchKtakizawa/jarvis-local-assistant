import test from "node:test";
import assert from "node:assert/strict";
import {
  publicURL,
  publicAddress,
  publicFetch,
  searchResults,
  webQuery,
  textOnly,
  WebProvider,
} from "../server/web.js";
const html = `<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.nasa.gov%2Fnews%2F">NASA &amp; news</a><a class="result__snippet">Latest <b>space</b> news.</a><a class="result__a" href="http://127.0.0.1/private">Private</a>`;
test("web queries use only the current public question or a supplied URL", () => {
  assert.deepEqual(webQuery("Search the web for NASA news"), {
    query: "NASA news",
  });
  assert.deepEqual(webQuery("Read https://example.com/story."), {
    url: "https://example.com/story",
    query: "Read https://example.com/story.",
  });
  assert.equal(webQuery("What is my password?"), null);
  assert.equal(webQuery("Help me write a poem"), null);
  assert.ok(webQuery("What is the weather in Bangkok today?"));
});
test("page URL and address checks reject local networks and credential-bearing destinations", async () => {
  for (const url of [
    "http://example.com",
    "https://127.0.0.1",
    "https://[::1]/",
    "https://localhost",
    "https://router.local",
    "https://a.internal",
    "https://u:p@example.com",
    "https://example.com:8080/",
  ])
    assert.equal(publicURL(url), null, url);
  for (const ip of [
    "127.0.0.1",
    "10.0.0.1",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "::1",
    "::ffff:127.0.0.1",
    "fc00::1",
    "fe80::1",
  ])
    assert.equal(publicAddress(ip), false, ip);
  assert.equal(publicAddress("8.8.8.8"), true);
  assert.equal(publicAddress("2606:4700:4700::1111"), true);
  await assert.rejects(publicFetch("https://127.0.0.1"), /public HTTPS/);
});
test("search result parsing decodes redirect links and rejects unsafe links", () => {
  assert.deepEqual(searchResults(html), [
    {
      title: "NASA & news",
      url: "https://www.nasa.gov/news/",
      extract: "Latest space news.",
      kind: "web",
      read: false,
    },
  ]);
  assert.equal(
    textOnly("<script>steal()</script><main>Hello &amp; &#x1f30d;</main>"),
    "Hello & 🌍",
  );
});
test("web search enriches readable pages and marks blocked pages as snippets", async () => {
  const results =
    html +
    '<a class="result__a" href="https://example.com/blocked">Blocked site</a><a class="result__snippet">A useful summary.</a>';
  const calls = [];
  const p = new WebProvider({
    fetcher: async (url, signal) => {
      calls.push(url);
      signal.throwIfAborted();
      if (url.includes("duckduckgo.com")) return { url, html: results };
      if (url.includes("blocked")) throw new Error("403");
      return {
        url,
        html:
          "<title>NASA</title><nav>Navigation</nav><main>" +
          "Space science. ".repeat(20) +
          "</main>",
      };
    },
  });
  const r = await p.lookup({ query: "NASA news" });
  assert.equal(calls.length, 3);
  assert.equal(r.references[0].read, true);
  assert.equal(r.references[1].read, false);
  assert.equal(r.references[1].extract, "A useful summary.");
  assert.ok(!r.references[0].extract.includes("Navigation"));
  assert.ok(r.references[0].retrievedAt);
});
test("direct reading skips search; failures and cancellation stay visible", async () => {
  const p = new WebProvider({
    fetcher: async (url, signal) => {
      signal.throwIfAborted();
      return {
        url,
        html: "<main>" + "Example public text. ".repeat(20) + "</main>",
      };
    },
  });
  const r = await p.lookup({ url: "https://example.com/" });
  assert.equal(r.references.length, 1);
  assert.equal(r.references[0].read, true);
  const c = new AbortController();
  c.abort();
  await assert.rejects(p.lookup({ query: "test" }, c.signal), {
    name: "AbortError",
  });
  const empty = new WebProvider({
    fetcher: async (url) => ({ url, html: "Captcha" }),
  });
  await assert.rejects(empty.lookup({ query: "test" }), /no readable results/);
});
