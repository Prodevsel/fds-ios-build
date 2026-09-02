import type { Block } from '@frontdoorsales/flow-schema';
import { t } from '../../i18n';
import { parseIdentityAnswerName } from './db/contractsRepo';

/**
 * The pre-signature review list: every answer the rep has given so far,
 * rendered as display text, with the block index to jump back to.
 *
 * Why this module exists at all. Until now the only way to correct a typo
 * discovered at the signature screen was to tap the header back tile N times
 * — past every intervening block, each of which re-renders its own draft
 * state — and then forward again the same number of taps. At a front door,
 * with the customer already holding the device, that is the moment a
 * consultation dies. The fix is a single screen that shows what was captured
 * and jumps straight to the one block that is wrong.
 *
 * Deliberately a pure, exported module and NOT component logic — the same
 * posture as `features/map/houseList.ts` and `features/map/buildingStatus.ts`.
 * This repo has no `react-test-renderer`, so anything that only exists inside
 * a component cannot be asserted at all. Everything decidable about a review
 * row therefore lives here: which blocks produce a row, what their answer
 * reads as, and what is redacted. `ReviewScreen.tsx` is left with layout.
 *
 * No React, no database access, no navigation. The caller supplies the
 * ALREADY show-if-filtered, visible-ordered block list (Pitfall 3 — the same
 * `visible` array `FlowRunnerScreen` renders and indexes `currentIndex`
 * into), so `ReviewRow.index` is directly assignable to `currentIndex`
 * without any re-mapping. Passing the raw unfiltered `blocks` array here
 * would produce rows that jump to the wrong screen.
 *
 * TWO rules this module exists to keep honest:
 *
 *   * A row is a CORRECTABLE ANSWER, not a step. Blocks that carry nothing
 *     the rep could have got wrong — the intro/info text screens, the
 *     discount hero (its "answer" is a bare acknowledgement of a price the
 *     rep cannot influence, D-19), the signature block itself — produce no
 *     row. A list padded with un-actionable entries is a list nobody reads,
 *     and this list has exactly one job: get read before a signature.
 *
 *   * Redaction is decided here, at the row level, never at the component —
 *     and it is deliberately NARROW. This screen is shown while the device is
 *     in the customer's hands and is the most photographable surface in the
 *     flow, which is an argument for masking; but the screen's ONE job is the
 *     customer reading their own details back and catching the wrong digit.
 *     A masked value cannot be checked, so masking it defeats the screen.
 *
 *     So the IBAN — the value the customer is here to verify, their own, one
 *     transposed pair away from a failed direct debit and a dead contract —
 *     is shown IN FULL. The ID document number is not: the customer already
 *     confirmed it character by character on the scan screen, nothing on this
 *     screen would make them read it again, and it is identity data rather
 *     than something the deal depends on. That asymmetry is the whole rule —
 *     redact what nobody is going to re-read, print what the screen exists
 *     for.
 */

/** One correctable answer, ready to render. `value` is ALREADY redacted where required (id document number only). */
export interface ReviewRow {
  /** The answering block's id — a stable React key, and useful in assertions. */
  blockId: string;
  /**
   * Index into the SAME visible-ordered list passed to `buildReviewRows`.
   * Directly assignable to `FlowRunnerScreen`'s `currentIndex` — no re-mapping.
   */
  index: number;
  /** The authored `shortLabel` if there is one, else `label`. Product copy,
   * already localized by the author. */
  label: string;
  /** Display text for the answer — masked where `masked` is true. */
  value: string;
  /**
   * True when `value` is a deliberately redacted rendering of the stored
   * answer. The screen uses this to show the elision hint, so a rep never
   * reads an elision as a scanning error and re-scans a document that was
   * captured correctly. Since the IBAN is printed in full (module header),
   * the id-scan document number is the only thing that still sets this — and
   * `review.maskedNote` names it explicitly for that reason.
   */
  masked: boolean;
}

/**
 * Elides everything but the last `keep` characters of a value that must not
 * be printed in full.
 *
 * Separator and ellipsis are copied verbatim from `contractsRepo.maskIban`
 * (the convention `features/checkout/AbschlussDetailScreen` already renders
 * as "DE44 … 31") so every elision this app prints looks the same — a rep who
 * learns one reads the other. This screen no longer redacts an IBAN itself,
 * but the shared look is what makes an elision legible as an elision.
 *
 * Unlike an IBAN, an ID document number has no non-identifying prefix worth
 * keeping: the country/check-digit head that makes "DE44 …" safe to show has
 * no counterpart in a 9-character BSI document number, where every character
 * is payload. So this keeps only a tail — enough to tell two captured
 * documents apart at a glance, not enough to transcribe one.
 */
function maskTail(raw: string, keep = 2): string {
  const compact = raw.replace(/\s+/g, '').toUpperCase();
  if (compact.length <= keep) return '…';
  return `… ${compact.slice(-keep)}`;
}

/**
 * The two non-name id-scan fields this screen shows, read off the serialized
 * answer without importing the .tsx block module (see the `id-scan` case for
 * why). Never throws: a malformed answer degrades to empty strings, because a
 * parse error here must not take down the last screen before a signature.
 */
function parseIdFieldsLoosely(raw: string): { birthDate: string; documentNumber: string } {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { birthDate: '', documentNumber: '' };
    const record = parsed as Record<string, unknown>;
    return {
      birthDate: typeof record.birthDate === 'string' ? record.birthDate.trim() : '',
      documentNumber: typeof record.documentNumber === 'string' ? record.documentNumber.trim() : '',
    };
  } catch {
    // Not JSON — a legacy plain-string answer. Handled by the name path.
    return { birthDate: '', documentNumber: '' };
  }
}

/** Non-empty trimmed string, or null — the shape every row builder below wants. */
function nonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/**
 * Renders a single block's answer, or null when this block contributes no row.
 *
 * Split out from the loop so the "which blocks are rows" decision is one
 * readable `switch` with an exhaustiveness guard: a new block type added to
 * `flow-schema` becomes a COMPILE error here rather than a silently missing
 * line on the review screen, which is the failure mode that matters (an
 * answer the customer never got to check).
 */
function renderAnswer(block: Block, answer: unknown): { value: string; masked: boolean } | null {
  switch (block.type) {
    case 'text': {
      // `multiline` presence is what `TextBlock` itself uses to decide whether
      // the block is a real entry field or a pure info screen (its
      // `requiresInput`). Reusing the SAME predicate here is deliberate: if an
      // info screen ever starts producing a row, the two have diverged and the
      // rep is looking at a row for a screen with no input on it.
      if (block.multiline === undefined) return null;
      const text = nonEmptyString(answer);
      // A blank note is not a mistake worth a row — the rep tapped Next past
      // an optional field. Showing an empty line only dilutes the list.
      return text ? { value: text, masked: false } : null;
    }
    case 'choice':
    case 'recommendation': {
      const selected = nonEmptyString(answer);
      if (!selected) return null;
      // Show the human option LABEL, never the stored machine value ("paket_max").
      // Falling back to the raw value covers an answer whose option was removed
      // by a later product version — an honest, if ugly, row beats a vanished one.
      const option = block.options.find((candidate) => candidate.value === selected);
      return { value: option?.label ?? selected, masked: false };
    }
    case 'contact': {
      // The customer's own contact details, verbatim. These are exactly the
      // values a typo destroys silently: a wrong e-mail means the signed
      // contract is dispatched to nobody (see contact.ts on extractRecipient).
      const contact = nonEmptyString(answer);
      return contact ? { value: contact, masked: false } : null;
    }
    case 'slider': {
      if (typeof answer !== 'number' || Number.isNaN(answer)) return null;
      // Unit is authored per block ("GB", "Geräte"); absent for a bare count.
      return { value: block.unit ? `${answer} ${block.unit}` : String(answer), masked: false };
    }
    case 'iban-scan': {
      const iban = nonEmptyString(answer);
      if (!iban) return null;
      // FULL, never masked — see the module header. This is the one value on
      // the screen the customer is actually here to proof-read: an OCR that
      // read a 6 as an 8 is invisible in "DE44 … 31", and the direct debit
      // fails weeks later, after the deal is already booked. The screenshot
      // risk is real but it is the SAME value the customer just typed/scanned
      // one screen earlier on their own device, so masking it here buys no
      // exposure reduction worth the check it destroys.
      return { value: iban, masked: false };
    }
    case 'id-scan': {
      const raw = nonEmptyString(answer);
      if (!raw) return null;
      // D-24: the id-scan answer is a JSON-serialized `{surname, givenNames,
      // birthDate, documentNumber, …}` (serializeIdFields), never a plain
      // name. The NAME half goes through `parseIdentityAnswerName` — the SSOT
      // that `deriveSignatureSummary` and `contractsRepo.parseCustomerName`
      // already share, and whose duplication regressed once into rendering raw
      // JSON at the customer (CR-01/IN-02). It also handles the legacy
      // plain-string answer shape by returning it verbatim.
      //
      // The remaining two fields are read locally rather than via
      // `IdScanBlock.parseIdFieldsAnswer`. That helper lives in a .tsx module
      // whose module scope imports react-native, @expo/vector-icons and the
      // vision-camera OCR bindings; importing it here would drag a dozen
      // native mocks into every test of this module and forfeit exactly the
      // pure-module posture the header argues for. Reading two known string
      // keys off an already-parsed object is the cheaper honest trade.
      const name = parseIdentityAnswerName(raw);
      const fields = parseIdFieldsLoosely(raw);
      const parts = [
        name === raw ? '' : name,
        fields.birthDate,
        // The document number is the identifying half of an ID capture and is
        // masked for the same reason as the IBAN — see the module header. The
        // full value is one tap away in `IdScanBlock`'s own fields.
        fields.documentNumber ? maskTail(fields.documentNumber) : '',
      ].filter((part) => part.length > 0);
      // Nothing structured parsed at all (a pre-D-24 plain-string answer, or
      // garbage): fall back to the raw string so the rep still sees that
      // SOMETHING is stored and can jump in to fix it. An id-scan answer is
      // never absent-but-fine — it names the person signing.
      if (parts.length === 0) return { value: raw, masked: false };
      return { value: parts.join(' · '), masked: Boolean(fields.documentNumber) };
    }
    case 'belehrung': {
      // A gate. Its only answer is the explicit `true` the customer confirmed,
      // so there is no value to render — but it earns a row anyway: the whole
      // point of the review step is that the customer can see, before signing,
      // that the statutory withdrawal notice was actually presented. Jumping
      // back to it is safe (a CONFIRMED gate is never the first unconfirmed
      // gate, so `canJumpTo` at the call site keeps allowing it).
      return answer === true ? { value: t('review.confirmed'), masked: false } : null;
    }
    case 'discount':
      // The discount hero is a presentation block: its answer is a bare `true`
      // acknowledgement, and the price it shows is the FROZEN snapshot (D-19)
      // that no rep may influence. There is nothing here to correct, so a row
      // would only be a jump target for changing a price — exactly the thing
      // the frozen snapshot exists to prevent.
      return null;
    case 'signature':
      // The screen this review precedes. Listing it would offer a jump into
      // the signature capture from the review of that signature.
      return null;
    case 'consent':
      // Never a wizard step at all — `FlowRunnerScreen` filters consent blocks
      // out of the step list because they belong to the offer/lead OUTCOME
      // (EndAsLeadSheet). It cannot appear in a visible-ordered list, and this
      // case exists only to keep the exhaustiveness guard below honest.
      return null;
    default: {
      // A new block type in `flow-schema` with no decision recorded here is a
      // compile-time error, not a silently missing review row.
      const exhaustive: never = block;
      return exhaustive;
    }
  }
}

/**
 * Turns the visible-ordered block list plus the current answers into the
 * review rows, in flow order.
 *
 * `visibleBlocks` MUST be the show-if-filtered list the runner renders (see
 * the module header) — indices are handed straight back as jump targets.
 * Unanswered blocks are skipped rather than rendered as empty rows: the rep
 * reaches this screen at the signature step, so anything unanswered was
 * legitimately optional, and a list of blanks buries the entries that matter.
 */
export function buildReviewRows(
  visibleBlocks: Block[],
  answers: Record<string, unknown>,
): ReviewRow[] {
  const rows: ReviewRow[] = [];
  visibleBlocks.forEach((block, index) => {
    const rendered = renderAnswer(block, answers[block.id]);
    if (!rendered) return;
    rows.push({
      blockId: block.id,
      index,
      // The noun, not the question — see `shortLabel` in the block schemas.
      label: ('shortLabel' in block && block.shortLabel) || block.label,
      value: rendered.value,
      masked: rendered.masked,
    });
  });
  return rows;
}
