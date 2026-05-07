# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is PipeBot

PipeBot is a WhatsApp AI sales agent for **Papas Pipe**, a wholesale snack distributor in Medellín, Colombia. It takes wholesale orders via WhatsApp Business API, enforces business rules (30-package minimum, operating hours, fixed pricing), and escalates to human agents when needed. A real-time web dashboard lets agents monitor and manage conversations and orders.

## Architecture

```
WhatsApp User → Meta Cloud API → Node.js Backend → Supabase (PostgreSQL + Realtime + Storage)
                                        ↕
                                     Redis (queues + cache)
                                        ↕
                                  LLM (Groq primary / Gemini fallback)
                                        ↕
                              Dashboard (Vanilla JS or React)
```

## Tech Stack

- **Backend:** Node.js + Express — webhook handler, LLM orchestrator, tool executors
- **Database:** Supabase (PostgreSQL + Auth + Realtime + Storage for images)
- **Cache/Queue:** Redis
- **LLMs:** Groq (primary), Gemini (fallback)
- **Frontend:** Vanilla JS or React dashboard with Tabler Icons
- **Messaging:** Meta WhatsApp Cloud API

## Project Structure

```
PipeBot/
├── backend/
│   ├── server.js              # Express entry point
│   ├── webhook.js             # Meta WhatsApp webhook handler
│   ├── orchestrator.js        # LLM orchestration + state machine
│   ├── tools/                 # Tool executors (DB lookups, order creation)
│   └── services/
│       ├── whatsapp.js        # Meta Cloud API calls
│       ├── llm.js             # Groq/Gemini adapter
│       └── redis.js           # Queue + cache
├── dashboard/
│   ├── index.html
│   ├── styles/
│   │   ├── variables.css      # CSS custom properties (color system)
│   │   ├── dashboard.css
│   │   └── components.css
│   └── scripts/
│       ├── app.js
│       ├── supabase-client.js
│       ├── components/        # topbar, metrics, orders-panel, chat-panel, actions-panel
│       ├── services/          # orders, conversations, messages, whatsapp
│       └── utils/             # formatters (dates, currency), notifications
├── supabase/
│   └── migrations/            # SQL migrations
├── system-prompt.md           # PipeBot system prompt (source of truth for bot behavior)
└── CLAUDE.md
```

## Key Business Rules (Hard Constraints)

- **Minimum order:** 30 packages (any product mix) — block orders below this
- **Operating hours:** Mon–Fri 08:00–17:00 COT — block orders outside hours
- **Same-day delivery cutoff:** 09:00 COT — orders after 09:00 deliver next business day
- **Friday after 09:00 AM** → delivery on Monday
- **Prices:** fixed for all wholesale customers, no discounts ever
- **Delivery:** always free, covers all Medellín metro area

## Database Schema (Supabase)

Key tables:
- `customers` — phone_number (PK from WhatsApp), name, business_name, address, neighborhood, preferred_payment_method
- `conversations` — status (`bot_active` | `human_active`), assigned_agent_id, handoff_reason
- `messages` — direction (inbound/outbound), sender_type (bot/agent/customer), content, media_url, llm_provider
- `orders` — order_number (PP-YYYY-XXXX format), status (pending/confirmed/cancelled), total, total_items, delivery_date, payment_method, payment_proof_url, cancellation_reason
- `order_items` — product_name, quantity, unit_price
- `agents` — role (admin/agent/viewer)

## Product Catalog (Fixed — Never Invent Products or Prices)

| Category | Products | Size | Price COP |
|----------|----------|------|-----------|
| Papas | Limón, Limón Pimienta, Natural, Mayonesa, BBQ Picante | 80g | $2.650 |
| Platanitos | Natural, Limón | 85g | $2.650 |
| Chicharrones | Natural, Limón | — | $2.650 |
| Mixto (papa+platanito+chicharrón) | Limón, Natural | 80g | $2.650 |
| Crispetas | Dulces, Sal, Mixtas | 50g | $2.300 |
| Maní | Dulce, Salado, Mixto, Sal Pasas | — | $1.000 |

## Bot State Machine

`GREETING → DATA_COLLECTION (new) | ORDER_TAKING (returning) → ORDER_VALIDATION → DELIVERY_CONFIRMATION → PAYMENT_METHOD_SELECTION → ORDER_CONFIRMATION → FINAL_CONFIRMATION → ORDER_PLACED → CLOSING`

**Handoff triggers** (bot stops responding immediately): customer requests human, 2 consecutive misunderstandings, frustration/anger detected, complaint about past order.

**Payment flow:** Cash → no proof needed. Nequi/Transfer → send QR + bank details → wait for photo proof → only then confirm order.

## Dashboard Color System

Always use CSS variables. Status colors:
- Pending: bg `#FAEEDA`, text `#854F0B`, accent `#BA7517`
- Confirmed: bg `#EAF3DE`, text `#3B6D11`, accent `#639922`
- Cancelled: bg `#FCEBEB`, text `#A32D2D`, accent `#E24B4A`
- WhatsApp brand green: `#1D9E75`

## Real-Time Pattern

Dashboard subscribes to Supabase Realtime on `conversations`, `messages`, and `orders` tables. Polling fallback every 10 seconds if WebSockets fail. The bot checks `conversations.status` before every response — if `human_active`, it stops.

## Currency & Number Formatting

- Prices: `$2.650` (Colombian peso, dot as thousand separator — never comma or COP suffix)
- Phone: `300 555 8847` (spaces)
- Order numbers: `PP-YYYY-XXXX`

## Commands

*(Fill in once backend and dashboard are scaffolded)*

```bash
# Install dependencies
npm install

# Run backend dev server
npm run dev

# Run dashboard (if using Vite/build tool)
npm run dashboard

# Run tests
npm test

# Run a single test
npm test -- --grep "test name"

# Apply Supabase migrations
npx supabase db push
```

## Environment Variables Needed

```
WHATSAPP_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_VERIFY_TOKEN=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
GROQ_API_KEY=
GEMINI_API_KEY=
REDIS_URL=
```
