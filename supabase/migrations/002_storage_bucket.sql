-- Public bucket for WhatsApp inbound media (payment proofs, product photos
-- sent by customers). Backend uploads with the service role; the dashboard
-- reads via public URLs.

INSERT INTO storage.buckets (id, name, public)
VALUES ('whatsapp-media', 'whatsapp-media', true)
ON CONFLICT (id) DO NOTHING;

-- Authenticated dashboard users can read all objects in the bucket.
CREATE POLICY "agents_read_media" ON storage.objects
  FOR SELECT
  USING (bucket_id = 'whatsapp-media' AND auth.role() = 'authenticated');

-- Anonymous public read (so <img src="..."> works without a session).
-- Remove this policy if media must stay behind auth.
CREATE POLICY "public_read_media" ON storage.objects
  FOR SELECT
  USING (bucket_id = 'whatsapp-media');
