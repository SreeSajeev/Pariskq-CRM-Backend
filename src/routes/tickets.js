// src/routes/tickets.js

import express from "express";
import { supabase } from "../supabaseClient.js";
import { createActionToken } from "../services/tokenService.js";
import {
  sendResolutionEmail,
  sendFEAssignmentEmail,
  sendFETokenEmail,
} from "../services/emailService.js";
import { setAssignmentDeadline, setOnsiteDeadline } from "../services/slaService.js";


const router = express.Router();

/* ======================================================
   READ TICKETS
====================================================== */
router.get("/", async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from("tickets")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.json(data || []);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/* ======================================================
   ASSIGN FIELD EXECUTIVE
   (Always generate ON_SITE token)
====================================================== */
router.post("/:id/assign", async (req, res) => {
  const ticketId = req.params.id;
  const { feId } = req.body;

  if (!feId) {
    return res.status(400).json({ error: "feId is required" });
  }

  try {
    const { data: ticket, error: ticketError } = await supabase
      .from("tickets")
      .select("id, ticket_number")
      .eq("id", ticketId)
      .single();

    if (ticketError || !ticket) {
      return res.status(404).json({ error: "Ticket not found" });
    }

    // Insert assignment (ignore duplicates for demo)
    const { data: assignment, error: assignmentError } = await supabase
      .from("ticket_assignments")
      .insert({
        ticket_id: ticketId,
        fe_id: feId,
      })
      .select()
      .single();

    if (assignmentError) {
      console.error("Assignment insert error:", assignmentError);
    }

    // Update ticket state
    await supabase
      .from("tickets")
      .update({
        status: "ASSIGNED",
        current_assignment_id: assignment?.id || null,
      })
      .eq("id", ticketId);

    setAssignmentDeadline(ticketId).catch((err) =>
      console.error("[SLA] setAssignmentDeadline after assign", ticketId, err.message)
    );

    sendFEAssignmentEmail({
      feId,
      ticketNumber: ticket.ticket_number,
    }).catch(console.error);

    // Always create ON_SITE token
    const token = await createActionToken({
      ticketId,
      feId,
      actionType: "ON_SITE",
    });

    // Send email (non-blocking, demo-safe)
    sendFETokenEmail({
      feId,
      ticketNumber: ticket.ticket_number,
      token,
      type: "ON_SITE",
    }).catch(console.error);

    return res.json({
      success: true,
      token,
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/* ======================================================
   STAFF VERIFY ON-SITE
   (Generate RESOLUTION token)
====================================================== */
router.post("/:id/on-site-token", async (req, res) => {
  const ticketId = req.params.id;

  try {
    const { data: ticket } = await supabase
      .from("tickets")
      .select("ticket_number")
      .eq("id", ticketId)
      .single();

    const { data: assignment } = await supabase
      .from("ticket_assignments")
      .select("fe_id")
      .eq("ticket_id", ticketId)
      .single();

    if (!assignment) {
      return res.status(400).json({ error: "Assignment missing" });
    }

    const resolutionToken = await createActionToken({
      ticketId,
      feId: assignment.fe_id,
      actionType: "RESOLUTION",
    });

    sendFETokenEmail({
      feId: assignment.fe_id,
      ticketNumber: ticket?.ticket_number || "DEMO",
      token: resolutionToken,
      type: "RESOLUTION",
    }).catch(console.error);

    await supabase
      .from("tickets")
      .update({ status: "ON_SITE" })
      .eq("id", ticketId);

    setOnsiteDeadline(ticketId).catch((err) =>
      console.error("[SLA] setOnsiteDeadline after on-site-token", ticketId, err.message)
    );

    return res.json({
      success: true,
      resolutionToken,
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/* ======================================================
   STAFF FINAL CLOSE
   (Always allow close for demo)
====================================================== */
router.post("/:id/close", async (req, res) => {
  const ticketId = req.params.id;

  try {
    const { data: ticket, error } = await supabase
      .from("tickets")
      .update({
        status: "RESOLVED",
        resolved_at: new Date(),
      })
      .eq("id", ticketId)
      .select("ticket_number, opened_by_email")
      .single();

    if (error || !ticket) {
      return res.status(404).json({ error: "Ticket not found" });
    }

    if (ticket.opened_by_email) {
      await sendResolutionEmail({
        toEmail: ticket.opened_by_email,
        ticketNumber: ticket.ticket_number,
      });
    }

    return res.json({ success: true });

  } catch (err) {
    console.error("[CLOSE ROUTE ERROR]", err);
    return res.status(500).json({ error: err.message });
  }
});


export default router;
//works