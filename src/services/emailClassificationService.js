// services/classificationService.js

/**
 * Deterministic, production-grade email classifier.
 *
 * Priority:
 * 1. AUTO_REPLY
 * 2. COMPLAINT (structured signals override sender heuristics)
 * 3. PROMOTIONAL
 * 4. UNKNOWN
 *
 * Guarantees:
 * - Never throws
 * - No mutation of input
 * - Stable return contract
 */

export function classifyEmail(rawEmail) {
  try {
    /* =====================================================
       Normalization Helpers
    ===================================================== */

    const safeString = (v) =>
      v === null || v === undefined
        ? ''
        : typeof v === 'string'
        ? v.trim()
        : typeof v === 'number' || typeof v === 'boolean'
        ? String(v)
        : '';

    const lower = (s) => safeString(s).toLowerCase();

    const clamp = (n, min = 0, max = 100) =>
      Math.max(min, Math.min(max, Math.round(n)));

    const safeParsePayload = (payload) => {
      if (!payload) return {};
      if (typeof payload === 'object') return { ...payload };
      if (typeof payload === 'string') {
        try {
          return JSON.parse(payload);
        } catch {
          return { __malformed: true };
        }
      }
      return {};
    };

    const stripHtml = (html) => {
      if (!html) return '';
      return String(html)
        .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, ' ')
        .replace(/<\/?[^>]+(>|$)/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/\s+/g, ' ')
        .trim();
    };

    const countLinks = (text) => {
      if (!text) return 0;
      const http = text.match(/https?:\/\/[^\s"']+/gi) || [];
      const www = text.match(/\bwww\.[^\s"']+/gi) || [];
      return http.length + www.length;
    };

    const containsAny = (text, phrases) =>
      phrases.some((p) => lower(text).includes(p));

    const findKeywords = (text, keywords) => {
      if (!text) return [];
      const found = [];
      const normalized = lower(text);

      for (const kw of keywords) {
        const escaped = kw.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
        const re = new RegExp(`\\b${escaped}\\b`, 'i');
        if (re.test(normalized)) found.push(kw);
      }
      return found;
    };

    /* =====================================================
       Input Extraction
    ===================================================== */

    const payload = safeParsePayload(rawEmail?.payload);
    const subjectRaw = safeString(rawEmail?.subject);
    const subject = subjectRaw.replace(/^(re|fw|fwd)\s*[:\-]+/i, '').trim();
    const from = lower(rawEmail?.from_email);

    const textBody =
      safeString(
        payload.TextBody ||
          payload.textBody ||
          payload.text ||
          payload.body ||
          payload.plain ||
          payload.plaintext
      ) ||
      stripHtml(
        payload.HtmlBody ||
          payload.htmlBody ||
          payload.html ||
          payload.bodyHtml
      );

    const combined = `${subject} ${textBody}`.trim();
    const combinedLower = lower(combined);
    const wordCount = combined.split(/\s+/).filter(Boolean).length;

    const reasons = [];

    /* =====================================================
       1️⃣ AUTO_REPLY
    ===================================================== */

    const autoReplyIndicators = [
      'out of office',
      'auto-reply',
      'automatic reply',
      'autoreply',
      'away from office',
    ];

    if (containsAny(combinedLower, autoReplyIndicators)) {
      reasons.push('Auto-reply indicator detected');
      return {
        type: 'AUTO_REPLY',
        confidence: 85,
        reasons,
      };
    }

    /* =====================================================
       2️⃣ COMPLAINT (Structured Override)
    ===================================================== */

    const hasComplaintId = /\bCCM\d{4,15}\b/i.test(combined);
    const hasVehicle = /\bVEHICLE\s+[A-Z0-9-]+\b/i.test(combined);

    const issueKeywords = [
      'error',
      'problem',
      'not working',
      'failed',
      'failure',
      'issue',
      'complaint',
      'damaged',
      'broken',
      'missing',
      'lost',
      'delay',
      'wrong',
    ];

    const detectedIssues = findKeywords(combined, issueKeywords);
    const humanLike = wordCount >= 3 && countLinks(combined) < wordCount / 2;

    if ((hasComplaintId || hasVehicle || detectedIssues.length > 0) && humanLike) {
      reasons.push('Operational complaint signals detected');

      let confidence = 75;
      if (hasComplaintId) confidence += 10;
      if (hasVehicle) confidence += 5;
      if (detectedIssues.length) confidence += 5;

      return {
        type: 'COMPLAINT',
        confidence: clamp(confidence, 75, 95),
        reasons,
      };
    }

    /* =====================================================
       3️⃣ PROMOTIONAL
    ===================================================== */

    const promoKeywords = [
      'unsubscribe',
      'special offer',
      'limited time',
      'buy now',
      'sale',
      'discount',
      'newsletter',
      'promotion',
      'deal',
    ];

    const detectedPromo = findKeywords(combined, promoKeywords);

    const senderPatterns = [
      'no-reply@',
      'noreply@',
      'newsletter@',
      'marketing@',
    ];

    const isPromoSender = senderPatterns.some((p) => from.includes(p));

    const promoScore =
      detectedPromo.length +
      (isPromoSender ? 1 : 0) +
      (countLinks(combined) >= 2 ? 1 : 0);

    if (promoScore > 0) {
      reasons.push('Promotional characteristics detected');

      return {
        type: 'PROMOTIONAL',
        confidence: clamp(70 + promoScore * 5, 70, 90),
        reasons,
      };
    }

    /* =====================================================
       4️⃣ UNKNOWN
    ===================================================== */

    if (!combined) {
      reasons.push('Empty subject and body');
      return {
        type: 'UNKNOWN',
        confidence: 70,
        reasons,
      };
    }

    reasons.push('No strong classification signals');
    return {
      type: 'UNKNOWN',
      confidence: 60,
      reasons,
    };
  } catch {
    return {
      type: 'UNKNOWN',
      confidence: 60,
      reasons: ['Unexpected classification failure'],
    };
  }
}
