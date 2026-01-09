import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import bodyParser from 'body-parser';
import { createClient } from '@supabase/supabase-js';

const app = express();
app.use(bodyParser.json());

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * Health check (important for Render)
 */
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

/**
 * Postmark webhook
 */
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
      payload: email
    });

    if (error) {
      console.error('Supabase insert error:', error);
      return res.status(500).send('Failed to insert email');
    }

    res.status(200).send('Email saved');
  } catch (err) {
    console.error('Webhook error:', err);
    res.status(500).send('Internal server error');
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
