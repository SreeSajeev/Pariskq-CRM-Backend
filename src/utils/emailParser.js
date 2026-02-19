// /utils/emailParser.js
import { Buffer } from 'buffer';

/**
 * Robust base64 detection & decoding
 */
function decodeIfBase64(content) {
  if (!content || typeof content !== 'string') return '';

  const stripped = content.replace(/\s/g, '');

  const looksBase64 =
    stripped.length > 100 &&
    /^[A-Za-z0-9+/=]+$/.test(stripped);

  if (!looksBase64) return content;

  try {
    return Buffer.from(stripped, 'base64').toString('utf-8');
  } catch {
    return content;
  }
}

/**
 * Convert HTML → text
 * Extracts table rows properly.
 */
function htmlToText(html) {
  if (!html) return '';

  let cleaned = String(html);

  // Remove script/style
  cleaned = cleaned
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '');

  // Convert table rows into newline pairs
  cleaned = cleaned
    .replace(/<\/tr>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/td>/gi, ' ')
    .replace(/<td>/gi, ' ');

  // Remove remaining tags
  cleaned = cleaned.replace(/<[^>]+>/g, ' ');

  // Decode common entities
  cleaned = cleaned
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');

  return cleaned
    .replace(/\r\n/g, '\n')
    .replace(/\n+/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

/**
 * Normalize spacing but preserve logical separation
 */
function normalize(text) {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\n+/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

/**
 * Unified Email Text Extractor
 */
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

    const textBody = decodeIfBase64(
      payload?.TextBody || payload?.textBody || ''
    );

    const htmlBodyDecoded = decodeIfBase64(
      payload?.HtmlBody || payload?.htmlBody || ''
    );

    const htmlText = htmlToText(htmlBodyDecoded);

    return normalize(
      [subject, textBody, htmlText]
        .filter(Boolean)
        .join('\n')
    );
  } catch {
    return '';
  }
}
