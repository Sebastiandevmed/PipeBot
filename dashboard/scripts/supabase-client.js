import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const cfg = window.__PIPEBOT_CONFIG__ ?? {};
if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) {
  console.warn('Supabase config missing — set SUPABASE_URL and SUPABASE_ANON_KEY on the server.');
}

export const supabase = createClient(cfg.supabaseUrl ?? '', cfg.supabaseAnonKey ?? '', {
  realtime: { params: { eventsPerSecond: 10 } }
});
