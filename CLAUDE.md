# ChittyConcierge

## Canonical Identity

| Attribute | Value |
|-----------|-------|
| **Canonical Name** | `chittyconcierge` |
| **Canonical URI** | `chittycanon://platform/services/concierge` |
| **Organization** | CHITTYOS |
| **Tier** | 4 (Domain - Business Logic) |
| **Domain** | `concierge.chitty.cc` |
| **Account** | ChittyCorp LLC |

## Overview

ChittyConcierge is the canonical AI-powered communication orchestrator for the ChittyOS ecosystem. It provides:

- AI message categorization (Workers AI / Llama 3.1)
- Lead management and tracking
- Automated response generation
- SMS/Voice webhook handling
- ChittyConnect credential integration

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Inbound Messages (SMS/Voice)                               │
│  Twilio Webhook → concierge.chitty.cc/webhook/sms           │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  ChittyConcierge (this service)                             │
│  chittycanon://platform/services/concierge                  │
│  ─────────────────────────────────────────────────────────  │
│  • Workers AI categorization (Llama 3.1)                    │
│  • Rule-based fallback categorization                       │
│  • Lead storage (D1 database)                               │
│  • Auto-response generation                                 │
│  • KV credential caching                                    │
└─────────────────────────────────────────────────────────────┘
          │                              │
          ▼                              ▼
┌─────────────────────┐    ┌─────────────────────────────────┐
│  ChittyConnect      │    │  Twilio API                     │
│  Credential fetch   │    │  Send responses                 │
│  (5-min KV cache)   │    │                                 │
└─────────────────────┘    └─────────────────────────────────┘
```

## Domain Overlays

This core service can be extended by domain-specific overlays:

| Overlay | URI | Purpose |
|---------|-----|---------|
| Properties | `chittycanon://platform/services/concierge/properties` | Rental/property management |
| Legal | `chittycanon://platform/services/concierge/legal` | Legal case intake |
| Corporate | `chittycanon://platform/services/concierge/corporate` | Executive assistant |

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check with canonical URI |
| `/api/v1/status` | GET | Service status and capabilities |
| `/webhook/sms` | POST | Twilio SMS webhook |
| `/api/leads` | GET | List all leads |
| `/api/leads/:id` | PATCH | Update lead status |
| `/api/sms/send` | POST | Send manual SMS |

## Development

```bash
# Install dependencies
npm install

# Local development
npm run dev

# Deploy to production
npm run deploy
```

## Environment Variables

### Vars (wrangler.toml)
- `SERVICE_NAME` - `chittyconcierge`
- `CANONICAL_URI` - `chittycanon://platform/services/concierge`
- `CHITTYCONNECT_URL` - `https://connect.chitty.cc`

### Bindings
- `AI` - Workers AI binding
- `DB` - D1 database (`chico-db`)
- `CONCIERGE_KV` - KV namespace for caching

## Lead Categories

| Category | Description | Urgency |
|----------|-------------|---------|
| `rental_inquiry` | Rental/availability questions | 4 |
| `maintenance` | Repair requests | 4 |
| `viewing_request` | Tour requests | 3 |
| `visitor_entry` | Visitor/delivery | 5 |
| `payment` | Payment questions | 3 |
| `general` | Other inquiries | 2 |

## Related Services

| Service | URI | Relationship |
|---------|-----|--------------|
| ChittyConnect | `chittycanon://platform/services/connect` | Credential provider |
| ChittyAuth | `chittycanon://foundation/services/auth` | Authentication |
| ChittyChronicle | `chittycanon://platform/services/chronicle` | Logging |
