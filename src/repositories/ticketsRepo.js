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
