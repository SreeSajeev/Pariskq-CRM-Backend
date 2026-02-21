import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import bodyParser from "body-parser";

import { supabase } from "./supabaseClient.js";
import { runAutoTicketWorker } from "./workers/autoTicketWorker.js";
import { evaluateBreaches } from "./services/slaService.js";

import { sendResolutionEmail } from "./services/emailService.js";
import ticketsRouter from "./routes/tickets.js";
import feActionsRouter from "./routes/feActions.js";
import { uploadFeProof } from "./controllers/proofController.js";

const app = express();
const PORT = process.env.PORT || 3000;

/* ======================================================
   GLOBAL MIDDLEWARE
====================================================== */

// ✅ Proper CORS configuration (Express 5 safe)
app.use(
  cors({
    origin: [
      "https://opsxbypariskq.vercel.app",
      "http://localhost:3000",
    ],
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);

// Body parsing
app.use(bodyParser.json({ limit: "10mb" }));
app.use(bodyParser.urlencoded({ extended: true }));

/* ======================================================
   ROUTES
====================================================== */

// Tickets
app.use("/tickets", ticketsRouter);

// FE token validation routes
app.use(feActionsRouter);

// FE proof upload
app.post("/fe/proof", uploadFeProof);

/* ======================================================
   HEALTH CHECK
====================================================== */

app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

/* ======================================================
   INTERNAL: TICKET RESOLVED HOOK
====================================================== */

app.post("/internal/ticket-resolved", async (req, res) => {
  try {
    const secret = req.headers["x-internal-secret"];

    if (secret !== process.env.INTERNAL_TRIGGER_SECRET) {
      return res.status(401).json({ error: "unauthorized" });
    }

    const { ticket_id } = req.body;

    if (!ticket_id) {
      return res.status(400).json({ error: "ticket_id missing" });
    }

    const { data: ticket, error } = await supabase
      .from("tickets")
      .select("id, ticket_number, status, opened_by_email")
      .eq("id", ticket_id)
      .single();

    if (error || !ticket) {
      return res.status(200).json({ ignored: "ticket not found" });
    }

    if (ticket.status !== "RESOLVED") {
      return res.status(200).json({ ignored: "status not resolved" });
    }

    if (!ticket.opened_by_email) {
      return res.status(200).json({ ignored: "no opened_by_email" });
    }

    const { data: alreadySent } = await supabase
      .from("ticket_resolution_notifications")
      .select("ticket_id")
      .eq("ticket_id", ticket.id)
      .single();

    if (alreadySent) {
      return res.status(200).json({ ignored: "email already sent" });
    }

    await sendResolutionEmail({
      toEmail: ticket.opened_by_email,
      ticketNumber: ticket.ticket_number,
    });

    await supabase
      .from("ticket_resolution_notifications")
      .insert({ ticket_id: ticket.id });

    return res.status(200).json({ sent: true });
  } catch (err) {
    console.error("[ticket-resolved-hook]", err);
    return res.status(500).json({ error: "internal error" });
  }
});

/* ======================================================
   POSTMARK INBOUND WEBHOOK
====================================================== */

app.post("/postmark-webhook", async (req, res) => {
  try {
    const email = req.body;

    if (!email || !email.MessageID) {
      return res.status(400).send("Invalid payload");
    }

    const fromEmail = email.FromFull?.Email || email.From || null;
    const toEmail = email.ToFull?.Email || email.To || null;
    console.log("[POSTMARK] webhook received", {
      MessageID: email.MessageID,
      from_email: fromEmail,
      to_email: toEmail,
    });

    const insertPayload = {
      message_id: email.MessageID,
      thread_id: email.ThreadID || null,
      from_email: fromEmail,
      to_email: toEmail,
      subject: email.Subject || null,
      received_at: email.ReceivedAt || new Date().toISOString(),
      payload: email,
      processing_status: "PENDING",
      created_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from("raw_emails")
      .insert(insertPayload)
      .select("id")
      .single();

    if (error) {
      console.error("[POSTMARK] Insert failed", error.code, error.message);
      return res.status(500).send("Failed to store email");
    }

    console.log("[POSTMARK] Insert ok", { id: data?.id });
    return res.status(200).send("Email received");
  } catch (err) {
    console.error("[POSTMARK] Exception", err);
    return res.status(500).send("Internal server error");
  }
});

/* ======================================================
   WORKER BOOTSTRAP
====================================================== */

async function startWorkerLoop() {
  console.log("⚡ Running auto ticket worker on startup");

  try {
    await runAutoTicketWorker();
  } catch (err) {
    console.error("[WORKER] Startup run failed", err);
  }

  setInterval(async () => {
    try {
      await runAutoTicketWorker();
    } catch (err) {
      console.error("[WORKER] Interval run failed", err);
    }
  }, 60_000);
}

function startSlaBreachEvaluator() {
  console.log("⚡ SLA breach evaluator starting (every 60s)");
  evaluateBreaches().catch((err) => console.error("[SLA] evaluateBreaches startup failed", err));
  setInterval(() => {
    evaluateBreaches().catch((err) => console.error("[SLA] evaluateBreaches interval failed", err));
  }, 60_000);
}

/* ======================================================
   SERVER START
====================================================== */

app.listen(PORT, () => {
  console.log(`🚀 Backend running on port ${PORT}`);
  startWorkerLoop();
  startSlaBreachEvaluator();
});
