// src/routes/feProofs.js

import express from "express"
import { supabase } from "../supabaseClient.js"
import { validateActionToken } from "../services/tokenService.js"
import { assertValidTransition } from "../services/ticketStateMachine.js"

const router = express.Router()

/**
 * Field Executive submits proof
 */
router.post("/submit", async (req, res) => {
  try {
    const {
      ticketId,
      feId,
      token,
      actionType, // "ON_SITE" or "RESOLUTION"
      attachments,
      remarks,
    } = req.body

    if (!ticketId || !feId || !token || !actionType) {
      return res.status(400).json({ error: "Missing required fields" })
    }

    // 1️⃣ Validate token
    await validateActionToken({
      token,
      ticketId,
      feId,
      actionType,
    })

    // 2️⃣ Get ticket
    const { data: ticket } = await supabase
      .from("tickets")
      .select("status")
      .eq("id", ticketId)
      .single()

    // 3️⃣ Decide next state
    const nextState =
      actionType === "ON_SITE"
        ? "ON_SITE"
        : "RESOLVED_PENDING_VERIFICATION"

    assertValidTransition(ticket.status, nextState)

    // 4️⃣ Save proof
    await supabase.from("ticket_comments").insert({
      ticket_id: ticketId,
      author_role: "FE",
      comment_type: "PROOF",
      action_type: actionType,
      attachments,
      remarks,
    })

    // 5️⃣ Advance ticket
    await supabase
      .from("tickets")
      .update({ status: nextState })
      .eq("id", ticketId)

    return res.json({ success: true })
  } catch (err) {
    return res.status(400).json({ error: err.message })
  }
})

export default router
