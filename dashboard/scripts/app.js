import { supabase } from './supabase-client.js';
import { getSessionOrRedirect, getCurrentAgent, logout } from './auth.js';
import { api } from './api.js';
import {
  formatCurrency, timeAgo, formatTime, todayLabel, initials, escapeHtml, statusLabel
} from './utils/formatters.js';
import { toast, notify, requestNotificationPermission } from './utils/notifications.js';

// ── State ──────────────────────────────────────────────
const state = {
  agent: null,
  status: 'pending',          // current orders tab
  search: '',
  selectedOrder: null,        // full order object
  channels: { messages: null }
};

// ── Bootstrap ──────────────────────────────────────────
const session = await getSessionOrRedirect();
if (!session) throw new Error('redirecting');
state.agent = await getCurrentAgent(session.user.id);
if (!state.agent) {
  toast('Tu usuario no está registrado como agente.', 'error', 6000);
}

document.getElementById('topbar-date').textContent = todayLabel();
document.getElementById('topbar-agent').textContent = state.agent?.name ?? session.user.email;
requestNotificationPermission();

// ── Wire UI ────────────────────────────────────────────
document.getElementById('logoutBtn').addEventListener('click', logout);

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    state.status = tab.dataset.status;
    refreshOrders();
  });
});

let searchTimer;
document.getElementById('searchInput').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  state.search = e.target.value;
  searchTimer = setTimeout(refreshOrders, 250);
});

document.getElementById('messageForm').addEventListener('submit', onAgentSend);
document.getElementById('btn-confirm').addEventListener('click', onConfirmOrder);
document.getElementById('btn-cancel').addEventListener('click', onOpenCancelDialog);
document.getElementById('btn-takeover').addEventListener('click', onTakeOver);
document.getElementById('btn-return').addEventListener('click', onReturnToBot);

const cancelDialog = document.getElementById('cancel-dialog');
document.getElementById('cancel-form').addEventListener('submit', (e) => {
  if (e.submitter?.value === 'confirm') onConfirmCancel(e);
});

// ── Initial load + global subscriptions ────────────────
await Promise.all([refreshMetrics(), refreshOrders()]);
subscribeGlobalChanges();
setInterval(refreshMetrics, 30_000);   // safety net
setInterval(refreshOrders,  60_000);

// ──────────────────────────────────────────────────────────
// Metrics
// ──────────────────────────────────────────────────────────
async function refreshMetrics() {
  try {
    const m = await api.metricsToday();
    for (const card of document.querySelectorAll('.metric-card')) {
      const key = card.dataset.key;
      card.querySelector('.metric-value').textContent = m[key] ?? 0;
    }
    document.getElementById('tab-count-pending').textContent = m.pending_orders ?? 0;
  } catch (err) {
    console.error('metrics:', err);
  }
}

// ──────────────────────────────────────────────────────────
// Orders list
// ──────────────────────────────────────────────────────────
async function refreshOrders() {
  const list = document.getElementById('ordersList');
  const empty = document.getElementById('ordersEmpty');
  try {
    const orders = await api.listOrders(state.status, state.search);
    list.innerHTML = '';
    empty.hidden = orders.length > 0;
    for (const order of orders) list.appendChild(renderOrderRow(order));
    if (state.selectedOrder) markSelected(state.selectedOrder.id);
  } catch (err) {
    console.error('orders:', err);
    toast('No pude cargar los pedidos', 'error');
  }
}

function renderOrderRow(o) {
  const li = document.createElement('li');
  li.className = 'order-item';
  li.dataset.orderId = o.id;
  const customer = o.customer_name ?? 'Cliente';
  li.innerHTML = `
    <div class="avatar ${o.status}">${escapeHtml(initials(customer))}</div>
    <div>
      <div class="order-name">${escapeHtml(customer)} · <span class="muted">${escapeHtml(o.order_number)}</span></div>
      <div class="order-meta">${escapeHtml(o.business_name ?? '')}${o.business_name ? ' · ' : ''}${escapeHtml(o.items_summary || '—')}</div>
    </div>
    <div class="order-right">
      <span class="order-price">${formatCurrency(o.total)}</span>
      <span class="order-time">${timeAgo(o.created_at)}</span>
      <span class="status-pill ${o.status}">${statusLabel(o.status)}</span>
    </div>
  `;
  li.addEventListener('click', () => selectOrder(o));
  return li;
}

function markSelected(orderId) {
  document.querySelectorAll('.order-item').forEach((el) => {
    el.classList.toggle('active', el.dataset.orderId === orderId);
  });
}

// ──────────────────────────────────────────────────────────
// Selection / chat panel
// ──────────────────────────────────────────────────────────
async function selectOrder(order) {
  state.selectedOrder = order;
  markSelected(order.id);

  // Header
  document.getElementById('chat-avatar').textContent = initials(order.customer_name ?? '');
  document.getElementById('chat-avatar').className = `avatar ${order.status}`;
  document.getElementById('chat-name').textContent = order.customer_name ?? 'Cliente';
  document.getElementById('chat-business').textContent = order.business_name ?? order.phone_number ?? '';

  // Conversation status pill — fetched live
  await refreshConversationStatus(order.conversation_id);
  await loadMessages(order.conversation_id);
  subscribeToConversation(order.conversation_id);

  // Payment proof link
  const proof = document.getElementById('proof-link');
  if (order.payment_proof_url) {
    proof.href = order.payment_proof_url;
    proof.hidden = false;
  } else {
    proof.hidden = true;
  }

  refreshActionButtons();
}

async function refreshConversationStatus(conversationId) {
  if (!conversationId) {
    setConversationStatusPill(null);
    return;
  }
  const { data } = await supabase
    .from('conversations')
    .select('status, assigned_agent_id')
    .eq('id', conversationId)
    .maybeSingle();
  setConversationStatusPill(data);
}

function setConversationStatusPill(conv) {
  const pill = document.getElementById('chat-status-pill');
  if (!conv) { pill.textContent = ''; pill.className = 'status-pill'; return; }
  if (conv.status === 'human_active') {
    pill.textContent = 'Agente';
    pill.className = 'status-pill human';
  } else if (conv.status === 'bot_active') {
    pill.textContent = 'Bot';
    pill.className = 'status-pill bot';
  } else {
    pill.textContent = conv.status;
    pill.className = 'status-pill';
  }
  state.conversationStatus = conv.status;
  refreshActionButtons();
}

async function loadMessages(conversationId) {
  const wrap = document.getElementById('messages');
  wrap.innerHTML = '';
  if (!conversationId) {
    wrap.innerHTML = '<div class="empty-state">Sin conversación</div>';
    return;
  }
  try {
    const messages = await api.conversationMessages(conversationId);
    for (const m of messages) wrap.appendChild(renderMessage(m));
    wrap.scrollTop = wrap.scrollHeight;
  } catch (err) {
    console.error('messages:', err);
    wrap.innerHTML = '<div class="empty-state">No pude cargar la conversación</div>';
  }
}

function renderMessage(m) {
  const dir = m.direction === 'inbound' ? 'inbound' : 'outbound';
  const senderTag = m.sender_type === 'agent' ? ' agent' : '';
  const sender = m.sender_type === 'bot' ? 'Bot' : m.sender_type === 'agent' ? 'Agente' : '';
  const meta = sender ? `${formatTime(m.created_at)} · ${sender}` : formatTime(m.created_at);
  const div = document.createElement('div');
  div.className = `msg ${dir}${senderTag}`;
  const body = m.content ? escapeHtml(m.content) : (m.message_type === 'image' ? '<em>Imagen</em>' : `<em>${m.message_type}</em>`);
  const media = m.media_url && m.message_type === 'image'
    ? `<img src="${m.media_url}" alt="adjunto" />` : '';
  div.innerHTML = `<div>${body}${media}</div><div class="msg-meta">${meta}</div>`;
  return div;
}

function appendMessage(m) {
  const wrap = document.getElementById('messages');
  const empty = wrap.querySelector('.empty-state');
  if (empty) empty.remove();
  wrap.appendChild(renderMessage(m));
  wrap.scrollTop = wrap.scrollHeight;
}

// ──────────────────────────────────────────────────────────
// Action buttons
// ──────────────────────────────────────────────────────────
function refreshActionButtons() {
  const o = state.selectedOrder;
  const hasOrder = Boolean(o);
  const isPending = o?.status === 'pending';
  const isHuman = state.conversationStatus === 'human_active';

  document.getElementById('btn-confirm').disabled = !hasOrder || !isPending;
  document.getElementById('btn-cancel').disabled  = !hasOrder || !isPending;
  document.getElementById('btn-takeover').disabled = !hasOrder || isHuman;
  document.getElementById('btn-return').disabled   = !hasOrder || !isHuman;

  const inputEnabled = hasOrder && isHuman;
  document.getElementById('messageInput').disabled = !inputEnabled;
  document.querySelector('.btn-send').disabled = !inputEnabled;
}

async function onConfirmOrder() {
  const o = state.selectedOrder; if (!o) return;
  try {
    await api.setOrderStatus(o.id, 'confirmed');
    toast('Pedido confirmado ✅');
    await Promise.all([refreshOrders(), refreshMetrics()]);
  } catch (err) {
    toast(`Error: ${err.message}`, 'error');
  }
}

function onOpenCancelDialog() {
  const dialog = document.getElementById('cancel-dialog');
  dialog.querySelector('textarea').value = '';
  dialog.showModal();
}

async function onConfirmCancel(e) {
  e.preventDefault();
  const dialog = document.getElementById('cancel-dialog');
  const reason = dialog.querySelector('textarea').value.trim();
  if (!reason) return;
  dialog.close();
  const o = state.selectedOrder; if (!o) return;
  try {
    await api.setOrderStatus(o.id, 'cancelled', reason);
    toast('Pedido cancelado', 'warn');
    await Promise.all([refreshOrders(), refreshMetrics()]);
  } catch (err) {
    toast(`Error: ${err.message}`, 'error');
  }
}

async function onTakeOver() {
  const o = state.selectedOrder; if (!o?.conversation_id) return;
  try {
    await api.takeOver(o.conversation_id);
    toast('Tomaste la conversación');
    await refreshConversationStatus(o.conversation_id);
  } catch (err) {
    toast(`Error: ${err.message}`, 'error');
  }
}

async function onReturnToBot() {
  const o = state.selectedOrder; if (!o?.conversation_id) return;
  try {
    await api.returnToBot(o.conversation_id);
    toast('Conversación devuelta al bot');
    await refreshConversationStatus(o.conversation_id);
  } catch (err) {
    toast(`Error: ${err.message}`, 'error');
  }
}

async function onAgentSend(e) {
  e.preventDefault();
  const input = document.getElementById('messageInput');
  const text = input.value.trim();
  const o = state.selectedOrder;
  if (!text || !o?.conversation_id) return;
  input.value = '';
  try {
    await api.sendAgentMessage(o.conversation_id, text);
    // The realtime subscription will append the message; nothing more here.
  } catch (err) {
    toast(`No se envió: ${err.message}`, 'error');
    input.value = text;
  }
}

// ──────────────────────────────────────────────────────────
// Realtime
// ──────────────────────────────────────────────────────────
function subscribeGlobalChanges() {
  supabase
    .channel('global')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => {
      refreshOrders();
      refreshMetrics();
    })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'conversations' }, () => {
      refreshMetrics();
      notify('Nueva conversación', 'Un cliente inició una conversación');
    })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'conversations' }, (payload) => {
      const conv = payload.new;
      if (conv?.status === 'human_active' && conv?.handoff_reason && conv.handoff_reason !== 'agent_initiated') {
        notify('Handoff solicitado', `Razón: ${conv.handoff_reason}`);
        toast(`Handoff: ${conv.handoff_reason}`, 'warn', 6000);
      }
      if (state.selectedOrder?.conversation_id === conv.id) {
        setConversationStatusPill(conv);
      }
    })
    .subscribe();
}

function subscribeToConversation(conversationId) {
  if (state.channels.messages) {
    supabase.removeChannel(state.channels.messages);
    state.channels.messages = null;
  }
  if (!conversationId) return;

  state.channels.messages = supabase
    .channel(`messages:${conversationId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` },
      (payload) => {
        if (state.selectedOrder?.conversation_id === conversationId) {
          appendMessage(payload.new);
        }
      }
    )
    .subscribe();
}

// Network-status banner
window.addEventListener('online', () => document.getElementById('connection-banner').hidden = true);
window.addEventListener('offline', () => document.getElementById('connection-banner').hidden = false);
