import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import bodyParser from "body-parser";

import { supabase } from "./supabaseClient.js";
import { runAutoTicketWorker } from "./workers/autoTicketWorker.js";
import { processProofBackupQueue } from "./workers/proofBackupQueueProcessor.js";
import { evaluateBreaches } from "./services/slaService.js";

import { sendResolutionEmail } from "./services/emailService.js";
import ticketsRouter from "./routes/tickets.js";
import feActionsRouter from "./routes/feActions.js";
import adminUsersRouter from "./routes/adminUsers.js";
import { uploadFeProof } from "./controllers/proofController.js";
import { createActionToken } from "./services/tokenService.js";
import { sendFESms, buildFEActionURL } from "./services/smsService.js";
import { APP_BASE_URL } from "./config/appConfig.js";

const app = express();
const PORT = process.env.PORT || 3000;

/* ======================================================
   GLOBAL MIDDLEWARE
====================================================== */

// CORS: allow frontend app origin (APP_BASE_URL) + dev origins
const corsOrigins = [
  APP_BASE_URL,
  "https://opsxbypariskq.vercel.app",
  "http://localhost:3000",
  "http://localhost:8080",
  "http://localhost:5173",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:8080",
  "http://127.0.0.1:5173",
  "https://sahaya.pariskq.in",
].filter((o, i, a) => a.indexOf(o) === i);

app.use(
  cors({
    origin: corsOrigins,
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

// Admin: user status (activation/deactivation)
app.use("/admin/users", adminUsersRouter);

// Admin: test FE SMS (generate token + send SMS without full assignment)
app.post("/admin/test-fe-sms", async (req, res) => {
  try {
    const { fe_id: feId, ticket_id: ticketId } = req.body || {};
    if (!feId || !ticketId) {
      return res.status(400).json({ error: "fe_id and ticket_id required" });
    }
    const { data: fe, error: feError } = await supabase
      .from("field_executives")
      .select("name, phone")
      .eq("id", feId)
      .single();
    if (feError || !fe) {
      return res.status(404).json({ error: "Field executive not found" });
    }
    if (!fe.phone || !String(fe.phone).trim()) {
      return res.status(400).json({ error: "FE has no phone number" });
    }
    const { data: ticket, error: ticketError } = await supabase
      .from("tickets")
      .select("ticket_number, vehicle_number, location")
      .eq("id", ticketId)
      .single();
    if (ticketError || !ticket) {
      return res.status(404).json({ error: "Ticket not found" });
    }
    const token = await createActionToken({
      ticketId,
      feId,
      actionType: "ON_SITE",
    });
    const actionUrl = buildFEActionURL(token);
    const location = ticket.location ? String(ticket.location).slice(0, 25) : "N/A";
    const smsMessage = `TKT:${ticket.ticket_number ?? "N/A"}
Veh:${ticket.vehicle_number ?? "N/A"}
Loc:${location}
Action:${actionUrl}
-Pariskq`;
    const sent = await sendFESms({ phoneNumber: fe.phone, message: smsMessage });
    return res.json({
      success: sent,
      message: sent ? "SMS sent" : "SMS send failed (check logs)",
      fe_name: fe.name,
      ticket_number: ticket.ticket_number,
      action_url: actionUrl,
    });
  } catch (err) {
    console.error("[admin/test-fe-sms]", err?.message || err);
    return res.status(500).json({ error: err?.message || "Server error" });
  }
});

// Admin: test RESOLUTION SMS (use current assignment + resolution token)
app.post("/admin/test-resolution-sms", async (req, res) => {
  try {
    const { ticket_id: ticketId } = req.body || {};
    if (!ticketId) {
      return res.status(400).json({ error: "ticket_id required" });
    }

    const { data: ticket, error: ticketError } = await supabase
      .from("tickets")
      .select("ticket_number, vehicle_number, location")
      .eq("id", ticketId)
      .single();
    if (ticketError || !ticket) {
      return res.status(404).json({ error: "Ticket not found" });
    }

    const { data: assignment, error: assignmentError } = await supabase
      .from("ticket_assignments")
      .select("fe_id")
      .eq("ticket_id", ticketId)
      .single();
    if (assignmentError || !assignment) {
      return res.status(400).json({ error: "FE not assigned" });
    }

    const { data: fe, error: feError } = await supabase
      .from("field_executives")
      .select("name, phone")
      .eq("id", assignment.fe_id)
      .single();
    if (feError || !fe) {
      return res.status(404).json({ error: "Field executive not found" });
    }
    if (!fe.phone || !String(fe.phone).trim()) {
      return res.status(400).json({ error: "FE has no phone number" });
    }

    const token = await createActionToken({
      ticketId,
      feId: assignment.fe_id,
      actionType: "RESOLUTION",
    });

    const resolutionUrl = buildFEActionURL(token);
    const location = ticket.location ? String(ticket.location).slice(0, 25) : "N/A";
    const smsMessage = `TKT:${ticket.ticket_number ?? "N/A"}
Veh:${ticket.vehicle_number ?? "N/A"}
Loc:${location}
Action:${resolutionUrl}
-Pariskq`;

    console.log("📩 Sending Resolution SMS to:", fe.phone);
    console.log("📩 Resolution SMS Body:", smsMessage);
    const sent = await sendFESms({ phoneNumber: fe.phone, message: smsMessage });

    return res.json({
      success: sent,
      message: sent ? "SMS sent" : "SMS send failed (check logs)",
      fe_name: fe.name,
      ticket_number: ticket.ticket_number,
      resolution_url: resolutionUrl,
    });
  } catch (err) {
    console.error("[admin/test-resolution-sms]", err?.message || err);
    return res.status(500).json({ error: err?.message || "Server error" });
  }
});

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

    console.log("EMAIL_TRIGGER_TICKET_RESOLVED_HOOK", ticket.opened_by_email, "ticketNumber=", ticket.ticket_number);
    await sendResolutionEmail({
      toEmail: ticket.opened_by_email,
      ticketNumber: ticket.ticket_number,
    }).catch((e) => console.error("[ticket-resolved-hook] Resolution email failed:", e?.message || e));

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
  try {
    await processProofBackupQueue();
  } catch (err) {
    console.error("[WORKER] Proof backup queue startup failed", err);
  }

  setInterval(async () => {
    try {
      await runAutoTicketWorker();
    } catch (err) {
      console.error("[WORKER] Interval run failed", err);
    }
    try {
      await processProofBackupQueue();
    } catch (err) {
      console.error("[WORKER] Proof backup queue interval failed", err);
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
