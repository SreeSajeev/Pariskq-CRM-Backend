
// src/controllers/ticketController.js

import { supabase } from "../config/supabase.js"
import { assertValidTransition } from "../services/ticketStateMachine.js"
import {
  createActionToken,
  validateActionToken,
} from "../services/tokenService.js"
import { sendFETokenEmail } from "../services/emailService.js"
import { handleClientResolutionNotification } from "../services/clientNotificationService.js"

/**
 * ASSIGN FE TO TICKET
 */
export async function assignFieldExecutive(req, res) {
  try {
    const ticketId = req.params.id
    const { feId } = req.body

    const { data: ticket, error } = await supabase
      .from("tickets")
      .select("status")
      .eq("id", ticketId)
      .single()

    if (error || !ticket) {
      return res.status(404).json({ error: "Ticket not found" })
    }

    assertValidTransition(ticket.status, "ASSIGNED")

    await supabase.from("ticket_assignments").insert({
      ticket_id: ticketId,
      fe_id: feId,
    })

    await supabase
      .from("tickets")
      .update({ status: "ASSIGNED" })
      .eq("id", ticketId)

    return res.json({ success: true })
  } catch (err) {
    return res.status(400).json({ error: err.message })
  }
}

/**
 * GENERATE ON-SITE TOKEN
 */
export async function generateOnSiteToken(req, res) {
  try {
    const ticketId = req.params.id

    const { data: assignment } = await supabase
      .from("ticket_assignments")
      .select("fe_id")
      .eq("ticket_id", ticketId)
      .single()

    if (!assignment) {
      return res.status(400).json({ error: "FE not assigned" })
    }

    const { data: ticket } = await supabase
      .from("tickets")
      .select("status, ticket_number")
      .eq("id", ticketId)
      .single()

    assertValidTransition(ticket.status, "EN_ROUTE")

    const token = await createActionToken({
      ticketId,
      feId: assignment.fe_id,
      actionType: "ON_SITE",
    })

    await supabase
      .from("tickets")
      .update({ status: "EN_ROUTE" })
      .eq("id", ticketId)

    await sendFETokenEmail({
      feId: assignment.fe_id,
      ticketNumber: ticket.ticket_number,
      token,
      type: "ON_SITE",
    })

    return res.json({ success: true })
  } catch (err) {
    return res.status(400).json({ error: err.message })
  }
}

/**
 * VERIFY ON-SITE & ISSUE RESOLUTION TOKEN
 * (Step 5 → Step 6 bridge)
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

    // Guardrail
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

    // Advance ticket lifecycle (still not closed)
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
 * VERIFY RESOLUTION & CLOSE TICKET
 */
export async function verifyAndCloseTicket(req, res) {
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
      .update({ status: "RESOLVED" })
      .eq("id", ticketId)

    await handleClientResolutionNotification(ticket.opened_by_email)

    return res.json({ success: true })
  } catch (err) {
    return res.status(400).json({ error: err.message })
  }
}
