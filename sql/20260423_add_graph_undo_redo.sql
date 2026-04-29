-- Migration: add undo/redo history for graph edits
-- Date: 2026-04-23

BEGIN;

CREATE TABLE graph_history (
    id BIGSERIAL PRIMARY KEY,
    graph_id TEXT NOT NULL
        REFERENCES graphs(id)
        ON DELETE CASCADE,
    version INT NOT NULL,
    action_type TEXT NOT NULL,
    target_kind TEXT NOT NULL,
    target_id TEXT,
    before_state JSONB,
    after_state JSONB,
    created_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_graph_history_version UNIQUE (graph_id, version)
);

CREATE TABLE graph_history_cursor (
    graph_id TEXT PRIMARY KEY
        REFERENCES graphs(id)
        ON DELETE CASCADE,
    current_version INT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_graph_history_graph_id ON graph_history (graph_id);
CREATE INDEX idx_graph_history_graph_version_desc ON graph_history (graph_id, version DESC);
CREATE INDEX idx_graph_history_action_type ON graph_history (action_type);
CREATE INDEX idx_graph_history_target ON graph_history (graph_id, target_kind, target_id);
CREATE INDEX idx_graph_history_before_state_gin ON graph_history USING GIN (before_state);
CREATE INDEX idx_graph_history_after_state_gin ON graph_history USING GIN (after_state);

-- Initialize cursor for existing graphs
INSERT INTO graph_history_cursor (graph_id, current_version)
SELECT id, 0
FROM graphs
ON CONFLICT (graph_id) DO NOTHING;

COMMIT;
