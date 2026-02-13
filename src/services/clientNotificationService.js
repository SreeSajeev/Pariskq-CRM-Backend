// src/services/clientNotificationService.js

import { supabase } from "../supabaseClient.js"
import { sendClientClosureEmail } from "./emailService.js"

export async function handleClientResolutionNotification(clientEmail) {
  const oneWeekAgo = new Date()
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7)

  const { data: resolvedTickets, error } = await supabase
    .from("tickets")
    .select("ticket_number, category")
    .eq("opened_by_email", clientEmail)
    .eq("status", "RESOLVED")
    .gte("updated_at", oneWeekAgo.toISOString())

  if (error) throw error

  if (resolvedTickets.length >= 5) {
    await sendClientClosureEmail({
      to: clientEmail,
      consolidated: true,
      tickets: resolvedTickets,
    })
  } else {
    for (const ticket of resolvedTickets) {
      await sendClientClosureEmail({
        to: clientEmail,
        consolidated: false,
        ticket,
      })
    }
  }
}
