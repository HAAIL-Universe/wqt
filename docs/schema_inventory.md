# Schema Inventory (Generated)
Generated: 2025-12-27T19:09:17Z (UTC)
Method: pg_catalog/pg_indexes (pg_dump unavailable)
Connection check: current_database=neondb, current_user=neondb_owner, version=PostgreSQL 17.7 (bdc8956) on aarch64-unknown-linux-gnu, compiled by gcc (Debian 12.2.0-14+deb12u1) 12.2.0, 64-bit

NOTE: Generated for visibility only; do not apply to production directly.

## Tables
- admin_messages
- device_states
- global_state
- order_events
- orders
- perf_samples
- shift_sessions
- usage_events
- users
- warehouse_locations

## Table: admin_messages
Columns:
| column | type | nullable | default |
| --- | --- | --- | --- |
| id | integer | NO | nextval('admin_messages_id_seq'::regclass) |
| device_id | text | NO | - |
| message_text | text | NO | - |
| created_at | timestamp with time zone | YES | now() |
| read_at | timestamp with time zone | YES | - |

Constraints:
- admin_messages_pkey (PRIMARY KEY): PRIMARY KEY (id)

Indexes:
- admin_messages_pkey: CREATE UNIQUE INDEX admin_messages_pkey ON public.admin_messages USING btree (id)
- ix_admin_messages_device_id: CREATE INDEX ix_admin_messages_device_id ON public.admin_messages USING btree (device_id)
- ix_admin_messages_id: CREATE INDEX ix_admin_messages_id ON public.admin_messages USING btree (id)

## Table: device_states
Columns:
| column | type | nullable | default |
| --- | --- | --- | --- |
| id | integer | NO | nextval('device_states_id_seq'::regclass) |
| device_id | text | NO | - |
| payload | text | NO | - |

Constraints:
- device_states_pkey (PRIMARY KEY): PRIMARY KEY (id)

Indexes:
- device_states_pkey: CREATE UNIQUE INDEX device_states_pkey ON public.device_states USING btree (id)
- ix_device_states_device_id: CREATE UNIQUE INDEX ix_device_states_device_id ON public.device_states USING btree (device_id)
- ix_device_states_id: CREATE INDEX ix_device_states_id ON public.device_states USING btree (id)

## Table: global_state
Columns:
| column | type | nullable | default |
| --- | --- | --- | --- |
| id | integer | NO | nextval('global_state_id_seq'::regclass) |
| payload | text | NO | - |

Constraints:
- global_state_pkey (PRIMARY KEY): PRIMARY KEY (id)

Indexes:
- global_state_pkey: CREATE UNIQUE INDEX global_state_pkey ON public.global_state USING btree (id)
- ix_global_state_id: CREATE INDEX ix_global_state_id ON public.global_state USING btree (id)

## Table: order_events
Columns:
| column | type | nullable | default |
| --- | --- | --- | --- |
| id | integer | NO | nextval('order_events_id_seq'::regclass) |
| order_id | integer | NO | - |
| operator_id | text | YES | - |
| device_id | text | YES | - |
| event_type | text | NO | - |
| value_units | integer | YES | - |
| value_min | integer | YES | - |
| meta_json | text | YES | - |
| created_at | timestamp with time zone | YES | now() |

Constraints:
- order_events_order_id_fkey (FOREIGN KEY): FOREIGN KEY (order_id) REFERENCES orders(id)
- order_events_pkey (PRIMARY KEY): PRIMARY KEY (id)

Indexes:
- ix_order_events_created_at: CREATE INDEX ix_order_events_created_at ON public.order_events USING btree (created_at)
- ix_order_events_device_id: CREATE INDEX ix_order_events_device_id ON public.order_events USING btree (device_id)
- ix_order_events_id: CREATE INDEX ix_order_events_id ON public.order_events USING btree (id)
- ix_order_events_operator_id: CREATE INDEX ix_order_events_operator_id ON public.order_events USING btree (operator_id)
- ix_order_events_order_id: CREATE INDEX ix_order_events_order_id ON public.order_events USING btree (order_id)
- order_events_pkey: CREATE UNIQUE INDEX order_events_pkey ON public.order_events USING btree (id)

## Table: orders
Columns:
| column | type | nullable | default |
| --- | --- | --- | --- |
| id | integer | NO | nextval('orders_id_seq'::regclass) |
| operator_id | text | NO | - |
| operator_name | text | YES | - |
| device_id | text | YES | - |
| order_name | text | YES | - |
| is_shared | boolean | NO | - |
| total_units | integer | YES | - |
| pallets | integer | YES | - |
| order_date | timestamp with time zone | YES | now() |
| start_hhmm | text | YES | - |
| close_hhmm | text | YES | - |
| duration_min | integer | YES | - |
| excl_min | integer | YES | - |
| closed_early | boolean | NO | - |
| early_reason | text | YES | - |
| notes | text | YES | - |
| log_json | text | YES | - |
| created_at | timestamp with time zone | YES | now() |
| locations | integer | YES | 0 |
| order_rate_uh | double precision | YES | - |
| perf_score_ph | double precision | YES | - |
| zone_id | text | YES | - |
| zone_label | text | YES | - |

Constraints:
- orders_pkey (PRIMARY KEY): PRIMARY KEY (id)

Indexes:
- ix_orders_created_at: CREATE INDEX ix_orders_created_at ON public.orders USING btree (created_at)
- ix_orders_device_id: CREATE INDEX ix_orders_device_id ON public.orders USING btree (device_id)
- ix_orders_id: CREATE INDEX ix_orders_id ON public.orders USING btree (id)
- ix_orders_operator_id: CREATE INDEX ix_orders_operator_id ON public.orders USING btree (operator_id)
- ix_orders_order_date: CREATE INDEX ix_orders_order_date ON public.orders USING btree (order_date)
- orders_pkey: CREATE UNIQUE INDEX orders_pkey ON public.orders USING btree (id)

## Table: perf_samples
Columns:
| column | type | nullable | default |
| --- | --- | --- | --- |
| id | integer | NO | nextval('perf_samples_id_seq'::regclass) |
| operator_id | text | NO | - |
| shift_id | integer | YES | - |
| device_id | text | YES | - |
| perf_score | double precision | YES | - |
| sample_time | timestamp with time zone | YES | now() |
| created_at | timestamp with time zone | YES | now() |

Constraints:
- perf_samples_pkey (PRIMARY KEY): PRIMARY KEY (id)
- perf_samples_shift_id_fkey (FOREIGN KEY): FOREIGN KEY (shift_id) REFERENCES shift_sessions(id)

Indexes:
- ix_perf_samples_created_at: CREATE INDEX ix_perf_samples_created_at ON public.perf_samples USING btree (created_at)
- ix_perf_samples_device_id: CREATE INDEX ix_perf_samples_device_id ON public.perf_samples USING btree (device_id)
- ix_perf_samples_id: CREATE INDEX ix_perf_samples_id ON public.perf_samples USING btree (id)
- ix_perf_samples_operator_id: CREATE INDEX ix_perf_samples_operator_id ON public.perf_samples USING btree (operator_id)
- ix_perf_samples_sample_time: CREATE INDEX ix_perf_samples_sample_time ON public.perf_samples USING btree (sample_time)
- ix_perf_samples_shift_id: CREATE INDEX ix_perf_samples_shift_id ON public.perf_samples USING btree (shift_id)
- perf_samples_pkey: CREATE UNIQUE INDEX perf_samples_pkey ON public.perf_samples USING btree (id)

## Table: shift_sessions
Columns:
| column | type | nullable | default |
| --- | --- | --- | --- |
| id | integer | NO | nextval('shift_sessions_id_seq'::regclass) |
| operator_id | text | NO | - |
| device_id | text | YES | - |
| operator_name | text | YES | - |
| site | text | YES | - |
| shift_type | text | YES | - |
| started_at | timestamp with time zone | NO | now() |
| ended_at | timestamp with time zone | YES | - |
| total_units | integer | YES | - |
| avg_rate | double precision | YES | - |
| duration_minutes | integer | YES | - |
| active_minutes | integer | YES | - |
| summary_json | text | YES | - |
| zone_green_seconds | integer | YES | 0 |
| zone_amber_seconds | integer | YES | 0 |
| zone_red_seconds | integer | YES | 0 |
| zone_last | text | YES | - |
| zone_last_at | timestamp with time zone | YES | - |
| actual_login_at | timestamp with time zone | YES | - |
| zone_id | text | YES | - |
| zone_label | text | YES | - |
| state_version | integer | NO | 0 |
| active_order_snapshot | jsonb | YES | - |

Constraints:
- shift_sessions_pkey (PRIMARY KEY): PRIMARY KEY (id)

Indexes:
- ix_shift_sessions_id: CREATE INDEX ix_shift_sessions_id ON public.shift_sessions USING btree (id)
- ix_shift_sessions_operator_id: CREATE INDEX ix_shift_sessions_operator_id ON public.shift_sessions USING btree (operator_id)
- shift_sessions_pkey: CREATE UNIQUE INDEX shift_sessions_pkey ON public.shift_sessions USING btree (id)

## Table: usage_events
Columns:
| column | type | nullable | default |
| --- | --- | --- | --- |
| id | integer | NO | nextval('usage_events_id_seq'::regclass) |
| created_at | timestamp with time zone | YES | now() |
| category | text | NO | - |
| detail | text | YES | - |

Constraints:
- usage_events_pkey (PRIMARY KEY): PRIMARY KEY (id)

Indexes:
- ix_usage_events_created_at: CREATE INDEX ix_usage_events_created_at ON public.usage_events USING btree (created_at)
- ix_usage_events_id: CREATE INDEX ix_usage_events_id ON public.usage_events USING btree (id)
- usage_events_pkey: CREATE UNIQUE INDEX usage_events_pkey ON public.usage_events USING btree (id)

## Table: users
Columns:
| column | type | nullable | default |
| --- | --- | --- | --- |
| id | integer | NO | nextval('users_id_seq'::regclass) |
| username | text | NO | - |
| pin | text | NO | - |
| display_name | text | YES | - |
| role | text | NO | - |
| created_at | timestamp with time zone | YES | now() |
| hashed_pin | text | YES | - |

Constraints:
- users_pkey (PRIMARY KEY): PRIMARY KEY (id)

Indexes:
- ix_users_id: CREATE INDEX ix_users_id ON public.users USING btree (id)
- ix_users_username: CREATE UNIQUE INDEX ix_users_username ON public.users USING btree (username)
- users_pkey: CREATE UNIQUE INDEX users_pkey ON public.users USING btree (id)

## Table: warehouse_locations
Columns:
| column | type | nullable | default |
| --- | --- | --- | --- |
| id | integer | NO | nextval('warehouse_locations_id_seq'::regclass) |
| warehouse | text | NO | - |
| row_id | text | NO | - |
| aisle | text | NO | - |
| bay | integer | NO | - |
| layer | integer | NO | - |
| spot | text | NO | - |
| code | text | NO | - |
| is_active | boolean | NO | - |
| created_at | timestamp with time zone | NO | now() |
| updated_at | timestamp with time zone | NO | now() |
| is_empty | boolean | NO | false |

Constraints:
- uq_warehouse_location_unique (UNIQUE): UNIQUE (warehouse, row_id, aisle, bay, layer, spot)
- warehouse_locations_pkey (PRIMARY KEY): PRIMARY KEY (id)

Indexes:
- ix_warehouse_locations_code: CREATE INDEX ix_warehouse_locations_code ON public.warehouse_locations USING btree (code)
- ix_warehouse_locations_id: CREATE INDEX ix_warehouse_locations_id ON public.warehouse_locations USING btree (id)
- ix_warehouse_locations_row_id: CREATE INDEX ix_warehouse_locations_row_id ON public.warehouse_locations USING btree (row_id)
- ix_warehouse_locations_warehouse: CREATE INDEX ix_warehouse_locations_warehouse ON public.warehouse_locations USING btree (warehouse)
- uq_warehouse_location_unique: CREATE UNIQUE INDEX uq_warehouse_location_unique ON public.warehouse_locations USING btree (warehouse, row_id, aisle, bay, layer, spot)
- warehouse_locations_pkey: CREATE UNIQUE INDEX warehouse_locations_pkey ON public.warehouse_locations USING btree (id)

