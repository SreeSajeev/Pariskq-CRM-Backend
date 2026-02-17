// src/controllers/proofController.js
import { supabase } from "../supabaseClient.js";

export async function uploadFeProof(req, res) {
  try {
    const { token, attachments = [] } = req.body;

    if (!token) {
      return res.status(400).json({ error: "Token required" });
    }

    // 🔥 DEMO MODE: Only validate existence
    const { data: actionToken, error: tokenError } = await supabase
      .from("fe_action_tokens")
      .select("*")
      .eq("id", token)
      .single();

    if (tokenError || !actionToken) {
      return res.status(404).json({ error: "Invalid token" });
    }

    const ticketId = actionToken.ticket_id;

    // 🔥 Always store proof
    await supabase.from("ticket_comments").insert({
      ticket_id: ticketId,
      source: "FE",
      author_id: actionToken.fe_id,
      body: `${actionToken.action_type} proof uploaded`,
      attachments,
      created_at: new Date().toISOString(),
    });

    // 🔥 Always consume token
    await supabase
      .from("fe_action_tokens")
      .update({ used: true })
      .eq("id", token);

    let nextStatus;

    if (actionToken.action_type === "ON_SITE") {
      nextStatus = "ON_SITE";

      await supabase
        .from("tickets")
        .update({ status: nextStatus })
        .eq("id", ticketId);

    } else {
      nextStatus = "RESOLVED_PENDING_VERIFICATION";

      await supabase
        .from("tickets")
        .update({ status: nextStatus })
        .eq("id", ticketId);
    }

    return res.json({
      success: true,
      nextStatus,
    });

  } catch (err) {
    console.error("[uploadFeProof]", err);
    return res.status(500).json({ error: "Proof upload failed" });
  }
}
