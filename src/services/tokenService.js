// src/services/tokenService.js

import crypto from "crypto"
import { supabase } from "../config/supabase.js"

export async function createActionToken({
  ticketId,
  feId,
  actionType,
}) {
  const token = crypto.randomUUID()

  const { error } = await supabase
    .from("fe_action_tokens")
    .insert({
      id: token,
      ticket_id: ticketId,
      fe_id: feId,
      action_type: actionType,
    })

  if (error) throw error

  return token
}

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
    .single()

  if (error || !data) {
    throw new Error("Invalid or expired action token")
  }

  return data
}
