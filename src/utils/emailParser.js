//emailParser.js
import { Buffer } from 'buffer';

function decodeBase64(content) {
  if (!content) return '';

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
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/td>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\n+/g, '\n')
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
  const textBody = decodeBase64(payload?.TextBody || '');
  const htmlBodyRaw = decodeBase64(payload?.HtmlBody || '');
  const htmlBody = stripHtml(htmlBodyRaw);

  return `
${subject}
${textBody}
${htmlBody}
`.replace(/\r\n/g, '\n').trim();
}
