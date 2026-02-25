/**
 * SMS service — Fast2SMS QuickSMS (bulkV2).
 * Uses env: FAST2SMS_BASE_URL, FAST2SMS_API_KEY, FAST2SMS_ROUTE, FAST2SMS_FLASH.
 * Does not throw; logs and returns success boolean.
 */

import axios from "axios";

/**
 * Send SMS to a single number.
 * @param {{ phoneNumber: string, message: string }} params
 * @returns {Promise<boolean>} true if sent successfully, false otherwise (logs error, does not throw)
 */
export async function sendFESms({ phoneNumber, message }) {
  try {
    if (!phoneNumber || !String(phoneNumber).trim()) {
      return false;
    }
    const baseUrl = process.env.FAST2SMS_BASE_URL;
    const key = process.env.FAST2SMS_API_KEY;
    if (!baseUrl || !key || !String(key).trim()) {
      console.error("[SMS] Failed: FAST2SMS_BASE_URL or FAST2SMS_API_KEY not set");
      return false;
    }

    const { data, status } = await axios.get(baseUrl, {
      params: {
        authorization: key,
        route: process.env.FAST2SMS_ROUTE,
        flash: process.env.FAST2SMS_FLASH,
        message: message ?? "",
        numbers: String(phoneNumber).trim(),
      },
      timeout: 10000,
    });

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
