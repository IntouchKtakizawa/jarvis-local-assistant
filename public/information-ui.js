const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};
function citation(source, text = "") {
  return source && !text.includes(`[${source}]`) ? ` [${source}]` : "";
}
export function renderInformation(info, reply) {
  const card = el("section", "information-card");
  card.setAttribute("aria-label", info.title);
  reply.el.classList.add("has-info-card");
  const hero = el("div", "info-hero"),
    copy = el("div", "info-intro");
  copy.append(
    el("div", "visual-eyebrow", info.subtitle || "QUICK OVERVIEW"),
    el("h3", "", info.title),
    el("p", "info-summary", info.summary),
  );
  hero.append(copy);
  const image = info.image;
  try {
    if (
      image?.url &&
      ["upload.wikimedia.org", "thumb.wikimedia.org"].includes(
        new URL(image.url).hostname,
      ) &&
      new URL(image.url).protocol === "https:"
    ) {
      const figure = el("figure", "info-image"),
        img = el("img");
      img.src = image.url;
      img.alt = image.alt || info.title;
      img.referrerPolicy = "no-referrer";
      img.loading = "lazy";
      img.addEventListener("error", () => figure.remove(), { once: true });
      figure.append(img);
      if (
        image.creditURL &&
        new URL(image.creditURL).hostname === "commons.wikimedia.org"
      ) {
        const a = el(
          "a",
          "",
          ` ${image.artist || "Image"} · ${image.license || "Source"} ↗`.trim(),
        );
        a.href = image.creditURL;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        figure.append(a);
      }
      hero.append(figure);
    }
  } catch {}
  card.append(hero);
  if (info.facts.length) {
    const grid = el("div", "info-facts");
    for (const f of info.facts) {
      const fact = el("div");
      fact.append(
        el("span", "", f.label),
        el("strong", "", f.value + citation(f.source, f.value)),
      );
      grid.append(fact);
    }
    card.append(grid);
  }
  if (info.chart) {
    const chart = el("div", "info-chart");
    chart.append(el("h4", "", info.chart.title));
    const max = Math.max(...info.chart.points.map((p) => p.value), 1);
    for (const p of info.chart.points) {
      const row = el("div", "info-chart-row"),
        label = el("span", "", p.label),
        bar = el("meter");
      bar.min = 0;
      bar.max = max;
      bar.value = p.value;
      bar.setAttribute(
        "aria-label",
        `${p.label}: ${p.value} ${info.chart.unit}`,
      );
      row.append(
        label,
        bar,
        el(
          "strong",
          "",
          p.value.toLocaleString() + " " + info.chart.unit + citation(p.source),
        ),
      );
      chart.append(row);
    }
    card.append(chart);
  }
  const sections = el("div", "info-sections");
  for (const s of info.sections) {
    const section = el("section");
    section.append(
      el("h4", "", s.heading),
      el("p", "", s.text + citation(s.source, s.text)),
    );
    sections.append(section);
  }
  card.append(sections);
  reply.el.insertBefore(card, reply.content);
}
