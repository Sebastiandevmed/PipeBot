import path from 'path';
import { fileURLToPath } from 'url';
import { config as loadEnv } from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Load .env from this file's directory so the script works whether started
// from the project root, the backend folder, or a hosted runtime.
loadEnv({ path: path.resolve(__dirname, '.env') });
loadEnv(); // also pick up env vars injected by the host

const express = (await import('express')).default;
const { handleWebhook, verifyWebhook } = await import('./webhook.js');
const { apiRouter } = await import('./routes/api.js');

const DASHBOARD_DIR = path.resolve(__dirname, '../dashboard');

const app = express();
app.use(express.json({ limit: '1mb' }));

// Health
app.get('/health', (_req, res) => res.json({ ok: true, service: 'pipebot' }));

// Public config for the dashboard — only the anon key is exposed here.
app.get('/config.js', (_req, res) => {
  res.type('application/javascript').send(
    `window.__PIPEBOT_CONFIG__ = ${JSON.stringify({
      supabaseUrl: process.env.SUPABASE_URL ?? '',
      supabaseAnonKey: process.env.SUPABASE_ANON_KEY ?? ''
    })};`
  );
});

// WhatsApp webhook
app.get('/webhook', verifyWebhook);
app.post('/webhook', handleWebhook);

// Agent API (JWT-protected)
app.use('/api', apiRouter);

// Dashboard static assets + SPA fallback
app.use(express.static(DASHBOARD_DIR, { extensions: ['html'] }));
app.get(/^\/(?!api|webhook|health|config\.js).*/, (_req, res) => {
  res.sendFile(path.join(DASHBOARD_DIR, 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`PipeBot listening on :${PORT}`));
