import Redis from 'ioredis';

export const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

// Store conversation history (last 20 messages) keyed by phone number
const HISTORY_TTL = 60 * 60 * 24; // 24 hours

export async function getHistory(phone) {
  const raw = await redis.get(`history:${phone}`);
  return raw ? JSON.parse(raw) : [];
}

export async function appendHistory(phone, role, content) {
  const history = await getHistory(phone);
  history.push({ role, content });
  // Keep last 20 turns to avoid context overflow
  const trimmed = history.slice(-20);
  await redis.setex(`history:${phone}`, HISTORY_TTL, JSON.stringify(trimmed));
  return trimmed;
}

export async function clearHistory(phone) {
  await redis.del(`history:${phone}`);
}

// Deduplication: ignore duplicate WhatsApp message deliveries
export async function isDuplicate(messageId) {
  const key = `msg:${messageId}`;
  const result = await redis.set(key, '1', 'EX', 300, 'NX');
  return result === null; // null means key already existed
}
