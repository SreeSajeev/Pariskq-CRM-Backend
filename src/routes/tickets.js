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
import { sendFESms, buildFEActionURL } from "../services/smsService.js";


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
  const { feId } = req.body || {};

  if (!feId) {
    return res.status(400).json({ error: "feId is required" });
  }

  try {
    const { data: ticket, error: ticketError } = await supabase
      .from("tickets")
      .select("id, ticket_number, vehicle_number, location")
      .eq("id", ticketId)
      .single();

    if (ticketError || !ticket) {
      return res.status(404).json({ error: "Ticket not found" });
    }

    // Insert assignment
    const { data: assignment, error: assignmentError } = await supabase
      .from("ticket_assignments")
      .insert({
        ticket_id: ticketId,
        fe_id: feId,
      })
      .select()
      .single();

    if (assignmentError || !assignment) {
      console.error("Assignment insert error:", assignmentError);
      return res.status(400).json({
        error: assignmentError?.message ?? "Failed to create assignment. Check that the Field Executive exists and the ticket is not already assigned.",
      });
    }

    // Update ticket state
    await supabase
      .from("tickets")
      .update({
        status: "ASSIGNED",
        current_assignment_id: assignment.id,
      })
      .eq("id", ticketId);

    setAssignmentDeadline(ticketId).catch((err) =>
      console.error("[SLA] setAssignmentDeadline after assign", ticketId, err.message)
    );

    console.log("[ASSIGN] Sending FE assignment email feId=", feId, "ticketNumber=", ticket.ticket_number);
    sendFEAssignmentEmail({
      feId,
      ticketNumber: ticket.ticket_number,
    }).catch((e) => console.error("[ASSIGN] FE assignment email failed:", e?.message || e));

    // Always create ON_SITE token
    const token = await createActionToken({
      ticketId,
      feId,
      actionType: "ON_SITE",
    });

    console.log("[ASSIGN] Sending FE token email feId=", feId, "type=ON_SITE");
    sendFETokenEmail({
      feId,
      ticketNumber: ticket.ticket_number,
      token,
      type: "ON_SITE",
    }).catch((e) => console.error("[ASSIGN] FE token email failed:", e?.message || e));

    // SMS only on first assignment when FE has valid phone; do not block assignment on failure
    const { count: assignmentCount } = await supabase
      .from("ticket_assignments")
      .select("*", { count: "exact", head: true })
      .eq("ticket_id", ticketId);
    const isFirstAssignment = (assignmentCount ?? 0) <= 1;
    console.log("[ASSIGN] SMS branch isFirstAssignment=", isFirstAssignment, "assignmentCount=", assignmentCount ?? 0);
    if (isFirstAssignment) {
      const { data: fe, error: feErr } = await supabase
        .from("field_executives")
        .select("name, phone")
        .eq("id", feId)
        .maybeSingle();
      const phonePresent = fe?.phone != null && String(fe.phone).trim() !== "";
      console.log("[ASSIGN] FE lookup for SMS feId=", feId, "error=", feErr?.message || null, "phonePresent=", phonePresent);
      if (fe?.phone != null && String(fe.phone).trim() !== "") {
        const actionUrl = buildFEActionURL(token);
        const location = ticket.location ? String(ticket.location).slice(0, 25) : "N/A";
        const smsMessage = `TKT:${ticket.ticket_number ?? "N/A"}
Veh:${ticket.vehicle_number ?? "N/A"}
Loc:${location}
Action:${actionUrl}
-Pariskq`;
        try {
          console.log("[ASSIGN] Sending SMS to FE feId=", feId);
          await sendFESms({ phoneNumber: fe.phone, message: smsMessage });
          console.log("[ASSIGN] SMS sent successfully");
        } catch (err) {
          console.error("[ASSIGN] SMS failed:", err?.message || err);
        }
      } else {
        console.log("[ASSIGN] SMS skipped: FE has no phone");
      }
    } else {
      console.log("[ASSIGN] SMS skipped: not first assignment");
    }

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
    const { data: ticket, error: ticketError } = await supabase
      .from("tickets")
      .select("ticket_number, vehicle_number, location")
      .eq("id", ticketId)
      .single();

    if (ticketError || !ticket) {
      return res.status(404).json({ error: "Ticket not found" });
    }

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

    // Optional: Resolution SMS to FE (does not block flow)
    try {
      const { data: fe } = await supabase
        .from("field_executives")
        .select("name, phone")
        .eq("id", assignment.fe_id)
        .maybeSingle();

      if (fe?.phone && String(fe.phone).trim()) {
        const resolutionUrl = buildFEActionURL(resolutionToken);
        const location = ticket?.location ? String(ticket.location).slice(0, 25) : "N/A";
        const smsMessage = `TKT:${ticket?.ticket_number ?? "N/A"}
Veh:${ticket?.vehicle_number ?? "N/A"}
Loc:${location}
Action:${resolutionUrl}
-Pariskq`;

        console.log("📩 Sending Resolution SMS to:", fe.phone);
        console.log("📩 Resolution SMS Body:", smsMessage);
        await sendFESms({ phoneNumber: fe.phone, message: smsMessage });
      }
    } catch (err) {
      console.error("[Resolution SMS] Failed:", err?.message || err);
    }

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
  const { verification_remarks, resolution_category } = req.body || {};

  const remarksValue =
    verification_remarks != null && String(verification_remarks).trim() !== ""
      ? String(verification_remarks).trim()
      : null;
  const resolutionCategoryValue =
    resolution_category != null && String(resolution_category).trim() !== ""
      ? String(resolution_category).trim()
      : null;

  try {
    let updatePayload = {
      status: "RESOLVED",
      resolved_at: new Date(),
      verification_remarks: remarksValue,
    };

    const selectFields = "ticket_number, opened_by_email, complaint_id, vehicle_number, category, issue_type, location";
    let { data: ticket, error } = await supabase
      .from("tickets")
      .update(updatePayload)
      .eq("id", ticketId)
      .select(selectFields)
      .single();

    if (error) {
      const isColumnError =
        error.code === "42703" ||
        (error.message && /verification_remarks|column|resolved_at/.test(error.message));
      if (isColumnError) {
        updatePayload = {
          status: "RESOLVED",
          resolved_at: new Date(),
        };
        const retry = await supabase
          .from("tickets")
          .update(updatePayload)
          .eq("id", ticketId)
          .select(selectFields)
          .single();
        if (retry.error || !retry.data) {
          return res.status(404).json({ error: "Ticket not found" });
        }
        ticket = retry.data;
      } else {
        return res.status(404).json({ error: "Ticket not found" });
      }
    }

    if (!ticket) {
      return res.status(404).json({ error: "Ticket not found" });
    }

    if (ticket.opened_by_email) {
      await sendResolutionEmail({
        toEmail: ticket.opened_by_email,
        ticketNumber: ticket.ticket_number,
        verificationRemarks: remarksValue,
        resolutionCategory: resolutionCategoryValue,
        complaintId: ticket.complaint_id ?? null,
        vehicleNumber: ticket.vehicle_number ?? null,
        category: ticket.category ?? null,
        issueType: ticket.issue_type ?? null,
        location: ticket.location ?? null,
      });
    }

    return res.json({ success: true });
  } catch (err) {
    console.error("[CLOSE ROUTE ERROR]", err);
    return res.status(500).json({ error: err.message });
  }
});

/* ======================================================
   COMPLETE REVIEW (Needs Review → 100% confidence)
   PATCH /tickets/:id/review-complete
   Body: { category, issue_type, location, vehicle_number?, priority? }
   Sets: needs_review = false, confidence_score = 100, updated_at = now()
====================================================== */
router.patch("/:id/review-complete", async (req, res) => {
  const ticketId = req.params.id;
  const { category, issue_type, location, vehicle_number, priority } = req.body || {};

  const cat = category != null ? String(category).trim() : "";
  const issue = issue_type != null ? String(issue_type).trim() : "";
  const loc = location != null ? String(location).trim() : "";
  if (!cat || !issue || !loc) {
    return res.status(400).json({
      error: "category, issue_type, and location are required",
    });
  }

  try {
    const { data: ticket, error } = await supabase
      .from("tickets")
      .update({
        category: cat,
        issue_type: issue,
        location: loc,
        vehicle_number:
          vehicle_number != null && String(vehicle_number).trim() !== ""
            ? String(vehicle_number).trim()
            : null,
        priority: Boolean(priority),
        needs_review: false,
        confidence_score: 100,
        updated_at: new Date().toISOString(),
      })
      .eq("id", ticketId)
      .select()
      .single();

    if (error) {
      return res.status(404).json({ error: error.message || "Ticket not found" });
    }
    if (!ticket) {
      return res.status(404).json({ error: "Ticket not found" });
    }

    return res.json(ticket);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
//works