# PipeBot

WhatsApp AI sales agent for **Papas Pipe** (wholesale snacks, Medellín) plus a real-time agent dashboard.

```
WhatsApp → Meta Cloud API → Node backend → Supabase (Postgres + Realtime + Storage)
                                  ↕
                                Redis (history + draft + dedup)
                                  ↕
                            LLM (Groq → Gemini fallback)
                                  ↕
                             Dashboard (vanilla JS)
```

The whole thing — backend, webhook, agent API, and dashboard — ships as a single Node process. You only need to plug in API keys and deploy.

---

## What you need before deploying

| Service | Why | Where to get it |
|---|---|---|
| **Supabase project** | Postgres + Auth + Realtime + Storage | https://supabase.com |
| **Meta Business / WhatsApp Cloud API** | Send and receive WhatsApp messages | https://developers.facebook.com → "WhatsApp" product |
| **Groq API key** | Primary LLM (`llama-3.3-70b-versatile`) | https://console.groq.com |
| **Gemini API key** *(optional)* | Fallback LLM if Groq fails | https://aistudio.google.com/app/apikey |
| **Redis URL** | Conversation history + draft orders + message dedup | https://upstash.com (free tier works) |
| **A host** | To run the Node process | Railway, Render, Fly.io, or any VPS |

---

## Step-by-step deploy

### 1. Supabase

1. Create a new project in Supabase and note the **Project URL**, **anon key**, and **service-role key** (Settings → API).
2. In SQL Editor, run the migrations in order:
   - `supabase/migrations/001_initial_schema.sql`
   - `supabase/migrations/002_storage_bucket.sql`
   - `supabase/migrations/003_realtime_and_view.sql`
3. Verify the `whatsapp-media` bucket exists in Storage.

### 2. WhatsApp Cloud API

1. Create a Meta dev app, add the WhatsApp product, and create a test phone number.
2. Note your **Permanent access token**, **Phone Number ID**, and pick any random string for **Verify Token**.
3. The webhook URL will be: `https://YOUR_DEPLOY_URL/webhook` — you set this in Meta after deploy.

### 3. Environment variables

Copy `backend/.env.example` to `backend/.env` (local) or paste them into your host's env-var UI.

```
WHATSAPP_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_VERIFY_TOKEN=

SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_MEDIA_BUCKET=whatsapp-media

GROQ_API_KEY=
GEMINI_API_KEY=          # optional

REDIS_URL=redis://...

PORT=3000
```

### 4. Deploy

Any host that runs Node ≥ 20:

```bash
npm install            # installs backend deps via postinstall
npm start              # boots the server
```

The single server serves:
- `/`            → dashboard
- `/login.html`  → agent login
- `/webhook`     → WhatsApp webhook (GET verify, POST messages)
- `/api/*`       → JWT-protected agent API
- `/health`      → liveness probe

After it's up, set the webhook URL in Meta's WhatsApp config:
- **Callback URL:** `https://YOUR_DEPLOY/webhook`
- **Verify token:** value of `WHATSAPP_VERIFY_TOKEN`
- **Subscribe to:** `messages`

### 5. Create the first agent

The dashboard requires a Supabase Auth user that exists in the `agents` table.

1. In Supabase → Authentication → Users → "Add user", create one with email + password.
2. In SQL Editor, run:
   ```sql
   INSERT INTO agents (id, email, name, role)
   VALUES ('<user-id-from-step-1>', 'agent@example.com', 'Felipe', 'admin');
   ```
3. Open `https://YOUR_DEPLOY/login.html` and sign in.

### 6. Smoke test

1. Send a WhatsApp message to the bot's number — you should see it appear in the dashboard within ~2 seconds.
2. Click the resulting order → verify the chat loads and the conversation status pill shows "Bot".
3. Click "Tomar conversación" → input becomes editable; send a reply → it should arrive on the customer's WhatsApp.

---

## Local development

```bash
git clone https://github.com/Sebastiandevmed/PipeBot
cd PipeBot
cp backend/.env.example backend/.env   # fill in
npm install
npm run dev                            # restarts on save
```

Use [`ngrok`](https://ngrok.com) or `cloudflared` to expose `:3000` and point Meta's webhook at the public URL during local testing.

---

## Project layout

```
PipeBot/
├── package.json                 # root scripts (start/dev/postinstall)
├── backend/
│   ├── server.js                # express entry, serves dashboard + API + webhook
│   ├── webhook.js               # Meta verify + inbound dispatch
│   ├── orchestrator.js          # tool-call loop, state, persistence
│   ├── tools/                   # LLM-callable tools (catalog, business, customer, order, handoff)
│   ├── routes/api.js            # JWT-protected agent endpoints
│   ├── middleware/auth.js       # Supabase JWT verification
│   ├── services/                # whatsapp, llm, redis, supabase, storage
│   └── package.json             # backend deps
├── dashboard/                   # vanilla JS SPA (no build step)
│   ├── index.html  login.html
│   ├── styles/                  # variables, dashboard, components CSS
│   └── scripts/                 # supabase-client, auth, api, app, utils
└── supabase/migrations/         # SQL migrations (run in order)
```

---

## Hard rules the bot enforces

| Rule | Where |
|---|---|
| 30-package minimum | `tools/order.js#placeOrder` |
| Mon–Fri 08:00–17:00 operating hours | `tools/business.js` (LLM checks via `get_business_status`) |
| 09:00 same-day cutoff, Friday after 9 → Monday | `tools/business.js#computeDeliveryDate` |
| Payment proof image required for Nequi/Transfer | `tools/order.js#placeOrder` rejects without `payment_proof_url` |
| Single fixed price list, no discounts | `tools/catalog.js` is the only price source |
| Bot stays silent when `conversations.status = human_active` | `orchestrator.js` |

---

## Troubleshooting

- **Webhook returns 403 on verify** → `WHATSAPP_VERIFY_TOKEN` doesn't match the value you put in Meta.
- **Dashboard loads blank, console shows `supabase config missing`** → `SUPABASE_URL` / `SUPABASE_ANON_KEY` not set on the server.
- **Login succeeds but everything is empty** → user is not in `agents` table; run the SQL insert from step 5.
- **Realtime not pushing updates** → migration `003_realtime_and_view.sql` not applied (replica identity / publication missing).
- **Payment proof image broken in dashboard** → `whatsapp-media` bucket missing or not public; re-run migration 002.
