# Security and deployment boundaries

This release is a single-user local application. Each installation has its own host identity and credential directory. Users sign in with their own ChatGPT account; no publisher account is shipped or required.

## Supported deployment

Run the Node server on your own computer with its default loopback binding. Keep `.local/`, `.env`, downloaded models, logs and dependency folders out of public source archives. Do not copy a signed-in runtime to another user or host.

## Public hosting

Do not host this backend as a multi-user public service. The active account, OAuth pending attempt and credential store are global to the process. Host/Origin checks protect a local application; they are not visitor authentication or per-user isolation. Changing the bind address or proxying it publicly does not create those protections.

A public website can safely present a static demonstration, documentation and a source download. Real sign-in and inference must run on each user's local installation in this release.

A fully hosted product needs a separate supported OpenAI integration for remote hosting, per-visitor sessions, server-side ownership checks, isolated and encrypted credential records, HTTPS callback handling, secure cookies, account deletion, abuse/rate controls, and a hosted-compatible speech architecture. Sign-in for identity alone does not automatically grant subscription inference.

Never send security reports containing tokens or credential files. Disconnect the app in ChatGPT Settings if a renewable session is exposed.

Official scope: https://developers.openai.com/siwc/token-sharing-open-source
