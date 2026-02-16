
//
// src/controllers/ticketController.js
// Backend-authoritative, demo-safe lifecycle controller

import { supabase } from "../supabaseClient.js";
import { assertValidTransition } from "../services/ticketStateMachine.js";
import { createActionToken } from "../services/tokenService.js";
import { sendFETokenEmail } from "../services/emailService.js";
import { handleClientResolutionNotification } from "../services/clientNotificationService.js";

/* =====================================================
   ASSIGN FE TO TICKET
===================================================== */
export async function assignFieldExecutive(req, res) {
  try {
    const ticketId = req.params.id;
    const { feId } = req.body;

    const { data: ticket } = await supabase
      .from("tickets")
      .select("status")
      .eq("id", ticketId)
      .single();

    if (!ticket) {
      return res.status(404).json({ error: "Ticket not found" });
    }

    assertValidTransition(ticket.status, "ASSIGNED");

    await supabase.from("ticket_assignments").insert({
      ticket_id: ticketId,
      fe_id: feId,
    });

    await supabase
      .from("tickets")
      .update({ status: "ASSIGNED" })
      .eq("id", ticketId);

    return res.json({ success: true });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}

/* =====================================================
   GENERATE ON-SITE TOKEN
===================================================== */
export async function generateOnSiteToken(req, res) {
  try {
    const ticketId = req.params.id;

    const { data: assignment } = await supabase
      .from("ticket_assignments")
      .select("fe_id")
      .eq("ticket_id", ticketId)
      .single();

    if (!assignment) {
      return res.status(400).json({ error: "FE not assigned" });
    }

    const { data: ticket } = await supabase
      .from("tickets")
      .select("status, ticket_number")
      .eq("id", ticketId)
      .single();

    assertValidTransition(ticket.status, "EN_ROUTE");

    const { data: existingToken } = await supabase
      .from("fe_action_tokens")
      .select("id")
      .eq("ticket_id", ticketId)
      .eq("action_type", "ON_SITE")
      .eq("used", false)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();

    if (existingToken) {
      return res.status(400).json({ error: "ON_SITE token already active" });
    }

    const token = await createActionToken({
      ticketId,
      feId: assignment.fe_id,
      actionType: "ON_SITE",
    });

    await supabase
      .from("tickets")
      .update({ status: "EN_ROUTE" })
      .eq("id", ticketId);

    await sendFETokenEmail({
      feId: assignment.fe_id,
      ticketNumber: ticket.ticket_number,
      token,
      type: "ON_SITE",
    });

    return res.json({ success: true });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}

/* =====================================================
   VERIFY ON-SITE & ISSUE RESOLUTION TOKEN
===================================================== */
export async function verifyOnSiteAndIssueResolution(req, res) {
  try {
    const ticketId = req.params.id;

    const { data: ticket } = await supabase
      .from("tickets")
      .select("status, ticket_number")
      .eq("id", ticketId)
      .single();

    if (!ticket) {
      return res.status(404).json({ error: "Ticket not found" });
    }

    assertValidTransition(ticket.status, "ON_SITE");

    const { data: assignment } = await supabase
      .from("ticket_assignments")
      .select("fe_id")
      .eq("ticket_id", ticketId)
      .single();

    if (!assignment) {
      return res.status(400).json({ error: "FE not assigned" });
    }

    // Consume ON_SITE token (single-use, atomic)
    const { data: consumed } = await supabase
      .from("fe_action_tokens")
      .update({ used: true })
      .eq("ticket_id", ticketId)
      .eq("action_type", "ON_SITE")
      .eq("used", false)
      .limit(1)
      .select("id");

    if (!consumed || consumed.length === 0) {
      return res.status(400).json({ error: "ON_SITE token already consumed or missing" });
    }

    const { data: existingResolution } = await supabase
      .from("fe_action_tokens")
      .select("id")
      .eq("ticket_id", ticketId)
      .eq("action_type", "RESOLUTION")
      .eq("used", false)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();

    if (existingResolution) {
      return res.status(400).json({ error: "RESOLUTION token already active" });
    }

    const token = await createActionToken({
      ticketId,
      feId: assignment.fe_id,
      actionType: "RESOLUTION",
    });

    await supabase
      .from("tickets")
      .update({ status: "ON_SITE" })
      .eq("id", ticketId);

    await sendFETokenEmail({
      feId: assignment.fe_id,
      ticketNumber: ticket.ticket_number,
      token,
      type: "RESOLUTION",
    });

    return res.json({ success: true });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}

/* =====================================================
   VERIFY RESOLUTION & CLOSE TICKET
===================================================== */
export async function verifyAndCloseTicket(req, res) {
  try {
    const ticketId = req.params.id;

    const { data: ticket } = await supabase
      .from("tickets")
      .select("status, opened_by_email, ticket_number")
      .eq("id", ticketId)
      .single();

    if (!ticket) {
      return res.status(404).json({ error: "Ticket not found" });
    }

    assertValidTransition(ticket.status, "RESOLVED");

    // Ensure RESOLUTION token has been consumed
    const { data: pendingResolution } = await supabase
      .from("fe_action_tokens")
      .select("id")
      .eq("ticket_id", ticketId)
      .eq("action_type", "RESOLUTION")
      .eq("used", false)
      .maybeSingle();

    if (pendingResolution) {
      return res.status(400).json({
        error: "Resolution proof not yet verified",
      });
    }

    await supabase
      .from("tickets")
      .update({
        status: "RESOLVED",
        resolved_at: new Date().toISOString(),
      })
      .eq("id", ticketId);

    await handleClientResolutionNotification({
      toEmail: ticket.opened_by_email,
      ticketNumber: ticket.ticket_number,
    });

    return res.json({ success: true });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}
