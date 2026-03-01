/**
 * SMS service — Fast2SMS QuickSMS (bulkV2).
 * Endpoint: https://www.fast2sms.com/dev/bulkV2
 * Params: authorization, route, message, numbers (10-digit), flash=0
 * Uses env: FAST2SMS_API_KEY (required), FAST2SMS_BASE_URL (optional), FAST2SMS_ROUTE, FRONTEND_URL.
 */

import axios from "axios";

const FAST2SMS_BULK_V2 = "https://www.fast2sms.com/dev/bulkV2";

/**
 * Build FE action page URL for SMS/email.
 * @param {string} tokenId - fe_action_tokens.id (UUID)
 * @returns {string}
 */
export function buildFEActionURL(tokenId) {
  const base = (process.env.FRONTEND_URL || process.env.APP_URL || "https://opsxbypariskq.vercel.app").replace(/\/$/, "");
  return `${base}/fe/action/${tokenId}`;
}

/**
 * Sanitize Indian mobile to 10 digits (no country code, spaces, or dashes).
 * @param {string} phone
 * @returns {string} 10-digit or empty
 */
export function sanitizePhoneForSms(phone) {
  if (!phone || typeof phone !== "string") return "";
  const digits = phone.replace(/\D/g, "");
  return digits.slice(-10);
}

/**
 * Send SMS to a single number via Fast2SMS bulkV2 (GET with query params).
 * Logs errors, does not throw. Assignment must never be affected by SMS failure.
 * @param {{ phoneNumber: string, message: string }} params
 * @returns {Promise<boolean>} true if sent successfully; false on validation/provider/network failure
 */
export async function sendFESms({ phoneNumber, message }) {
  const rawPhone = phoneNumber != null ? String(phoneNumber).trim() : "";
  const cleanPhone = sanitizePhoneForSms(rawPhone);

  const key = process.env.FAST2SMS_API_KEY;
  const hasKey = Boolean(key && String(key).trim());
  console.log("[SMS ENV] FAST2SMS_API_KEY=", hasKey ? "set" : "MISSING");
  console.log("[SMS] phone last4=", cleanPhone.length === 10 ? cleanPhone.slice(-4) + "****" : "invalid", "len=", cleanPhone.length);

  if (cleanPhone.length !== 10) {
    console.error("[SMS] Skipped: invalid or missing 10-digit phone");
    return false;
  }

  const baseUrl = process.env.FAST2SMS_BASE_URL || FAST2SMS_BULK_V2;
  if (!hasKey) {
    console.error("[SMS] Failed: FAST2SMS_API_KEY not set");
    return false;
  }

  const route = process.env.FAST2SMS_ROUTE || "q";
  const flash = process.env.FAST2SMS_FLASH != null ? Number(process.env.FAST2SMS_FLASH) : 0;

  console.log("[SMS] Sending to ****" + cleanPhone.slice(-4), "route=", route);

  try {
    console.log(">>> About to call Fast2SMS");
    const { data, status } = await axios.get(baseUrl, {
      params: {
        authorization: key,
        route,
        message: message ?? "",
        numbers: cleanPhone,
        flash,
      },
      timeout: 10000,
    });

    console.log("[SMS] Fast2SMS response status=", status, "body=", JSON.stringify(data));

    if (status >= 200 && status < 300) {
      console.log("[SMS] Sent successfully");
      return true;
    }
    const errMsg = (data && (data.message || data.msg)) ? String(data.message || data.msg) : `status ${status}`;
    console.error("[SMS] Provider error:", errMsg);
    return false;
  } catch (err) {
    if (err.response) {
      console.error("[SMS] Provider response status=", err.response.status, "data=", JSON.stringify(err.response.data));
    }
    const errMsg = err?.message || String(err);
    console.error("[SMS] Request failed:", errMsg);
    return false;
  }
}
