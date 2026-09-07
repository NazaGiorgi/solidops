// Normalise an email subject or ticket title into a stable thread key so that
// replies with slightly re-formatted subjects (Re:, FW:, ticket tags, numbers)
// can be matched to the same ticket thread.
export function normalizeSubjectKey(subject: string): string {
  if (!subject) return '';
  return subject
    .toLowerCase()
    .trim()
    // Remove leading reply/forward markers, e.g. "Re:", "FW:", "AW:". Also
    // drop leading ticket tags like "[Ticket]".
    .replace(/^(re|fr|fwd|fw|aw|sv|antw|wg|ref|ticket)(\s*:|\s*\[)?/i, '')
    // Remove bracket-delimited ticket tags anywhere: "[Ticket]", "(ticket)".
    .replace(/\[(ticket|caso|ref)\]/gi, '')
    .replace(/\(ticket[^)]*\)/gi, '')
    // Remove ticket-number markers like "[#123]", "#123", "(#123)".
    .replace(/[\[(]?#\d+[\])]?/g, '')
    // Collapse whitespace.
    .replace(/\s+/g, ' ')
    // Strip any remaining stray brackets.
    .replace(/[#\[\]]+/g, '')
    .trim();
}
