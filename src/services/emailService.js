// src/services/emailService.js
import { supabase } from "../supabaseClient.js";

const POSTMARK_URL = "https://api.postmarkapp.com/email";

function canSendEmail() {
  return Boolean(
    process.env.POSTMARK_SERVER_TOKEN &&
    process.env.FROM_EMAIL
  );
}

function isValidTicketNumber(ticketNumber) {
  return typeof ticketNumber === "string" && ticketNumber.trim().length > 0;
}

function isValidToEmail(toEmail) {
  return typeof toEmail === "string" && toEmail.trim().length > 0;
}

function generateTicketSubjectTag(ticketNumber) {
  return `[Ticket ID: ${String(ticketNumber).trim()}]`;
}

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

export async function sendTicketConfirmation({ toEmail, ticketNumber }) {
  if (!isValidToEmail(toEmail)) return;
  if (!isValidTicketNumber(ticketNumber)) return;

  try {
    const subjectTag = generateTicketSubjectTag(ticketNumber);
    await sendEmail(
      {
        From: process.env.FROM_EMAIL,
        To: toEmail.trim(),
        Subject: `Complaint Received - ${subjectTag}`,
        TextBody: `
Your ticket ${ticketNumber} has been successfully created.

Our operations team will review it shortly.

Thank you,
Pariskq Operations Team
      `.trim(),
      },
      "TICKET_CONFIRMATION"
    );
  } catch (err) {
    console.error("[EMAIL:TICKET_CONFIRMATION]", err.message);
  }
}

function formatOptional(value) {
  if (value == null || String(value).trim() === "") return null;
  return String(value).trim();
}

export async function sendMissingDetailsEmail({ toEmail, ticketNumber, missingDetails, receivedDetails, subject, complaintId, category, issueType, location }) {
  if (!isValidToEmail(toEmail)) return;
  if (!isValidTicketNumber(ticketNumber)) return;

  try {
    const subjectTag = generateTicketSubjectTag(ticketNumber);
    const receivedList = Array.isArray(receivedDetails) && receivedDetails.length > 0
      ? receivedDetails.map((d) => `• ${d}`).join("\n")
      : "• None listed";
    const missingList = Array.isArray(missingDetails) && missingDetails.length > 0
      ? missingDetails.map((d) => `• ${d}`).join("\n")
      : "• Additional information to help us process your request";

    const summaryLines = [];
    if (formatOptional(subject)) summaryLines.push(`Subject: ${formatOptional(subject)}`);
    if (formatOptional(complaintId)) summaryLines.push(`Complaint ID: ${formatOptional(complaintId)}`);
    if (formatOptional(category)) summaryLines.push(`Category: ${formatOptional(category)}`);
    if (formatOptional(issueType)) summaryLines.push(`Issue type: ${formatOptional(issueType)}`);
    if (formatOptional(location)) summaryLines.push(`Location: ${formatOptional(location)}`);
    const complaintSummary = summaryLines.length > 0 ? summaryLines.join("\n") : "—";

    const body = `
Hello,

Your ticket ${ticketNumber} has been created. We need a few more details to proceed.

Reference (what we have so far):
${complaintSummary}

Fields we received:
${receivedList}

Fields we need:
${missingList}

When replying, please include [Ticket ID: ${ticketNumber}] in the subject line.

Thank you,
Pariskq Operations Team
    `.trim();

    await sendEmail(
      {
        From: process.env.FROM_EMAIL,
        To: toEmail.trim(),
        Subject: `Re: ${subjectTag} Additional Details Required`,
        TextBody: body,
      },
      "MISSING_DETAILS"
    );
  } catch (err) {
    console.error("[EMAIL:MISSING_DETAILS]", err.message);
  }
}

export async function sendFEAssignmentEmail({
  feId,
  ticketNumber,
}) {
  try {
    if (!feId) {
      console.error("[FE ASSIGN EMAIL] Missing feId");
      return;
    }
    if (!isValidTicketNumber(ticketNumber)) {
      console.error("[FE ASSIGN EMAIL] Invalid ticketNumber");
      return;
    }

    const { data: fe, error } = await supabase
      .from("field_executives")
      .select("email, name")
      .eq("id", feId)
      .single();

    if (error || !fe?.email) {
      console.error("[FE ASSIGN EMAIL] FE email not found:", feId);
      return;
    }

    const subjectTag = generateTicketSubjectTag(ticketNumber);
    await sendEmail(
      {
        From: process.env.FROM_EMAIL,
        To: fe.email,
        Subject: `New Ticket Assigned - ${subjectTag}`,
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
  } catch (err) {
    console.error("[FE ASSIGN EMAIL ERROR]", err.message);
  }
}

export async function sendFETokenEmail({ feId, ticketNumber, token, type }) {
  try {
    if (!feId || !isValidTicketNumber(ticketNumber) || !token) {
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
    const subjectTag = generateTicketSubjectTag(ticketNumber);

    await sendEmail(
      {
        From: process.env.FROM_EMAIL,
        To: fe.email,
        Subject: `${actionLabel} proof required - ${subjectTag}`,
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

export async function sendClientResolutionEmail({
  toEmail,
  ticketNumber,
}) {
  if (!isValidToEmail(toEmail)) return;
  if (!isValidTicketNumber(ticketNumber)) return;

  try {
    const subjectTag = generateTicketSubjectTag(ticketNumber);
    await sendEmail(
      {
        From: process.env.FROM_EMAIL,
        To: toEmail.trim(),
        Subject: `Ticket Resolved - ${subjectTag}`,
        TextBody: `
Your ticket ${ticketNumber} has been successfully resolved.

If you have further issues, feel free to raise a new ticket.

Thank you,
Pariskq Operations Team
      `.trim(),
      },
      "CLIENT_RESOLUTION"
    );
  } catch (err) {
    console.error("[EMAIL:CLIENT_RESOLUTION]", err.message);
  }
}

export const sendResolutionEmail = sendClientResolutionEmail;
export const sendClientClosureEmail = sendClientResolutionEmail;
