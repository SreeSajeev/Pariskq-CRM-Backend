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
import { requireAuth } from './middleware/auth.js';
import { requireRole } from './middleware/requireRole.js';

const app = express();

/**
 * --------------------
 * Middleware
 * --------------------
 */
app.use(bodyParser.json({ limit: '10mb' }));

/**
 * --------------------
 * Health Check
 * --------------------
 * Used by Render, monitoring tools, and manual checks
 */
app.get('/health', (_req, res) => {
  return res.status(200).json({ status: 'ok' });
});

/**
 * --------------------
 * Postmark Inbound Webhook
 * --------------------
 * Responsibility:
 * 1. Accept inbound email
 * 2. Store it RAW
 * 3. Mark as PENDING
 * 4. Do NOT process here (async worker handles that)
 */
app.post('/postmark-webhook', async (req, res) => {
  try {
    const email = req.body;

    const { error } = await supabase
      .from('raw_emails')
      .insert({
        message_id: email.MessageID,
        thread_id: email.ThreadID || null,
        from_email: email.FromFull?.Email || email.From || null,
        to_email: email.ToFull?.Email || email.To || null,
        subject: email.Subject || null,
        received_at: email.ReceivedAt || new Date().toISOString(),
        payload: email,
        processing_status: 'PENDING',
        created_at: new Date().toISOString()
      });

    if (error) {
      console.error('[POSTMARK] Failed to store raw email:', error);
      return res.status(500).send('Failed to store email');
    }

    return res.status(200).send('Email received');
  } catch (err) {
    console.error('[POSTMARK] Webhook error:', err);
    return res.status(500).send('Internal server error');
  }
});

/**
 * --------------------
 * Server Boot + Worker
 * --------------------
 */
const PORT = process.env.PORT || 3000;

app.listen(PORT, async () => {
  console.log(`🚀 Backend running on port ${PORT}`);

  /**
   * Run worker immediately on startup
   * (Prevents emails staying PENDING during demos / restarts)
   */
  try {
    console.log('⚡ Running auto ticket worker on startup');
    await runAutoTicketWorker();
  } catch (err) {
    console.error('[WORKER] Startup run failed:', err);
  }

  /**
   * Run worker periodically (every 60 seconds)
   */
  setInterval(async () => {
    console.log('⏱ Auto ticket worker tick');
    try {
      await runAutoTicketWorker();
    } catch (err) {
      console.error('[WORKER] Interval run failed:', err);
    }
  }, 60_000);
});
