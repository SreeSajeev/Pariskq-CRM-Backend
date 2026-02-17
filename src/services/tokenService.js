// src/services/tokenService.js
// Single-responsibility token lifecycle service

import crypto from "crypto";
import { supabase } from "../supabaseClient.js";

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
  const now = new Date().toISOString();

  // 1️⃣ Check for existing active token
  const { data: existing, error: existingError } = await supabase
    .from("fe_action_tokens")
    .select("id")
    .eq("ticket_id", ticketId)
    .eq("action_type", actionType)
    .eq("used", false)
    .gt("expires_at", now)
    .maybeSingle();

  if (existingError) {
    throw existingError;
  }

  if (existing) {
    return existing.id;
  }

  // 2️⃣ Create new token
  const token = crypto.randomUUID();
  const expiresAt = new Date(
    Date.now() + 24 * 60 * 60 * 1000
  ).toISOString();

  const { error: insertError } = await supabase
    .from("fe_action_tokens")
    .insert({
      id: token,
      ticket_id: ticketId,
      fe_id: feId,
      action_type: actionType,
      used: false,
      expires_at: expiresAt,
    });

  if (insertError) {
    // Race-condition fallback
    const { data: retry } = await supabase
      .from("fe_action_tokens")
      .select("id")
      .eq("ticket_id", ticketId)
      .eq("action_type", actionType)
      .eq("used", false)
      .gt("expires_at", now)
      .maybeSingle();

    if (retry) {
      return retry.id;
    }

    throw insertError;
  }

  return token;
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
    .select("id");

  if (error) {
    throw error;
  }

  if (!data || data.length === 0) {
    throw new Error("Token already used or invalid");
  }

  return true;
}
