// src/services/emailService.js
import { supabase } from "../supabaseClient.js";

const POSTMARK_URL = "https://api.postmarkapp.com/email";

function canSendEmail() {
  return Boolean(
    process.env.POSTMARK_SERVER_TOKEN &&
    process.env.FROM_EMAIL
  );
}

/** Temporary: log env presence for debugging (no secret values). */
function logEmailEnvStatus(tag) {
  const hasToken = Boolean(process.env.POSTMARK_SERVER_TOKEN && String(process.env.POSTMARK_SERVER_TOKEN).trim());
  const hasFrom = Boolean(process.env.FROM_EMAIL && String(process.env.FROM_EMAIL).trim());
  console.log(`[EMAIL ENV] ${tag} — POSTMARK_SERVER_TOKEN=${hasToken ? "set" : "MISSING"}, FROM_EMAIL=${hasFrom ? "set" : "MISSING"}`);
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

/** For email body detail lines: null/undefined/empty -> "Not provided" */
function formatDetail(value) {
  if (value == null) return "Not provided";
  const s = String(value).trim();
  return s === "" ? "Not provided" : s;
}

async function sendEmail(payload, tag) {
  logEmailEnvStatus(tag);
  if (!canSendEmail()) {
    const msg = `Email not configured: missing POSTMARK_SERVER_TOKEN or FROM_EMAIL`;
    console.error(`[EMAIL SKIPPED] ${tag} — ${msg}`);
    throw new Error(msg);
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

    const text = await res.text();
    if (!res.ok) {
      console.error(`[EMAIL FAILED] ${tag} status=${res.status} body=`, text);
      throw new Error(`Postmark ${tag} failed: ${res.status} ${text}`);
    }
    console.log(`[EMAIL SENT] ${tag} To=${payload.To}`);
  } catch (err) {
    console.error(`[EMAIL ERROR] ${tag}`, err.message);
    throw err;
  }
}

export async function sendTicketConfirmation({
  toEmail,
  ticketNumber,
  complaintId = null,
  vehicleNumber = null,
  category = null,
  issueType = null,
  location = null,
}) {
  if (!isValidToEmail(toEmail)) return;
  if (!isValidTicketNumber(ticketNumber)) return;

  try {
    const subjectTag = generateTicketSubjectTag(ticketNumber);
    const detailsBlock = `
Ticket Details:
---------------------------------
Complaint ID: ${formatDetail(complaintId)}
Vehicle Number: ${formatDetail(vehicleNumber)}
Category: ${formatDetail(category)}
Issue Type: ${formatDetail(issueType)}
Location: ${formatDetail(location)}
---------------------------------
`.trim();

    const textBody = `
Your ticket ${ticketNumber} has been successfully created.

${detailsBlock}

Our operations team will review it shortly.

Thank you,
Pariskq Operations Team
    `.trim();

    await sendEmail(
      {
        From: process.env.FROM_EMAIL,
        To: toEmail.trim(),
        Subject: `Complaint Received - ${subjectTag}`,
        TextBody: textBody,
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
    console.log("[FE ASSIGN EMAIL] FE lookup feId=", feId, "ticketNumber=", ticketNumber);
    if (!feId) {
      const msg = "Missing feId";
      console.error("[FE ASSIGN EMAIL]", msg);
      throw new Error(msg);
    }
    if (!isValidTicketNumber(ticketNumber)) {
      const msg = "Invalid ticketNumber";
      console.error("[FE ASSIGN EMAIL]", msg);
      throw new Error(msg);
    }

    const { data: fe, error } = await supabase
      .from("field_executives")
      .select("email, name")
      .eq("id", feId)
      .single();

    if (error || !fe?.email) {
      const msg = `FE email not found feId=${feId} error=${error?.message || "no email"}`;
      console.error("[FE ASSIGN EMAIL]", msg);
      throw new Error(msg);
    }
    console.log("[FE ASSIGN EMAIL] FE found email=", fe.email, "name=", fe.name || "(none)");

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
    console.log("[FE ASSIGN EMAIL] Sent to", fe.email);
  } catch (err) {
    console.error("[FE ASSIGN EMAIL ERROR]", err.message);
    throw err;
  }
}

export async function sendFETokenEmail({ feId, ticketNumber, token, type }) {
  try {
    console.log("[FE TOKEN EMAIL] FE lookup feId=", feId, "type=", type);
    if (!feId || !isValidTicketNumber(ticketNumber) || !token) {
      const msg = "Missing feId, ticketNumber, or token";
      console.error("[FE TOKEN EMAIL]", msg);
      throw new Error(msg);
    }

    const { data: fe, error } = await supabase
      .from("field_executives")
      .select("email, name")
      .eq("id", feId)
      .single();

    if (error || !fe?.email) {
      const msg = `FE not found or no email feId=${feId} error=${error?.message || "no email"}`;
      console.error("[FE TOKEN EMAIL]", msg);
      throw new Error(msg);
    }
    console.log("[FE TOKEN EMAIL] FE found email=", fe.email);

    const actionLabel = type === "RESOLUTION" ? "Resolution" : "On-Site";
    const baseUrl = (process.env.APP_URL || process.env.FRONTEND_URL || "https://opsxbypariskq.vercel.app").replace(/\/$/, "");
    const actionUrl = `${baseUrl}/fe/action/${token}`;
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
    console.log("[FE TOKEN EMAIL] Sent to", fe.email);
  } catch (err) {
    console.error("[FE TOKEN EMAIL ERROR]", err.message);
    throw err;
  }
}

export async function sendClientResolutionEmail({
  toEmail,
  ticketNumber,
  verificationRemarks = null,
  resolutionCategory = null,
  complaintId = null,
  vehicleNumber = null,
  category = null,
  issueType = null,
  location = null,
}) {
  if (!isValidToEmail(toEmail)) return;
  if (!isValidTicketNumber(ticketNumber)) return;

  try {
    const subjectTag = generateTicketSubjectTag(ticketNumber);
    const detailsBlock = `
Ticket Details:
---------------------------------
Complaint ID: ${formatDetail(complaintId)}
Vehicle Number: ${formatDetail(vehicleNumber)}
Category: ${formatDetail(category)}
Issue Type: ${formatDetail(issueType)}
Location: ${formatDetail(location)}
---------------------------------
`.trim();

    let textBody = `
Your ticket ${ticketNumber} has been successfully resolved.

${detailsBlock}

If you have further issues, feel free to raise a new ticket.

Thank you,
Pariskq Operations Team
    `.trim();
    const hasResolutionCategory =
      resolutionCategory != null && String(resolutionCategory).trim() !== "";
    if (hasResolutionCategory) {
      textBody += `\n\nResolution Category:\n${String(resolutionCategory).trim()}`;
    }
    if (
      verificationRemarks != null &&
      String(verificationRemarks).trim() !== ""
    ) {
      textBody += `\n\nStaff Verification Notes:\n${String(verificationRemarks).trim()}`;
    }
    await sendEmail(
      {
        From: process.env.FROM_EMAIL,
        To: toEmail.trim(),
        Subject: `Ticket Resolved - ${subjectTag}`,
        TextBody: textBody,
      },
      "CLIENT_RESOLUTION"
    );
  } catch (err) {
    console.error("[EMAIL:CLIENT_RESOLUTION]", err.message);
  }
}

export const sendResolutionEmail = sendClientResolutionEmail;
export const sendClientClosureEmail = sendClientResolutionEmail;
