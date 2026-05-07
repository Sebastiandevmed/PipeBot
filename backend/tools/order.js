import { supabase } from '../services/supabase.js';
import { redis } from '../services/redis.js';
import { CATALOG, findProduct, MIN_PACKAGES } from './catalog.js';
import { computeDeliveryDate } from './business.js';

// A draft order lives in Redis keyed by phone until placed. Shape:
// { items: [{ name, quantity, unit_price }], payment_method, delivery_address,
//   delivery_neighborhood, payment_proof_url }
const DRAFT_TTL = 60 * 60 * 6; // 6h

const draftKey = (phone) => `draft:${phone}`;

export async function getDraft(phone) {
  const raw = await redis.get(draftKey(phone));
  return raw ? JSON.parse(raw) : { items: [] };
}

async function saveDraft(phone, draft) {
  await redis.setex(draftKey(phone), DRAFT_TTL, JSON.stringify(draft));
  return draft;
}

export async function clearDraft(phone) {
  await redis.del(draftKey(phone));
}

// Replace draft items with the provided list, validating each against the catalog.
// items: [{ name, quantity }]
export async function setDraftItems(phone, items) {
  const draft = await getDraft(phone);
  const resolved = [];
  const unknown = [];
  for (const raw of items) {
    const product = findProduct(raw.name);
    if (!product) { unknown.push(raw.name); continue; }
    const qty = Math.max(0, Math.floor(Number(raw.quantity) || 0));
    if (qty === 0) continue;
    resolved.push({ name: product.name, quantity: qty, unit_price: product.price });
  }
  draft.items = mergeItems(resolved);
  await saveDraft(phone, draft);
  return { draft, unknown, totals: totalsFor(draft) };
}

// Merge duplicate product lines (e.g. user adds "Papa Natural" twice).
function mergeItems(items) {
  const map = new Map();
  for (const it of items) {
    const prev = map.get(it.name);
    if (prev) prev.quantity += it.quantity;
    else map.set(it.name, { ...it });
  }
  return [...map.values()];
}

export async function setDraftField(phone, fields) {
  const draft = await getDraft(phone);
  for (const k of ['payment_method', 'delivery_address', 'delivery_neighborhood', 'payment_proof_url']) {
    if (fields[k] != null) draft[k] = fields[k];
  }
  await saveDraft(phone, draft);
  return draft;
}

export function totalsFor(draft) {
  const total_items = draft.items.reduce((s, it) => s + it.quantity, 0);
  const total = draft.items.reduce((s, it) => s + it.quantity * it.unit_price, 0);
  return { total_items, total, meets_minimum: total_items >= MIN_PACKAGES };
}

// Persist the draft as a real order row, then clear the draft.
export async function placeOrder({ phone, customer, conversation }) {
  const draft = await getDraft(phone);
  const totals = totalsFor(draft);

  if (draft.items.length === 0) throw new Error('empty_order');
  if (!totals.meets_minimum) throw new Error('below_minimum');
  if (!draft.payment_method) throw new Error('missing_payment_method');
  if (draft.payment_method !== 'efectivo' && !draft.payment_proof_url) {
    throw new Error('missing_payment_proof');
  }

  const delivery = computeDeliveryDate();

  const { data: order, error } = await supabase
    .from('orders')
    .insert({
      customer_id: customer.id,
      conversation_id: conversation.id,
      status: 'pending',
      total: totals.total,
      total_items: totals.total_items,
      delivery_address: draft.delivery_address ?? customer.address,
      delivery_neighborhood: draft.delivery_neighborhood ?? customer.neighborhood,
      delivery_date: delivery.date,
      payment_method: draft.payment_method,
      payment_proof_url: draft.payment_proof_url ?? null
    })
    .select()
    .single();
  if (error) throw error;

  const itemsRows = draft.items.map((it) => ({
    order_id: order.id,
    product_name: it.name,
    quantity: it.quantity,
    unit_price: it.unit_price
  }));
  const { error: itemsError } = await supabase.from('order_items').insert(itemsRows);
  if (itemsError) throw itemsError;

  await clearDraft(phone);
  return { order, delivery };
}

// Re-export catalog/min so tools/index can pull from one place.
export { CATALOG, MIN_PACKAGES };
