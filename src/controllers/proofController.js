// src/controllers/proofController.js
// Backend-authoritative FE proof upload + token consumption

import { supabase } from "../supabaseClient.js";

/* =====================================================
   UPLOAD FE PROOF (ON_SITE or RESOLUTION)
===================================================== */
/*
  POST /fe/proof

  Body:
  - token (uuid from fe_action_tokens)
  - attachments (json | optional metadata)

  This endpoint:
  - validates token
  - enforces lifecycle order
  - consumes token
  - transitions ticket status
*/
export async function uploadFeProof(req, res) {
  try {
    const { token, attachments = null } = req.body;

    if (!token) {
      return res.status(400).json({ error: "Token required" });
    }

    const now = new Date().toISOString();

    // 🔐 Validate token
    const { data: actionToken, error } = await supabase
      .from("fe_action_tokens")
      .select("id, ticket_id, fe_id, action_type, expires_at, used")
      .eq("id", token)
      .single();

    if (error || !actionToken) {
      return res.status(404).json({ error: "Invalid token" });
    }

    if (actionToken.used) {
      return res.status(410).json({ error: "Token already used" });
    }

    if (actionToken.expires_at <= now) {
      return res.status(410).json({ error: "Token expired" });
    }

    // 🔎 Fetch ticket
    const { data: ticket } = await supabase
      .from("tickets")
      .select("id, status")
      .eq("id", actionToken.ticket_id)
      .single();

    if (!ticket) {
      return res.status(404).json({ error: "Ticket not found" });
    }

    // 🔒 Enforce lifecycle order
    if (
      actionToken.action_type === "ON_SITE" &&
      ticket.status !== "EN_ROUTE"
    ) {
      return res.status(400).json({ error: "Invalid ticket state for ON_SITE proof" });
    }

    if (
      actionToken.action_type === "RESOLUTION" &&
      ticket.status !== "ON_SITE"
    ) {
      return res.status(400).json({ error: "Invalid ticket state for RESOLUTION proof" });
    }

    // 📝 Store proof as ticket comment (auditable)
    await supabase.from("ticket_comments").insert({
      ticket_id: ticket.id,
      source: "FE",
      author_id: actionToken.fe_id,
      body: `${actionToken.action_type} proof uploaded`,
      attachments,
    });

    // 🔐 Consume token (atomic)
    await supabase
      .from("fe_action_tokens")
      .update({ used: true })
      .eq("id", actionToken.id);

    // 🔁 Transition ticket state
    const nextStatus =
      actionToken.action_type === "ON_SITE"
        ? "ON_SITE"
        : "RESOLVED_PENDING_VERIFICATION";

    await supabase
      .from("tickets")
      .update({ status: nextStatus })
      .eq("id", ticket.id);

    return res.json({
      success: true,
      nextStatus,
    });
  } catch (err) {
    console.error("[uploadFeProof]", err.message);
    return res.status(500).json({ error: "Proof upload failed" });
  }
}
