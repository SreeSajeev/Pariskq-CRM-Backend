import { supabase } from '../supabaseClient.js';

export async function addEmailComment(ticketId, text) {
  if (!ticketId) {
    return { data: null, error: new Error('Missing ticketId in addEmailComment') };
  }

  const body = text != null ? String(text) : '';

  return supabase.from('ticket_comments').insert({
    ticket_id: ticketId,
    body,
    source: 'EMAIL',
  });
}
