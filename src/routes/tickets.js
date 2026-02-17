// src/routes/tickets.js
import express from "express"
import { supabase } from "../supabaseClient.js"
import { createActionToken } from "../services/tokenService.js"
import { sendFETokenEmail } from "../services/emailService.js"
import { handleClientResolutionNotification } from "../services/clientNotificationService.js"

const router = express.Router()

/* ======================================================
   READ TICKETS
====================================================== */
router.get("/", async (_req, res) => {
  const { data, error } = await supabase
    .from("tickets")
    .select("*")
    .order("created_at", { ascending: false })

  if (error) return res.status(500).json({ error: error.message })
  return res.json(data)
})

/* ======================================================
   ASSIGN FIELD EXECUTIVE
====================================================== */
router.post("/:id/assign", async (req, res) => {
  const ticketId = req.params.id
  const { feId } = req.body

  if (!feId) {
    return res.status(400).json({ error: "feId is required" })
  }

  try {
    // 1. Fetch ticket
    const { data: ticket, error: ticketError } = await supabase
      .from("tickets")
      .select("id, status, ticket_number")
      .eq("id", ticketId)
      .single()

    if (ticketError || !ticket) {
      return res.status(404).json({ error: "Ticket not found" })
    }

    if (ticket.status !== "OPEN") {
      return res.status(400).json({ error: "Ticket not in OPEN state" })
    }

    // 2. Prevent duplicate assignment
    const { data: existing } = await supabase
      .from("ticket_assignments")
      .select("id")
      .eq("ticket_id", ticketId)
      .maybeSingle()

    if (existing) {
      return res.status(409).json({ error: "Ticket already assigned" })
    }

    // 3. Insert assignment
    const { data: assignment, error: insertError } = await supabase
      .from("ticket_assignments")
      .insert({
        ticket_id: ticketId,
        fe_id: feId,
      })
      .select()
      .single()

    if (insertError) {
      return res.status(500).json({ error: insertError.message })
    }

    // 4. Update ticket status + pointer
    const { error: updateError } = await supabase
      .from("tickets")
      .update({
        status: "ASSIGNED",
        current_assignment_id: assignment.id,
      })
      .eq("id", ticketId)

    if (updateError) {
      return res.status(500).json({ error: updateError.message })
    }

    // 5. Create ON_SITE token
    const token = await createActionToken({
      ticketId,
      feId,
      actionType: "ON_SITE",
    })

    // 6. Send email (non-blocking)
    sendFETokenEmail({
      feId,
      ticketNumber: ticket.ticket_number,
      token,
      type: "ON_SITE",
    }).catch(console.error)

    return res.json({ success: true })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
})

/* ======================================================
   STAFF VERIFY ON-SITE (GENERATE RESOLUTION TOKEN)
====================================================== */
router.post("/:id/on-site-token", async (req, res) => {
  const ticketId = req.params.id

  try {
    const { data: ticket, error: ticketError } = await supabase
      .from("tickets")
      .select("status, ticket_number")
      .eq("id", ticketId)
      .single()

    if (ticketError || !ticket) {
      return res.status(404).json({ error: "Ticket not found" })
    }

    if (ticket.status !== "ASSIGNED" && ticket.status !== "ON_SITE") {
      return res.status(400).json({ error: "Invalid state for ON_SITE verification" })
    }

    const { data: assignment, error: assignError } = await supabase
      .from("ticket_assignments")
      .select("fe_id")
      .eq("ticket_id", ticketId)
      .single()

    if (assignError || !assignment) {
      return res.status(400).json({ error: "Assignment not found" })
    }

    // Mark ON_SITE token used
    await supabase
      .from("fe_action_tokens")
      .update({ used: true })
      .eq("ticket_id", ticketId)
      .eq("action_type", "ON_SITE")

    // Generate RESOLUTION token
    const resolutionToken = await createActionToken({
      ticketId,
      feId: assignment.fe_id,
      actionType: "RESOLUTION",
    })

    sendFETokenEmail({
      feId: assignment.fe_id,
      ticketNumber: ticket.ticket_number,
      token: resolutionToken,
      type: "RESOLUTION",
    }).catch(console.error)

    // Move ticket to pending verification
    await supabase
      .from("tickets")
      .update({ status: "RESOLVED_PENDING_VERIFICATION" })
      .eq("id", ticketId)

    return res.json({ success: true })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
})

/* ======================================================
   STAFF FINAL VERIFY & CLOSE
====================================================== */
router.post("/:id/close", async (req, res) => {
  const ticketId = req.params.id

  try {
    const { data: ticket, error: ticketError } = await supabase
      .from("tickets")
      .select("status")
      .eq("id", ticketId)
      .single()

    if (ticketError || !ticket) {
      return res.status(404).json({ error: "Ticket not found" })
    }

    if (ticket.status !== "RESOLVED_PENDING_VERIFICATION") {
      return res.status(400).json({ error: "Ticket not ready to close" })
    }

    await supabase
      .from("tickets")
      .update({
        status: "RESOLVED",
        resolved_at: new Date(),
      })
      .eq("id", ticketId)

    await handleClientResolutionNotification(ticketId)

    return res.json({ success: true })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
})

export default router
