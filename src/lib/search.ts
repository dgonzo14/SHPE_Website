/**
 * Lowercase without accents, so "jose" finds "José" and "pena" finds "Peña":
 * NFD splits "ñ" into "n" plus a combining tilde, and the combining marks
 * (U+0300 to U+036F) are dropped.
 *
 * profiles.search_text is folded with the same steps in SQL
 * (20260921000001_member_search_text.sql), so a member search has to fold its
 * words with this, or a word typed with an accent would find nobody.
 */
export function foldForSearch(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}
