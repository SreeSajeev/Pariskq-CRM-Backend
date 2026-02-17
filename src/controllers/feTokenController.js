// src/controllers/feTokenController.js

import { supabase } from "../supabaseClient.js";
import { sendFETokenEmail } from "../services/emailService.js";

/**
 * Generate FE Action Token + Send Email
 * This is a standalone authority endpoint.
 * No lifecycle enforcement (demo safe).
 */
export async function generateAndSendFEToken(req, res) {
  try {
    const { ticketId, feId, type } = req.body;

    if (!ticketId || !feId || !type) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    if (type !== "ON_SITE" && type !== "RESOLUTION") {
      return res.status(400).json({ error: "Invalid action type" });
    }

    // 1️⃣ Create expiry
    const expiresAt = new Date(
      Date.now() + 24 * 60 * 60 * 1000
    ).toISOString();

    // 2️⃣ Insert token
    const { data: tokenRow, error: tokenError } = await supabase
      .from("fe_action_tokens")
      .insert({
        ticket_id: ticketId,
        fe_id: feId,
        action_type: type,
        expires_at: expiresAt,
        used: false,
      })
      .select("id")
      .single();

    if (tokenError || !tokenRow) {
      console.error("Token insert error:", tokenError);
      return res.status(500).json({ error: "Token creation failed" });
    }

    // 3️⃣ Get ticket number
    const { data: ticket } = await supabase
      .from("tickets")
      .select("ticket_number")
      .eq("id", ticketId)
      .single();

    // 4️⃣ Send email
    await sendFETokenEmail({
      feId,
      ticketNumber: ticket?.ticket_number || "DEMO",
      token: tokenRow.id,
      type,
    });

    return res.json({
      success: true,
      token: tokenRow.id,
    });

  } catch (err) {
    console.error("[generateAndSendFEToken]", err);
    return res.status(500).json({
      error: "Failed to generate FE token",
    });
  }
}
