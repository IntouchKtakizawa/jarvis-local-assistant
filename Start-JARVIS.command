#!/bin/zsh
# Run the web UI; Ollama and Whisper should already be running (see README).
cd -- "$(dirname -- "$0")" || exit 1
if ! command -v node >/dev/null; then
  export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
fi
if ! command -v node >/dev/null; then
  echo 'Node.js is required. See README.md.'
  read -r '?Press Enter to close.'
  exit 1
fi
# Start the installed local recogniser if it is not already available.
if command -v whisper-server >/dev/null && [[ -f models/ggml-base.en.bin ]] && ! curl --silent --max-time 1 http://127.0.0.1:8080/ >/dev/null; then
  mkdir -p .local
  whisper-server --host 127.0.0.1 --port 8080 -m models/ggml-base.en.bin -l en > .local/whisper.log 2>&1 &
  jarvis_whisper_pid=$!
  trap 'kill "$jarvis_whisper_pid" 2>/dev/null' EXIT
fi
npm start
