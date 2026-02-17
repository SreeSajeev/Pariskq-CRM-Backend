// src/services/tokenService.js
// Single-responsibility token lifecycle service

import crypto from "crypto"
import { supabase } from "../supabaseClient.js"

/**
 * Create FE action token
 * - One active, unexpired token per (ticket_id, action_type)
 * - Idempotent and race-safe
 */
export async function createActionToken({
  ticketId,
  feId,
  actionType,
}) {
  const nowIso = new Date().toISOString()

  // 1️⃣ Check for existing active token
  const { data: existing, error: existingError } = await supabase
    .from("fe_action_tokens")
    .select("id")
    .eq("ticket_id", ticketId)
    .eq("action_type", actionType)
    .eq("used", false)
    .gt("expires_at", nowIso)
    .maybeSingle()

  if (existingError) {
    throw existingError
  }

  if (existing) {
    return existing.id
  }

  // 2️⃣ Create new token
  const tokenId = crypto.randomUUID()
  const expiresAtIso = new Date(
    Date.now() + 24 * 60 * 60 * 1000
  ).toISOString()

  const { error: insertError } = await supabase
    .from("fe_action_tokens")
    .insert({
      id: tokenId,
      ticket_id: ticketId,
      fe_id: feId,
      action_type: actionType,
      expires_at: expiresAtIso,
      used: false,
    })

  if (insertError) {
    // 3️⃣ Race-condition fallback (re-check existing)
    const { data: retry, error: retryError } = await supabase
      .from("fe_action_tokens")
      .select("id")
      .eq("ticket_id", ticketId)
      .eq("action_type", actionType)
      .eq("used", false)
      .gt("expires_at", nowIso)
      .maybeSingle()

    if (retryError) {
      throw retryError
    }

    if (retry) {
      return retry.id
    }

    throw insertError
  }

  return tokenId
}

/**
 * Mark token as used (atomic single-use guarantee)
 */
export async function markTokenUsed(tokenId) {
  const { data, error } = await supabase
    .from("fe_action_tokens")
    .update({ used: true })
    .eq("id", tokenId)
    .eq("used", false)
    .select("id")

  if (error) {
    throw error
  }

  if (!data || data.length === 0) {
    throw new Error("Token already used or invalid")
  }

  return true
}
