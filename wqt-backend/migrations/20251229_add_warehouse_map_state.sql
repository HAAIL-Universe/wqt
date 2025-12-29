CREATE TABLE IF NOT EXISTS warehouse_map_state (
    warehouse TEXT PRIMARY KEY,
    state JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by_device_id TEXT NULL
);
