import { getAccessToken } from './auth.js';

async function request(path, { method = 'GET', body } = {}) {
  const token = await getAccessToken();
  const res = await fetch(`/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token ?? ''}`
    },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

export const api = {
  metricsToday: () => request('/metrics/today'),
  listOrders: (status, search = '') =>
    request(`/orders?status=${encodeURIComponent(status)}&search=${encodeURIComponent(search)}`),
  getOrder: (id) => request(`/orders/${id}`),
  setOrderStatus: (id, status, cancellation_reason) =>
    request(`/orders/${id}/status`, { method: 'PATCH', body: { status, cancellation_reason } }),
  conversationMessages: (id) => request(`/conversations/${id}/messages`),
  sendAgentMessage: (conversation_id, content) =>
    request('/messages', { method: 'POST', body: { conversation_id, content } }),
  takeOver: (id) => request(`/conversations/${id}/take-over`, { method: 'POST' }),
  returnToBot: (id) => request(`/conversations/${id}/return-to-bot`, { method: 'POST' })
};
