/**
 * app.js
 * Entry point for Pariskq CRM Backend
 */

import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import bodyParser from 'body-parser';

import { supabase } from './supabaseClient.js';
import { runAutoTicketWorker } from './workers/autoTicketWorker.js';

const app = express();

/* ===============================
   GLOBAL MIDDLEWARE
================================ */

// Parse JSON payloads
app.use(bodyParser.json({ limit: '10mb' }));

// IMPORTANT: Parse Postmark form-encoded payloads
app.use(bodyParser.urlencoded({ extended: true }));

/* ===============================
   HEALTH CHECK
================================ */

app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});

/* ===============================
   POSTMARK INBOUND WEBHOOK
================================
 Responsibilities:
 - Accept inbound email
 - Store RAW payload
 - Mark as PENDING
 - Never throw
*/
app.post('/postmark-webhook', async (req, res) => {
  try {
    const email = req.body;

    // Defensive validation
    if (!email || !email.MessageID) {
      console.warn('[POSTMARK] Invalid payload received');
      return res.status(400).send('Invalid payload');
    }

    const insertPayload = {
      message_id: email.MessageID,
      thread_id: email.ThreadID || null,
      from_email: email.FromFull?.Email || email.From || null,
      to_email: email.ToFull?.Email || email.To || null,
      subject: email.Subject || null,
      received_at: email.ReceivedAt || new Date().toISOString(),

      // IMPORTANT: Ensure payload is DB-safe
      payload: email, // ✅ assumes jsonb column

      processing_status: 'PENDING',
      created_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .from('raw_emails')
      .insert(insertPayload);

    if (error) {
      console.error(
        '[POSTMARK] Supabase insert failed:',
        JSON.stringify(error, null, 2)
      );
      return res.status(500).send('Failed to store email');
    }

    res.status(200).send('Email received');
  } catch (err) {
    console.error('[POSTMARK] Webhook exception:', err);
    res.status(500).send('Internal server error');
  }
});

/* ===============================
   SERVER BOOT + WORKER
================================ */

const PORT = process.env.PORT || 3000;

app.listen(PORT, async () => {
  console.log(`🚀 Backend running on port ${PORT}`);

  try {
    console.log('⚡ Running auto ticket worker on startup');
    await runAutoTicketWorker();
  } catch (err) {
    console.error('[WORKER] Startup run failed:', err);
  }

  setInterval(async () => {
    console.log('⏱ Auto ticket worker tick');
    try {
      await runAutoTicketWorker();
    } catch (err) {
      console.error('[WORKER] Interval run failed:', err);
    }
  }, 60_000);
});
