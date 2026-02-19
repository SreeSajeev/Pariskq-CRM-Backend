//emailParser.jsimport { Buffer } from 'buffer';

/* ======================================================
   SAFE BASE64 DECODER
====================================================== */

function decodeBase64IfNeeded(content) {
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

/* ======================================================
   HTML → STRUCTURED TEXT
   Converts tables into "Label: Value" lines
====================================================== */

function htmlTableToStructuredText(html) {
  if (!html) return '';

  let clean = String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '');

  const rows = clean.match(/<tr[\s\S]*?<\/tr>/gi);
  if (!rows) return clean;

  const structuredLines = [];

  for (const row of rows) {
    const cells = row.match(/<td[\s\S]*?<\/td>/gi);
    if (!cells || cells.length < 2) continue;

    const label = stripTags(cells[0]);
    const value = stripTags(cells[1]);

    if (label && value) {
      structuredLines.push(`${label}: ${value}`);
    }
  }

  return structuredLines.join('\n');
}

/* ======================================================
   GENERIC HTML STRIPPER
====================================================== */

function stripTags(html) {
  if (!html) return '';

  return String(html)
    .replace(/<\/?[^>]+(>|$)/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/* ======================================================
   GENERAL HTML → TEXT
====================================================== */

function htmlToText(html) {
  if (!html) return '';

  // First attempt structured table parsing
  const structured = htmlTableToStructuredText(html);
  if (structured && structured.includes(':')) {
    return structured;
  }

  // Fallback generic stripping
  return stripTags(html);
}

/* ======================================================
   NOISE REMOVAL
====================================================== */

function removeForwardedNoise(text) {
  if (!text) return '';

  return text
    .replace(/-----\s*Forwarded Message\s*-----/gi, '')
    .replace(/Regards[\s\S]*/gi, '')
    .replace(/Best regards[\s\S]*/gi, '')
    .replace(/Thanks[\s\S]*/gi, '')
    .trim();
}

/* ======================================================
   NORMALIZATION
====================================================== */

function normalizeWhitespace(text) {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\n+/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

/* ======================================================
   PUBLIC API
====================================================== */

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

    const decodedTextBody = decodeBase64IfNeeded(
      payload?.TextBody || payload?.textBody || ''
    );

    const decodedHtmlBody = decodeBase64IfNeeded(
      payload?.HtmlBody || payload?.htmlBody || ''
    );

    const htmlConverted = htmlToText(decodedHtmlBody);

    const combined = [
      subject,
      decodedTextBody,
      htmlConverted
    ]
      .filter(Boolean)
      .join('\n');

    const cleaned = removeForwardedNoise(combined);

    return normalizeWhitespace(cleaned);
  } catch {
    return '';
  }
}
