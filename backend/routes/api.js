import express from 'express';
import { supabase } from '../services/supabase.js';
import { sendText } from '../services/whatsapp.js';
import { requireAgent, requireRole } from '../middleware/auth.js';

export const apiRouter = express.Router();

apiRouter.use(requireAgent);

// --- Metrics ---
apiRouter.get('/metrics/today', async (_req, res) => {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

  const [convs, pending, confirmed, cancelled] = await Promise.all([
    supabase.from('conversations').select('id', { count: 'exact', head: true }).gte('created_at', today.toISOString()),
    supabase.from('orders').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    supabase.from('orders').select('id', { count: 'exact', head: true }).eq('status', 'confirmed').gte('created_at', monthStart.toISOString()),
    supabase.from('orders').select('id', { count: 'exact', head: true }).eq('status', 'cancelled').gte('created_at', monthStart.toISOString())
  ]);

  res.json({
    conversations_today: convs.count ?? 0,
    pending_orders: pending.count ?? 0,
    confirmed_orders_month: confirmed.count ?? 0,
    cancelled_orders_month: cancelled.count ?? 0
  });
});

// --- Orders list ---
apiRouter.get('/orders', async (req, res) => {
  const status = req.query.status ?? 'pending';
  const search = (req.query.search ?? '').trim();

  let query = supabase
    .from('orders_with_customer')
    .select('*')
    .eq('status', status)
    .order('created_at', { ascending: false })
    .limit(50);

  if (search) {
    query = query.or(
      `order_number.ilike.%${search}%,customer_name.ilike.%${search}%,business_name.ilike.%${search}%,phone_number.ilike.%${search}%`
    );
  }

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

apiRouter.get('/orders/:id', async (req, res) => {
  const { data, error } = await supabase
    .from('orders_with_customer')
    .select('*, order_items(*)')
    .eq('id', req.params.id)
    .single();
  if (error) return res.status(404).json({ error: error.message });
  res.json(data);
});

// --- Order status mutations ---
apiRouter.patch('/orders/:id/status', async (req, res) => {
  const { status, cancellation_reason } = req.body;
  if (!['confirmed', 'cancelled'].includes(status)) {
    return res.status(400).json({ error: 'invalid_status' });
  }
  if (status === 'cancelled' && !cancellation_reason?.trim()) {
    return res.status(400).json({ error: 'cancellation_reason_required' });
  }

  const patch = { status };
  if (status === 'cancelled') patch.cancellation_reason = cancellation_reason.trim();

  const { data: order, error } = await supabase
    .from('orders')
    .update(patch)
    .eq('id', req.params.id)
    .select('*, customers(phone_number, name)')
    .single();
  if (error) return res.status(500).json({ error: error.message });

  const phone = order.customers.phone_number;
  const text = status === 'confirmed'
    ? `¡Tu pedido ${order.order_number} fue confirmado! ✅\nGracias por elegir Papas Pipe. 🍿💚`
    : `Tu pedido ${order.order_number} fue cancelado.\nMotivo: ${cancellation_reason}`;
  await sendText(phone, text).catch((e) => console.error('notify customer failed:', e?.message));

  res.json(order);
});

// --- Conversation messages ---
apiRouter.get('/conversations/:id/messages', async (req, res) => {
  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', req.params.id)
    .order('created_at', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// --- Agent sends a message ---
apiRouter.post('/messages', async (req, res) => {
  const { conversation_id, content } = req.body;
  if (!conversation_id || !content?.trim()) return res.status(400).json({ error: 'missing_fields' });

  const { data: conv, error: convErr } = await supabase
    .from('conversations')
    .select('id, status, customer_id, customers(phone_number)')
    .eq('id', conversation_id)
    .single();
  if (convErr) return res.status(404).json({ error: 'conversation_not_found' });

  // Sending from the dashboard implies the agent is taking over.
  if (conv.status !== 'human_active') {
    await supabase
      .from('conversations')
      .update({ status: 'human_active', assigned_agent_id: req.agent.id, handoff_reason: 'agent_initiated' })
      .eq('id', conversation_id);
  }

  const { data: msg, error: msgErr } = await supabase
    .from('messages')
    .insert({
      conversation_id,
      direction: 'outbound',
      sender_type: 'agent',
      content: content.trim(),
      message_type: 'text'
    })
    .select()
    .single();
  if (msgErr) return res.status(500).json({ error: msgErr.message });

  await sendText(conv.customers.phone_number, content.trim()).catch((e) =>
    console.error('agent send failed:', e?.response?.data ?? e.message)
  );

  res.json(msg);
});

// --- Conversation handoff ---
apiRouter.post('/conversations/:id/take-over', async (req, res) => {
  const { data, error } = await supabase
    .from('conversations')
    .update({
      status: 'human_active',
      assigned_agent_id: req.agent.id,
      handoff_reason: 'agent_initiated'
    })
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

apiRouter.post('/conversations/:id/return-to-bot', async (req, res) => {
  const { data, error } = await supabase
    .from('conversations')
    .update({ status: 'bot_active', assigned_agent_id: null, handoff_reason: null })
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// --- Admin: bootstrap an agent record after an Auth user is created ---
apiRouter.post('/agents', requireRole('admin'), async (req, res) => {
  const { id, email, name, role } = req.body;
  if (!id || !email || !name || !role) return res.status(400).json({ error: 'missing_fields' });
  const { data, error } = await supabase
    .from('agents')
    .insert({ id, email, name, role })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
