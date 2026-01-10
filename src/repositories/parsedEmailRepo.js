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
