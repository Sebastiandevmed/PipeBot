import { processMessage } from './orchestrator.js';

export function verifyWebhook(req, res) {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    console.log('Webhook verified');
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
}

export async function handleWebhook(req, res) {
  // Acknowledge immediately — Meta requires fast 200
  res.sendStatus(200);

  const body = req.body;
  if (body.object !== 'whatsapp_business_account') return;

  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;

      // Incoming messages
      for (const msg of value.messages ?? []) {
        const phone = msg.from;
        const messageId = msg.id;
        const timestamp = msg.timestamp;

        let content = null;
        let mediaId = null;
        const messageType = msg.type;

        if (msg.type === 'text') {
          content = msg.text.body;
        } else if (msg.type === 'image') {
          mediaId = msg.image?.id ?? null;
          content = msg.image?.caption ?? null;
        } else if (['document', 'audio'].includes(msg.type)) {
          mediaId = msg[msg.type]?.id ?? null;
        }

        await processMessage({ phone, messageId, content, mediaId, messageType, timestamp }).catch(
          (err) => console.error('processMessage error:', err)
        );
      }
    }
  }
}
