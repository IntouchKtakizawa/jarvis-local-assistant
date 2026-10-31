import test from "node:test";
import assert from "node:assert/strict";
import { ChatGPTProvider } from "../server/chatgpt.js";
const auth = { accessToken: async () => "test-oauth-token" };
function stream(events, { truncate = false } = {}) {
  const b = new TextEncoder().encode(
    events.map((e) => "data: " + JSON.stringify(e) + "\r\n\r\n").join("") +
      (truncate ? 'data: {"type":"response.completed"}' : ""),
  );
  return new Response(
    new ReadableStream({
      start(c) {
        for (let i = 0; i < b.length; i += 7) c.enqueue(b.slice(i, i + 7));
        c.close();
      },
    }),
  );
}
test("uses OAuth on official Responses route with allowed plan fields and full context", async () => {
  const p = new ChatGPTProvider(auth, {
    fetcher: async (url, options) => {
      assert.equal(url, "https://api.openai.com/v1/responses");
      assert.equal(options.headers.Authorization, "Bearer test-oauth-token");
      const body = JSON.parse(options.body);
      assert.equal(body.store, false);
      assert.equal(body.stream, true);
      assert.equal(body.model, "account-model");
      assert.deepEqual(body.input, [{ role: "user", content: "Hello" }]);
      assert.ok(body.instructions);
      assert.equal(body.tools, undefined);
      assert.equal(body.temperature, undefined);
      return stream([
        { type: "response.output_text.delta", delta: "Hello ✳" },
        {
          type: "response.completed",
          response: { usage: { output_tokens: 3 } },
        },
      ]);
    },
  });
  const result = [];
  for await (const item of p.chat(
    [{ role: "user", content: "Hello" }],
    "account-model",
  ))
    result.push(item);
  assert.deepEqual(result, [
    { type: "token", content: "Hello ✳" },
    { type: "done", tokens: 3 },
  ]);
});
test("only account-specific visible models appear in the picker", async () => {
  const p = new ChatGPTProvider(auth, {
    fetcher: async () =>
      Response.json({
        models: [
          { slug: "a", display_name: "Model A", visibility: "list" },
          { slug: "b", visibility: "hidden" },
        ],
      }),
  });
  assert.deepEqual(await p.models(), [{ id: "a", name: "Model A" }]);
});
test("partial streams and failure after text never become successful replies", async () => {
  for (const ending of [
    [],
    [
      {
        type: "response.failed",
        response: {
          error: { code: "subscription_sharing_usage_limit_exceeded" },
        },
      },
    ],
    [{ type: "response.incomplete" }],
  ]) {
    const p = new ChatGPTProvider(auth, {
      fetcher: async () =>
        stream([
          { type: "response.output_text.delta", delta: "Partial" },
          ...ending,
        ]),
    });
    await assert.rejects(async () => {
      for await (const item of p.chat(
        [{ role: "user", content: "hello" }],
        "model",
      )) {
      }
    }, /completion|limit|incomplete/);
  }
});
test("401 refreshes once, while policy and usage failures never switch billing paths", async () => {
  let calls = 0,
    forced = 0;
  const p = new ChatGPTProvider(
    {
      accessToken: async (force) => {
        if (force) forced++;
        return "token";
      },
    },
    {
      fetcher: async () => {
        calls++;
        return calls === 1
          ? new Response("{}", { status: 401 })
          : stream([{ type: "response.completed" }]);
      },
    },
  );
  for await (const item of p.chat(
    [{ role: "user", content: "Hello" }],
    "model",
  )) {
  }
  assert.equal(calls, 2);
  assert.equal(forced, 1);
  const denied = new ChatGPTProvider(auth, {
    fetcher: async () =>
      Response.json(
        { error: { code: "subscription_sharing_user_not_eligible" } },
        { status: 403, headers: { "x-request-id": "test-request" } },
      ),
  });
  await assert.rejects(
    denied.models(),
    (e) =>
      e.status === 403 &&
      e.code === "subscription_sharing_user_not_eligible" &&
      e.requestId === "test-request",
  );
});
test("aborted request signal is forwarded to the remote request", async () => {
  const c = new AbortController();
  c.abort();
  const p = new ChatGPTProvider(auth, {
    fetcher: async (url, options) => {
      options.signal.throwIfAborted();
    },
  });
  await assert.rejects(
    async () => {
      for await (const item of p.chat(
        [{ role: "user", content: "Hello" }],
        "model",
        c.signal,
      )) {
      }
    },
    { name: "AbortError" },
  );
});
