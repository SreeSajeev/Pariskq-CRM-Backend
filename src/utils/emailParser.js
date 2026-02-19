//emailParser.js
import { Buffer } from 'buffer';

function decodeBase64IfNeeded(content) {
  if (!content || typeof content !== 'string') return '';

  const stripped = content.replace(/\s/g, '');
  const looksBase64 =
    stripped.length > 200 &&
    /^[A-Za-z0-9+/=]+$/.test(stripped);

  if (!looksBase64) return content;

  try {
    return Buffer.from(stripped, 'base64').toString('utf-8');
  } catch {
    return content;
  }
}

function htmlToText(html) {
  if (!html) return '';

  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/td>/gi, ' ')
    .replace(/<td>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\r\n/g, '\n')
    .replace(/\n+/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function normalize(text) {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function getEmailText(raw) {
  try {
    let payload = raw?.payload;

    if (typeof payload === 'string') {
      try {
        payload = JSON.parse(payload);
      } catch {
        payload = {};
      }
    }

    const subject = raw?.subject || '';

    const textBody = decodeBase64IfNeeded(payload?.TextBody || '');
    const htmlBody = htmlToText(
      decodeBase64IfNeeded(payload?.HtmlBody || '')
    );

    return normalize(
      [subject, textBody, htmlBody]
        .filter(Boolean)
        .join(' ')
    );
  } catch {
    return '';
  }
}
