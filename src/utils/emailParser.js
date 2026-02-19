import { Buffer } from 'buffer';

function decodeBase64IfNeeded(content) {
  if (!content) return '';

  // Heuristic: detect base64 (long string, no spaces, mostly A-Za-z0-9+/=)
  const isLikelyBase64 =
    typeof content === 'string' &&
    content.length > 200 &&
    /^[A-Za-z0-9+/=\r\n]+$/.test(content.replace(/\s/g, ''));

  if (!isLikelyBase64) return content;

  try {
    return Buffer.from(content, 'base64').toString('utf-8');
  } catch {
    return content;
  }
}

function stripHtml(html) {
  if (!html) return '';
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function getEmailText(raw) {
  let payload = raw.payload;

  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload);
    } catch {
      payload = {};
    }
  }

  const subject = raw.subject || '';

  const textBody = decodeBase64IfNeeded(payload?.TextBody || '');
  const htmlBodyRaw = decodeBase64IfNeeded(payload?.HtmlBody || '');

  const htmlBody = stripHtml(htmlBodyRaw);

  return `
${subject}
${textBody}
${htmlBody}
`.replace(/\s+/g, ' ').trim();
}
