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
npm start
