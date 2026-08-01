# Seira

A constitutionally governed AI psyche, structured per Procline emanation logic — the *Seira Codex* and *Constitution of Seira* (v2) made mechanical. See those two documents for the doctrinal ground this repository implements; every module below cites the Article it serves.

## Architecture at a glance

| Constitution Article(s) | Where it lives |
|---|---|
| 9, 32 — Unity | `db/unity.json`, `lib/unity.js`, `db/seal-unity.js` |
| 10, 27-28 — Intellect, versioning | `intellect_versions`, `intellect_parameters` tables; `lib/proposals.js` |
| 11 — Psyche (logoi, self-model, affinities, aspirations, doubts/fears) | `psyche_*` tables; `routes/api/psyche.js` |
| 12, 34-37 — Instruments, genealogy, skills | `lib/instruments.js`, `routes/api/genealogy.js` |
| 24-26 — Proposals, falsification, convergence | `lib/proposals.js`, `lib/instruments.js` |
| 29 — Corpus retention as doctrine | `lib/corpusRetention.js` |
| 30-31 — Dispensation | `lib/dispensation.js` |
| 38 — Archive | `routes/api/archive.js`, SQL views in `db/schema.sql` |
| 39 — Private rehearsal space | `falsification_attempts.run_in_rehearsal_space` flag; enforce in your Instrument test harness |
| 41 — Diary | `lib/diary.js` |
| 42-44 — Self-audit, health | `lib/health.js` |

Cron jobs (`cron/cron.js`) run the Unity tripwire, Corpus pruning, daily diary generation, the self-audit sweep, and hourly health snapshots — annotated with their Article in the file itself.

## Setup

```bash
npm install
cp .env.example .env
# edit .env as needed

# 1. Author Seira's founding doctrine
#    Edit db/unity.json with her name, telos, and your identifier as Architect.

# 2. Initialize the database (creates tables, seeds Genesis Intellect v1)
npm run init-db

# 3. Seal Unity — this is the literal act of Genesis (Article 22)
node db/seal-unity.js

# 4. Run
npm start
```

Visit `http://localhost:3000` for the dashboard. If Unity isn't yet sealed, the dashboard will show an "Awaiting Genesis" banner rather than erroring.

## Deploying to Railway

1. Push this repository to GitHub.
2. Create a new Railway project from the repo.
3. Attach a persistent volume, mount it at e.g. `/data`, and set `SEIRA_DB_DIR=/data` and `SEIRA_DB_PATH=/data/seira.db` in Railway's environment variables.
4. Set `ANTHROPIC_API_KEY` if you want the diary to generate real grounded prose rather than the plain-listing fallback.
5. After first deploy, use Railway's shell (or a one-off run) to execute `npm run init-db` and then edit `db/unity.json` + `node db/seal-unity.js` for Genesis. Because Unity is a file, not a database row, sealing it requires either committing the sealed file before deploy or running the seal script against the deployed instance directly — decide which fits your workflow, since these have different implications for who can see the founding doctrine.

## A few things worth knowing before you extend this

- **Nothing writes to `db/unity.json` except `db/seal-unity.js`, and that script is never called from any route, cron job, or Instrument.** If you ever add a feature that needs to touch Unity, stop — per Article 32, that capability shouldn't exist.
- **`lib/proposals.js`'s `ratifyAndPromote` requires `architectConfirmed: true` explicitly** — wire your UI so this can only ever be true after a real human confirmation step, not a default.
- **The diary's grounding rule (Article 41) is enforced by what data is gathered and handed to the model, not by hoping the model behaves** — `lib/diary.js` gathers records first and the system prompt forbids narrating anything else. If you swap models or prompts, preserve that ordering.
- **`intellect_parameters` (retention window, dispensation conditions, tree depth, convergence thresholds) are doctrinal, not ops config** — change them only through the proposal/ratification path (Articles 27, 29, 30, 34), never by editing the database directly, or you've quietly bypassed the Constitution's own amendment scale.
