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
 * @param {{ phoneNumber: string, message: string }} params
 * @returns {Promise<boolean>} true if sent successfully; logs errors, does not throw
 */
export async function sendFESms({ phoneNumber, message }) {
  const rawPhone = phoneNumber != null ? String(phoneNumber).trim() : "";
  const cleanPhone = sanitizePhoneForSms(rawPhone);
  if (cleanPhone.length !== 10) {
    console.error("[SMS] Skipped: invalid or missing 10-digit phone");
    return false;
  }

  const baseUrl = process.env.FAST2SMS_BASE_URL || FAST2SMS_BULK_V2;
  const key = process.env.FAST2SMS_API_KEY;
  if (!key || !String(key).trim()) {
    console.error("[SMS] Failed: FAST2SMS_API_KEY not set");
    return false;
  }

  const route = process.env.FAST2SMS_ROUTE || "q";
  const flash = process.env.FAST2SMS_FLASH != null ? Number(process.env.FAST2SMS_FLASH) : 0;

  console.log("📩 Sending SMS to:", cleanPhone);
  console.log("📩 SMS Body:", message);

  try {
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

    console.log("📩 Fast2SMS response:", data);

    if (status >= 200 && status < 300) {
      console.log("[SMS] Sent successfully");
      return true;
    }
    const errMsg = (data && (data.message || data.msg)) || `status ${status}`;
    console.error("[SMS] Failed:", errMsg);
    return false;
  } catch (err) {
    const errMsg = err?.message || String(err);
    console.error("[SMS] Failed:", errMsg);
    return false;
  }
}
