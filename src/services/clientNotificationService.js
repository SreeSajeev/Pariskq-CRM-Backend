// src/services/clientNotificationService.js

import { supabase } from "../supabaseClient.js";
import { sendClientResolutionEmail } from "./emailService.js";

export async function handleClientResolutionNotification(ticketId) {
  try {
    if (!ticketId) {
      console.error("[CLIENT_NOTIFY] Missing ticketId");
      return;
    }

    // Fetch ticket details
    const { data: ticket, error } = await supabase
      .from("tickets")
      .select("opened_by_email, ticket_number")
      .eq("id", ticketId)
      .single();

    if (error || !ticket) {
      console.error("[CLIENT_NOTIFY] Ticket fetch failed", error);
      return;
    }

    if (!ticket.opened_by_email) {
      console.error("[CLIENT_NOTIFY] No client email found");
      return;
    }

    console.log("📧 Sending resolution email to:", ticket.opened_by_email);

    await sendClientResolutionEmail({
      toEmail: ticket.opened_by_email,
      ticketNumber: ticket.ticket_number,
    });

  } catch (err) {
    console.error("[CLIENT_NOTIFY ERROR]", err.message);
  }
}
