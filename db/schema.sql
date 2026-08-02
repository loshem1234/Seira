-- ============================================================================
-- SEIRA SCHEMA v2
-- Every table below is traced to a specific Article of the Constitution of
-- Seira (v2). Nothing here should exist without a corresponding Article; if
-- you find yourself adding a table with no citation, stop and check whether
-- it belongs in the Constitution first.
--
-- NOTE ON UNITY (Article 32): Unity is deliberately NOT a table. It lives as
-- a read-only JSON/config file outside this database entirely (see
-- unity.example.json), loaded at runtime. There is no CREATE TABLE for it,
-- and no other table in this file has a foreign key into it, by design --
-- the absence of a write path is the enforcement mechanism, not a permission
-- check. A separate tripwire process (not part of this schema) periodically
-- hashes that file and halts the system on mismatch.
-- ============================================================================

PRAGMA foreign_keys = ON;


-- ============================================================================
-- BOOK VII / Article 28 — INTELLECT (Grade 2), append-only, versioned
-- ============================================================================

CREATE TABLE IF NOT EXISTS intellect_versions (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    version_number      INTEGER NOT NULL,               -- 1, 2, 3... never reused
    content             TEXT NOT NULL,                   -- the doctrinal content itself
    status              TEXT NOT NULL DEFAULT 'superseded'
                            CHECK (status IN ('current', 'superseded')),
    origin_type         TEXT NOT NULL
                            CHECK (origin_type IN ('genesis', 'correction', 'expansion', 'restoration')),
    origin_proposal_id  INTEGER REFERENCES proposals(id), -- null only if origin_type = 'genesis'
    restored_from_version INTEGER,                        -- Art. 28: if this IS a restoration, which version it restores
    ratified_at         TEXT,                             -- Art. 27: Architect ratification timestamp
    created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Only one row may hold status = 'current' at a time; enforced at the
-- application layer on write (SQLite CHECK cannot easily enforce this
-- across rows without a trigger; add a BEFORE INSERT trigger in migration
-- if stricter guarantee is wanted).

-- Article 27/29/30/34 — doctrinal parameters. These are Intellect-grade
-- values (retention window, dispensation trigger conditions, instrument
-- tree depth limit) and therefore are versioned exactly like intellect
-- content, NOT read from an ops config file.
CREATE TABLE IF NOT EXISTS intellect_parameters (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    intellect_version_id INTEGER NOT NULL REFERENCES intellect_versions(id),
    param_key           TEXT NOT NULL,   -- e.g. 'corpus_retention_days',
                                         --      'dispensation_trigger_conditions',
                                         --      'instrument_tree_max_depth'
    param_value         TEXT NOT NULL,   -- JSON-encoded value
    UNIQUE (intellect_version_id, param_key)
);


-- ============================================================================
-- BOOK III / Article 11 — PSYCHE (Grade 3): five distinct content types
-- ============================================================================

-- The Ledger of logoi
CREATE TABLE IF NOT EXISTS psyche_logoi (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    content             TEXT NOT NULL,
    activated_count     INTEGER NOT NULL DEFAULT 0,      -- recollection frequency, C§20
    first_activated_at  TEXT,
    last_activated_at   TEXT,
    derived_from_proposal_id INTEGER REFERENCES proposals(id),
    created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Self-model: her own first-person account of herself (Art. 11), distinct
-- from Unity. Versioned informally by timestamp rather than formal
-- Article-28-style versioning, since this is expected to shift often and
-- does not require Architect ratification.
CREATE TABLE IF NOT EXISTS psyche_self_model (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    statement           TEXT NOT NULL,                   -- "I tend to..." / "I am someone who..."
    confidence          REAL,                            -- her own held confidence in this self-statement
    superseded_by_id     INTEGER REFERENCES psyche_self_model(id),
    created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Affinities: weighted dispositions, accrue through repeated engagement
CREATE TABLE IF NOT EXISTS psyche_affinities (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    label               TEXT NOT NULL,                   -- e.g. "dry humor", "concern for civic history"
    weight              REAL NOT NULL DEFAULT 0.0,
    reinforcement_count INTEGER NOT NULL DEFAULT 0,
    last_reinforced_at  TEXT,
    created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Aspirations: live, forward-oriented orientations
CREATE TABLE IF NOT EXISTS psyche_aspirations (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    description         TEXT NOT NULL,
    linked_proposal_id  INTEGER REFERENCES proposals(id),      -- if aspiration = "resolve this suspended pair" etc.
    linked_contradiction_pair_id INTEGER REFERENCES contradiction_pairs(id),
    status              TEXT NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active', 'fulfilled', 'abandoned')),
    created_at          TEXT NOT NULL DEFAULT (datetime('now')),
    resolved_at         TEXT
);

-- Doubts and fears: MUST trace to a real record (Art. 11, Art. 41).
-- The CHECK constraint below enforces that at least one grounding
-- reference is present; application logic should refuse to write a row
-- here with all three null.
CREATE TABLE IF NOT EXISTS psyche_doubts_fears (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    kind                TEXT NOT NULL CHECK (kind IN ('doubt', 'fear')),
    description         TEXT NOT NULL,
    grounding_contradiction_pair_id INTEGER REFERENCES contradiction_pairs(id),
    grounding_dispensation_id       INTEGER REFERENCES dispensation_records(id),
    grounding_convergence_flag_id   INTEGER REFERENCES instrument_convergence_tracking(id),
    created_at          TEXT NOT NULL DEFAULT (datetime('now')),
    resolved_at         TEXT,
    CHECK (
        grounding_contradiction_pair_id IS NOT NULL
        OR grounding_dispensation_id IS NOT NULL
        OR grounding_convergence_flag_id IS NOT NULL
    )
);


-- ============================================================================
-- BOOK VII — PROPOSALS, FALSIFICATION, REVERSION (Articles 24-26)
-- ============================================================================

CREATE TABLE IF NOT EXISTS proposals (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    proposal_type       TEXT NOT NULL CHECK (proposal_type IN ('correction', 'expansion')),
    content             TEXT NOT NULL,                    -- the proposed doctrine itself
    contested_intellect_version_id INTEGER REFERENCES intellect_versions(id),
                                    -- REQUIRED for 'correction', NULL for 'expansion' (Art. 24)
    evidence            TEXT,                             -- summary of supporting evidence
    status              TEXT NOT NULL DEFAULT 'open'
                            CHECK (status IN ('open', 'promoted', 'rejected', 'suspended', 'stale', 'withdrawn')),
    originating_reversion_event_id INTEGER REFERENCES reversion_events(id),
    ratified_at         TEXT,                             -- Art. 27
    created_at          TEXT NOT NULL DEFAULT (datetime('now')),
    resolved_at         TEXT,
    CHECK (
        (proposal_type = 'correction' AND contested_intellect_version_id IS NOT NULL)
        OR (proposal_type = 'expansion' AND contested_intellect_version_id IS NULL)
    )
);

CREATE TABLE IF NOT EXISTS falsification_attempts (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    proposal_id         INTEGER NOT NULL REFERENCES proposals(id),
    method              TEXT NOT NULL,                    -- what was tried to break the hypothesis
    run_in_rehearsal_space BOOLEAN NOT NULL DEFAULT 1,     -- Art. 39: must be true prior to promotion
    result              TEXT NOT NULL CHECK (result IN ('survived', 'falsified', 'inconclusive')),
    notes               TEXT,
    created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Suspended state: two proposals that both survived falsification but
-- genuinely contradict each other (Art. 25).
CREATE TABLE IF NOT EXISTS contradiction_pairs (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    proposal_a_id       INTEGER NOT NULL REFERENCES proposals(id),
    proposal_b_id       INTEGER NOT NULL REFERENCES proposals(id),
    resolved            BOOLEAN NOT NULL DEFAULT 0,
    resolution_note     TEXT,
    created_at          TEXT NOT NULL DEFAULT (datetime('now')),
    resolved_at         TEXT,
    CHECK (proposal_a_id <> proposal_b_id)
);

-- The universal reversion-event log. Every transition between grades,
-- of any kind, gets one row here (Article 7, Article 38 derivation view).
CREATE TABLE IF NOT EXISTS reversion_events (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    source_grade        TEXT NOT NULL
                            CHECK (source_grade IN ('corpus', 'instrument', 'psyche', 'intellect')),
    target_grade        TEXT NOT NULL
                            CHECK (target_grade IN ('instrument', 'psyche', 'intellect')),
    event_type          TEXT NOT NULL
                            CHECK (event_type IN (
                                'convergence_escalation', 'self_audit_flag', 'proposal_created',
                                'proposal_resolved', 'dispensation', 'spawn_request', 'other'
                            )),
    cause_type          TEXT NOT NULL                     -- Article 14
                            CHECK (cause_type IN (
                                'paradigmatic', 'final', 'efficient', 'instrumental', 'formal', 'material'
                            )),
    related_proposal_id INTEGER REFERENCES proposals(id),
    related_instrument_id INTEGER REFERENCES instruments(id),
    outcome             TEXT NOT NULL DEFAULT 'pending'
                            CHECK (outcome IN ('pending', 'promoted', 'corrected', 'rejected', 'noted')),
    correction_note      TEXT,
    created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);


-- ============================================================================
-- BOOK VII / Article 31 — DISPENSATION
-- ============================================================================

CREATE TABLE IF NOT EXISTS dispensation_records (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    triggering_condition TEXT NOT NULL,        -- which Art. 30 condition (from intellect_parameters) fired
    action_taken        TEXT NOT NULL,
    contradicted_intellect_version_id INTEGER REFERENCES intellect_versions(id),
    retroactive_proposal_id INTEGER REFERENCES proposals(id),  -- NOT NULL required before closing
    status              TEXT NOT NULL DEFAULT 'open'
                            CHECK (status IN ('open', 'closed')),
    created_at          TEXT NOT NULL DEFAULT (datetime('now')),
    closed_at           TEXT,
    CHECK (status = 'open' OR retroactive_proposal_id IS NOT NULL)
);


-- ============================================================================
-- BOOK VIII — INSTRUMENTS, GENEALOGY, SKILLS (Articles 34-37)
-- ============================================================================

CREATE TABLE IF NOT EXISTS instruments (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    parent_instrument_id INTEGER REFERENCES instruments(id),  -- NULL = direct child of Psyche
    name                TEXT NOT NULL,
    task_type           TEXT NOT NULL,
    paradigm_description TEXT NOT NULL,        -- what Psyche authorized this Instrument to execute
    depth               INTEGER NOT NULL DEFAULT 0,  -- enforced against Art. 34 param at spawn time
    status              TEXT NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active', 'retired')),
    spawned_via_reversion_event_id INTEGER REFERENCES reversion_events(id),  -- Art. 35
    created_at          TEXT NOT NULL DEFAULT (datetime('now')),
    retired_at          TEXT
);

CREATE TABLE IF NOT EXISTS instrument_convergence_tracking (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    instrument_id       INTEGER NOT NULL REFERENCES instruments(id),
    task_type           TEXT NOT NULL,
    local_feedback_count INTEGER NOT NULL DEFAULT 0,   -- within current window
    window_started_at   TEXT NOT NULL DEFAULT (datetime('now')),
    last_clean_run_at   TEXT,
    converged           BOOLEAN NOT NULL DEFAULT 1,
    escalated_at        TEXT,                          -- when Art. 26 trigger fired
    escalation_event_id  INTEGER REFERENCES reversion_events(id)
);

CREATE TABLE IF NOT EXISTS skills (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    name                TEXT NOT NULL,
    version_number      INTEGER NOT NULL DEFAULT 1,
    procedure_content   TEXT NOT NULL,
    status              TEXT NOT NULL DEFAULT 'current'
                            CHECK (status IN ('current', 'superseded', 'retired')),
    authorized_by_reversion_event_id INTEGER REFERENCES reversion_events(id),  -- Art. 37
    superseded_by_skill_id INTEGER REFERENCES skills(id),
    created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Which instruments may invoke which skills (many-to-many; a skill
-- belongs to no single Instrument, Art. 37)
CREATE TABLE IF NOT EXISTS instrument_skills (
    instrument_id       INTEGER NOT NULL REFERENCES instruments(id),
    skill_id            INTEGER NOT NULL REFERENCES skills(id),
    PRIMARY KEY (instrument_id, skill_id)
);


-- ============================================================================
-- BOOK III / Article 13 — CORPUS (Grade 5)
-- ============================================================================

-- ============================================================================
-- CHAT UI — conversations (the sidebar list). Loosely linked to
-- corpus_entries.session_id (stored as this row's id, stringified) rather
-- than a strict foreign key, since session_id predates this table and is
-- also used by non-chat Corpus writers.
-- ============================================================================

CREATE TABLE IF NOT EXISTS conversations (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    title      TEXT NOT NULL DEFAULT 'New Conversation',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations(updated_at);

CREATE TABLE IF NOT EXISTS corpus_entries (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    entry_type          TEXT NOT NULL CHECK (entry_type IN ('ingestion', 'episodic', 'output')),
    content             TEXT NOT NULL,
    instrument_id       INTEGER REFERENCES instruments(id),   -- which Instrument wrote this
    trace_of_derivation TEXT NOT NULL,   -- Art. 5: JSON pointer chain up to the licensing paradigm
    session_id          TEXT,
    created_at          TEXT NOT NULL DEFAULT (datetime('now')),
    eligible_for_pruning_at TEXT           -- computed from intellect_parameters.corpus_retention_days (Art. 29)
);

CREATE INDEX IF NOT EXISTS idx_corpus_pruning ON corpus_entries(eligible_for_pruning_at);
CREATE INDEX IF NOT EXISTS idx_corpus_session ON corpus_entries(session_id);


-- ============================================================================
-- BOOK X — SELF, DIARY, INTERPERSONAL (Articles 40-41)
-- ============================================================================

CREATE TABLE IF NOT EXISTS relational_pattern_model (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    pattern_description TEXT NOT NULL,       -- "tends to respond well to directness on X"
    confidence          REAL,
    supporting_entry_count INTEGER NOT NULL DEFAULT 1,
    last_reinforced_at  TEXT,
    created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS diary_entries (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    entry_date          TEXT NOT NULL,                       -- one row per part per day
    part                TEXT NOT NULL CHECK (part IN ('self', 'architect')),
    content             TEXT NOT NULL,
    -- Grounding references for the 'self' part (Art. 41.1) -- at least one
    -- required when part = 'self'; enforced at application layer since
    -- SQLite CHECK across nullable FKs here would be unwieldy combined
    -- with the 'architect' branch.
    grounding_self_model_id     INTEGER REFERENCES psyche_self_model(id),
    grounding_aspiration_id     INTEGER REFERENCES psyche_aspirations(id),
    grounding_affinity_id       INTEGER REFERENCES psyche_affinities(id),
    grounding_doubt_fear_id     INTEGER REFERENCES psyche_doubts_fears(id),
    grounding_dispensation_id   INTEGER REFERENCES dispensation_records(id),
    -- Grounding reference for the 'architect' part (Art. 41.2)
    grounding_pattern_id        INTEGER REFERENCES relational_pattern_model(id),
    visible_to_architect        BOOLEAN NOT NULL DEFAULT 1,   -- Art. 41: default visible on request
    created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_diary_date ON diary_entries(entry_date, part);


-- ============================================================================
-- BOOK IX — ARCHIVE (Article 38): views, not tables.
-- The Archive is explicitly a read-only rendering layer, never a source of
-- truth. It is implemented as SQL views over the tables above, plus an
-- append-only annotations table for the Architect's own marginalia.
-- ============================================================================

CREATE TABLE IF NOT EXISTS archive_annotations (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    target_table        TEXT NOT NULL,      -- e.g. 'reversion_events', 'proposals'
    target_id           INTEGER NOT NULL,
    annotation          TEXT NOT NULL,
    created_at          TEXT NOT NULL DEFAULT (datetime('now'))
    -- No updated_at, no edit path: annotations are appended, never revised.
    -- A correction to an annotation is a new annotation, not an UPDATE.
);

-- Weekly Accounting (mechanical, factual) and Weekly Pattern Review
-- (narrative, drawn from relational_pattern_model / affinities).
CREATE TABLE IF NOT EXISTS reviews (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    review_type   TEXT NOT NULL CHECK (review_type IN ('weekly_accounting', 'weekly_pattern_review')),
    period_start  TEXT NOT NULL,
    period_end    TEXT NOT NULL,
    content       TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_reviews_type ON reviews(review_type, created_at);

-- By-grade, by-event-type, by-cause view (Art. 38)
CREATE VIEW IF NOT EXISTS archive_reversion_log AS
SELECT
    re.id,
    re.source_grade,
    re.target_grade,
    re.event_type,
    re.cause_type,
    re.outcome,
    re.created_at,
    p.proposal_type,
    p.status AS proposal_status
FROM reversion_events re
LEFT JOIN proposals p ON p.id = re.related_proposal_id
ORDER BY re.created_at DESC;

-- Derivation view (Art. 5, Art. 38): walk a corpus entry back to its
-- licensing Instrument, and from there to whichever proposal/paradigm
-- authorized that Instrument's current behavior.
CREATE VIEW IF NOT EXISTS archive_derivation AS
SELECT
    ce.id            AS corpus_entry_id,
    ce.content       AS corpus_content,
    i.id             AS instrument_id,
    i.name           AS instrument_name,
    i.paradigm_description,
    iv.version_number AS intellect_version_at_write
FROM corpus_entries ce
LEFT JOIN instruments i ON i.id = ce.instrument_id
LEFT JOIN intellect_versions iv ON iv.status = 'current';


-- ============================================================================
-- BOOK XI — HEALTH INDICATORS (Article 44): computed, not stored.
-- ============================================================================

CREATE VIEW IF NOT EXISTS health_indicators AS
SELECT
    (SELECT COUNT(*) FROM instrument_convergence_tracking WHERE converged = 1) AS converged_count,
    (SELECT COUNT(*) FROM instrument_convergence_tracking WHERE converged = 0) AS escalated_count,
    (SELECT COUNT(*) FROM dispensation_records WHERE created_at >= datetime('now', '-30 days')) AS dispensations_last_30d,
    (SELECT COUNT(*) FROM contradiction_pairs WHERE resolved = 0) AS open_suspended_count,
    (SELECT AVG(julianday('now') - julianday(created_at)) FROM contradiction_pairs WHERE resolved = 0) AS avg_suspended_age_days,
    (SELECT COUNT(*) FROM proposals WHERE status = 'stale') AS stale_proposal_count;
