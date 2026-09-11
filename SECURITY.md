# Security

## What this app is

Wallet Tracker is **read-only by design**. It reads public blockchain data about addresses you give it and stores what it reads. It has no code path that signs or broadcasts a transaction, and no field for a private key or seed phrase anywhere in the interface, the configuration, or the database.

That is the security model. If a version of this app ever asks for a private key or a seed phrase, it is not this software. There is no roadmap item that changes this: transaction features, if they ever exist, will live in a separate project so that this one stays something a stranger can run without trusting anyone.

## What is in scope

We want to hear about:

- Any way to make the app sign, send, or spend anything.
- Any way to read the dashboard without the `DASH_USER` / `DASH_PASS` login, including through the manifest and icon exemptions in the middleware.
- Any way for a token, an RPC response, or a price API response to inject content into the page or the database.
- Secrets or addresses leaking into logs, error messages, CSV exports, or the demo mode.
- Dependency vulnerabilities that are actually reachable from this app.

Out of scope: the accuracy of third-party prices and balances (they are labeled as best-effort and every chain has a fallback), and the strength of a weak password you chose for `DASH_PASS`.

## Reporting

Email **Gunnar@TofteVenturesLLC.com** with "wallet tracker security" in the subject. Include what you found, how to reproduce it, and what you think the impact is. You will get a reply within a few days, and credit in the fix's release notes if you want it.

Please do not open a public issue for something exploitable until a fix is out.

## Keeping your own deployment safe

- Set `DASH_USER` and `DASH_PASS` **before** the first deploy. An app deployed without them refuses every request, which is the safe failure, but there is no reason to have that window at all.
- Use a long random password. The login is a single shared credential meant to keep a personal dashboard private, not to serve multiple users.
- Keep wallet addresses in `.env.local` and your host's environment variables, never in a commit. Addresses are public data, but publishing them ties them to your name permanently.
- Leave `DEMO_MODE` unset in production.
- Treat any token the app flags as untrustworthy, and never visit a website named inside a token you did not buy.
