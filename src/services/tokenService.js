// src/services/tokenService.js

import crypto from "crypto"
import { supabase } from "../supabaseClient.js"

/**
 * Create FE action token (IDEMPOTENT)
 * - One active token per (ticket_id, action_type)
 * - Safe to retry
 */
export async function createActionToken({
  ticketId,
  feId,
  actionType,
}) {
  // 1️⃣ Check for existing unused token
  const { data: existing, error: existingError } = await supabase
    .from("fe_action_tokens")
    .select("id")
    .eq("ticket_id", ticketId)
    .eq("action_type", actionType)
    .eq("used", false)
    .maybeSingle()

  if (existingError) {
    throw existingError
  }

  if (existing) {
    return existing.id
  }

  // 2️⃣ Create new token
  const token = crypto.randomUUID()
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000) // 24h

  const { error } = await supabase
    .from("fe_action_tokens")
    .insert({
      id: token,
      ticket_id: ticketId,
      fe_id: feId,
      action_type: actionType,
      used: false,
      expires_at: expiresAt,
    })

  if (error) throw error

  return token
}

/**
 * Validate FE action token
 * - Must match ticket + FE + action
 * - Must not be used
 * - Must not be expired
 */
export async function validateActionToken({
  token,
  ticketId,
  feId,
  actionType,
}) {
  const { data, error } = await supabase
    .from("fe_action_tokens")
    .select("*")
    .eq("id", token)
    .eq("ticket_id", ticketId)
    .eq("fe_id", feId)
    .eq("action_type", actionType)
    .eq("used", false)
    .single()

  if (error || !data) {
    throw new Error("Invalid or expired action token")
  }

  if (data.expires_at && new Date(data.expires_at) < new Date()) {
    throw new Error("Action token has expired")
  }

  return data
}

/**
 * Mark token as used (single-use guarantee)
 */
export async function markTokenUsed(tokenId) {
  const { error } = await supabase
    .from("fe_action_tokens")
    .update({
      used: true,
      used_at: new Date(),
    })
    .eq("id", tokenId)
    .eq("used", false)

  if (error) {
    throw error
  }
}
