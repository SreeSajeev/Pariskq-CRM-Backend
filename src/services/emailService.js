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
    // 🔒 Enforce lifecycle correctness
    if (type !== "ON_SITE" && type !== "RESOLUTION") {
      console.error("[sendFETokenEmail] Invalid action type:", type);
      return;
    }

    const { data: fe, error } = await supabase
      .from("field_executives")
      .select("email, name")
      .eq("id", feId)
      .single();

    if (error || !fe?.email) {
      console.error("[sendFETokenEmail] FE email not found", feId);
      return;
    }

    if (!process.env.FIELD_OPS_URL) {
      console.error("[sendFETokenEmail] FIELD_OPS_URL not set");
      return;
    }

    const label =
      type === "RESOLUTION"
        ? "Resolution Action Required"
        : "On-site Action Required";

    const link = `${process.env.FIELD_OPS_URL}/fe/action/${token}`;

    await sendEmail(
      {
        From: process.env.FROM_EMAIL,
        To: fe.email,
        Subject: `${label} — Ticket ${ticketNumber}`,
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
  } catch (err) {
    console.error("[sendFETokenEmail]", err.message);
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
