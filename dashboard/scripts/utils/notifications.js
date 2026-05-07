export function requestNotificationPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission().catch(() => {});
  }
}

export function notify(title, body) {
  if ('Notification' in window && Notification.permission === 'granted') {
    try { new Notification(title, { body }); } catch {}
  }
}

export function toast(message, level = 'info', ttl = 3500) {
  const container = document.getElementById('toasts');
  if (!container) return;
  const el = document.createElement('div');
  el.className = `toast toast-${level}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => el.remove(), ttl);
}
