/**
 * "Kunden" as a PROJECTION over rows that are already on the device — not a
 * table, not a sync stream, not a migration.
 *
 * There is no customer entity anywhere in this system. A customer exists only
 * as strings on two tables the rep already carries: `contracts.customer_name`
 * (0055:38, frozen into the row at INSERT because `contracts` is append-only)
 * and the `leads` contact block (0033_leads.sql: contact_name/contact_phone/
 * contact_email/product_interest). Both tables are already synced to this
 * device under the SAME visibility rule — `rep_id = auth.user_id() OR team_id
 * IN led_or_administered_team_ids` (powersync/sync-streams.yaml:83-88 for
 * contracts, :229-234 for leads).
 *
 * Which is the entire argument for doing it this way:
 *
 *   * NO NEW PII REACHES THE PHONE. Every value a customer row can show was
 *     already downloaded and already readable through "Meine Abschlüsse". A
 *     `customers` table would mean a new sync stream, a new RLS surface, and a
 *     second copy of the same names sitting in local SQLite.
 *   * NOTHING TO KEEP IN SYNC. A materialised customer would need a writer on
 *     every contract INSERT and every lead INSERT, and would drift the moment
 *     one of those paths forgot. A projection cannot drift — it is recomputed
 *     from the source rows on every call.
 *   * NO MIGRATION. Nothing to add server-side, nothing to backfill, and no
 *     new retention target: the 0045 retention jobs already own the lifetime
 *     of the underlying rows, and whatever they anonymise disappears from this
 *     projection automatically on the next recompute.
 *
 * Deliberately a pure, exported module and NOT component logic — the same
 * posture as `features/map/buildingStatus.ts` and
 * `features/flow-runner/reviewRows.ts`. This repo has no
 * `react-test-renderer`, so anything that lives only inside a component
 * cannot be asserted at all. Everything decidable about a customer therefore
 * lives here: who counts as one person, what their name reads as, and what a
 * search box matches. No React, no database access, no imports from expo-* or
 * react-native — the caller supplies the rows.
 *
 * Everything here is total: no input can make these functions throw. The rep
 * is standing at a door. One malformed row must cost that row, never the
 * screen.
 */

/**
 * The `contracts` columns this projection reads. A structural subset of the
 * local table (apps/mobile/src/lib/db/schema.ts) rather than an import of
 * `ContractListRow`, because the caller may hand us raw SQLite rows — every
 * field is therefore `unknown`-typed and optional.
 */
export interface CustomerContractInput {
  id?: unknown;
  customer_name?: unknown;
  deal_reference?: unknown;
  /**
   * There is no product DISPLAY name anywhere on a contract row — only the
   * definition id. The same best-effort limitation `ContractListRow.productName`
   * already documents; inventing a label here would be faked data.
   */
  product_definition_id?: unknown;
  signed_at?: unknown;
  created_at?: unknown;
  /** Frozen monthly door price, numeric→text like every PowerSync column. */
  snapshot_door_price?: unknown;
  /**
   * 0084 §5.2 — set when this contract came out of a redeemed offer. It is the
   * ONLY offline-truthful way to tell an accepted offer from an open one:
   * `leads.converted_contract_id` exists server-side but is NOT declared in the
   * device schema (apps/mobile/src/lib/db/schema.ts), so it never arrives.
   */
  redeemed_lead_id?: unknown;
  /**
   * NOT a column of the local `contracts` table, and not one server-side
   * either — 0045's anonymise job never touches contracts (they are statutory
   * data, § 257 HGB). Accepted here only so rule 4 is enforced uniformly over
   * both inputs; in practice it is always absent.
   */
  anonymized_at?: unknown;
}

/** The `leads` columns this projection reads (0033_leads.sql + 0045 + 0084). */
export interface CustomerLeadInput {
  id?: unknown;
  /** 0084 §5.2 — the written offer left behind when nobody signed. */
  offer_code?: unknown;
  offer_expires_at?: unknown;
  contact_name?: unknown;
  contact_phone?: unknown;
  contact_email?: unknown;
  product_interest?: unknown;
  created_at?: unknown;
  converted_contract_id?: unknown;
  /**
   * 0045_retention_jobs.sql:73 — stamped by `anonymize_expired_leads()` when
   * the row's PII has been nulled. A stamped row is excluded outright (see
   * `isAnonymized`).
   *
   * A caveat worth stating rather than hiding: this column is NOT declared in
   * the device schema (apps/mobile/src/lib/db/schema.ts, `leads`), so today it
   * arrives as `undefined` no matter what the server holds — PowerSync drops
   * undeclared columns even though the stream is `SELECT *`. The filter is
   * still the correct rule and is written to survive the column being declared
   * later; in the meantime an anonymised lead is dropped anyway, because 0045
   * nulls name, phone AND e-mail and rule 4 produces no customer from a row
   * carrying neither.
   */
  anonymized_at?: unknown;
}

/** One signed deal, as it hangs under a customer. */
export interface CustomerContract {
  /** The contracts row id, or null when the row carried none. */
  id: string | null;
  dealReference: string | null;
  /** The product definition id — no display name exists on the row. */
  productName: string | null;
  /** `signed_at`, falling back to `created_at` for a row missing it. */
  signedAtIso: string | null;
  /** Parsed `snapshot_door_price`, or null when absent/unparseable. */
  priceEur: number | null;
}

/**
 * One offer left with a customer, as the rep needs to see it again.
 *
 * `redeemed` is DERIVED from the local contracts (`redeemed_lead_id`), not read
 * from the lead: the server's `leads.converted_contract_id` is not in the
 * device schema, so trusting it would mean showing "offen" for a deal that was
 * closed hours ago on this very phone.
 *
 * Deliberately NO `expired` flag. Expiry is a comparison against a clock, and
 * this module has none — a pure projection that silently read `Date.now()`
 * would be untestable and would change its answer between two renders. The
 * caller holds the clock and compares `expiresAtIso` itself.
 */
export interface CustomerOffer {
  /** The one-time code the customer types, e.g. `FDS-4LEY-ZU3K`. */
  code: string;
  /** `offer_expires_at`, or null when the lead carried none. */
  expiresAtIso: string | null;
  /** True when a contract on this device redeemed this offer. */
  redeemed: boolean;
}

export interface Customer {
  /**
   * Stable identity key: `email:<normalised>` when an e-mail is known,
   * otherwise `name:<normalised>`. Stable across recomputes because it derives
   * only from the data, never from array order or a counter — so it is
   * directly usable as a React key and as a navigation parameter.
   */
  key: string;
  /** The name seen for this person; the e-mail when no name exists at all. */
  displayName: string;
  email: string | null;
  phone: string | null;
  contracts: CustomerContract[];
  contractCount: number;
  /** Offers left with this person, newest expiry first. Empty for most. */
  offers: CustomerOffer[];
  /** Newest `signedAtIso` among `contracts`, or null for a lead-only customer. */
  lastContractAtIso: string | null;
}

/** Trimmed string, or null for anything that is not usable text. */
function asText(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Comparison form: lowercase, diacritics stripped, whitespace collapsed.
 *
 * NFD + combining-mark removal covers the umlauts a German name actually
 * carries (Müller → muller), so a rep typing on a phone keyboard without
 * long-pressing still finds the row. `ß` has no decomposition, so it is mapped
 * to `ss` explicitly — otherwise "Strasse" would never find "Straße".
 *
 * Deliberately NOT a full transliteration: "Mueller" does not find "Müller".
 * That is a guess about intent, and a search box returning rows the query does
 * not literally contain is worse than one returning none.
 */
function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ß/g, 'ss')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Digits only — how a phone number is compared, see `searchCustomers`. */
function digitsOnly(value: string): string {
  return value.replace(/\D/g, '');
}

function asEmail(value: unknown): string | null {
  const text = asText(value);
  if (text === null) {
    return null;
  }
  // No validation beyond "an @ with something either side": rejecting an
  // odd-but-real address would silently split one customer into two, and this
  // is a grouping key, not a delivery guarantee.
  return /^[^@\s]+@[^@\s]+$/.test(text) ? text : null;
}

/** Finite number from PowerSync's numeric→text mirroring, or null. */
function asNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  const text = asText(value);
  if (text === null) {
    return null;
  }
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Rule 4: a row the 0045 retention job has anonymised never comes back. */
function isAnonymized(row: Record<string, unknown>): boolean {
  return asText(row.anonymized_at) !== null;
}

/** Newest-wins ISO comparison that tolerates nulls (null is always older). */
function isNewer(candidate: string | null, current: string | null): boolean {
  if (candidate === null) {
    return false;
  }
  return current === null || candidate > current;
}

/** Descending ISO compare, nulls last. ISO-8601 means string order is time order. */
function compareIsoDesc(a: string | null, b: string | null): number {
  if (a === b) {
    return 0;
  }
  if (a === null) {
    return 1;
  }
  if (b === null) {
    return -1;
  }
  return a < b ? 1 : -1;
}

/** Everything one source row contributes, before grouping. */
interface ExtractedRow {
  name: string | null;
  email: string | null;
  phone: string | null;
  /** Sorting input for lead-only customers — see `buildCustomers`. */
  activityIso: string | null;
  contract: CustomerContract | null;
  offer: CustomerOffer | null;
}

function extractContract(row: unknown): ExtractedRow | null {
  if (!isObject(row) || isAnonymized(row)) {
    return null;
  }
  const signedAtIso = asText(row.signed_at) ?? asText(row.created_at);
  return {
    name: asText(row.customer_name),
    // A contract carries no contact block at all — only leads do. That is why
    // the name-to-e-mail alias pass in `buildCustomers` exists.
    email: null,
    phone: null,
    activityIso: signedAtIso,
    contract: {
      id: asText(row.id),
      dealReference: asText(row.deal_reference),
      productName: asText(row.product_definition_id),
      signedAtIso,
      priceEur: asNumber(row.snapshot_door_price),
    },
    offer: null,
  };
}

function extractLead(row: unknown, redeemedLeadIds: ReadonlySet<string>): ExtractedRow | null {
  if (!isObject(row) || isAnonymized(row)) {
    return null;
  }
  const code = asText(row.offer_code);
  return {
    name: asText(row.contact_name),
    email: asEmail(row.contact_email),
    phone: asText(row.contact_phone),
    activityIso: asText(row.created_at),
    contract: null,
    // A lead without a code is an ordinary lead, not an offer: nothing was
    // left with the customer, so there is nothing to look up later.
    offer: code === null ? null : {
      code,
      expiresAtIso: asText(row.offer_expires_at),
      redeemed: redeemedLeadIds.has(String(row.id)),
    },
  };
}

/**
 * The deduplicated customer list over rows already on the device.
 *
 * Grouping, in order:
 *
 *   1. A row with a usable e-mail groups under `email:<normalised>`. An
 *      e-mail is the only thing in this data even close to an identifier —
 *      two "M. Schmidt"s in one street are one keystroke apart, two identical
 *      addresses are the same person.
 *   2. A row without one groups under `name:<normalised>`.
 *   3. …EXCEPT when that exact normalised name appears with EXACTLY ONE
 *      e-mail elsewhere in the input, in which case the row joins that
 *      e-mail's group. Without this a signed contract — which structurally
 *      cannot carry an e-mail — would never join the lead it came from, and
 *      the rep would see the same person twice, which is precisely the
 *      failure this list exists to remove. "Exactly one" is the safety rail:
 *      the moment a name maps to two different addresses the alias is
 *      ambiguous, and merging two real people is a worse error than listing
 *      one person twice, so no merge happens.
 *   4. A row with NEITHER an e-mail NOR a name produces no customer at all.
 *      An anonymous entry is not a customer; it is a row the rep cannot act
 *      on, cannot search for, and cannot tell apart from the next one.
 *
 * Ordering is most-recent-contract-first, because a rep at a door is looking
 * for who they just dealt with. Lead-only customers have no contract date, so
 * they sort by their newest lead instead and always below anyone holding a
 * contract; ties break on display name so the list never shuffles between
 * renders.
 */
export function buildCustomers(contracts: unknown, leads: unknown): Customer[] {
  // Which offers were already redeemed, read off the CONTRACTS that are on
  // this device. See CustomerOffer.redeemed for why the lead's own column
  // cannot answer this.
  const redeemedLeadIds = new Set<string>();
  for (const row of asArray(contracts)) {
    if (isObject(row)) {
      const redeemed = asText(row.redeemed_lead_id);
      if (redeemed !== null) {
        redeemedLeadIds.add(redeemed);
      }
    }
  }

  const rows: ExtractedRow[] = [];
  for (const row of asArray(contracts)) {
    const extracted = extractContract(row);
    if (extracted !== null) {
      rows.push(extracted);
    }
  }
  for (const row of asArray(leads)) {
    const extracted = extractLead(row, redeemedLeadIds);
    if (extracted !== null) {
      rows.push(extracted);
    }
  }

  // Pass 1 — the name→e-mail alias index (rule 3). A name resolving to more
  // than one e-mail is recorded as ambiguous (null) and never used.
  const aliasByName = new Map<string, string | null>();
  for (const row of rows) {
    if (row.name === null || row.email === null) {
      continue;
    }
    const nameKey = normalizeText(row.name);
    const emailKey = normalizeText(row.email);
    if (!aliasByName.has(nameKey)) {
      aliasByName.set(nameKey, emailKey);
    } else if (aliasByName.get(nameKey) !== emailKey) {
      aliasByName.set(nameKey, null);
    }
  }

  interface Bucket {
    customer: Customer;
    /** Newest source-row timestamp, contract or lead — the fallback sort key. */
    activityIso: string | null;
  }
  const buckets = new Map<string, Bucket>();

  // Pass 2 — group.
  for (const row of rows) {
    const nameKey = row.name === null ? null : normalizeText(row.name);
    let emailKey = row.email === null ? null : normalizeText(row.email);
    if (emailKey === null && nameKey !== null) {
      emailKey = aliasByName.get(nameKey) ?? null;
    }

    const key =
      emailKey !== null ? `email:${emailKey}` : nameKey !== null ? `name:${nameKey}` : null;
    if (key === null) {
      continue; // rule 4 — neither e-mail nor name: no customer.
    }

    let bucket = buckets.get(key);
    if (bucket === undefined) {
      bucket = {
        customer: {
          key,
          // Falls back to the e-mail so a nameless-but-reachable lead still
          // renders as something the rep can read out loud.
          displayName: row.name ?? row.email ?? '',
          email: row.email,
          phone: row.phone,
          contracts: [],
          contractCount: 0,
          offers: [],
          lastContractAtIso: null,
        },
        activityIso: row.activityIso,
      };
      buckets.set(key, bucket);
    } else {
      // First non-null wins for the contact fields: every row is an equally
      // authoritative frozen capture, so there is no "newer is truer" here,
      // and first-wins keeps the output a function of the caller's order
      // rather than of an invented precedence rule.
      if (bucket.customer.email === null) {
        bucket.customer.email = row.email;
      }
      if (bucket.customer.phone === null) {
        bucket.customer.phone = row.phone;
      }
      if (bucket.customer.displayName === '' && row.name !== null) {
        bucket.customer.displayName = row.name;
      }
      if (isNewer(row.activityIso, bucket.activityIso)) {
        bucket.activityIso = row.activityIso;
      }
    }

    if (row.contract !== null) {
      bucket.customer.contracts.push(row.contract);
      bucket.customer.contractCount = bucket.customer.contracts.length;
      if (isNewer(row.contract.signedAtIso, bucket.customer.lastContractAtIso)) {
        bucket.customer.lastContractAtIso = row.contract.signedAtIso;
      }
    }

    if (row.offer !== null) {
      bucket.customer.offers.push(row.offer);
    }
  }

  const grouped = [...buckets.values()];
  for (const bucket of grouped) {
    // Newest deal first inside a customer, for the same reason the list is
    // ordered that way: the last thing that happened is the thing being
    // looked for.
    bucket.customer.contracts.sort((a, b) => compareIsoDesc(a.signedAtIso, b.signedAtIso));
    // Newest expiry first: the offer still worth chasing is the one that runs
    // out last, and an offer with no expiry sorts last rather than first.
    bucket.customer.offers.sort((a, b) => compareIsoDesc(a.expiresAtIso, b.expiresAtIso));
  }
  grouped.sort((a, b) => {
    const byContract = compareIsoDesc(a.customer.lastContractAtIso, b.customer.lastContractAtIso);
    if (byContract !== 0) {
      return byContract;
    }
    const byActivity = compareIsoDesc(a.activityIso, b.activityIso);
    if (byActivity !== 0) {
      return byActivity;
    }
    return a.customer.displayName.localeCompare(b.customer.displayName);
  });
  return grouped.map((bucket) => bucket.customer);
}

/**
 * Case- and diacritic-insensitive substring search over name, e-mail and
 * phone, preserving the input's most-recent-contract-first order.
 *
 * An empty (or whitespace-only) query returns everything: the search box is
 * this screen's only filter, so an empty box must never mean an empty screen.
 *
 * A phone number is additionally matched digits-against-digits, because the
 * stored form ("+49 176 1234567") and the typed form ("01761234567") almost
 * never agree character for character, and the rep is typically reading the
 * number off a display that formats it a third way again.
 */
export function searchCustomers(customers: unknown, query: unknown): Customer[] {
  const all = asArray(customers).filter((entry): entry is Customer => isObject(entry));
  const rawQuery = asText(query);
  if (rawQuery === null) {
    return all;
  }
  const needle = normalizeText(rawQuery);
  if (needle.length === 0) {
    return all;
  }
  const needleDigits = digitsOnly(rawQuery);

  return all.filter((customer) => {
    for (const field of [customer.displayName, customer.email, customer.phone]) {
      const text = asText(field);
      if (text !== null && normalizeText(text).includes(needle)) {
        return true;
      }
    }
    if (needleDigits.length > 0) {
      const phone = asText(customer.phone);
      if (phone !== null && digitsOnly(phone).includes(needleDigits)) {
        return true;
      }
    }
    return false;
  });
}
