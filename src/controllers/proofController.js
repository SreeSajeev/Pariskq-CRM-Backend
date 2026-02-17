// src/controllers/proofController.js
import { supabase } from "../supabaseClient.js";

export async function uploadFeProof(req, res) {
  try {
    const { token, attachments = [] } = req.body;

    if (!token) {
      return res.status(400).json({ error: "Token required" });
    }

    /* =====================================================
       🔥 DEMO MODE — ALWAYS ACCEPT TOKEN IF EXISTS
    ===================================================== */

    const { data: actionToken } = await supabase
      .from("fe_action_tokens")
      .select("id, ticket_id, fe_id, action_type")
      .eq("id", token)
      .maybeSingle();

    if (!actionToken) {
      return res.status(404).json({ error: "Invalid token" });
    }

    const ticketId = actionToken.ticket_id;

    /* =====================================================
       🔥 ALWAYS INSERT PROOF COMMENT
    ===================================================== */

    const { error: commentError } = await supabase
      .from("ticket_comments")
      .insert({
        ticket_id: ticketId,
        source: "FE",
        author_id: actionToken.fe_id,
        body: `Demo ${actionToken.action_type} proof uploaded`,
        attachments,
        created_at: new Date().toISOString(),
      });

    if (commentError) {
      console.error("Comment Insert Error:", commentError);
    }

    /* =====================================================
       🔥 FORCE STATUS TRANSITION
       ON_SITE → ON_SITE
       RESOLUTION → RESOLVED_PENDING_VERIFICATION
    ===================================================== */

    let nextStatus =
      actionToken.action_type === "ON_SITE"
        ? "ON_SITE"
        : "RESOLVED_PENDING_VERIFICATION";

    const { error: updateError } = await supabase
      .from("tickets")
      .update({
        status: nextStatus,
        updated_at: new Date().toISOString(),
      })
      .eq("id", ticketId);

    if (updateError) {
      console.error("Status Update Error:", updateError);
    }

    /* =====================================================
       🔥 ALWAYS MARK TOKEN USED (IGNORE STATE)
    ===================================================== */

    await supabase
      .from("fe_action_tokens")
      .update({ used: true })
      .eq("id", token);

    return res.json({
      success: true,
      nextStatus,
      demo: true,
    });
  } catch (err) {
    console.error("[DEMO uploadFeProof ERROR]", err);
    return res.status(500).json({
      error: "Demo proof upload failed",
    });
  }
}
