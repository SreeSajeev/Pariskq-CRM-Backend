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
   2️⃣ FE ACTION TOKEN EMAIL (STRICT CONTRACT)
===================================================== */
export async function sendFETokenEmail({
  feId,
  ticketNumber,
  token,
  type,
}) {
  try {
    console.log("[FE TOKEN EMAIL] START");

    if (!feId) {
      console.error("[FE TOKEN EMAIL] Missing feId");
      return;
    }

    if (!ticketNumber) {
      console.error("[FE TOKEN EMAIL] Missing ticketNumber");
      return;
    }

    if (!token) {
      console.error("[FE TOKEN EMAIL] Missing token");
      return;
    }

    // 🔥 Accept both string or object token
    const tokenId =
      typeof token === "string"
        ? token
        : token.tokenId || token.id;

    if (!tokenId) {
      console.error("[FE TOKEN EMAIL] Invalid token format:", token);
      return;
    }

    const { data: fe, error } = await supabase
      .from("field_executives")
      .select("email, name")
      .eq("id", feId)
      .single();

    if (error || !fe?.email) {
      console.error("[FE TOKEN EMAIL] FE email not found:", feId);
      return;
    }

    if (!process.env.FIELD_OPS_URL) {
      console.error("[FE TOKEN EMAIL] FIELD_OPS_URL missing");
      return;
    }

    const actionLabel =
      type === "RESOLUTION"
        ? "Resolution Action Required"
        : "On-Site Action Required";

    const link = `${process.env.FIELD_OPS_URL}/fe/action/${tokenId}`;

    console.log("[FE TOKEN EMAIL] Sending to:", fe.email);
    console.log("[FE TOKEN EMAIL] Link:", link);

    await sendEmail(
      {
        From: process.env.FROM_EMAIL,
        To: fe.email,
        Subject: `${actionLabel} — Ticket ${ticketNumber}`,
        TextBody: `
Hello ${fe.name || ""},

You have been assigned a ${type} task for Ticket ${ticketNumber}.

Please complete the required action using the link below:

${link}

This link is time-sensitive and can only be used once.

Thank you,
Pariskq Operations Team
        `.trim(),
      },
      `FE_ACTION_${type}`
    );

    console.log("[FE TOKEN EMAIL] SUCCESS");

  } catch (err) {
    console.error("[FE TOKEN EMAIL ERROR]", err);
  }
}

/* =====================================================
   FE ASSIGNMENT EMAIL (SIMPLE)
===================================================== */
export async function sendFEAssignmentEmail({
  feId,
  ticketNumber,
}) {
  try {
    console.log("=== FE ASSIGNMENT EMAIL START ===");

    if (!feId || !ticketNumber) {
      console.error("Missing feId or ticketNumber");
      return;
    }

    const { data: fe, error } = await supabase
      .from("field_executives")
      .select("email, name")
      .eq("id", feId)
      .single();

    if (error || !fe?.email) {
      console.error("FE email not found:", feId);
      return;
    }

    await sendEmail(
      {
        From: process.env.FROM_EMAIL,
        To: fe.email,
        Subject: `New Ticket Assigned — ${ticketNumber}`,
        TextBody: `
Hello ${fe.name || ""},

You have been assigned a new ticket.

Ticket Number: ${ticketNumber}

Please log into the Field Executive dashboard to view details.

${process.env.FIELD_OPS_URL}

Thank you,
Pariskq Operations Team
        `.trim(),
      },
      "FE_ASSIGNMENT"
    );

    console.log("=== FE ASSIGNMENT EMAIL SENT ===");

  } catch (err) {
    console.error("FE ASSIGNMENT EMAIL ERROR:", err);
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
