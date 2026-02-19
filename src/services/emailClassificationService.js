
export function classifyEmail(rawEmail) {
    try {
        // Helpers
        const safeString = (v) => {
            if (v === null || v === undefined) return '';
            if (typeof v === 'string') return v.trim();
            if (typeof v === 'number' || typeof v === 'boolean') return String(v);
            return '';
        };

        const lower = (s) => safeString(s).toLowerCase();

        const clamp = (n, min = 0, max = 100) => Math.max(min, Math.min(max, Math.round(n)));

        const safeParsePayload = (p) => {
            if (p === null || p === undefined) return {};
            if (typeof p === 'object') return Object.assign({}, p);
            if (typeof p === 'string') {
                try {
                    return JSON.parse(p);
                } catch (e) {
                    return { __malformed: true, raw: p };
                }
            }
            return {};
        };

        const stripHtml = (s) => {
            if (!s) return '';
            // remove script/style blocks
            let out = String(s).replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, ' ');
            out = out.replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, ' ');
            // remove tags
            out = out.replace(/<\/?[^>]+(>|$)/g, ' ');
            // decode a few common entities
            out = out.replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>');
            // collapse whitespace
            out = out.replace(/\s+/g, ' ').trim();
            return out;
        };

        const extractHeadersMap = (payload) => {
            const map = {};
            if (!payload) return map;
            // Postmark and others might include headers as array of {Name,Value} or as object
            const rawHeaders = payload.Headers || payload.headers || payload.header || payload.h || null;
            if (Array.isArray(rawHeaders)) {
                rawHeaders.forEach((h) => {
                    if (!h) return;
                    const name = (h.Name || h.name || '').toString().toLowerCase();
                    const value = safeString(h.Value || h.value || h.Value || '');
                    if (name) map[name] = value;
                });
            } else if (rawHeaders && typeof rawHeaders === 'object') {
                Object.keys(rawHeaders).forEach((k) => {
                    map[k.toLowerCase()] = safeString(rawHeaders[k]);
                });
            }
            // Also consider top-level common headers
            ['auto-submitted', 'x-autoreply', 'x-autorespond', 'precedence'].forEach((k) => {
                if (payload[k] && !map[k]) map[k] = safeString(payload[k]);
            });
            return map;
        };

        const countLinks = (s) => {
            if (!s) return 0;
            const m = String(s).match(/https?:\/\/[^\s"']+/gi) || [];
            const m2 = String(s).match(/\bwww\.[^\s"']+/gi) || [];
            return m.length + m2.length;
        };

        const findKeywords = (s, kws) => {
            if (!s) return [];
            const found = [];
            const txt = lower(s);
            for (const kw of kws) {
                // match whole words where sensible, else substring
                const esc = kw.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
                const re = new RegExp(`\\b${esc}\\b`, 'i');
                if (re.test(txt)) found.push(kw);
                else if (txt.includes(kw.toLowerCase())) found.push(kw);
            }
            return found;
        };

        // Normalize inputs (do not mutate rawEmail)
        const payload = safeParsePayload(rawEmail && rawEmail.payload);
        const subjectRaw = safeString(rawEmail && rawEmail.subject);
        const subject = subjectRaw.replace(/^(re|fw|fwd)\s*[:\-]+/i, '').trim();
        const subjectLower = lower(subject);
        const from = safeString(rawEmail && rawEmail.from_email);
        const to = safeString(rawEmail && rawEmail.to_email);

        // Extract bodies
        const bodyCandidates = [
            payload.textBody, payload.TextBody, payload.text, payload.body, payload.plain, payload.plaintext,
            payload.htmlBody, payload.HtmlBody, payload.html, payload.bodyHtml
        ];
        let textBody = '';
        for (const c of bodyCandidates) {
            if (c && typeof c === 'string') {
                // prefer plain text fields
                if (/<\/?[a-z][\s\S]*>/i.test(c)) {
                    // looks like HTML
                    textBody = textBody || stripHtml(c);
                } else {
                    textBody = textBody || c.trim();
                }
            }
        }
        // If still empty but payload.raw exists, try to extract visible text
        if (!textBody && payload && typeof payload === 'object') {
            // try a few property names
            const fallback = safeString(payload.raw || payload.bodyHtml || payload.content || payload.data || payload.message);
            if (fallback) textBody = stripHtml(fallback);
        }

        const combined = ((subject ? subject + ' ' : '') + (textBody ? textBody : '')).trim();
        const combinedLower = lower(combined);
        const headers = extractHeadersMap(payload);

        const reasons = [];

        // Priority 1: AUTO_REPLY
        const autoHeaderKeys = ['auto-submitted', 'x-autoreply', 'x-autorespond', 'precedence'];
        const autoHeaderMatches = [];
        for (const k of Object.keys(headers)) {
            const lk = k.toLowerCase();
            if (autoHeaderKeys.includes(lk)) {
                const val = headers[k] || '';
                if (lk === 'precedence' && /bulk/i.test(val)) {
                    autoHeaderMatches.push('Precedence: bulk');
                } else if (val) {
                    autoHeaderMatches.push(`${k}: ${val}`);
                } else {
                    autoHeaderMatches.push(k);
                }
            }
        }

        const autoSubjectPhrases = [
            'out of office', 'auto-reply', 'autoreply', 'automatic reply', 'away from office'
        ];
        const autoBodyPhrases = [
            'i am currently out of the office', 'this is an automated response', 'automatic reply', 'out of office'
        ];

        const subjectAutoFound = autoSubjectPhrases.filter(p => subjectLower.includes(p));
        const bodyAutoFound = autoBodyPhrases.filter(p => combinedLower.includes(p));

        if (autoHeaderMatches.length > 0) {
            reasons.push(`Header signals: ${autoHeaderMatches.join('; ')}`);
            return {
                type: 'AUTO_REPLY',
                confidence: 95,
                reasons
            };
        }
        if (subjectAutoFound.length > 0) {
            reasons.push(`Subject contained auto-reply phrase(s): ${subjectAutoFound.join(', ')}`);
            return {
                type: 'AUTO_REPLY',
                confidence: 80,
                reasons
            };
        }
        if (bodyAutoFound.length > 0) {
            reasons.push(`Body contained auto-reply phrase(s): ${bodyAutoFound.join(', ')}`);
            return {
                type: 'AUTO_REPLY',
                confidence: 75,
                reasons
            };
        }

        // Priority 2: PROMOTIONAL
        const promoKeywords = ['unsubscribe', 'special offer', 'limited time', 'buy now', 'sale', 'discount', 'newsletter', 'promotion', 'promo', 'deal'];
        const promoFound = findKeywords(combined, promoKeywords);
        const promoFromPatterns = [];
        if (from) {
            const lf = from.toLowerCase();
            if (lf.includes('no-reply@') || lf.includes('noreply@')) promoFromPatterns.push('no-reply@');
            if (lf.includes('newsletter@')) promoFromPatterns.push('newsletter@');
            if (lf.includes('marketing@')) promoFromPatterns.push('marketing@');
        }
        const linkCount = countLinks(subject + ' ' + textBody);
        const unsubscribeFound = /unsubscribe/i.test(combined) ? ['unsubscribe'] : [];

        const promoSignals = promoFound.length + promoFromPatterns.length + (linkCount >= 2 ? 1 : 0) + (unsubscribeFound.length ? 1 : 0);
        // Only treat as promotional if NO complaint signals exist
        const hasStructuredComplaint =
            /\bCCM\d+\b/i.test(combined) ||
            /\bVEHICLE\s+[A-Z0-9]+\b/i.test(combined);

        if (promoSignals > 0 && !hasStructuredComplaint) {

        
            const details = [];
            if (promoFound.length) details.push(`keywords: ${promoFound.join(', ')}`);
            if (promoFromPatterns.length) details.push(`sender patterns: ${promoFromPatterns.join(', ')}`);
            if (linkCount >= 2) details.push(`${linkCount} links`);
            if (unsubscribeFound.length) details.push('contains "unsubscribe"');
            reasons.push(`Promotional signals: ${details.join('; ')}`);
            const base = 80;
            const confidence = clamp(base + 5 * (promoSignals - 1), 80, 100);
            return {
                type: 'PROMOTIONAL',
                confidence,
                reasons
            };
        }

        // Priority 3: UNKNOWN checks (payload malformed or empty)
        if (payload && payload.__malformed) {
            reasons.push('Payload could not be parsed (malformed JSON)');
            return { type: 'UNKNOWN', confidence: 75, reasons };
        }
        const subjectEmpty = !subject || subject.trim().length === 0;
        const bodyEmpty = !textBody || textBody.trim().length === 0;
        const combinedWords = combined.split(/\s+/).filter(Boolean);
        if (subjectEmpty && bodyEmpty) {
            reasons.push('No subject and no readable body');
            return { type: 'UNKNOWN', confidence: 75, reasons };
        }
        if ((combinedWords.length === 1 || combinedWords.length === 2) && bodyEmpty) {
            reasons.push(`Content too short or ambiguous ("${combined}")`);
            return { type: 'UNKNOWN', confidence: 65, reasons };
        }

        // Priority 4: COMPLAINT (only if safe)
        const issueKeywords = ['error', 'problem', 'not working', 'failed', 'failure', 'issue', 'complaint', 'damaged', 'burned', 'disconnected', 'broken', 'leak', 'delay', 'missing', 'lost', 'wrong', 'late'];
        const issueFound = findKeywords(combined, issueKeywords);

        // Structured indicators (conservative): complaint id like CCM123 or uppercase letters+digits, vehicle tags like TRK1234, numbers with known prefix
        const structuredMatches = [];
        try {
            const complaintIdRe = /\b[A-Z]{2,5}\d{2,6}\b/g;
            const vehicleRe = /\b(?:truck|vehicle|van|lorry|bus|trailer|reg|regn|regno|plate)\b[:\s]*[A-Z0-9-]{3,15}/i;
            const genericId = combined.match(complaintIdRe) || [];
            const vehicleMatch = combined.match(vehicleRe) || [];
            if (genericId.length) structuredMatches.push(...genericId.slice(0, 3));
            if (vehicleMatch.length) structuredMatches.push(...vehicleMatch.slice(0, 3));
        } catch (_) {
            // ignore regex errors silently (function must not throw)
        }

        // Heuristic human-written: at least 3 words and not mostly links
        const mostlyLinks = (countLinks(combined) > (combinedWords.length / 2));
        const humanLike = combinedWords.length >= 3 && !mostlyLinks;

        if ((issueFound.length > 0 || structuredMatches.length > 0) && humanLike) {
            const details = [];
            if (issueFound.length) details.push(`issue keywords: ${issueFound.join(', ')}`);
            if (structuredMatches.length) details.push(`structured indicators: ${structuredMatches.join(', ')}`);
            reasons.push(`Complaint-like signals: ${details.join('; ')}`);
            // Confidence calculation: base 70, +10 for issue keywords, +10 for structured, capped
            let conf = 70;
            conf += Math.min(20, issueFound.length * 5);
            conf += structuredMatches.length ? 10 : 0;
            conf = clamp(conf, 70, 90);
            return {
                type: 'COMPLAINT',
                confidence: conf,
                reasons
            };
        }

        // Fallback to UNKNOWN
        reasons.push('Content ambiguous or lacked clear complaint signals');
        return { type: 'UNKNOWN', confidence: 60, reasons };
    } catch (err) {
        // Never throw — always return UNKNOWN with reason
        return {
            type: 'UNKNOWN',
            confidence: 60,
            reasons: ['Unexpected error during classification']
        };
    }
}