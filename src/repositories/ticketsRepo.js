import { supabase } from '../supabaseClient.js';
//working with tickets table
export async function findTicketByComplaintId(complaintId) {
  if (!complaintId) return null;

  const { data, error } = await supabase
    .from('tickets')
    .select('id')
    .eq('complaint_id', complaintId)
    .limit(1)
    .single();

  if (error && error.code !== 'PGRST116') {
  throw new Error(`ticketsRepo error: ${error.message}`);
}

  return data ?? null;
}

export async function findTicketByTicketNumber(ticketNumber) {
  if (!ticketNumber || typeof ticketNumber !== 'string') return null;
  const trimmed = String(ticketNumber).trim();
  if (!trimmed) return null;

  const { data, error } = await supabase
    .from('tickets')
    .select('id, status, vehicle_number, issue_type, location')
    .eq('ticket_number', trimmed)
    .limit(1)
    .maybeSingle();

  if (error) return null;
  return data ?? null;
}

export async function updateTicketStatus(ticketId, status) {
  if (!ticketId || !status) return { error: new Error('Missing ticketId or status') };
  return supabase
    .from('tickets')
    .update({ status })
    .eq('id', ticketId);
}

export async function insertTicket(ticket) {
  const { data, error } = await supabase
    .from('tickets')
    .insert(ticket)
    .select()
    .single();

  if (error) {
    throw new Error(`Ticket insert failed: ${error.message}`);
  }

  return data;
}
