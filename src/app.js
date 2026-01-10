import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import bodyParser from 'body-parser';

import { supabase } from './supabaseClient.js';
import { runAutoTicketWorker } from './workers/autoTicketWorker.js';

const app = express();

/**
 * Middleware
 */
app.use(bodyParser.json({ limit: '10mb' }));

/**
 * Health check
 * Used by Render / monitoring / manual sanity checks
 */
app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});

/**
 * Postmark inbound webhook
 * Responsibility:
 * - Accept email
 * - Store it RAW
 * - Do NOT process here
 */
app.post('/postmark-webhook', async (req, res) => {
  try {
    const email = req.body;

    const { error } = await supabase
      .from('raw_emails')
      .insert({
        message_id: email.MessageID,
        thread_id: email.ThreadID || null,
        from_email: email.FromFull?.Email || email.From,
        to_email: email.ToFull?.Email || email.To,
        subject: email.Subject || null,
        received_at: email.ReceivedAt || new Date().toISOString(),
        payload: email,
        processing_status: 'PENDING',
      });

    if (error) {
      console.error('[POSTMARK] raw_emails insert failed:', error);
      return res.status(500).send('Failed to store email');
    }

    return res.status(200).send('Email saved');
  } catch (err) {
    console.error('[POSTMARK] webhook error:', err);
    return res.status(500).send('Internal server error');
  }
});

/**
 * Server boot + background worker
 */
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Backend running on port ${PORT}`);

  // Run worker every 60 seconds
  setInterval(async () => {
    console.log('⏱ Auto ticket worker tick');
    try {
      await runAutoTicketWorker();
    } catch (err) {
      console.error('[WORKER] fatal error:', err);
    }
  }, 60_000);
});
