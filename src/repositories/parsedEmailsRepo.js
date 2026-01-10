import { supabase } from '../supabaseClient.js';

export async function insertParsedEmail(data) {
  return supabase
    .from('parsed_emails')
    .insert(data)
    .select()
    .single();
}

export async function markParsedAsTicketed(id) {
  return supabase
    .from('parsed_emails')
    .update({ ticket_created: true })
    .eq('id', id);
}

/**
 * 🔹 REQUIRED by autoTicketWorker
 */
export async function fetchUnprocessedParsedEmails(limit = 10) {
  const { data, error } = await supabase
    .from('parsed_emails')
    .select('*, raw_emails(*)')
    .eq('ticket_created', false)
    .order('created_at')
    .limit(limit);

  if (error) {
    console.error('❌ fetchUnprocessedParsedEmails error:', error);
    return [];
  }

  return data || [];
}
