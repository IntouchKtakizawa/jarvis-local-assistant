# Publication layout

This repository contains the personal local application and a static public demo in `website/`.

Each user runs their own backend and signs in with their own ChatGPT account. This repository contains no saved account records, OAuth credentials, `.env`, local host ID, or downloaded model binaries. Runtime files remain ignored and must not be published.

The `website/` directory is a static demo and download/setup guide. Its example replies are scripted and labelled. It makes no AI requests, asks for no credentials or microphone permission, and has no account backend. The site is hosted separately from the local application.

Do not publicly host `server/index.js`. See SECURITY.md.
