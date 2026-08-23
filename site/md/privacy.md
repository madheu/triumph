<!-- Markdown variant of https://trytriumph.de5.net/privacy — request any page with Accept: text/markdown -->

*Legal · Triumph*

# Privacy policy.

Last updated: August 22, 2026

This policy explains what **Triumph** ("we", "the service", operated at trytriumph.de5.net) collects, why, how long it is kept, and how you can have it removed. The short version: we collect as little as possible, we don't sell anything, and deletion requests are honored within 30 days.

## What we collect

- **Account email address** — only if you create an account. Used for verification codes and essential service notices. We do not send marketing email.
- **Password hash** — passwords are hashed with PBKDF2-SHA256 (100,000 iterations, per-user salt) before storage. Plaintext passwords are never stored or logged.
- **Study state** — if you use cloud sync while signed in: your answers, mastery map, study plan, spaced-repetition data, and exam date. This exists so your progress follows you across devices.
- **API keys** — if you generate one via the developer API, we store a SHA-256 hash of the key plus its granted scopes and creation time. The plaintext key is shown once and never stored in readable form.
- **Analytics** — Google Analytics 4 (measurement ID G-MSR1Q1G7W9) and Cloudflare Web Analytics collect aggregate usage signals (page views, referrers, coarse geography). Cloudflare's security layer also processes request metadata (IP address, user agent) for abuse prevention.
- **Email delivery provider** — verification emails are sent through a third-party transactional email provider (Resend or Mailgun), which processes your address to deliver the message.

## What we never do

- We do not sell, rent, or trade personal data. There is no ad business here.
- We do not require an account to use the question bank, guides, diagnostic, or public API — anonymous use leaves nothing personal behind beyond standard analytics aggregates.
- We do not knowingly collect data from children under 13, and the product is intended for adult teacher candidates.

## Local storage & cookies

The app stores your session token, display email, and cached study progress in your browser's `localStorage`. Clearing site data in your browser removes all of it from your device. Google Analytics may set its own cookies as described in Google's privacy documentation.

## Data retention & deletion

Account records, study state, and API-key records persist until you ask us to delete them or delete your account. To delete everything associated with your email, write to **abc15531888397@gmail.com** with the subject "Privacy" from your account address; deletion completes within 30 days. Verification codes expire automatically after 15 minutes; hourly rate-limit counters expire after about one hour.

## Infrastructure

The service runs on Cloudflare Pages, Cloudflare Workers KV, and third-party email delivery. These processors operate under their own privacy terms (Cloudflare, Google, Resend/Mailgun). Data is stored in Cloudflare's global network; no offline copies exist outside this infrastructure.

## Contact

Questions about this policy: **abc15531888397@gmail.com**, or via the [contact page](https://trytriumph.de5.net/contact). Material changes will be announced on this page with an updated date above.
