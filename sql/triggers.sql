-- ============================================================
--  Trigger: Notify on Orders Change
--  Fires on INSERT, UPDATE, and DELETE on the orders table.
--  Sends a self-sufficient JSON payload to 'order_updates'.
--
--  FIX 1: Payload includes the full row inline — listeners never
--  need to do a follow-up SELECT to get the changed data.
--  This closes the race window where a second UPDATE could land
--  between NOTIFY firing and a listener querying the row back,
--  which would cause stale data to be broadcast.
-- ============================================================


-- Trigger function — builds a JSON payload and calls NOTIFY
CREATE OR REPLACE FUNCTION notify_order_change()
RETURNS TRIGGER AS $$

DECLARE
    payload   JSONB;

BEGIN

    -- Build a self-sufficient payload directly from NEW/OLD.
    -- For DELETE we only have OLD; for INSERT/UPDATE we use NEW.
    -- Fields are listed explicitly so the shape is stable even if
    -- columns are added to the table later.
    IF (TG_OP = 'DELETE') THEN
        payload := jsonb_build_object(
            'operation',     TG_OP,
            'table',         TG_TABLE_NAME,
            'timestamp',     extract(epoch from now()),
            'data', jsonb_build_object(
                'id',            OLD.id,
                'customer_name', OLD.customer_name,
                'product_name',  OLD.product_name,
                'status',        OLD.status,
                'updated_at',    OLD.updated_at
            )
        );
    ELSE
        -- INSERT or UPDATE: NEW is always available
        payload := jsonb_build_object(
            'operation',     TG_OP,
            'table',         TG_TABLE_NAME,
            'timestamp',     extract(epoch from now()),
            'data', jsonb_build_object(
                'id',            NEW.id,
                'customer_name', NEW.customer_name,
                'product_name',  NEW.product_name,
                'status',        NEW.status,
                'updated_at',    NEW.updated_at
            )
        );
    END IF;


    -- Log the event for replay support
    INSERT INTO order_events (operation, order_id, payload)
    VALUES (
        TG_OP,
        COALESCE((payload->'data'->>'id')::INTEGER, OLD.id),
        payload
    );


    -- Fire the notification — payload is self-sufficient; listeners
    -- broadcast it directly without any additional SELECT.
    PERFORM pg_notify('order_updates', payload::TEXT);


    RETURN COALESCE(NEW, OLD);

END;
$$ LANGUAGE plpgsql;


-- Attach the trigger to the orders table
DROP TRIGGER IF EXISTS order_change_trigger ON orders;

CREATE TRIGGER order_change_trigger
    AFTER INSERT OR UPDATE OR DELETE
    ON orders
    FOR EACH ROW
    EXECUTE FUNCTION notify_order_change();
