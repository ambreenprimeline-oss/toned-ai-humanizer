# Decisions

Records every place where the build departs from the original master spec, and why.

## D1 - Platform, not the Python monorepo (Phase 0)

The spec asks for Python 3.11 + FastAPI + Postgres + Redis/RQ + Next.js + Docker.
This project is built on the Base44 platform instead: React + Vite frontend,
platform-managed auth, JSON-schema entities for storage, and TypeScript/JavaScript
backend functions as the only server runtime.

What that means in practice:
- There is no `apps/api`, `apps/web`, `infra/` or Alembic. Storage is the entity
  layer (`RewriteJob`, `UserSetting`); migrations are schema edits.
- There is no Redis queue or RQ worker. Long work is split into individually
  invoked stages (`runRewriteStage`) so each request is short, resumable and
  cheap to retry - the job record itself is the queue position and the progress.
- Auth is the platform's own (email + Google). JWT verification, sessions and
  password reset are platform-owned and deliberately not reimplemented.
- Per-user isolation is enforced in the database by row-level security on both
  entities rather than by hand-written authorization checks per endpoint.
- `make dev`, Docker Compose and GitHub Actions have no equivalent here; the
  equivalent gates are the preview runtime and the function test harness.

## D2 - The provider abstraction is kept; the vendor is configurable (Phase 2)

`LLMProvider` exists as an interface with two implementations:

- `anthropic` - the Anthropic Messages API (`claude-haiku-4-5-20251001` for the
  fast stages, `claude-sonnet-5-5` for the rewrite and repair stages), used
  whenever `ANTHROPIC_API_KEY` is present. Long static system prompts are sent
  with prompt caching enabled.
- `platform` - the platform's built-in model integration, used **only** while no
  Anthropic key is configured, so the product runs and can be tested before API
  billing is set up.

Model IDs, token ceilings, the input cap and pricing all come from environment
variables, never from code. Verified against Anthropic's published model list on
2026-10-05: `claude-sonnet-5-5` and `claude-haiku-4-5-20251001` are current.

## D3 - Prompt files are versioned TypeScript modules, not XML files (Phase 3)

The spec asks for `/prompts/*.xml`. Prompt text lives in
`base44/shared/prompts.ts` so functions can import it, and the same version
string (`humanizer/1.0.0`) is stamped on every job for reproducibility. The
stage-3 rewrite prompt sits behind a clearly marked paste target so the author's
own prompt can replace it without touching pipeline code.

## D4 - Scope of this first version

Confirmed with the author: this version contains the rewrite workspace, the
tracked-change diff, the claim audit, editor's notes, history, usage and the data
controls. Deliberately deferred, and named as such:

- Voice fingerprinting from writing samples (and the `voice_profiles` table).
- Stripe checkout, plans, and word-credit metering (`credit_ledger`).
- `packages/evals` and the 30-document evaluation set.
- Playwright/vitest suites, Sentry, S3 export storage.
- `.docx` export (needs a document library; the platform ships none).

## D5 - Retention is enforced lazily, not by a scheduled job

The spec asks for a scheduled purge. Scheduled jobs need a plan tier that is not
guaranteed here, so retention is enforced two ways instead: every job carries
`expires_at`, and any history/usage load deletes that user's expired jobs before
rendering. Retention of "immediately" (`0`) means the record is deleted as soon
as the result has been handed back to the browser screen.

## D6 - Files are read in the browser

`.txt` and `.md` are read locally and never uploaded, so no document ever lands
in storage. That removes the S3 upload path, its encryption and its lifecycle
rules, and it is strictly better for privacy than uploading and expiring. `.docx`
input is rejected with an explanation rather than silently accepted.