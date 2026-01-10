export function normalizeSubject(subject = '') {
  return subject
    .toLowerCase()
    .replace(/^(\s*(re|fw|fwd):\s*)+/gi, '')
    .trim();
}
