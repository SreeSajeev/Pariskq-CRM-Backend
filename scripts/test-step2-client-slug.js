/**
 * Test Step 2: client_slug injection in createTicket().
 *
 * Run from repo root: node scripts/test-step2-client-slug.js
 * Requires .env with Supabase credentials. Creates 2 real tickets in DB.
 */

import { createTicket } from '../src/services/ticketService.js';
import { supabase } from '../src/supabaseClient.js';

const minimalParsed = {
  complaint_id: 'STEP2-TEST',
  vehicle_number: 'TEST-VH-001',
  category: 'Test',
  issue_type: 'Test',
  location: 'Test',
  confidence_score: 90,
  needs_review: true,
};

async function getTicketClientSlug(ticketNumber) {
  const { data, error } = await supabase
    .from('tickets')
    .select('ticket_number, client_slug, opened_by_email')
    .eq('ticket_number', ticketNumber)
    .single();
  if (error) throw new Error(`Fetch failed: ${error.message}`);
  return data;
}

async function run() {
  console.log('Step 2 test: client_slug injection\n');

  // 1) Sender with "hitachi" in email → expect client_slug = 'hitachi'
  const rawHitachi = {
    from_email: 'user@hitachi.com',
    subject: 'Step2 test Hitachi',
    payload: {},
  };
  const { ticketNumber: hitachiTicketNumber } = await createTicket(
    minimalParsed,
    rawHitachi,
    { requiredComplete: false }
  );
  const hitachiRow = await getTicketClientSlug(hitachiTicketNumber);
  const hitachiOk = hitachiRow.client_slug === 'hitachi';
  console.log(`1) Hitachi sender (${rawHitachi.from_email}):`);
  console.log(`   ticket_number=${hitachiRow.ticket_number}, client_slug=${JSON.stringify(hitachiRow.client_slug)}`);
  console.log(`   ${hitachiOk ? 'PASS' : 'FAIL'} (expected client_slug "hitachi")\n`);

  // 2) Sender without "hitachi" → expect client_slug = null
  const rawOther = {
    from_email: 'other@gmail.com',
    subject: 'Step2 test Other',
    payload: {},
  };
  const { ticketNumber: otherTicketNumber } = await createTicket(
    { ...minimalParsed, complaint_id: 'STEP2-TEST-2' },
    rawOther,
    { requiredComplete: false }
  );
  const otherRow = await getTicketClientSlug(otherTicketNumber);
  const otherOk = otherRow.client_slug == null;
  console.log(`2) Non-Hitachi sender (${rawOther.from_email}):`);
  console.log(`   ticket_number=${otherRow.ticket_number}, client_slug=${JSON.stringify(otherRow.client_slug)}`);
  console.log(`   ${otherOk ? 'PASS' : 'FAIL'} (expected client_slug null)\n`);

  if (hitachiOk && otherOk) {
    console.log('Step 2 test: all checks passed.');
  } else {
    console.log('Step 2 test: some checks failed.');
    process.exit(1);
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
