// src/routes/tickets.js

import express from "express"
import { supabase } from "../config/supabase.js"
import { assertValidTransition } from "../services/ticketStateMachine.js"
import { createActionToken } from "../services/tokenService.js"
import { sendFETokenEmail } from "../services/emailService.js"
import { handleClientResolutionNotification } from "../services/clientNotificationService.js"

const router = express.Router()

/**
 * ASSIGN FIELD EXECUTIVE
 * - Assigns FE
 * - Generates ON_SITE token
 * - Sends email to FE
 */
router.post("/:id/assign", async (req, res) => {
  try {
    const ticketId = req.params.id
    const { feId } = req.body

    if (!feId) {
      return res.status(400).json({ error: "feId is required" })
    }

    const { data: ticket, error } = await supabase
      .from("tickets")
      .select("id, status, ticket_number")
      .eq("id", ticketId)
      .single()

    if (error || !ticket) {
      return res.status(404).json({ error: "Ticket not found" })
    }

    assertValidTransition(ticket.status, "ASSIGNED")

    const { data: existingAssignment } = await supabase
      .from("ticket_assignments")
      .select("id")
      .eq("ticket_id", ticketId)
      .maybeSingle()

    if (existingAssignment) {
      return res.status(409).json({ error: "Ticket already assigned" })
    }

    await supabase.from("ticket_assignments").insert({
      ticket_id: ticketId,
      fe_id: feId,
    })

    await supabase
      .from("tickets")
      .update({ status: "ASSIGNED" })
      .eq("id", ticketId)

    const { data: existingToken } = await supabase
      .from("fe_action_tokens")
      .select("id")
      .eq("ticket_id", ticketId)
      .eq("action_type", "ON_SITE")
      .maybeSingle()

    if (!existingToken) {
      const token = await createActionToken({
        ticketId,
        feId,
        actionType: "ON_SITE",
      })

      await sendFETokenEmail({
        feId,
        ticketNumber: ticket.ticket_number,
        token,
        type: "ON_SITE",
      })
    }

    return res.json({ success: true })
  } catch (err) {
    return res.status(400).json({ error: err.message })
  }
})

/**
 * VERIFY ON-SITE PROOF
 * - Marks ON_SITE token as used
 * - Generates RESOLUTION token
 * - Emails FE
 *
 * ✅ This is the canonical Step 5 → Step 6 bridge
 */
export async function verifyOnSiteAndIssueResolution(req, res) {
  try {
    const ticketId = req.params.id

    const { data: ticket } = await supabase
      .from("tickets")
      .select("status, ticket_number")
      .eq("id", ticketId)
      .single()

    if (!ticket) {
      return res.status(404).json({ error: "Ticket not found" })
    }

    assertValidTransition(ticket.status, "ON_SITE")

    const { data: assignment } = await supabase
      .from("ticket_assignments")
      .select("fe_id")
      .eq("ticket_id", ticketId)
      .single()

    if (!assignment) {
      return res.status(400).json({ error: "FE not assigned" })
    }

    // Mark ON_SITE token as used
    await supabase
      .from("fe_action_tokens")
      .update({ used: true })
      .eq("ticket_id", ticketId)
      .eq("action_type", "ON_SITE")

    // Generate RESOLUTION token
    const token = await createActionToken({
      ticketId,
      feId: assignment.fe_id,
      actionType: "RESOLUTION",
    })

    // Advance lifecycle (not closed yet)
    await supabase
      .from("tickets")
      .update({ status: "ON_SITE" })
      .eq("id", ticketId)

    await sendFETokenEmail({
      feId: assignment.fe_id,
      ticketNumber: ticket.ticket_number,
      token,
      type: "RESOLUTION",
    })

    return res.json({ success: true })
  } catch (err) {
    return res.status(400).json({ error: err.message })
  }
}

/**
 * 🔗 CANONICAL ROUTE
 */
router.post("/:id/on-site-token", verifyOnSiteAndIssueResolution)

/**
 * VERIFY RESOLUTION & CLOSE TICKET
 */
router.post("/:id/verify-resolution", async (req, res) => {
  try {
    const ticketId = req.params.id

    const { data: ticket } = await supabase
      .from("tickets")
      .select("status, opened_by_email")
      .eq("id", ticketId)
      .single()

    if (!ticket) {
      return res.status(404).json({ error: "Ticket not found" })
    }

    assertValidTransition(ticket.status, "RESOLVED")

    await supabase
      .from("tickets")
      .update({
        status: "RESOLVED",
        resolved_at: new Date(),
      })
      .eq("id", ticketId)

    await handleClientResolutionNotification(ticket.opened_by_email)

    return res.json({ success: true })
  } catch (err) {
    return res.status(400).json({ error: err.message })
  }
})

export default router
