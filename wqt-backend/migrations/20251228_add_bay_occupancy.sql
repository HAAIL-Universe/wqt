-- Add bay_occupancy table for layer-level pallet occupancy.
CREATE TABLE IF NOT EXISTS bay_occupancy (
  id SERIAL PRIMARY KEY,
  warehouse TEXT NOT NULL,
  row_id TEXT NOT NULL,
  aisle TEXT NOT NULL,
  bay INTEGER NOT NULL,
  layer INTEGER NOT NULL,
  euro_count INTEGER NOT NULL DEFAULT 0,
  uk_count INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by_device_id TEXT NULL,
  CONSTRAINT uq_bay_occupancy_unique UNIQUE (warehouse, row_id, aisle, bay, layer),
  CONSTRAINT ck_bay_occupancy_euro_nonneg CHECK (euro_count >= 0),
  CONSTRAINT ck_bay_occupancy_uk_nonneg CHECK (uk_count >= 0),
  CONSTRAINT ck_bay_occupancy_capacity CHECK ((euro_count + (uk_count * 1.5)) <= 3.0)
);

CREATE INDEX IF NOT EXISTS ix_bay_occupancy_warehouse_aisle
  ON bay_occupancy (warehouse, aisle);
