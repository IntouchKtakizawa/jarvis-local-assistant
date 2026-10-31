const scenes = {
  plan: {
    prompt: "Help me plan a focused morning.",
    reply:
      "Of course. Choose one thing you would be pleased to finish by lunch. Give it a quiet 45 minutes, then take a proper break. What is that one thing?",
  },
  idea: {
    prompt: "I have an idea for a small creative project. Where do I begin?",
    reply:
      "Start with the smallest version that would make the idea tangible. One sketch, one scene, or one working screen. Tell me what you want someone to feel or do, and we can shape a first step.",
  },
  system: {
    prompt: "What can the installed assistant do?",
    reply:
      "Chat through your own ChatGPT plan, or use a local Ollama model. Transcribe your microphone locally, let you review the words, then read a reply aloud. This version does not control apps or remember conversations after a reload.",
  },
};
const $ = (s) => document.querySelector(s);
let timer;
for (let i = 0; i < 37; i++) {
  const bar = document.createElement("i");
  bar.style.setProperty("--height", `${4 + Math.sin(i * 0.72) ** 2 * 20}px`);
  $(".wave").append(bar);
}
document.querySelectorAll("[data-scene]").forEach((button) =>
  button.addEventListener("click", () => {
    clearInterval(timer);
    const scene = scenes[button.dataset.scene];
    document.querySelectorAll("[data-scene]").forEach((b) => {
      b.classList.toggle("selected", b === button);
      b.setAttribute("aria-pressed", String(b === button));
    });
    $("#demo-prompt").textContent = scene.prompt;
    $("#demo-reply").textContent = "";
    $("#demo-state").textContent = "PLAYING SCRIPTED PREVIEW";
    let at = 0;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      $("#demo-reply").textContent = scene.reply;
      $("#demo-state").textContent = "PREVIEW COMPLETE";
      return;
    }
    timer = setInterval(() => {
      at += 3;
      $("#demo-reply").textContent = scene.reply.slice(0, at);
      if (at >= scene.reply.length) {
        clearInterval(timer);
        $("#demo-state").textContent = "PREVIEW COMPLETE";
      }
    }, 18);
  }),
);
$("#copy").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText($("#commands").textContent);
    $("#copy-status").textContent =
      "Commands copied. Run these in your own terminal.";
  } catch {
    $("#copy-status").textContent =
      "Clipboard unavailable. Select and copy the commands above.";
  }
});
