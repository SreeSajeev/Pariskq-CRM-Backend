import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import bodyParser from 'body-parser';
import { createClient } from '@supabase/supabase-js';
import { processRawEmails } from './autoTicketProcessor.js';

const app = express();
app.use(bodyParser.json());

// Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/* ------------------------
   HEALTH CHECK
------------------------- */
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

/* ------------------------
   POSTMARK WEBHOOK
------------------------- */
app.post('/postmark-webhook', async (req, res) => {
  try {
    const email = req.body;

    const { error } = await supabase.from('raw_emails').insert({
      message_id: email.MessageID,
      thread_id: email.ThreadID || null,
      from_email: email.FromFull?.Email || email.From,
      to_email: email.ToFull?.Email || email.To,
      subject: email.Subject,
      received_at: email.ReceivedAt || new Date().toISOString(),
      payload: email,
      ticket_created: false
    });

    if (error) {
      console.error('Raw email insert failed:', error);
      return res.status(500).send('Failed to store email');
    }

    res.status(200).send('Email saved');
  } catch (err) {
    console.error('Webhook error:', err);
    res.status(500).send('Internal server error');
  }
});

/* ------------------------
   SERVER START + WORKER
------------------------- */
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);

  // Background processor (every 60s)
  setInterval(async () => {
    try {
      await processRawEmails();
    } catch (err) {
      console.error('Auto ticket processor failed:', err);
    }
  }, 60 * 1000);
});
