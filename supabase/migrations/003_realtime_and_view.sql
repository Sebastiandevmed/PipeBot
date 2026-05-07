-- Dashboard read-friendly view: orders joined with customer fields and an
-- aggregated items summary string.
CREATE OR REPLACE VIEW orders_with_customer AS
SELECT
  o.id,
  o.order_number,
  o.status,
  o.total,
  o.total_items,
  o.delivery_address,
  o.delivery_neighborhood,
  o.delivery_date,
  o.payment_method,
  o.payment_proof_url,
  o.cancellation_reason,
  o.notes,
  o.created_at,
  o.updated_at,
  o.conversation_id,
  c.id AS customer_id,
  c.name AS customer_name,
  c.phone_number,
  c.business_name,
  COALESCE(
    (SELECT string_agg(oi.product_name || ' x' || oi.quantity, ', ')
     FROM order_items oi WHERE oi.order_id = o.id),
    ''
  ) AS items_summary
FROM orders o
JOIN customers c ON o.customer_id = c.id;

-- Authenticated agents can update orders and conversations from the dashboard.
CREATE POLICY "agents_update_orders" ON orders
  FOR UPDATE USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "agents_update_conversations" ON conversations
  FOR UPDATE USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- Authenticated agents can insert outbound messages.
CREATE POLICY "agents_insert_messages" ON messages
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- Realtime publication: enable change feeds on the tables the dashboard listens to.
ALTER PUBLICATION supabase_realtime ADD TABLE conversations;
ALTER PUBLICATION supabase_realtime ADD TABLE messages;
ALTER PUBLICATION supabase_realtime ADD TABLE orders;

-- Required so realtime delivers full row data on UPDATE/DELETE.
ALTER TABLE conversations REPLICA IDENTITY FULL;
ALTER TABLE messages REPLICA IDENTITY FULL;
ALTER TABLE orders REPLICA IDENTITY FULL;
