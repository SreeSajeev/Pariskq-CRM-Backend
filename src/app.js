import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import bodyParser from 'body-parser';

import { supabase } from './supabaseClient.js';
import { runAutoTicketWorker } from './workers/autoTicketWorker.js';

const app = express();
const PORT = process.env.PORT || 3000;

/* ===============================
   GLOBAL MIDDLEWARE
================================ */

app.use(bodyParser.json({ limit: '10mb' }));
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
 Contract:
 - Accept inbound email
 - Store raw payload
 - Mark as PENDING
 - Never crash caller
================================ */

app.post('/postmark-webhook', async (req, res) => {
  const email = req.body;

  // Always ACK quickly unless payload is clearly invalid
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
    payload: email, // assumes jsonb column
    processing_status: 'PENDING',
    created_at: new Date().toISOString(),
  };

  try {
    const { error } = await supabase
      .from('raw_emails')
      .insert(insertPayload);

    if (error) {
      console.error(
        '[POSTMARK] Supabase insert failed',
        JSON.stringify(error, null, 2)
      );
      return res.status(500).send('Failed to store email');
    }

    return res.status(200).send('Email received');
  } catch (err) {
    console.error('[POSTMARK] Webhook exception', {
      message: err.message,
      stack: err.stack,
    });
    return res.status(500).send('Internal server error');
  }
});

/* ===============================
   WORKER BOOTSTRAP
================================ */

async function startWorkerLoop() {
  console.log('⚡ Running auto ticket worker on startup');

  try {
    await runAutoTicketWorker();
  } catch (err) {
    console.error('[WORKER] Startup run failed', {
      message: err.message,
    });
  }

  setInterval(async () => {
    console.log('⏱ Auto ticket worker tick');

    try {
      await runAutoTicketWorker();
    } catch (err) {
      console.error('[WORKER] Interval run failed', {
        message: err.message,
      });
    }
  }, 60_000);
}

/* ===============================
   SERVER START
================================ */

app.listen(PORT, () => {
  console.log(`🚀 Backend running on port ${PORT}`);
  startWorkerLoop();
});

