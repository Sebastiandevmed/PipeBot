export function formatCurrency(amount) {
  return '$' + Math.round(Number(amount ?? 0)).toLocaleString('es-CO');
}

export function timeAgo(dateStr) {
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (diff < 60) return 'ahora';
  if (diff < 3600) return `hace ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `hace ${Math.floor(diff / 3600)} h`;
  return `hace ${Math.floor(diff / 86400)} d`;
}

export function formatTime(dateStr) {
  return new Date(dateStr).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
}

const TODAY_FMT = new Intl.DateTimeFormat('es-CO', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' });
export function todayLabel() {
  return TODAY_FMT.format(new Date());
}

export function initials(name = '') {
  return (name.trim().split(/\s+/).slice(0, 2).map((w) => w[0] ?? '').join('') || '?').toUpperCase();
}

export function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function statusLabel(status) {
  return { pending: 'Pendiente', confirmed: 'Confirmado', cancelled: 'Cancelado' }[status] ?? status;
}
