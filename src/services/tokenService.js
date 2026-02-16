import crypto from "crypto";
import { supabase } from "../supabaseClient.js";

/**
 * Create FE action token
 * - One active, unexpired token per (ticket_id, action_type)
 * - Safe to retry
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
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

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
    // 🛑 Race-condition fallback: re-fetch active token
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
 * Validate FE action token
 * - Must match ticket + FE + action
 * - Must be unused
 * - Must be unexpired
 */
export async function validateActionToken({
  token,
  ticketId,
  feId,
  actionType,
}) {
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from("fe_action_tokens")
    .select("*")
    .eq("id", token)
    .eq("ticket_id", ticketId)
    .eq("fe_id", feId)
    .eq("action_type", actionType)
    .eq("used", false)
    .gt("expires_at", now)
    .single();

  if (error || !data) {
    throw new Error("Invalid or expired action token");
  }

  return data;
}

/**
 * Mark token as used (single-use guarantee)
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
}
