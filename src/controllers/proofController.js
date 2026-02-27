// src/controllers/proofController.js
import { supabase } from "../supabaseClient.js";
import {
  setOnsiteDeadline,
  setResolutionDeadline,
  clearOnsiteAndResolutionDeadlines,
} from "../services/slaService.js";

export async function uploadFeProof(req, res) {
  try {
    const { token, attachments = [], outcome, failure_reason } = req.body || {};

    if (!token) {
      return res.status(400).json({ error: "Token required" });
    }

    const { data: actionToken } = await supabase
      .from("fe_action_tokens")
      .select("id, ticket_id, fe_id, action_type")
      .eq("id", token)
      .maybeSingle();

    if (!actionToken) {
      return res.status(404).json({ error: "Invalid token" });
    }

    const ticketId = actionToken.ticket_id;

    /* =====================================================
       RESOLUTION: multi-attempt outcome (SUCCESS | FAILED)
    ===================================================== */
    if (actionToken.action_type === "RESOLUTION") {
      const resolvedOutcome = outcome === "FAILED" ? "FAILED" : "SUCCESS";

      const { data: ticketRow } = await supabase
        .from("tickets")
        .select("current_assignment_id")
        .eq("id", ticketId)
        .single();

      const assignmentId = ticketRow?.current_assignment_id;
      if (!assignmentId) {
        return res.status(400).json({ error: "No current assignment" });
      }

      const { data: assignment } = await supabase
        .from("ticket_assignments")
        .select("id, outcome")
        .eq("id", assignmentId)
        .single();

      if (!assignment) {
        return res.status(400).json({ error: "Assignment not found" });
      }
      if (assignment.outcome != null && assignment.outcome !== undefined) {
        return res.status(400).json({ error: "Resolution already submitted for this attempt" });
      }

      const nowIso = new Date().toISOString();

      if (resolvedOutcome === "FAILED") {
        const reason = failure_reason != null && String(failure_reason).trim() !== ""
          ? String(failure_reason).trim()
          : null;
        if (!reason) {
          return res.status(400).json({ error: "Failure reason is required when outcome is FAILED" });
        }

        await supabase
          .from("ticket_assignments")
          .update({
            outcome: "FAILED",
            ended_at: nowIso,
            failure_reason: reason,
          })
          .eq("id", assignmentId);

        await supabase.from("ticket_comments").insert({
          ticket_id: ticketId,
          source: "FE",
          author_id: actionToken.fe_id,
          body: `Field Executive reported resolution failed: ${reason}`,
          attachments: {},
        });

        await supabase
          .from("tickets")
          .update({
            status: "FE_ATTEMPT_FAILED",
            updated_at: nowIso,
          })
          .eq("id", ticketId);

        clearOnsiteAndResolutionDeadlines(ticketId).catch((err) =>
          console.error("[SLA] clearOnsiteAndResolutionDeadlines", ticketId, err.message)
        );

        await supabase
          .from("fe_action_tokens")
          .update({ used: true })
          .eq("id", token);

        return res.json({
          success: true,
          nextStatus: "FE_ATTEMPT_FAILED",
          outcome: "FAILED",
        });
      }

      /* SUCCESS */
      await supabase
        .from("ticket_assignments")
        .update({
          outcome: "SUCCESS",
          ended_at: nowIso,
        })
        .eq("id", assignmentId);

      const { error: commentError } = await supabase
        .from("ticket_comments")
        .insert({
          ticket_id: ticketId,
          source: "FE",
          author_id: actionToken.fe_id,
          body: "Field Executive uploaded resolution proof",
          attachments: attachments && (Array.isArray(attachments) ? { items: attachments } : attachments),
        });

      if (commentError) {
        console.error("Comment Insert Error:", commentError);
      }

      await supabase
        .from("tickets")
        .update({
          status: "RESOLVED_PENDING_VERIFICATION",
          updated_at: nowIso,
        })
        .eq("id", ticketId);

      setResolutionDeadline(ticketId).catch((err) =>
        console.error("[SLA] setResolutionDeadline after proof", ticketId, err.message)
      );

      await supabase
        .from("fe_action_tokens")
        .update({ used: true })
        .eq("id", token);

      /* Optional: backup proof to Supabase Storage (does not block; base64 remains in ticket_comments) */
      const imageBase64 =
        attachments &&
        typeof attachments === "object" &&
        attachments.image_base64;
      if (imageBase64 && typeof imageBase64 === "string") {
        try {
          const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, "");
          const buffer = Buffer.from(base64Data, "base64");
          const actionType = actionToken.action_type || "RESOLUTION";
          const filePath = `${ticketId}/${actionType}/${Date.now()}.jpg`;
          const { error: uploadError } = await supabase.storage
            .from("fe-proofs")
            .upload(filePath, buffer, {
              contentType: "image/jpeg",
              upsert: false,
            });
          if (uploadError) {
            console.error("[Proof Storage] Upload failed:", uploadError.message);
          } else {
            await supabase
              .from("ticket_assignments")
              .update({ proof_storage_path: filePath })
              .eq("id", assignmentId);
            console.log("📦 Proof uploaded to Supabase:", filePath);
          }
        } catch (err) {
          console.error("[Proof Storage] Failed:", err?.message || err);
        }
      }

      return res.json({
        success: true,
        nextStatus: "RESOLVED_PENDING_VERIFICATION",
        outcome: "SUCCESS",
      });
    }

    /* =====================================================
       ON_SITE: existing flow (no outcome)
    ===================================================== */

    const { error: commentError } = await supabase
      .from("ticket_comments")
      .insert({
        ticket_id: ticketId,
        source: "FE",
        author_id: actionToken.fe_id,
        body: `Demo ${actionToken.action_type} proof uploaded`,
        attachments,
        created_at: new Date().toISOString(),
      });

    if (commentError) {
      console.error("Comment Insert Error:", commentError);
    }

    const nextStatus =
      actionToken.action_type === "ON_SITE"
        ? "ON_SITE"
        : "RESOLVED_PENDING_VERIFICATION";

    const { error: updateError } = await supabase
      .from("tickets")
      .update({
        status: nextStatus,
        updated_at: new Date().toISOString(),
      })
      .eq("id", ticketId);

    if (updateError) {
      console.error("Status Update Error:", updateError);
    }

    if (nextStatus === "ON_SITE") {
      setOnsiteDeadline(ticketId).catch((err) =>
        console.error("[SLA] setOnsiteDeadline after proof", ticketId, err.message)
      );
    } else if (nextStatus === "RESOLVED_PENDING_VERIFICATION") {
      setResolutionDeadline(ticketId).catch((err) =>
        console.error("[SLA] setResolutionDeadline after proof", ticketId, err.message)
      );
    }

    await supabase
      .from("fe_action_tokens")
      .update({ used: true })
      .eq("id", token);

    return res.json({
      success: true,
      nextStatus,
      demo: true,
    });
  } catch (err) {
    console.error("[DEMO uploadFeProof ERROR]", err);
    return res.status(500).json({
      error: "Demo proof upload failed",
    });
  }
}
