export function hasScopedTokens(raw: string): boolean {
  return /(^|\s)(tag|duration|status):\S/i.test(raw);
}
