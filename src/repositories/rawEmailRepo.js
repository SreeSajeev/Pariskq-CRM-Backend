import { supabase } from '../supabaseClient.js';

export async function fetchPendingRawEmails(limit = 10) {
  return supabase
    .from('raw_emails')
    .select('*')
    .or('processing_status.is.null,processing_status.eq.PENDING')
    .order('created_at')
    .limit(limit);
}

export async function updateRawEmailStatus(id, status, extra = {}) {
  return supabase
    .from('raw_emails')
    .update({ processing_status: status, ...extra })
    .eq('id', id);
}
