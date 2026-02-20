// src/services/emailService.js
import { supabase } from "../supabaseClient.js";

const POSTMARK_URL = "https://api.postmarkapp.com/email";

/* =====================================================
   ENV GUARD (NEVER CRASH DEMO)
===================================================== */
function canSendEmail() {
  return Boolean(
    process.env.POSTMARK_SERVER_TOKEN &&
    process.env.FROM_EMAIL
  );
}

/* =====================================================
   CORE SENDER (SINGLE AUTHORITY)
===================================================== */
async function sendEmail(payload, tag) {
  if (!canSendEmail()) {
    console.warn(`[EMAIL SKIPPED] ${tag} — env not configured`);
    return;
  }

  try {
    const res = await fetch(POSTMARK_URL, {
      method: "POST",
      headers: {
        "X-Postmark-Server-Token": process.env.POSTMARK_SERVER_TOKEN,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error(`[EMAIL FAILED] ${tag}`, text);
    }
  } catch (err) {
    console.error(`[EMAIL ERROR] ${tag}`, err.message);
  }
}

/* =====================================================
   1️⃣ TICKET CONFIRMATION
===================================================== */
export async function sendTicketConfirmation({ toEmail, ticketNumber }) {
  if (!toEmail) return;

  await sendEmail(
    {
      From: process.env.FROM_EMAIL,
      To: toEmail,
      Subject: `Ticket Created — ${ticketNumber}`,
      TextBody: `
Your ticket ${ticketNumber} has been successfully created.

Our operations team will review it shortly.

Thank you,
Pariskq Operations Team
      `.trim(),
    },
    "TICKET_CONFIRMATION"
  );
}

/* =====================================================
   FE ASSIGNMENT EMAIL
===================================================== */
export async function sendFEAssignmentEmail({
  feId,
  ticketNumber,
}) {
  try {
    console.log("[FE ASSIGN EMAIL] START");

    if (!feId) {
      console.error("[FE ASSIGN EMAIL] Missing feId");
      return;
    }

    if (!ticketNumber) {
      console.error("[FE ASSIGN EMAIL] Missing ticketNumber");
      return;
    }

    // Fetch FE email from Supabase
    const { data: fe, error } = await supabase
      .from("field_executives")
      .select("email, name")
      .eq("id", feId)
      .single();

    if (error || !fe?.email) {
      console.error("[FE ASSIGN EMAIL] FE email not found:", feId);
      return;
    }

    await sendEmail(
      {
        From: process.env.FROM_EMAIL,
        To: fe.email,
        Subject: `New Ticket Assigned — ${ticketNumber}`,
        TextBody: `
Hello ${fe.name || ""},

You have been assigned Ticket ${ticketNumber}.

Please log into the Field Ops dashboard to begin the work.

Thank you,
Pariskq Operations Team
        `.trim(),
      },
      "FE_ASSIGNMENT"
    );

    console.log("[FE ASSIGN EMAIL] SUCCESS");

  } catch (err) {
    console.error("[FE ASSIGN EMAIL ERROR]", err);
  }
}


/* =====================================================
   FE ACTION TOKEN EMAIL (ON_SITE / RESOLUTION)
===================================================== */
export async function sendFETokenEmail({ feId, ticketNumber, token, type }) {
  try {
    if (!feId || !ticketNumber || !token) {
      console.error("[FE TOKEN EMAIL] Missing feId, ticketNumber, or token");
      return;
    }

    const { data: fe, error } = await supabase
      .from("field_executives")
      .select("email, name")
      .eq("id", feId)
      .single();

    if (error || !fe?.email) {
      console.error("[FE TOKEN EMAIL] FE not found or no email:", feId);
      return;
    }

    const actionLabel = type === "RESOLUTION" ? "Resolution" : "On-Site";
    const baseUrl = process.env.APP_URL || process.env.FRONTEND_URL || "";
    const actionUrl = baseUrl ? `${baseUrl.replace(/\/$/, "")}/fe/action/${token}` : `#/fe/action/${token}`;

    await sendEmail(
      {
        From: process.env.FROM_EMAIL,
        To: fe.email,
        Subject: `${actionLabel} proof required — ${ticketNumber}`,
        TextBody: `
Hello ${fe.name || ""},

Please submit your ${actionLabel.toLowerCase()} proof for Ticket ${ticketNumber}.

Link: ${actionUrl}

Thank you,
Pariskq Operations Team
        `.trim(),
      },
      "FE_TOKEN_EMAIL"
    );
  } catch (err) {
    console.error("[FE TOKEN EMAIL ERROR]", err.message);
  }
}

/* =====================================================
   3️⃣ CLIENT RESOLUTION EMAIL (IDEMPOTENT)
===================================================== */
export async function sendClientResolutionEmail({
  toEmail,
  ticketNumber,
}) {
  if (!toEmail) return;

  await sendEmail(
    {
      From: process.env.FROM_EMAIL,
      To: toEmail,
      Subject: `Ticket Resolved — ${ticketNumber}`,
      TextBody: `
Your ticket ${ticketNumber} has been successfully resolved.

If you have further issues, feel free to raise a new ticket.

Thank you,
Pariskq Operations Team
      `.trim(),
    },
    "CLIENT_RESOLUTION"
  );
}

/* =====================================================
   🔒 EXPORT ALIASES (RENDER-SAFE)
===================================================== */
export const sendResolutionEmail = sendClientResolutionEmail;
export const sendClientClosureEmail = sendClientResolutionEmail;
