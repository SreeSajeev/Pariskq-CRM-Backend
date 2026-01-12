// customerClarificationService
// Composes and (optionally) sends a clarification email requesting missing fields.
// Design notes:
// - Safe to call multiple times (idempotent): it composes the same message each call.
// - If a runtime mailer is available via globalThis.sendEmail, it will be invoked; otherwise
//   the function returns the composed payload for an external sender to use.
// - Never throws.

export function sendMissingInfoEmail({ to, originalSubject, missingFields }) {
  try {
    const safeTo = typeof to === 'string' && to.trim() ? to.trim() : null;
    const subject = `Re: ${originalSubject || ''}`.trim();

    const fieldList = Array.isArray(missingFields) && missingFields.length
      ? missingFields.join(', ')
      : 'unspecified fields';

    const bodyLines = [
      'Hello,',
      '',
      'We received your message but are missing some information required to process your request.',
      `Please provide the following field(s): ${fieldList}.`,
      '',
      'Reply to this email with the requested information and we will continue processing your ticket.',
      '',
      'Thank you.',
    ];

    const message = {
      to: safeTo,
      subject,
      text: bodyLines.join('\n'),
      metadata: {
        missingFields: Array.isArray(missingFields) ? missingFields : [],
      },
    };

    // If a global mailer is provided, use it. Use try/catch to avoid throwing.
    try {
      if (typeof globalThis.sendEmail === 'function') {
        // sendEmail should be implemented elsewhere to actually deliver mail.
        // It should accept a message object similar to this payload.
        globalThis.sendEmail(message);
        return { sent: true, message };
      }
    } catch (e) {
      // ignore mailer errors; fall through to return payload
    }

    // Mailer not available — return the composed payload so caller can send it.
    return { sent: false, message };
  } catch (err) {
    // Never throw
    return { sent: false, message: null, error: 'Failed to compose clarification email' };
  }
}
