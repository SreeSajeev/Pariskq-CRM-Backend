// src/services/clientNotificationService.js

import { supabase } from "../supabaseClient.js";
import { sendClientClosureEmail } from "./emailService.js";

/**
 * Client Resolution Notification
 *
 * RULES:
 * - MUST NEVER block ticket closure
 * - MUST NEVER throw
 * - Logs failures for demo visibility
 * - Supports consolidated + single-ticket modes
 */
export async function handleClientResolutionNotification(clientEmail) {
  try {
    if (!clientEmail) {
      console.warn("[CLIENT_NOTIFY] Missing client email");
      return;
    }

    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

    const { data: resolvedTickets, error } = await supabase
      .from("tickets")
      .select("ticket_number, category")
      .eq("opened_by_email", clientEmail)
      .eq("status", "RESOLVED")
      .gte("updated_at", oneWeekAgo.toISOString());

    if (error) {
      console.error("[CLIENT_NOTIFY] Ticket query failed", error);
      return;
    }

    if (!resolvedTickets || resolvedTickets.length === 0) {
      return;
    }

    // 🔁 Consolidated notification
    if (resolvedTickets.length >= 5) {
      await sendClientClosureEmail({
        toEmail: clientEmail,
        consolidated: true,
        tickets: resolvedTickets,
      });
      return;
    }

    // 🔁 Individual notifications
    for (const ticket of resolvedTickets) {
      await sendClientClosureEmail({
        toEmail: clientEmail,
        consolidated: false,
        ticket,
      });
    }
  } catch (err) {
    // 🔥 ABSOLUTE RULE: NEVER THROW
    console.error("[CLIENT_NOTIFY] Resolution email failed", {
      clientEmail,
      message: err.message,
    });
  }
}
