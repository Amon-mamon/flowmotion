# Subscription — NOT READY

> ## ⛔ NOT READY
> Do not build, stub, or wire anything in this file. The owner wants to test the core product first. Remove this banner only when the owner says so.

## What is allowed now
- Log token usage to `usage_events` for later analysis. No limits, no deduction, no blocking.
- A "Plans coming soon" section on the landing page. No prices, no checkout buttons.

## Ideas to revisit later (not decisions)
- Plans with a monthly credit allowance. Flow generation costs credits; analysis may be included or metered.
- Show the estimated credit cost of each recommendation before the user selects it (`recommendations.estimated_tokens` already stores an estimate).
- Charge credits only when generation succeeds; refund when generation or validation fails.
- Limits per plan: connected repos, analyses per month, automatic re-analysis on push, flow history, team seats.
- Payment provider is undecided. Check that the provider supports the business's country before choosing. Webhooks must be signature-verified.
- Needed later: `plans`, `subscriptions`, `credit_ledger` tables with RLS; server-side enforcement only; idempotent webhook handling; an audit trail for every credit change.

## Open questions
Which provider, which countries to sell in, plan names and prices, free trial or free tier, credit-to-token ratio.
