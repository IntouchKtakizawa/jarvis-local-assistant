import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
export const ttsProvider =
  process.env.TTS_PROVIDER ||
  (process.platform === "darwin" ? "macos" : "none");
function run(command, args, input, signal) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { signal, timeout: 45000 });
    let error = "";
    child.stderr.on("data", (c) => (error += c.toString().slice(0, 1000)));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(error || `${command} exited ${code}`)),
    );
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}
export async function voiceStatus() {
  if (ttsProvider === "macos" && process.platform === "darwin") return true;
  if (ttsProvider === "piper" && process.env.PIPER_MODEL) {
    try {
      await access(process.env.PIPER_MODEL);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}
export async function speak(text, signal) {
  const dir = await mkdtemp(join(tmpdir(), "kenta-voice-"));
  const file = join(dir, "speech.wav");
  try {
    if (ttsProvider === "macos" && process.platform === "darwin")
      await run(
        "/usr/bin/say",
        [
          "-v",
          process.env.MACOS_VOICE || "Daniel",
          "-r",
          "170",
          "--file-format=WAVE",
          "--data-format=LEI16@22050",
          "-o",
          file,
          "-f",
          "-",
        ],
        text,
        signal,
      );
    else if (ttsProvider === "piper" && process.env.PIPER_MODEL)
      await run(
        process.env.PIPER_BIN || "piper",
        ["--model", process.env.PIPER_MODEL, "--output_file", file],
        text,
        signal,
      );
    else throw new Error("Local TTS is not configured. See README.");
    return await readFile(file);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
export async function transcribe(wav, url, signal) {
  const form = new FormData();
  form.append("file", new Blob([wav], { type: "audio/wav" }), "recording.wav");
  form.append("response_format", "json");
  const response = await fetch(`${url}/inference`, {
    method: "POST",
    body: form,
    signal,
  });
  if (!response.ok)
    throw new Error(
      `Whisper ${response.status}: ${(await response.text()).slice(0, 200)}`,
    );
  const data = await response.json();
  return data.text?.trim() || "";
}
