import axios from 'axios';
import { supabase } from './supabase.js';
import { getMediaUrl } from './whatsapp.js';

const BUCKET = process.env.SUPABASE_MEDIA_BUCKET || 'whatsapp-media';

const EXT_BY_TYPE = {
  image: 'jpg',
  document: 'pdf',
  audio: 'ogg'
};

// Download a WhatsApp media object (which sits behind an auth-gated Graph URL)
// and upload it to Supabase Storage so the dashboard can render it directly.
// Returns the public URL of the stored object, or null if the bucket is private
// (in which case the caller would need a signed URL).
export async function uploadInboundMedia(mediaId, conversationId, messageType) {
  const graphUrl = await getMediaUrl(mediaId);
  const { data: bytes, headers } = await axios.get(graphUrl, {
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` },
    responseType: 'arraybuffer'
  });

  const contentType = headers['content-type'] || 'application/octet-stream';
  const ext = EXT_BY_TYPE[messageType] || 'bin';
  const objectKey = `${conversationId}/${Date.now()}-${mediaId}.${ext}`;

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(objectKey, Buffer.from(bytes), { contentType, upsert: false });
  if (error) throw error;

  const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(objectKey);
  return pub?.publicUrl ?? null;
}
