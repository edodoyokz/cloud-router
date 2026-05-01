# Notes — 9router Cloud

> Consolidated from NOTES.md and EXECUTION_NOTES.md.

## Project Direction
- Inspired by 9router / cliproxyapi
- Goal is not engine novelty
- Goal is zero-setup usability
- Hosted AI router for coding tools
- User brings their own accounts/providers
- One endpoint, many provider sources

## Product Thesis
- power same
- friction lower
- login first
- config last

## Market Priority (Indonesia)
- Codex OAuth / ChatGPT Plus subscription is a strong current usage pattern
- China providers are heavily used: ZAI, Kimi, MiniMax, Alibaba
- MVP provider order should bias toward these sources first, then expand outward

## Stack Preference
- use Vercel free tier for frontend/control-plane UX where possible
- use Supabase free tier for auth + Postgres + workspace data where possible
- use existing VPS subscription for the router/data-plane engine
- Alibaba subscription on the VPS is a useful cost anchor until next year

## Provider Priority
- Codex OAuth is a major supported provider for the MVP
- China providers (Kimi, MiniMax, ZAI, Alibaba) are a major supported set
- user chooses which provider becomes primary in their workspace
- UI should make primary/secondary/fallback selection explicit and flexible
- no provider is hardcoded as primary for all users

## Main Risk Areas
- Provider ToS / compliance
- Credential security
- Trust and onboarding UX
- Over-expanding provider scope
