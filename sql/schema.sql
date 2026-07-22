-- ============================================================
--  Schema: Real-Time Order Tracking System
--  Creates the orders table and the event log table.
--
--  FIX 3: Added `version` column (incrementing integer) so
--  clients can detect gaps after a WebSocket reconnect.
--  On reconnect the client sends its last-seen version (or
--  updated_at) and the REST endpoint returns only rows that
--  changed since then — converting "hope no message was missed"
--  into "always self-heal on reconnect".
-- ============================================================


-- Orders table
CREATE TABLE IF NOT EXISTS orders (
    id              SERIAL      PRIMARY KEY,
    customer_name   TEXT        NOT NULL,
    product_name    TEXT        NOT NULL,
    status          TEXT        NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'shipped', 'delivered')),
    updated_at      TIMESTAMP   NOT NULL DEFAULT NOW(),

    -- Monotonically incrementing version.
    -- Bumped by a BEFORE UPDATE trigger (see below) so it is always
    -- the authoritative sequence number for this row. Clients store
    -- the highest version they have seen; on reconnect they call
    -- GET /orders?since_version=<N> to catch up on anything missed
    -- while they were disconnected.
    version         BIGINT      NOT NULL DEFAULT 0
);

-- Bump version on every UPDATE so clients can detect gaps.
CREATE OR REPLACE FUNCTION bump_order_version()
RETURNS TRIGGER AS $$
BEGIN
    NEW.version := OLD.version + 1;
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS order_version_trigger ON orders;
CREATE TRIGGER order_version_trigger
    BEFORE UPDATE ON orders
    FOR EACH ROW
    EXECUTE FUNCTION bump_order_version();


-- Event log table — stores every DB change for replay on reconnect.
-- `version` is also stored here so the replay query can be filtered
-- by version as well as by occurred_at.
CREATE TABLE IF NOT EXISTS order_events (
    id          SERIAL      PRIMARY KEY,
    operation   TEXT        NOT NULL,       -- INSERT | UPDATE | DELETE
    order_id    INTEGER     NOT NULL,
    payload     JSONB       NOT NULL,
    occurred_at TIMESTAMP   NOT NULL DEFAULT NOW()
);


-- Indexes for efficient event replay queries
CREATE INDEX IF NOT EXISTS idx_order_events_occurred_at
    ON order_events (occurred_at DESC);

-- Allows cheap "give me everything since version N" catch-up queries.
CREATE INDEX IF NOT EXISTS idx_orders_version
    ON orders (version);
