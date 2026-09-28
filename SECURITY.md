# Security policy

Pay Period Budget is a personal budgeting app with a single user: its owner. This document records how it protects that user's data and what to do if something goes wrong. Review it every few months and whenever the app gains a new outside service.

## Scope

- **Web app:** static files on GitHub Pages (`https://gavynrm5.github.io/budget/`).
- **Data:** Google Firebase (Authentication and Cloud Firestore), project `my-budget-ff7ca`.
- **Bank sync:** Cloudflare Worker `budget-bank-sync` (`bank-sync/`), which talks to Plaid.
- **Optional services:** Twelve Data (stock prices) and Anthropic (AI spending tips), each with the owner's own API key.

## Data handled

The owner's own budget entries, transactions, account nicknames and balances, wishlist items, stock trades, and (through Plaid) bank transactions and balances. No other person's data is collected. Account and card numbers and bank names are never stored; accounts are kept by nickname only.

## Access control

- **Sign-in:** Google Sign-In. The owner's Google account must have 2-step verification turned on.
- **Database:** Firestore security rules (`firestore.rules`) allow reads and writes only under `users/{uid}` and only for the owner's user id. Everything else is denied.
- **Bank sync worker:** every request must carry a Google-signed Firebase ID token for the owner's user id (checked for signature, issuer, audience, and expiry) and come from the app's own origin. Anything else is refused.
- **Admin consoles:** Google Cloud/Firebase, Cloudflare, Plaid, GitHub, and Anthropic accounts are used only by the owner and must each have a unique password and 2-step verification.
- **Least privilege:** Plaid access is read-only (Transactions only). Nothing in the app can move money.

## Secrets

- The Plaid client id and secret and the token encryption key are Cloudflare Worker secrets. They are never in source code, the browser, or backup files.
- Plaid access tokens are encrypted with AES-256-GCM before being stored in Workers KV.
- The Twelve Data and Anthropic keys are stored in the owner's Firestore data (readable only by the owner) and are left out of backup files.
- The Firebase web config in `src/config/firebase.ts` is public by design. Data is protected by the security rules, not by hiding it. The browser API key should be restricted to the app's own addresses in Google Cloud (see below).
- Before each commit, check that no secret is included; secrets must never land in the repo's history.

## Encryption

- **In transit:** HTTPS everywhere. The site and the bank sync worker use TLS 1.3; the worker refuses TLS 1.0 and 1.1. Plaid and Firebase connections use TLS 1.2 or higher.
- **At rest:** Firestore and Workers KV are encrypted at rest by Google and Cloudflare. Plaid tokens are additionally encrypted by the worker.

## Changes and testing

Changes go through a pull request with automated tests (`npm test`, and `npm test` in `bank-sync/`) and a production build, and are deployed only after merging. Dependencies are updated periodically.

## If something goes wrong

| Situation | What to do |
| --- | --- |
| Plaid secret may be exposed | Rotate it in the Plaid dashboard (Developers > Keys), then `npx wrangler secret put PLAID_SECRET` in `bank-sync/`. |
| Bank connection misused or a device lost | Disconnect it in the app (Accounts > Bank sync), which deletes it at Plaid. Change the bank password. |
| Anthropic or Twelve Data key exposed | Delete the key in that service's console, create a new one, and paste it into the app. |
| Token encryption key exposed | Put a new `TOKEN_KEY`, then disconnect and reconnect each bank (old tokens can't be read with the new key). |
| Google account compromised | Secure the account (password, 2-step verification, sign out other sessions), then review Firestore data and bank connections. |
| Unexpected Plaid charges | Check Billing / Usage in the Plaid dashboard against the connections listed in the app. |

## Browser API key restriction

In Google Cloud Console, go to **APIs & Services > Credentials**, open the Browser key for this project, and under **Application restrictions** choose **Websites** with:

- `https://gavynrm5.github.io/*`
- `https://my-budget-ff7ca.firebaseapp.com/*` (used by Google sign-in)
- `http://localhost:5173/*` (local development)

## Contact

Security contact: the owner (see the Plaid dashboard for the current address).
