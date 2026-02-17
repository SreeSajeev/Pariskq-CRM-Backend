// src/controllers/feActionsController.js
// Backend authoritative FE token validation

import { supabase } from "../supabaseClient.js";

/* =====================================================
   VALIDATE FE ACTION TOKEN
===================================================== */
export async function validateFeActionToken(req, res) {
  try {
    const { token } = req.params;

    if (!token) {
      return res.status(400).json({ error: "Token missing" });
    }

    const nowISO = new Date().toISOString();

    const { data: actionToken, error } = await supabase
      .from("fe_action_tokens")
      .select(
        `
        id,
        ticket_id,
        fe_id,
        action_type,
        expires_at,
        used,
        tickets (
          id,
          ticket_number,
          status
        )
      `
      )
      .eq("id", token)
      .single();

    if (error || !actionToken) {
      return res.status(404).json({ error: "Invalid token" });
    }

    if (actionToken.used) {
      return res.status(410).json({ error: "Token already used" });
    }

    if (actionToken.expires_at <= nowISO) {
      return res.status(410).json({ error: "Token expired" });
    }

    if (!actionToken.tickets) {
      return res.status(404).json({ error: "Ticket not found" });
    }

    const ticketStatus = actionToken.tickets.status;

    /* =====================================================
       🔒 LIFECYCLE ALIGNMENT (MATCHES YOUR ACTUAL FLOW)
       OPEN → ASSIGNED → ON_SITE → RESOLVED_PENDING_VERIFICATION
    ===================================================== */

    if (
      actionToken.action_type === "ON_SITE" &&
      ticketStatus !== "ASSIGNED"
    ) {
      return res.status(400).json({
        error: "Ticket not ready for ON_SITE action",
      });
    }

    if (
      actionToken.action_type === "RESOLUTION" &&
      ticketStatus !== "ON_SITE"
    ) {
      return res.status(400).json({
        error: "Ticket not ready for RESOLUTION action",
      });
    }

    return res.json({
      ticketId: actionToken.ticket_id,
      feId: actionToken.fe_id,
      actionType: actionToken.action_type,
      ticketNumber: actionToken.tickets.ticket_number,
      ticketStatus,
      expiresAt: actionToken.expires_at,
    });
  } catch (err) {
    console.error("[validateFeActionToken]", err.message);
    return res.status(500).json({ error: "Token validation failed" });
  }
}
