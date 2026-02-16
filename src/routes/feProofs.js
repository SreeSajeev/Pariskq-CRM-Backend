import express from "express"
import { supabase } from "../supabaseClient.js"
import { validateActionToken } from "../services/tokenService.js"
import { assertValidTransition } from "../services/ticketStateMachine.js"

const router = express.Router()

/**
 * INTERNAL helper — shared logic
 */
async function handleProofSubmission({
  tokenId,
  imageUrl,
  remarks,
  expectedActionType,
}) {
  if (!tokenId || !imageUrl) {
    throw new Error("Missing required fields")
  }

  /* 1️⃣ Load token */
  const { data: token, error: tokenError } = await supabase
    .from("fe_action_tokens")
    .select("*")
    .eq("id", tokenId)
    .eq("used", false)
    .single()

  if (tokenError || !token) {
    throw new Error("Invalid or expired token")
  }

  if (token.action_type !== expectedActionType) {
    throw new Error("Invalid action type for token")
  }

  /* 2️⃣ Validate token (authoritative) */
  await validateActionToken({
    token: token.token_hash,
    ticketId: token.ticket_id,
    feId: token.fe_id,
    actionType: token.action_type,
  })

  /* 3️⃣ Load ticket */
  const { data: ticket } = await supabase
    .from("tickets")
    .select("status")
    .eq("id", token.ticket_id)
    .single()

  if (!ticket) {
    throw new Error("Ticket not found")
  }

  /* 4️⃣ Decide next state */
  const nextState =
    token.action_type === "ON_SITE"
      ? "ON_SITE"
      : "RESOLVED_PENDING_VERIFICATION"

  assertValidTransition(ticket.status, nextState)

  /* 5️⃣ Save proof (Activity Timeline) */
  await supabase.from("ticket_comments").insert({
    ticket_id: token.ticket_id,
    author_role: "FE",
    comment_type: "PROOF",
    action_type: token.action_type,
    attachments: {
      image_url: imageUrl,
    },
    remarks,
  })

  /* 6️⃣ Advance ticket */
  await supabase
    .from("tickets")
    .update({ status: nextState })
    .eq("id", token.ticket_id)

  /* 7️⃣ Invalidate token */
  await supabase
    .from("fe_action_tokens")
    .update({ used: true })
    .eq("id", token.id)
}

/**
 * FE submits ON-SITE proof
 */
router.post("/onsite", async (req, res) => {
  try {
    const { tokenId, imageUrl, remarks } = req.body

    await handleProofSubmission({
      tokenId,
      imageUrl,
      remarks,
      expectedActionType: "ON_SITE",
    })

    return res.json({ success: true })
  } catch (err) {
    return res.status(400).json({ error: err.message })
  }
})

/**
 * FE submits RESOLUTION proof
 */
router.post("/resolution", async (req, res) => {
  try {
    const { tokenId, imageUrl, remarks } = req.body

    await handleProofSubmission({
      tokenId,
      imageUrl,
      remarks,
      expectedActionType: "RESOLUTION",
    })

    return res.json({ success: true })
  } catch (err) {
    return res.status(400).json({ error: err.message })
  }
})

export default router
