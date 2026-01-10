import { supabase } from '../supabaseClient.js';

export async function addEmailComment(ticketId, text) {
  return supabase.from('ticket_comments').insert({
    ticket_id: ticketId,
    comment: text,
    source: 'EMAIL',
  });
}
