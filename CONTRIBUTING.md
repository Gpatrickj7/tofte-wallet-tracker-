# Contributing

Thanks for looking. This is a small project with a clear boundary, so contributing is mostly about respecting that boundary.

## The one rule

**The app stays read-only.** Pull requests that add signing, sending, swapping on-chain, or any place to enter a private key or seed phrase will be closed, however well written. See [SECURITY.md](SECURITY.md) for why.

## What is welcome

- New chains, as long as they follow the existing pattern: public RPC or explorer, more than one provider, a fallback when one fails.
- New mining pools.
- Chart and accessibility improvements. Every chart must keep its hover readout, keyboard focus, and table view.
- Ledger accounting fixes, with a unit test that shows the old behavior was wrong.
- Documentation. If something in the README confused you, that is a bug.

## Before you open a pull request

```bash
npm ci
npx tsc --noEmit
npm test
DASH_USER=x DASH_PASS=x npm run build
```

All three must pass. CI runs the same commands.

Ledger math lives in `lib/ledger.ts`, which imports nothing, and is tested in `test/`. If you touch it, add or change a test in the same pull request.

## Style

Match what is there. Short files, comments that explain *why* rather than *what*, no new dependencies without a reason stated in the pull request. The chart module has a marks spec at the top of `lib/charts.tsx`; new charts follow it.

## Never commit

Wallet addresses, connection strings, passwords, or `.env.local`. The `.gitignore` covers the usual cases; `git add -f` is on you.
