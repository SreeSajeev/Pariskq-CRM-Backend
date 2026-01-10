import { supabase } from '../supabaseClient.js';

export async function findTicketByComplaintId(complaintId) {
  if (!complaintId) return null;

  const { data } = await supabase
    .from('tickets')
    .select('id')
    .eq('complaint_id', complaintId)
    .limit(1);

  return data?.[0] || null;
}

export async function insertTicket(data) {
  return supabase.from('tickets').insert(data);
}
