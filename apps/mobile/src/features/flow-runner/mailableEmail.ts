/**
 * Is this address one an SMTP server will actually accept?
 *
 * WHY THIS EXISTS. A lead was captured with `s.@live.de`. The local part ends
 * in a dot, which RFC 5321's dot-atom forbids, so the mail server rejected it
 * with `553 5.1.3 The address is not a valid RFC 5321 address` — three times,
 * on a backoff ladder, hours after the rep had walked away. The offer never
 * arrived and nobody found out: offer jobs are keyed on `lead_id`, and the
 * admin's delivery view joins on `contract_id`, so that failure has no human
 * surface anywhere in the product.
 *
 * The only check on the path was `.includes('@')`, which `s.@live.de` passes.
 *
 * DELIBERATELY NOT a full RFC 5322 validator. That grammar accepts quoted local
 * parts, comments and domain literals, none of which a customer types at a door
 * and several of which our own mail template would mangle. This is the narrow
 * question worth asking at the point of capture: will handing this string to
 * `RCPT TO` come back 250, or will it come back 553 tomorrow morning?
 *
 * The rules, all three from the same failure class — a dot where a dot may not
 * be:
 *   * exactly one `@`, with something on each side
 *   * neither part starts or ends with `.`, and no `..` anywhere
 *   * the domain has at least one dot and a last label of two or more letters
 *
 * A rejected address is NOT an error the rep has to solve: `EndAsLeadSheet`
 * still writes the lead, it just does not promise an offer mail it cannot send.
 */

const LOCAL = /^[^\s@.][^\s@]*$|^[^\s@]$/;

export function isMailable(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const address = value.trim();
  if (address.length === 0 || address.length > 254) return false;

  const at = address.indexOf('@');
  // Exactly one `@`: `indexOf` and `lastIndexOf` agreeing is the whole test.
  if (at <= 0 || at !== address.lastIndexOf('@')) return false;

  const local = address.slice(0, at);
  const domain = address.slice(at + 1);
  if (local.length === 0 || local.length > 64 || domain.length === 0) return false;

  // The bug that started this: a local part may not begin or end with a dot,
  // and may not contain two in a row.
  if (local.startsWith('.') || local.endsWith('.') || local.includes('..')) return false;
  if (!LOCAL.test(local)) return false;

  if (domain.startsWith('.') || domain.endsWith('.') || domain.includes('..')) return false;
  if (/[\s@]/.test(domain)) return false;

  const labels = domain.split('.');
  if (labels.length < 2) return false;
  if (labels.some((label) => label.length === 0 || label.startsWith('-') || label.endsWith('-'))) {
    return false;
  }
  const tld = labels[labels.length - 1] ?? '';
  return /^[A-Za-z]{2,}$/.test(tld);
}
