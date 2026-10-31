// Parse the subject around an image noun instead of relying on a fixed command word order.
const imageNoun = /\b(?:images?|pictures?|photos?|pics|photographs?)\b/i;
const command =
  /^(?:pull|fetch|grab|bring|display|show|find|search|get|send|give|load|open|let me see)\b(?:\s+(?:me|us|up|for|some|a|an|the))*\s*/i;
const placeholder =
  /^(?:it|them|these|those|me|up|directly|inline|here|right here|some|more|in (?:the |this )?chat)$/i;
function tidy(value) {
  return value
    .replace(/^\s*(?:of|for|about|featuring|showing)\s+/i, "")
    .replace(
      /\s+(?:(?:directly|right)\s+)?(?:here|inline|on (?:the |this )?screen|in (?:the |this )?chat)[.!?]*$/i,
      "",
    )
    .replace(/(?:^|\s+)please[.!?]*$/i, "")
    .replace(/[.!?]+$/, "")
    .trim();
}
export function imageRequest(messages) {
  const text = messages.at(-1)?.content?.trim() || "";
  if (/\bmap\b/i.test(text)) return null;
  const clean = text
    .replace(
      /^(?:(?:hey|yo) (?:jarvis|there)[,.]?\s*)?(?:please\s+)?(?:(?:can|could|would|will) you\s+)?/i,
      "",
    )
    .replace(
      /^i(?:'d| would)? (?:like|want|need)(?: you)?(?: to)?(?: see)?\s+/i,
      "",
    );
  const noun = imageNoun.exec(clean);
  if (noun) {
    const prefix = clean.slice(0, noun.index).trim(),
      suffix = clean.slice(noun.index + noun[0].length).trim();
    const requested =
      !prefix ||
      command.test(prefix) ||
      /\b(?:see|want|need|fetch|pull|show|bring|display|find)\b/i.test(
        prefix,
      ) ||
      /^(?:are there|do you have|is there)/i.test(prefix) ||
      /^(?:some|a|an|the)$/i.test(prefix) ||
      (!suffix &&
        prefix.split(/\s+/).length <= 5 &&
        !/^(?:what|why|how|explain|describe|edit|create|generate|analy[sz]e|compare)\b/i.test(
          prefix,
        ));
    if (requested) {
      const subject =
        tidy(suffix) ||
        tidy(prefix.replace(command, "").replace(/^(?:some|a|an|the)\s+/i, ""));
      if (subject && subject.length <= 160 && !placeholder.test(subject))
        return { query: subject };
    }
  }
  const follow =
    /^(?:(?:can|could|would) you\s+)?(?:please\s+)?(?:pull|put|show|display|bring|open|fetch|load|give)(?:\s+(?:me|us|it|them|those|these|up|the (?:images|pictures|photos)|images|pictures|photos|some|more))*(?:\s+(?:directly|right|actually|inline|here|in (?:the |this )?chat|on (?:the |this )?screen|please))*[.!?]*$/i;
  if (follow.test(text)) {
    for (const m of messages
      .slice(0, -1)
      .filter((m) => m.role === "user")
      .slice(-4)
      .reverse()) {
      const request = imageRequest([m]);
      if (request) return request;
      if (/\b(map|calendar|weather)\b/i.test(m.content)) break;
    }
  }
  return null;
}
