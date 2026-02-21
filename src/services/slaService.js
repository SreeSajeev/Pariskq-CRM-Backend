// src/services/slaService.js
// SLA lifecycle: row creation, deadline calculation, breach detection.
// Do not modify ticket state machine. Call from lifecycle transitions only.

import { supabase } from "../supabaseClient.js";

const CONFIG_KEYS = [
  "assignment_sla_hours",
  "onsite_sla_hours",
  "resolution_sla_hours",
];
const DEFAULTS = { assignment_sla_hours: 4, onsite_sla_hours: 24, resolution_sla_hours: 48 };

/**
 * Fetch SLA config from configurations table. Returns hours per phase.
 * @returns {{ assignment_sla_hours: number, onsite_sla_hours: number, resolution_sla_hours: number }}
 */
export async function getSlaConfig() {
  const { data: rows, error } = await supabase
    .from("configurations")
    .select("key, value")
    .in("key", CONFIG_KEYS);

  if (error) {
    console.warn("[SLA] getSlaConfig failed, using defaults:", error.message);
    return { ...DEFAULTS };
  }

  const out = { ...DEFAULTS };
  for (const row of rows || []) {
    const v = row.value;
    const num = typeof v === "number" ? v : typeof v === "object" && v != null && "value" in v ? Number(v.value) : Number(v);
    if (!Number.isNaN(num) && num >= 0) {
      out[row.key] = num;
    }
  }
  return out;
}

/**
 * Create a single sla_tracking row for a ticket. No deadlines set.
 * Idempotent: if row exists for ticket_id, skip insert.
 */
export async function createSlaRow(ticketId) {
  if (!ticketId) return;
  const { data: existing } = await supabase
    .from("sla_tracking")
    .select("id")
    .eq("ticket_id", ticketId)
    .maybeSingle();

  if (existing) {
    return;
  }

  const { error } = await supabase.from("sla_tracking").insert({
    ticket_id: ticketId,
    assignment_breached: false,
    onsite_breached: false,
    resolution_breached: false,
    updated_at: new Date().toISOString(),
  });

  if (error) {
    if (error.code === "23505") return; // unique violation, ignore
    console.error("[SLA] createSlaRow failed:", ticketId, error.message);
    throw error;
  }
  console.log("[SLA] createSlaRow ok", { ticket_id: ticketId });
}

/**
 * Set assignment_deadline = now() + assignment_sla_hours. Call when ticket transitions to ASSIGNED.
 */
export async function setAssignmentDeadline(ticketId) {
  if (!ticketId) return;
  const config = await getSlaConfig();
  const hours = config.assignment_sla_hours ?? DEFAULTS.assignment_sla_hours;
  const deadline = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();

  const { error } = await supabase
    .from("sla_tracking")
    .update({
      assignment_deadline: deadline,
      updated_at: new Date().toISOString(),
    })
    .eq("ticket_id", ticketId);

  if (error) {
    console.error("[SLA] setAssignmentDeadline failed:", ticketId, error.message);
    return;
  }
  console.log("[SLA] setAssignmentDeadline ok", { ticket_id: ticketId, deadline });
}

/**
 * Set onsite_deadline = now() + onsite_sla_hours. Call when ticket transitions to ON_SITE.
 */
export async function setOnsiteDeadline(ticketId) {
  if (!ticketId) return;
  const config = await getSlaConfig();
  const hours = config.onsite_sla_hours ?? DEFAULTS.onsite_sla_hours;
  const deadline = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();

  const { error } = await supabase
    .from("sla_tracking")
    .update({
      onsite_deadline: deadline,
      updated_at: new Date().toISOString(),
    })
    .eq("ticket_id", ticketId);

  if (error) {
    console.error("[SLA] setOnsiteDeadline failed:", ticketId, error.message);
    return;
  }
  console.log("[SLA] setOnsiteDeadline ok", { ticket_id: ticketId, deadline });
}

/**
 * Set resolution_deadline = now() + resolution_sla_hours. Call when ticket transitions to RESOLVED_PENDING_VERIFICATION.
 */
export async function setResolutionDeadline(ticketId) {
  if (!ticketId) return;
  const config = await getSlaConfig();
  const hours = config.resolution_sla_hours ?? DEFAULTS.resolution_sla_hours;
  const deadline = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();

  const { error } = await supabase
    .from("sla_tracking")
    .update({
      resolution_deadline: deadline,
      updated_at: new Date().toISOString(),
    })
    .eq("ticket_id", ticketId);

  if (error) {
    console.error("[SLA] setResolutionDeadline failed:", ticketId, error.message);
    return;
  }
  console.log("[SLA] setResolutionDeadline ok", { ticket_id: ticketId, deadline });
}

/**
 * Evaluate breach flags for all sla_tracking rows. Do not block ticket lifecycle.
 * - assignment_breached: ticket still ASSIGNED and now() > assignment_deadline
 * - onsite_breached: ticket still ON_SITE and now() > onsite_deadline
 * - resolution_breached: ticket still RESOLVED_PENDING_VERIFICATION and now() > resolution_deadline
 */
export async function evaluateBreaches() {
  const now = new Date().toISOString();

  const { data: rows, error: fetchError } = await supabase
    .from("sla_tracking")
    .select("id, ticket_id, assignment_deadline, onsite_deadline, resolution_deadline, assignment_breached, onsite_breached, resolution_breached");

  if (fetchError) {
    console.error("[SLA] evaluateBreaches fetch failed:", fetchError.message);
    return;
  }

  if (!rows || rows.length === 0) return;

  const ticketIds = [...new Set(rows.map((r) => r.ticket_id))];
  const { data: tickets, error: ticketsError } = await supabase
    .from("tickets")
    .select("id, status")
    .in("id", ticketIds);

  if (ticketsError || !tickets) {
    console.error("[SLA] evaluateBreaches tickets fetch failed:", ticketsError?.message);
    return;
  }

  const statusByTicket = Object.fromEntries(tickets.map((t) => [t.id, t.status]));

  for (const row of rows) {
    const status = statusByTicket[row.ticket_id];
    if (status == null) continue;

    const updates = {};
    if (
      !row.assignment_breached &&
      row.assignment_deadline &&
      now > row.assignment_deadline &&
      status === "ASSIGNED"
    ) {
      updates.assignment_breached = true;
    }
    if (
      !row.onsite_breached &&
      row.onsite_deadline &&
      now > row.onsite_deadline &&
      status === "ON_SITE"
    ) {
      updates.onsite_breached = true;
    }
    if (
      !row.resolution_breached &&
      row.resolution_deadline &&
      now > row.resolution_deadline &&
      status === "RESOLVED_PENDING_VERIFICATION"
    ) {
      updates.resolution_breached = true;
    }

    if (Object.keys(updates).length === 0) continue;

    updates.updated_at = now;
    const { error: updateError } = await supabase
      .from("sla_tracking")
      .update(updates)
      .eq("id", row.id);

    if (updateError) {
      console.error("[SLA] evaluateBreaches update failed:", row.id, updateError.message);
    }
  }
}
