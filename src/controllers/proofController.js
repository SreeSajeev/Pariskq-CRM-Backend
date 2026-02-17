// src/controllers/proofController.js
// Backend-authoritative FE proof upload + lifecycle enforcement

import { supabase } from "../supabaseClient.js";

/* =====================================================
   UPLOAD FE PROOF (ON_SITE or RESOLUTION)
===================================================== */
export async function uploadFeProof(req, res) {
  try {
    const { token, attachments = null } = req.body;

    if (!token) {
      return res.status(400).json({ error: "Token required" });
    }

    const nowISO = new Date().toISOString();

    /* =====================================================
       1️⃣ VALIDATE TOKEN (UNUSED + UNEXPIRED)
    ===================================================== */
    const { data: actionToken, error: tokenError } = await supabase
      .from("fe_action_tokens")
      .select("id, ticket_id, fe_id, action_type, expires_at")
      .eq("id", token)
      .eq("used", false)
      .gt("expires_at", nowISO)
      .single();

    if (tokenError || !actionToken) {
      return res.status(404).json({
        error: "Invalid or expired token",
      });
    }

    /* =====================================================
       2️⃣ FETCH TICKET
    ===================================================== */
    const { data: ticket, error: ticketError } = await supabase
      .from("tickets")
      .select("id, status")
      .eq("id", actionToken.ticket_id)
      .single();

    if (ticketError || !ticket) {
      return res.status(404).json({
        error: "Ticket not found",
      });
    }

    /* =====================================================
       3️⃣ ENFORCE LIFECYCLE ORDER
       ALIGN WITH tickets.js:
       OPEN → ASSIGNED → ON_SITE → RESOLVED_PENDING_VERIFICATION → RESOLVED
    ===================================================== */
    if (
      actionToken.action_type === "ON_SITE" &&
      ticket.status !== "ASSIGNED"
    ) {
      return res.status(400).json({
        error: "Invalid ticket state for ON_SITE proof",
      });
    }

    if (
      actionToken.action_type === "RESOLUTION" &&
      ticket.status !== "ON_SITE"
    ) {
      return res.status(400).json({
        error: "Invalid ticket state for RESOLUTION proof",
      });
    }

    /* =====================================================
       4️⃣ STORE PROOF (AUDITABLE)
    ===================================================== */
    const { error: commentError } = await supabase
      .from("ticket_comments")
      .insert({
        ticket_id: ticket.id,
        source: "FE",
        author_id: actionToken.fe_id,
        body: `${actionToken.action_type} proof uploaded`,
        attachments,
      });

    if (commentError) {
      throw commentError;
    }

    /* =====================================================
       5️⃣ TRANSITION TICKET STATE
    ===================================================== */
    const nextStatus =
      actionToken.action_type === "ON_SITE"
        ? "ON_SITE"
        : "RESOLVED_PENDING_VERIFICATION";

    const { error: statusError } = await supabase
      .from("tickets")
      .update({ status: nextStatus })
      .eq("id", ticket.id);

    if (statusError) {
      throw statusError;
    }

    /* =====================================================
       6️⃣ ATOMIC TOKEN CONSUMPTION (LAST)
    ===================================================== */
    const { data: consumed, error: consumeError } = await supabase
      .from("fe_action_tokens")
      .update({ used: true })
      .eq("id", actionToken.id)
      .eq("used", false)
      .select("id");

    if (consumeError) {
      throw consumeError;
    }

    if (!consumed || consumed.length === 0) {
      return res.status(409).json({
        error: "Token already consumed",
      });
    }

    return res.json({
      success: true,
      nextStatus,
    });
  } catch (err) {
    console.error("[uploadFeProof]", err.message);
    return res.status(500).json({
      error: "Proof upload failed",
    });
  }
}
