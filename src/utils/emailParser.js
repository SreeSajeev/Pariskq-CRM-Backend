export function getEmailText(raw) {
  let payload = raw.payload;

  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload);
    } catch {
      payload = {};
    }
  }

  return `
${raw.subject || ''}
${payload.TextBody || ''}
${payload.HtmlBody || ''}
`;
}
