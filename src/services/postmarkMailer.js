import postmark from 'postmark';

const client = new postmark.ServerClient(process.env.POSTMARK_SERVER_TOKEN);

export async function sendEmail({ to, subject, text, metadata }) {
  if (!to) {
    throw new Error('Cannot send email: missing recipient');
  }

  // Minimal, non-sensitive logging for observability
  console.info('mail: sending clarification email to', to, 'subject:', subject);

  try {
    const res = await client.sendEmail({
      From: process.env.SUPPORT_FROM_EMAIL,
      To: to,
      Subject: subject,
      TextBody: text,
      MessageStream: 'outbound',
      Metadata: metadata || {},
    });

    // Log message id if present (no message bodies or secrets)
    console.info('mail: postmark send success to', to, 'MessageID:', res?.MessageID || res?.MessageID);
    return res;
  } catch (err) {
    console.error('mail: postmark send failed to', to, 'error:', err?.message || err);
    throw err;
  }
}
