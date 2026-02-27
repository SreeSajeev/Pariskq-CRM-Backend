/**
 * Processes fe_proof_backup_queue: uploads proof images to Supabase Storage and updates proof_storage_path.
 * Called periodically from the worker loop. Additive only; does not change proof submission flow.
 */

import { supabase } from "../supabaseClient.js";

const BATCH_SIZE = 20;

export async function processProofBackupQueue() {
  const { data: rows, error: fetchError } = await supabase
    .from("fe_proof_backup_queue")
    .select("id, ticket_comment_id, ticket_id, action_type")
    .order("created_at", { ascending: true })
    .limit(BATCH_SIZE);

  if (fetchError) {
    console.error("[Proof Backup Queue] Fetch failed:", fetchError.message);
    return;
  }
  if (!rows || rows.length === 0) return;

  for (const row of rows) {
    try {
      const { data: comment, error: commentError } = await supabase
        .from("ticket_comments")
        .select("attachments")
        .eq("id", row.ticket_comment_id)
        .single();

      if (commentError || !comment?.attachments) {
        console.warn("[Proof Backup Queue] Comment not found or no attachments:", row.ticket_comment_id);
        await supabase.from("fe_proof_backup_queue").delete().eq("id", row.id);
        continue;
      }

      const imageBase64 = comment.attachments?.image_base64;
      if (!imageBase64 || typeof imageBase64 !== "string") {
        await supabase.from("fe_proof_backup_queue").delete().eq("id", row.id);
        continue;
      }

      const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, "");
      const buffer = Buffer.from(base64Data, "base64");
      const actionType = row.action_type || "ON_SITE";
      const filePath = `${row.ticket_id}/${actionType}/${row.ticket_comment_id}.jpg`;

      const { error: uploadError } = await supabase.storage
        .from("fe-proofs")
        .upload(filePath, buffer, {
          contentType: "image/jpeg",
          upsert: false,
        });

      if (uploadError) {
        console.warn("[Proof Backup Queue] Upload failed:", uploadError.message, "path:", filePath);
        continue;
      }

      const { data: ticketRow } = await supabase
        .from("tickets")
        .select("current_assignment_id")
        .eq("id", row.ticket_id)
        .single();

      const assignmentId = ticketRow?.current_assignment_id;
      if (assignmentId) {
        await supabase
          .from("ticket_assignments")
          .update({ proof_storage_path: filePath })
          .eq("id", assignmentId);
      }

      await supabase.from("fe_proof_backup_queue").delete().eq("id", row.id);
      console.log("📦 Proof uploaded to Supabase:", filePath);
    } catch (err) {
      console.warn("[Proof Backup Queue] Failed row", row.id, err?.message || err);
    }
  }
}
