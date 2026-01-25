/**
 * ChittyConcierge - Canonical Core
 * URI: chittycanon://platform/services/concierge
 *
 * AI-powered communication orchestrator for lead management,
 * message categorization, and automated responses.
 *
 * Credentials provisioned via ChittyConnect (canonical pattern)
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';

// Types
interface Env {
  AI: Ai;
  DB: D1Database;
  CONCIERGE_KV: KVNamespace;
  CHITTYCONNECT_URL: string;
  SERVICE_NAME: string;
  CANONICAL_URI: string;
}

interface TwilioCredentials {
  accountSid: string;
  authToken: string;
  phoneNumber: string;
}

interface LeadCategorization {
  category: 'rental_inquiry' | 'maintenance' | 'viewing_request' | 'visitor_entry' | 'payment' | 'general';
  urgency: number;
  suggestedResponse: string;
  extractedInfo: {
    name?: string;
    email?: string;
    budget?: string;
    timeframe?: string;
  };
}

interface TwilioWebhook {
  From: string;
  To: string;
  Body: string;
  MessageSid: string;
}

const app = new Hono<{ Bindings: Env }>();

// CORS
app.use('*', cors());

/**
 * Fetch Twilio credentials from ChittyConnect
 * Caches in KV for 5 minutes to reduce latency
 */
async function getTwilioCredentials(env: Env): Promise<TwilioCredentials | null> {
  const cacheKey = 'twilio:credentials';

  // Check KV cache first
  const cached = await env.CONCIERGE_KV.get(cacheKey, 'json') as TwilioCredentials | null;
  if (cached) {
    return cached;
  }

  try {
    const connectUrl = env.CHITTYCONNECT_URL || 'https://connect.chitty.cc';
    const response = await fetch(`${connectUrl}/api/credentials/twilio`, {
      headers: {
        'X-Service-Name': env.SERVICE_NAME || 'chittyconcierge',
        'X-Canonical-URI': env.CANONICAL_URI || 'chittycanon://platform/services/concierge',
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      console.error('[ChittyConcierge] Failed to fetch Twilio credentials:', response.status);
      return null;
    }

    const credentials = await response.json() as TwilioCredentials;

    // Cache for 5 minutes
    await env.CONCIERGE_KV.put(cacheKey, JSON.stringify(credentials), { expirationTtl: 300 });

    return credentials;
  } catch (error) {
    console.error('[ChittyConcierge] ChittyConnect error:', error);
    return null;
  }
}

// Health check (canonical pattern)
app.get('/health', (c) => c.json({
  status: 'healthy',
  service: c.env.SERVICE_NAME || 'chittyconcierge',
  canonicalUri: c.env.CANONICAL_URI || 'chittycanon://platform/services/concierge',
  version: '1.0.0',
  credentialSource: 'chittyconnect'
}));

// Service status endpoint (canonical pattern)
app.get('/api/v1/status', (c) => c.json({
  service: c.env.SERVICE_NAME || 'chittyconcierge',
  canonicalUri: c.env.CANONICAL_URI || 'chittycanon://platform/services/concierge',
  version: '1.0.0',
  environment: c.env.ENVIRONMENT || 'development',
  tier: 4,
  capabilities: [
    'sms_webhook',
    'ai_categorization',
    'lead_management',
    'auto_response'
  ],
  dependencies: {
    chittyconnect: 'chittycanon://platform/services/connect',
    workersAi: 'cloudflare/workers-ai'
  },
  endpoints: {
    health: '/health',
    status: '/api/v1/status',
    webhook: '/webhook/sms',
    leads: '/api/leads',
    send: '/api/sms/send'
  }
}));

// Twilio SMS Webhook - incoming messages
app.post('/webhook/sms', async (c) => {
  const env = c.env;

  // Parse form data from Twilio
  const formData = await c.req.formData();
  const webhook: TwilioWebhook = {
    From: formData.get('From') as string || '',
    To: formData.get('To') as string || '',
    Body: formData.get('Body') as string || '',
    MessageSid: formData.get('MessageSid') as string || ''
  };

  console.log(`[ChittyConcierge] Incoming SMS from ${webhook.From}: ${webhook.Body}`);

  // Categorize the message using Workers AI
  const categorization = await categorizeWithAI(env.AI, webhook.Body, webhook.From);

  // Store the lead
  await storeLead(env.DB, webhook, categorization);

  // Get Twilio credentials from ChittyConnect
  const twilioCreds = await getTwilioCredentials(env);

  if (twilioCreds) {
    await sendTwilioSMS(twilioCreds, webhook.From, categorization.suggestedResponse);
  } else {
    console.warn('[ChittyConcierge] Twilio credentials not available, skipping auto-response');
  }

  // Return TwiML response (empty - we handle response via API)
  return c.text('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', 200, {
    'Content-Type': 'text/xml'
  });
});

// API: Get all leads
app.get('/api/leads', async (c) => {
  const env = c.env;

  try {
    const result = await env.DB.prepare(`
      SELECT * FROM leads ORDER BY created_at DESC LIMIT 100
    `).all();

    return c.json({ leads: result.results });
  } catch (error) {
    console.error('[ChittyConcierge] Error fetching leads:', error);
    return c.json({ error: 'Failed to fetch leads' }, 500);
  }
});

// API: Update lead status
app.patch('/api/leads/:id', async (c) => {
  const env = c.env;
  const id = c.req.param('id');
  const body = await c.req.json();

  try {
    await env.DB.prepare(`
      UPDATE leads SET status = ?, updated_at = datetime('now') WHERE id = ?
    `).bind(body.status, id).run();

    return c.json({ success: true });
  } catch (error) {
    console.error('[ChittyConcierge] Error updating lead:', error);
    return c.json({ error: 'Failed to update lead' }, 500);
  }
});

// API: Send manual SMS
app.post('/api/sms/send', async (c) => {
  const env = c.env;
  const { to, message } = await c.req.json();

  const twilioCreds = await getTwilioCredentials(env);
  if (!twilioCreds) {
    return c.json({ error: 'Twilio credentials not available from ChittyConnect' }, 503);
  }

  const result = await sendTwilioSMS(twilioCreds, to, message);
  return c.json(result);
});

/**
 * Categorize message using Cloudflare Workers AI
 */
async function categorizeWithAI(ai: Ai, message: string, phone: string): Promise<LeadCategorization> {
  try {
    const response = await ai.run('@cf/meta/llama-3.1-8b-instruct', {
      messages: [
        {
          role: 'system',
          content: `You are a communication assistant. Categorize incoming messages and suggest responses.

Categories:
- rental_inquiry: Questions about renting, availability, pricing
- maintenance: Repair requests, broken items, issues
- viewing_request: Requests to tour or see something
- visitor_entry: Someone visiting, delivery
- payment: Payments, deposits, fees
- general: Other inquiries

Respond in JSON format:
{
  "category": "category_name",
  "urgency": 1-5,
  "suggestedResponse": "friendly response text",
  "extractedInfo": { "name": "if found", "email": "if found", "budget": "if found" }
}`
        },
        {
          role: 'user',
          content: `Categorize this message from ${phone}: "${message}"`
        }
      ]
    }) as { response: string };

    const jsonMatch = response.response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (error) {
    console.error('[ChittyConcierge] AI categorization failed, using fallback:', error);
  }

  return categorizeWithRules(message);
}

/**
 * Rule-based fallback categorization
 */
function categorizeWithRules(message: string): LeadCategorization {
  const lower = message.toLowerCase();

  if (lower.includes('rent') || lower.includes('available') || lower.includes('lease') || lower.includes('bedroom')) {
    return {
      category: 'rental_inquiry',
      urgency: 4,
      suggestedResponse: "Thanks for your interest! I'd love to help. When would be a good time to discuss?",
      extractedInfo: {}
    };
  }

  if (lower.includes('broken') || lower.includes('repair') || lower.includes('fix') || lower.includes('maintenance')) {
    return {
      category: 'maintenance',
      urgency: 4,
      suggestedResponse: "I received your request. I'll arrange for someone to look at it ASAP. Is this urgent?",
      extractedInfo: {}
    };
  }

  if (lower.includes('view') || lower.includes('tour') || lower.includes('show') || lower.includes('see the')) {
    return {
      category: 'viewing_request',
      urgency: 3,
      suggestedResponse: "I'd be happy to arrange a viewing! What times work best for you?",
      extractedInfo: {}
    };
  }

  if (lower.includes('visiting') || lower.includes('delivery') || lower.includes('here for') || lower.includes('guest')) {
    return {
      category: 'visitor_entry',
      urgency: 5,
      suggestedResponse: "I'll notify them right away. Please wait for confirmation.",
      extractedInfo: {}
    };
  }

  if (lower.includes('payment') || lower.includes('rent due') || lower.includes('deposit')) {
    return {
      category: 'payment',
      urgency: 3,
      suggestedResponse: "Thanks for reaching out about payment. Let me check and get back to you.",
      extractedInfo: {}
    };
  }

  return {
    category: 'general',
    urgency: 2,
    suggestedResponse: "Thanks for your message! I'll get back to you shortly.",
    extractedInfo: {}
  };
}

/**
 * Store lead in D1 database
 */
async function storeLead(db: D1Database, webhook: TwilioWebhook, categorization: LeadCategorization) {
  try {
    await db.prepare(`
      INSERT INTO leads (phone, message, category, urgency, suggested_response, message_sid, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'new', datetime('now'))
    `).bind(
      webhook.From,
      webhook.Body,
      categorization.category,
      categorization.urgency,
      categorization.suggestedResponse,
      webhook.MessageSid
    ).run();
  } catch (error) {
    console.error('[ChittyConcierge] Failed to store lead:', error);
  }
}

/**
 * Send SMS via Twilio (credentials from ChittyConnect)
 */
async function sendTwilioSMS(creds: TwilioCredentials, to: string, message: string) {
  const auth = btoa(`${creds.accountSid}:${creds.authToken}`);

  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${creds.accountSid}/Messages.json`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        To: to,
        From: creds.phoneNumber,
        Body: message
      })
    }
  );

  if (!response.ok) {
    const error = await response.text();
    console.error('[ChittyConcierge] Twilio error:', error);
    return { success: false, error };
  }

  const result = await response.json() as { sid: string };
  console.log(`[ChittyConcierge] SMS sent to ${to}: ${result.sid}`);
  return { success: true, messageSid: result.sid };
}

export default app;
