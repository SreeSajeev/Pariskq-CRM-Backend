import { supabase } from "../supabaseClient.js";

export async function validateFeActionToken(req, res) {
  try {
    const { token } = req.params;

    if (!token) {
      return res.status(400).json({ error: "Token missing" });
    }

    const nowISO = new Date().toISOString();

    const { data: actionToken, error } = await supabase
      .from("fe_action_tokens")
      .select("*")
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

    // 🔥 FOR DEMO: fetch ticket separately without lifecycle enforcement
    const { data: ticket } = await supabase
      .from("tickets")
      .select("id, ticket_number, status")
      .eq("id", actionToken.ticket_id)
      .single();

    return res.json({
      ticketId: actionToken.ticket_id,
      feId: actionToken.fe_id,
      actionType: actionToken.action_type,
      ticketNumber: ticket?.ticket_number || "DEMO",
      ticketStatus: ticket?.status || "ASSIGNED",
      expiresAt: actionToken.expires_at,
    });

  } catch (err) {
    console.error("[validateFeActionToken]", err.message);
    return res.status(500).json({ error: "Token validation failed" });
  }
}
