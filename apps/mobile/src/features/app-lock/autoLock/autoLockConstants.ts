/**
 * D-17 (15-CONTEXT.md): the provisional default for `auto_lock_timeout_minutes`
 * pending the Art. 35 DSGVO DPIA outcome named in `ROADMAP.md`'s Phase 15
 * block. The DPIA gate does not block engineering (D-17), but its outcome
 * MAY overrule this default — when it does, that must be a ONE-LINE change
 * to `AUTO_LOCK_DEFAULT_MINUTES` below, never a hunt through call sites. No
 * other module in `features/app-lock/autoLock/` may hardcode a fallback
 * minute value of its own.
 *
 * `5` is chosen as the second-shortest member of the existing closed value
 * set `AUTO_LOCK_TIMEOUT_MINUTES_OPTIONS` (`../../settings/autoLockOptions.ts`,
 * `[1, 5, 15, 30, 60]`) — that set deliberately has no "never" value, so
 * auto-lock can never be switched off. `autoLockConstants.test.ts` imports
 * both files and asserts `AUTO_LOCK_DEFAULT_MINUTES` is a MEMBER of
 * `AUTO_LOCK_TIMEOUT_MINUTES_OPTIONS`, so a future edit to either constant
 * fails loudly instead of silently drifting apart.
 */
export const AUTO_LOCK_DEFAULT_MINUTES = 5;

/**
 * D-08 (15-CONTEXT.md): the hard cap on the customer-handover idle-timeout
 * suspension (D-07). After this many milliseconds from the moment the
 * handover/signature screen mounts, the app locks unconditionally —
 * regardless of interaction, regardless of `timeoutMinutes`, regardless of
 * what is mounted. This is a ceiling on the suspension, never a floor that
 * lengthens the normal idle timeout.
 */
export const HANDOVER_SUSPENSION_CAP_MS = 10 * 60 * 1000;

/**
 * The background grace window: how long the app may stay unlocked after it
 * has been backgrounded before `useAppStateLock` locks it. D-05 originally
 * mandated an immediate, unconditional lock here; the operator overruled
 * that on 2026-08-27 after a field test (see `useAppStateLock.ts`'s header
 * for the full decision record and for what still holds).
 *
 * `60 * 1000` is the industry-standard step-out window: long enough for the
 * Control-Centre pull, a notification banner, an incoming call or an
 * app-switcher glance, short enough that a device left behind is not
 * meaningfully exposed. It is the SINGLE source of that duration — no other
 * module in `features/app-lock/autoLock/` may hardcode a grace of its own,
 * and shortening it must stay a ONE-LINE change here, never a hunt through
 * call sites (the `AUTO_LOCK_DEFAULT_MINUTES` rule above, applied again).
 *
 * This is a TIME PARAMETER, not a carve-out. It is global: it is not, and
 * must not become, a per-screen, per-flow or per-caller value. Checkout and
 * signature capture get exactly this window and no more —
 * `useAppStateLock.ts` takes no screen, route or flow input at all, and its
 * test asserts that parameter list.
 */
export const BACKGROUND_GRACE_MS = 60 * 1000;

/**
 * 15-UI-SPEC.md §3: the single-line, non-alarming heads-up
 * (`sec.handoverTimeoutWarning`) appears exactly 2 minutes before the D-08
 * hard cap — i.e. at the 8-minute mark of a 10-minute suspension.
 */
export const HANDOVER_WARNING_LEAD_MS = 2 * 60 * 1000;
