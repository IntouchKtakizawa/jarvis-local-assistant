import { marked } from "/vendor/marked.js";
import DOMPurify from "/vendor/purify.js";
marked.use({
  gfm: true,
  breaks: true,
  renderer: {
    html() {
      return "";
    },
  },
});
const imageHosts = new Set([
  "upload.wikimedia.org",
  "thumb.wikimedia.org",
  "commons.wikimedia.org",
]);
export function renderMessage(container, text) {
  const clean = DOMPurify.sanitize(marked.parse(text), {
    USE_PROFILES: { html: true },
    FORBID_TAGS: [
      "style",
      "iframe",
      "form",
      "input",
      "button",
      "video",
      "audio",
    ],
    FORBID_ATTR: ["style", "srcset", "id", "name"],
  });
  const template = document.createElement("template");
  template.innerHTML = clean;
  for (const a of template.content.querySelectorAll("a")) {
    try {
      const u = new URL(a.getAttribute("href"));
      if (!["https:", "http:", "mailto:"].includes(u.protocol)) throw Error();
      a.target = "_blank";
      a.rel = "noopener noreferrer";
    } catch {
      a.removeAttribute("href");
    }
  }
  for (const img of template.content.querySelectorAll("img")) {
    try {
      const u = new URL(img.getAttribute("src"));
      if (
        u.protocol !== "https:" ||
        !imageHosts.has(u.hostname) ||
        u.username ||
        u.password
      )
        throw Error();
      img.loading = "lazy";
      img.referrerPolicy = "no-referrer";
      img.classList.add("answer-image");
      img.addEventListener(
        "error",
        () => {
          const note = document.createElement("span");
          note.className = "image-load-note";
          note.textContent = "Image unavailable. Try the Find images button.";
          img.replaceWith(note);
        },
        { once: true },
      );
    } catch {
      const label = document.createElement("span");
      label.textContent = img.alt || "Image";
      img.replaceWith(label);
    }
  }
  for (const table of template.content.querySelectorAll("table")) {
    const wrap = document.createElement("div");
    wrap.className = "answer-table-scroll";
    table.replaceWith(wrap);
    wrap.append(table);
  }
  container.classList.add("rendered-answer");
  container.replaceChildren(template.content);
}
