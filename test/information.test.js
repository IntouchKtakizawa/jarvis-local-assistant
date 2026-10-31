import test from "node:test";
import assert from "node:assert/strict";
import {
  informationIntent,
  informationMessages,
  parseInformation,
} from "../server/information.js";
test("information questions request cards while writing and coding keep normal chat", () => {
  assert.equal(informationIntent("Tell me about Saturn"), true);
  assert.equal(informationIntent("Compare Earth and Mars"), true);
  assert.equal(informationIntent("Help me write a poem"), false);
  const messages = [{ role: "user", content: "Tell me about Saturn" }];
  assert.match(
    informationMessages(messages)[0].content,
    /Never invent numbers/,
  );
  assert.equal(messages[0].content, "Tell me about Saturn");
});
test("information cards accept only finite chart values with existing sources", () => {
  const info = parseInformation(
    JSON.stringify({
      title: "Planets",
      summary: "An overview",
      facts: [{ label: "Source test", value: "Value", source: 99 }],
      chart: {
        title: "Diameter",
        unit: "km",
        points: [
          { label: "Earth", value: 12742, source: 1 },
          { label: "Mars", value: 6779, source: 2 },
          { label: "Unknown", value: 123, source: 99 },
        ],
      },
    }),
    2,
  );
  assert.equal(info.chart.points.length, 2);
  assert.equal(info.facts[0].source, null);
  assert.equal(parseInformation("not json", 2), null);
  assert.equal(parseInformation('{"title":"No summary"}', 0), null);
});
