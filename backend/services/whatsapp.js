import axios from 'axios';

const BASE = `https://graph.facebook.com/v19.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}`;
const HEADERS = { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` };

export async function sendText(to, text) {
  return axios.post(`${BASE}/messages`, {
    messaging_product: 'whatsapp',
    to,
    type: 'text',
    text: { body: text }
  }, { headers: HEADERS });
}

export async function sendImage(to, mediaId, caption = '') {
  return axios.post(`${BASE}/messages`, {
    messaging_product: 'whatsapp',
    to,
    type: 'image',
    image: { id: mediaId, caption }
  }, { headers: HEADERS });
}

export async function markAsRead(messageId) {
  return axios.post(`${BASE}/messages`, {
    messaging_product: 'whatsapp',
    status: 'read',
    message_id: messageId
  }, { headers: HEADERS });
}

// Returns the public URL of a media file given its WhatsApp media ID
export async function getMediaUrl(mediaId) {
  const { data } = await axios.get(
    `https://graph.facebook.com/v19.0/${mediaId}`,
    { headers: HEADERS }
  );
  return data.url;
}
