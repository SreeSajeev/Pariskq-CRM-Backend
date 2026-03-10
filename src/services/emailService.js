// src/services/emailService.js
import { supabase } from "../supabaseClient.js";
import { APP_BASE_URL } from "../config/appConfig.js";

const POSTMARK_URL = "https://api.postmarkapp.com/email";

/** From address: FROM_EMAIL or MAIL_FROM_EMAIL (trimmed). */
function getFromEmail() {
  const v = process.env.FROM_EMAIL || process.env.MAIL_FROM_EMAIL;
  return v != null && String(v).trim() !== "" ? String(v).trim() : null;
}

/** From header value: "Name <email>" if MAIL_FROM_NAME set, else email. */
function getFromAddress() {
  const email = getFromEmail();
  if (!email) return null;
  const name = process.env.MAIL_FROM_NAME && String(process.env.MAIL_FROM_NAME).trim();
  return name ? `${name} <${email}>` : email;
}

function canSendEmail() {
  const token = process.env.POSTMARK_SERVER_TOKEN && String(process.env.POSTMARK_SERVER_TOKEN).trim();
  return Boolean(token && getFromEmail());
}

/** Temporary: log env presence for debugging (no secret values). */
function logEmailEnvStatus(tag) {
  const hasToken = Boolean(process.env.POSTMARK_SERVER_TOKEN && String(process.env.POSTMARK_SERVER_TOKEN).trim());
  const fromEmail = getFromEmail();
  const hasFrom = Boolean(fromEmail);
  console.log(`[EMAIL ENV] ${tag} — POSTMARK_SERVER_TOKEN=${hasToken ? "set" : "MISSING"}, FROM=${hasFrom ? "set" : "MISSING"} (FROM_EMAIL/MAIL_FROM_EMAIL)`);
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
  const fromAddr = getFromAddress();
  if (!canSendEmail() || !fromAddr) {
    const msg = `Email not configured: missing POSTMARK_SERVER_TOKEN or FROM_EMAIL/MAIL_FROM_EMAIL`;
    console.error(`[EMAIL SKIPPED] ${tag} — ${msg}`);
    return;
  }
  const payloadWithFrom = { ...payload, From: fromAddr };

  try {
    console.log(`[EMAIL_TRIGGER] ${tag} To=${payloadWithFrom.To}`);
    const res = await fetch(POSTMARK_URL, {
      method: "POST",
      headers: {
        "X-Postmark-Server-Token": process.env.POSTMARK_SERVER_TOKEN,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payloadWithFrom),
    });

    const text = await res.text();
    if (!res.ok) {
      console.error(`[EMAIL FAILED] ${tag} status=${res.status} body=`, text);
      return;
    }
    console.log(`[EMAIL SENT] ${tag} To=${payloadWithFrom.To}`);
  } catch (err) {
    console.error(`[EMAIL ERROR] ${tag}`, err.message);
  }
}

/** Build short issue summary from category, issueType, location; max 200 chars. */
function buildShortIssueSummary(category, issueType, location) {
  const parts = [category, issueType, location].filter(
    (v) => v != null && String(v).trim() !== ""
  ).map((v) => String(v).trim());
  if (parts.length === 0) return "Not provided";
  const summary = parts.join(" · ");
  return summary.length > 200 ? summary.slice(0, 197) + "..." : summary;
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
    const shortSummary = buildShortIssueSummary(category, issueType, location);
    const detailsBlock = `
Ticket Details:
---------------------------------
Complaint ID: ${formatDetail(complaintId)}
Vehicle Number: ${formatDetail(vehicleNumber)}
Category: ${formatDetail(category)}
Issue Type: ${formatDetail(issueType)}
Location: ${formatDetail(location)}
Short issue summary: ${formatDetail(shortSummary)}
---------------------------------
`.trim();

    const textBody = [
      "Hello,",
      "",
      `Your ticket ${ticketNumber} has been successfully created.`,
      "",
      detailsBlock,
      "",
      "If you need to reference this request, please mention the ticket ID above.",
      "Our operations team will review it shortly.",
      "",
      "Thank you,",
      "Pariskq Operations Team",
    ].join("\n");

    await sendEmail(
      {
        To: toEmail.trim(),
        Subject: `Complaint Received - Ticket ${String(ticketNumber).trim()}`,
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
      console.error("[FE ASSIGN EMAIL] FE email not found:", feId, error?.message || "no email");
      return;
    }
    console.log("[FE ASSIGN EMAIL] FE found email=", fe.email, "name=", fe.name || "(none)");

    const subjectTag = generateTicketSubjectTag(ticketNumber);
    console.log("EMAIL_TRIGGER_ASSIGNMENT", fe.email, "ticketNumber=", ticketNumber);
    await sendEmail(
      {
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
  }
}

export async function sendFETokenEmail({ feId, ticketNumber, token, type }) {
  try {
    console.log("[FE TOKEN EMAIL] FE lookup feId=", feId, "type=", type);
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
      console.error("[FE TOKEN EMAIL] FE not found or no email:", feId, error?.message || "no email");
      return;
    }
    console.log("[FE TOKEN EMAIL] FE found email=", fe.email);

    const actionLabel = type === "RESOLUTION" ? "Resolution" : "On-Site";
    const actionUrl = `${APP_BASE_URL}/fe/action/${token}`;
    const subjectTag = generateTicketSubjectTag(ticketNumber);
    console.log("EMAIL_TRIGGER_FE_TOKEN", fe.email, "type=", type, "ticketNumber=", ticketNumber);

    await sendEmail(
      {
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
    console.log("EMAIL_TRIGGER_RESOLUTION", toEmail, "ticketNumber=", ticketNumber);
    await sendEmail(
      {
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
