
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

    const { data: ticket, error } = await supabase
      .from("tickets")
      .select("status")
      .eq("id", ticketId)
      .single();

    if (error || !ticket) {
      return res.status(404).json({ error: "Ticket not found" });
    }

    assertValidTransition(ticket.status, "ASSIGNED");

    const { error: insertError } = await supabase
      .from("ticket_assignments")
      .insert({
        ticket_id: ticketId,
        fe_id: feId,
      });

    if (insertError) {
      throw insertError;
    }

    const { error: updateError } = await supabase
      .from("tickets")
      .update({ status: "ASSIGNED" })
      .eq("id", ticketId);

    if (updateError) {
      throw updateError;
    }

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

    const { data: assignment, error: assignmentError } = await supabase
      .from("ticket_assignments")
      .select("fe_id")
      .eq("ticket_id", ticketId)
      .single();

    if (assignmentError || !assignment) {
      return res.status(400).json({ error: "FE not assigned" });
    }

    const { data: ticket, error: ticketError } = await supabase
      .from("tickets")
      .select("status, ticket_number")
      .eq("id", ticketId)
      .single();

    if (ticketError || !ticket) {
      return res.status(404).json({ error: "Ticket not found" });
    }

    assertValidTransition(ticket.status, "EN_ROUTE");

    const nowISO = new Date().toISOString();

    const { data: existingToken } = await supabase
      .from("fe_action_tokens")
      .select("id")
      .eq("ticket_id", ticketId)
      .eq("action_type", "ON_SITE")
      .eq("used", false)
      .gt("expires_at", nowISO)
      .maybeSingle();

    if (existingToken) {
      return res.status(400).json({ error: "ON_SITE token already active" });
    }

    const token = await createActionToken({
      ticketId,
      feId: assignment.fe_id,
      actionType: "ON_SITE",
    });

    const { error: updateError } = await supabase
      .from("tickets")
      .update({ status: "EN_ROUTE" })
      .eq("id", ticketId);

    if (updateError) {
      throw updateError;
    }

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

    const { data: ticket, error: ticketError } = await supabase
      .from("tickets")
      .select("status, ticket_number")
      .eq("id", ticketId)
      .single();

    if (ticketError || !ticket) {
      return res.status(404).json({ error: "Ticket not found" });
    }

    assertValidTransition(ticket.status, "ON_SITE");

    const { data: assignment, error: assignmentError } = await supabase
      .from("ticket_assignments")
      .select("fe_id")
      .eq("ticket_id", ticketId)
      .single();

    if (assignmentError || !assignment) {
      return res.status(400).json({ error: "FE not assigned" });
    }

    // Consume ON_SITE token atomically
    const { data: consumed, error: consumeError } = await supabase
      .from("fe_action_tokens")
      .update({ used: true })
      .eq("ticket_id", ticketId)
      .eq("action_type", "ON_SITE")
      .eq("used", false)
      .select("id")
      .limit(1);

    if (consumeError) {
      throw consumeError;
    }

    if (!consumed || consumed.length === 0) {
      return res.status(400).json({
        error: "ON_SITE token already consumed or missing",
      });
    }

    const nowISO = new Date().toISOString();

    const { data: existingResolution } = await supabase
      .from("fe_action_tokens")
      .select("id")
      .eq("ticket_id", ticketId)
      .eq("action_type", "RESOLUTION")
      .eq("used", false)
      .gt("expires_at", nowISO)
      .maybeSingle();

    if (existingResolution) {
      return res.status(400).json({
        error: "RESOLUTION token already active",
      });
    }

    const token = await createActionToken({
      ticketId,
      feId: assignment.fe_id,
      actionType: "RESOLUTION",
    });

    const { error: updateError } = await supabase
      .from("tickets")
      .update({ status: "ON_SITE" })
      .eq("id", ticketId);

    if (updateError) {
      throw updateError;
    }

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

    const { data: ticket, error: ticketError } = await supabase
      .from("tickets")
      .select("status, opened_by_email, ticket_number")
      .eq("id", ticketId)
      .single();

    if (ticketError || !ticket) {
      return res.status(404).json({ error: "Ticket not found" });
    }

    assertValidTransition(ticket.status, "RESOLVED");

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

    const { error: updateError } = await supabase
      .from("tickets")
      .update({
        status: "RESOLVED",
        resolved_at: new Date().toISOString(),
      })
      .eq("id", ticketId);

    if (updateError) {
      throw updateError;
    }

    await handleClientResolutionNotification({
      toEmail: ticket.opened_by_email,
      ticketNumber: ticket.ticket_number,
    });

    return res.json({ success: true });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}
