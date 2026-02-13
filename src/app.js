import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import bodyParser from 'body-parser';

import { supabase } from './supabaseClient.js';
import { runAutoTicketWorker } from './workers/autoTicketWorker.js';

// ✅ Email services (existing)
import { sendResolutionEmail } from './services/emailService.js';

// ✅ CRITICAL: tickets router (FIX)
import ticketsRouter from './routes/tickets.js';

const app = express();
const PORT = process.env.PORT || 3000;

/* ===============================
   GLOBAL MIDDLEWARE
================================ */

app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true }));

/* ===============================
   ROUTES
================================ */

// ✅ CRITICAL: mount tickets router (FIX)
app.use('/tickets', ticketsRouter);

/* ===============================
   HEALTH CHECK
================================ */

app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});

/* ===============================
   INTERNAL: TICKET RESOLVED HOOK
   (NEW — does NOT affect existing flows)
================================ */

app.post('/internal/ticket-resolved', async (req, res) => {
  try {
    const secret = req.headers['x-internal-secret'];

    if (secret !== process.env.INTERNAL_TRIGGER_SECRET) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    const { ticket_id } = req.body;

    if (!ticket_id) {
      return res.status(400).json({ error: 'ticket_id missing' });
    }

    // Fetch ticket directly — read-only operation
    const { data: ticket, error } = await supabase
      .from('tickets')
      .select('id, ticket_number, status, opened_by_email')
      .eq('id', ticket_id)
      .single();

    if (error || !ticket) {
      return res.status(200).json({ ignored: 'ticket not found' });
    }

    // Safety guard — prevents accidental sends
    if (ticket.status !== 'RESOLVED') {
      return res.status(200).json({ ignored: 'status not resolved' });
    }

    if (!ticket.opened_by_email) {
      return res.status(200).json({ ignored: 'no opened_by_email' });
    }

    // Idempotency check
    const { data: alreadySent } = await supabase
      .from('ticket_resolution_notifications')
      .select('ticket_id')
      .eq('ticket_id', ticket.id)
      .single();

    if (alreadySent) {
      return res.status(200).json({ ignored: 'email already sent' });
    }

    // Send resolution email
    await sendResolutionEmail({
      to: ticket.opened_by_email,
      ticketNumber: ticket.ticket_number,
    });

    // Mark as sent (idempotency)
    await supabase
      .from('ticket_resolution_notifications')
      .insert({ ticket_id: ticket.id });

    return res.status(200).json({ sent: true });
  } catch (err) {
    console.error('[ticket-resolved-hook]', err);
    return res.status(500).json({ error: 'internal error' });
  }
});

/* ===============================
   POSTMARK INBOUND WEBHOOK
   (UNCHANGED)
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
   (UNCHANGED)
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
