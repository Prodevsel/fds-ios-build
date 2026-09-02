import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useSession } from '@/lib/auth/useSession';
import { getSupabase } from '@/lib/supabase';
import { Check, LogOut, Save } from 'lucide-react';
import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import type { AutoLockTimeoutMinutes } from './autoLockOptions';
import { isFormDirty } from './formDiff';
import { GovernanceTab } from './GovernanceTab';
import { RemoteWipeTab } from './RemoteWipeTab';
import { SessionsTab } from './SessionsTab';
import {
  type AdminAccountSettings,
  useAdminAccountSettings,
  useSaveAdminAccountSettings,
} from './useAdminAccountSettings';
import { useTenantName } from './useTenantName';
import {
  useOwnSalesOrgId,
  useSaveTenantSettingPolicy,
  useTenantSettingPolicies,
} from './useTenantSettingPolicies';

/** The Profil tab's local form shape: the two persisted account fields plus
 *  two transient, never-persisted fields (T-14-12-05) — `newPassword` and,
 *  since D-15/WR-12, `reauthCode` (the GoTrue `reauthenticate()`-issued OTP
 *  nonce required by `secure_password_change`) — see the file header's
 *  Password sub-section note. */
type ProfileForm = AdminAccountSettings & { newPassword: string; reauthCode: string };

const MIN_PASSWORD_LENGTH = 12;
const REAUTH_CODE_LENGTH = 6;

/** Live too-short countdown (D-10), mirroring
 *  `apps/admin/src/features/auth/ResetPasswordPage.tsx`'s `derivePasswordHint`
 *  — duplicated as a small pure function rather than a cross-feature import,
 *  keeping `features/settings` and `features/auth` decoupled. */
function derivePasswordHint(password: string): { tooShort: boolean; remaining: number } {
  const remaining = Math.max(0, MIN_PASSWORD_LENGTH - password.length);
  return { tooShort: remaining > 0, remaining };
}

/** Marks a `Promise.all` rejection as originating from the password-change
 *  call specifically, so `handleSave`'s catch can surface the precise
 *  rejection copy (Task 1's `profile.password.rejectedByServer`) instead of
 *  the generic save-error message. */
class PasswordRejectedError extends Error {}

/** D-15/WR-12: a DISTINCT rejection subtype for a wrong/missing/expired
 *  reauthentication nonce (GoTrue `error_code` in `REAUTH_ERROR_CODES`),
 *  surfaced as `profile.password.currentRejected` — never conflated with
 *  `PasswordRejectedError`'s `profile.password.rejectedByServer` (that copy
 *  is reserved for the NEW password failing policy). */
class ReauthRejectedError extends Error {}

const REAUTH_ERROR_CODES = new Set([
  'reauthentication_needed',
  'reauthentication_not_valid',
  'reauth_nonce_missing',
]);

/**
 * Einstellungen screen (account/settings) — REBUILT (SET-09, D-12) from the
 * original design port that shipped every control permanently inert: a
 * hardcoded-`false` dirty constant, a shared inert-by-construction select
 * primitive, and an unconditionally-inert toggle primitive. Every literal px
 * this file authors uses ONLY the 4/8/16/24/32
 * token scale (13-UI-SPEC.md Spacing Scale's page-boundary rule) — this is a
 * full-file rebuild, not a partial patch, so there is no scale seam within
 * the file. `BrandingPage.tsx` keeps its own literal-px idiom unchanged; it
 * is a different, untouched file.
 *
 * `dirty` is a structural diff (`isFormDirty`) against `lastLoaded`, captured
 * once on load and re-captured after every successful save — NOT
 * `BrandingPage.tsx`'s one-way flag (13-UI-SPEC.md Admin Save/Dirty
 * Contract). `settings-name` (writes `app_users.full_name`) and the language
 * select (writes `user_settings.language`) are the two real, editable,
 * persisted fields. E-mail and organisation stay read-only, but with a
 * STATED STRUCTURAL REASON, never "Kommt bald". The timezone row, the
 * invite/role-change controls, and the four notification toggles had no
 * backing store reachable this phase — per the approved scope decision they
 * are DELETED, not left permanently disabled (SC3: no dead control survives).
 *
 * D-19 (13-06): a fourth "Vorgaben" (`governance`) tab renders
 * `GovernanceTab`, the operator-only tenant auto-lock ceiling control. Its
 * form state (`governanceForm`/`governanceLastLoaded`) participates in the
 * SAME `isFormDirty`/shared-Save contract as the account fields above — one
 * Save button commits both the account write (`useSaveAdminAccountSettings`)
 * and, when it changed, the governance write
 * (`useSaveTenantSettingPolicy`) — rather than a second, independent
 * dirty/save mechanism.
 */

const LANGUAGE_OPTIONS = ['de', 'en'] as const;

function deriveInitials(name: string): string {
  return name
    .split(' ')
    .map((p) => p[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

const CARD = 'border-ink/10 rounded-md shadow-none';

export function SettingsPage() {
  const { t } = useTranslation('settings');
  const { session, role, loading: sessionLoading } = useSession();

  const email = session?.user.email ?? '';
  const roleLabel = t(`roles.${role ?? 'unknown'}`);

  const [tab, setTab] = React.useState('profil');

  const { data: accountSettings, isLoading: settingsLoading } = useAdminAccountSettings();
  const save = useSaveAdminAccountSettings();

  const { data: salesOrgId } = useOwnSalesOrgId();
  const { data: tenantPolicies, isLoading: policiesLoading } = useTenantSettingPolicies(
    salesOrgId ?? null,
  );
  const savePolicy = useSaveTenantSettingPolicy();

  const loading = sessionLoading || settingsLoading;
  const governanceLoading = loading || policiesLoading;

  const [form, setForm] = React.useState<ProfileForm>({
    fullName: '',
    language: 'de',
    newPassword: '',
    reauthCode: '',
  });
  // `newPassword`/`reauthCode` here are ALWAYS '' — never overwritten with
  // the typed plaintext value (T-14-12-05). `form.newPassword`/`reauthCode`
  // are the only place the in-progress password/nonce values live, and both
  // are cleared on every successful save (see `handleSave`).
  const [lastLoaded, setLastLoaded] = React.useState<ProfileForm>({
    fullName: '',
    language: 'de',
    newPassword: '',
    reauthCode: '',
  });

  interface GovernanceForm {
    autoLockTimeoutMinutes: AutoLockTimeoutMinutes | null;
  }
  const [governanceForm, setGovernanceForm] = React.useState<GovernanceForm>({
    autoLockTimeoutMinutes: null,
  });
  const [governanceLastLoaded, setGovernanceLastLoaded] = React.useState<GovernanceForm>({
    autoLockTimeoutMinutes: null,
  });

  const [errorMessage, setErrorMessage] = React.useState('');
  const [toast, setToast] = React.useState('');
  const toastTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Re-seed local form state whenever the persisted account settings load.
  // `newPassword`/`reauthCode` are deliberately always reset to '' here —
  // neither is a persisted field, so an incoming refetch of accountSettings
  // never carries a value for either.
  React.useEffect(() => {
    if (accountSettings) {
      setForm({ ...accountSettings, newPassword: '', reauthCode: '' });
      setLastLoaded({ ...accountSettings, newPassword: '', reauthCode: '' });
    }
  }, [accountSettings]);

  // D-15/WR-12: request the reauthentication nonce as soon as the settings
  // page mounts, so the OTP field is never shown before a code has actually
  // been requested (15-UI-SPEC.md §8's delivery note). Failure to send is
  // not fatal here — the operator can still submit once a code arrives.
  React.useEffect(() => {
    void getSupabase().auth.reauthenticate();
  }, []);

  // Re-seed governance form state whenever the tenant's policy rows load.
  React.useEffect(() => {
    if (tenantPolicies) {
      const autoLockValue =
        (tenantPolicies.auto_lock_timeout_minutes?.policy_value as AutoLockTimeoutMinutes | undefined) ??
        null;
      setGovernanceForm({ autoLockTimeoutMinutes: autoLockValue });
      setGovernanceLastLoaded({ autoLockTimeoutMinutes: autoLockValue });
    }
  }, [tenantPolicies]);

  React.useEffect(
    () => () => {
      if (toastTimer.current) {
        clearTimeout(toastTimer.current);
      }
    },
    [],
  );

  function fireToast(message: string) {
    setToast(message);
    if (toastTimer.current) {
      clearTimeout(toastTimer.current);
    }
    toastTimer.current = setTimeout(() => setToast(''), 2600);
  }

  const accountDirty = isFormDirty(
    form as unknown as Record<string, unknown>,
    lastLoaded as unknown as Record<string, unknown>,
  );
  const governanceDirty =
    role === 'operator' &&
    isFormDirty(
      governanceForm as unknown as Record<string, unknown>,
      governanceLastLoaded as unknown as Record<string, unknown>,
    );
  const dirty = accountDirty || governanceDirty;

  // D-15/WR-12: whenever the rep has started a password change (either field
  // touched), the shared Save button stays disabled until BOTH the
  // re-authentication code holds exactly 6 digits AND the new password
  // clears the 12-character floor — matching 15-UI-SPEC.md §8's
  // submit-disabled rule. Untouched password fields never block Save for
  // an ordinary account/governance-only change.
  const passwordChangeStarted = form.newPassword.length > 0 || form.reauthCode.length > 0;
  const passwordChangeReady =
    form.reauthCode.length === REAUTH_CODE_LENGTH && form.newPassword.length >= MIN_PASSWORD_LENGTH;
  const passwordBlocksSave = passwordChangeStarted && !passwordChangeReady;

  const initials = deriveInitials(form.fullName || t('profile.unnamed')) || '—';

  function handleSave() {
    setErrorMessage('');

    const saveAccount = new Promise<void>((resolve, reject) => {
      save.mutate(form, {
        onSuccess: () => {
          // Deliberately does NOT copy `form.newPassword` into `lastLoaded` —
          // `lastLoaded.newPassword` stays whatever it already was (always
          // ''), so the plaintext password is never written into this
          // snapshot, even transiently (T-14-12-05).
          setLastLoaded((prev) => ({ ...prev, fullName: form.fullName, language: form.language }));
          resolve();
        },
        onError: (err) => reject(err),
      });
    });

    const saveGovernance =
      governanceDirty && salesOrgId && governanceForm.autoLockTimeoutMinutes !== null
        ? new Promise<void>((resolve, reject) => {
            savePolicy.mutate(
              {
                salesOrgId,
                existingId: tenantPolicies?.auto_lock_timeout_minutes?.id ?? null,
                settingKey: 'auto_lock_timeout_minutes',
                policyKind: 'ceiling',
                policyValue: governanceForm.autoLockTimeoutMinutes,
              },
              {
                onSuccess: () => {
                  setGovernanceLastLoaded(governanceForm);
                  resolve();
                },
                onError: (err) => reject(err),
              },
            );
          })
        : Promise.resolve();

    // D-15/WR-12 (closes T-14-12-04, the admin-side twin of mobile's
    // T-14-08-02 in apps/mobile/src/features/auth/ChangePasswordScreen.tsx):
    // GoTrue's `secure_password_change` is now enabled server-side (see
    // .planning/phases/15-app-lock-wipe-data-minimization/15-SECURE-PASSWORD-CHANGE-PROBE.md,
    // VERDICT: NONCE_REQUIRED). This form's `reauthCode` field (populated via
    // `reauthenticate()` on mount, see the effect above) is sent as
    // `updateUser`'s `nonce` before a stolen-but-still-valid access token can
    // change the password within the ~15-minute `jwt_expiry` window. Per
    // RESEARCH Pitfall 2, GoTrue exempts sessions younger than 24h from this
    // requirement — that residual is accepted (T-15-14-02, `15-SECURITY.md`),
    // not a gap in this form.
    const passwordDirty = form.newPassword.length > 0;
    const savePassword = passwordDirty
      ? new Promise<void>((resolve, reject) => {
          getSupabase()
            .auth.updateUser({ password: form.newPassword, nonce: form.reauthCode })
            .then(({ error }) => {
              if (error) {
                const code = (error as { code?: string }).code;
                reject(
                  code && REAUTH_ERROR_CODES.has(code)
                    ? new ReauthRejectedError(error.message)
                    : new PasswordRejectedError(error.message),
                );
                return;
              }
              resolve();
            }, reject);
        })
      : Promise.resolve();

    Promise.all([saveAccount, saveGovernance, savePassword])
      .then(() => {
        // Clears the typed password and reauth code on success — neither
        // ever lived in `lastLoaded` (see `saveAccount`'s onSuccess above),
        // so this is the only place the plaintext values need to be dropped.
        setForm((f) => ({ ...f, newPassword: '', reauthCode: '' }));
        fireToast(t('toast.saved'));
      })
      .catch((err) => {
        setErrorMessage(
          err instanceof ReauthRejectedError
            ? t('profile.password.currentRejected')
            : err instanceof PasswordRejectedError
              ? t('profile.password.rejectedByServer')
              : t('errors.saveGeneric'),
        );
      });
  }

  return (
    <div className="mx-auto flex max-w-[900px] flex-col">
      <div className="mb-lg flex items-center justify-end gap-sm">
        {dirty ? (
          <span className="inline-flex items-center gap-xs text-label font-medium text-[#b56a1c]">
            <span className="size-xs rounded-full bg-porch" />
            {t('actions.unsaved')}
          </span>
        ) : null}
        <Button
          variant="outline"
          onClick={() => void getSupabase().auth.signOut()}
        >
          <LogOut aria-hidden className="size-4" />
          {t('actions.signOut')}
        </Button>
        <Button
          onClick={handleSave}
          disabled={!dirty || save.isPending || savePolicy.isPending || passwordBlocksSave}
        >
          <Save aria-hidden className="size-4" />
          {save.isPending || savePolicy.isPending ? t('actions.saving') : t('actions.save')}
        </Button>
      </div>

      {errorMessage ? (
        <p role="alert" className="mb-md text-body text-destructive">
          {errorMessage}
        </p>
      ) : null}

      <div className="mb-lg flex flex-col gap-xs">
        <h1 className="font-display text-display text-foreground">{t('title')}</h1>
        <p className="text-body text-[#5C6B85]">{t('subtitle')}</p>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList label={t('tablist')}>
          <TabsTrigger value="profil">{t('tabs.profile')}</TabsTrigger>
          <TabsTrigger value="team">{t('tabs.team')}</TabsTrigger>
          <TabsTrigger value="notif">{t('tabs.notifications')}</TabsTrigger>
          <TabsTrigger value="governance">{t('tabs.governance')}</TabsTrigger>
          <TabsTrigger value="sessions">{t('tabs.sessions')}</TabsTrigger>
          <TabsTrigger value="wipe">{t('wipe.tabLabel')}</TabsTrigger>
        </TabsList>

        <TabsContent value="profil">
          {loading ? (
            <ProfileSkeleton />
          ) : (
            <ProfilePanel
              email={email}
              initials={initials}
              form={form}
              onChange={setForm}
            />
          )}
        </TabsContent>

        <TabsContent value="team">
          <TeamPanel
            email={email}
            name={form.fullName || t('profile.unnamed')}
            initials={initials}
            roleLabel={roleLabel}
            loading={loading}
          />
        </TabsContent>

        <TabsContent value="notif">
          <NotificationsPanel />
        </TabsContent>

        <TabsContent value="governance">
          <GovernanceTab
            role={role}
            loading={governanceLoading}
            hasAnyPolicy={Boolean(tenantPolicies && Object.keys(tenantPolicies).length > 0)}
            autoLockValue={governanceForm.autoLockTimeoutMinutes}
            onAutoLockChange={(value) => setGovernanceForm({ autoLockTimeoutMinutes: value })}
          />
        </TabsContent>

        <TabsContent value="sessions">
          <SessionsTab />
        </TabsContent>

        <TabsContent value="wipe">
          <RemoteWipeTab />
        </TabsContent>
      </Tabs>

      {toast ? (
        <output className="fixed bottom-lg right-lg z-50 flex items-center gap-sm rounded-md bg-ink px-md py-sm text-paper shadow-lg">
          <Check aria-hidden className="size-4 text-pine" />
          <span className="text-body font-medium">{toast}</span>
        </output>
      ) : null}
    </div>
  );
}

/** Uppercase field label (11px/500, .02em tracking) — the admin Field label token. */
function FieldLabel({ htmlFor, children }: { htmlFor: string; children: React.ReactNode }) {
  return (
    <label
      htmlFor={htmlFor}
      className="mb-sm block text-label font-medium uppercase tracking-[.02em] text-[#5C6B85]"
    >
      {children}
    </label>
  );
}

function ProfilePanel({
  email,
  initials,
  form,
  onChange,
}: {
  email: string;
  initials: string;
  form: ProfileForm;
  onChange: (form: ProfileForm) => void;
}) {
  const { t } = useTranslation('settings');
  const { tenantName, isLoading: tenantLoading } = useTenantName();
  const orgDisplayValue = !tenantLoading && tenantName ? tenantName : t('profile.orgValueUnknown');

  const [passwordFocused, setPasswordFocused] = React.useState(false);
  const passwordHint = derivePasswordHint(form.newPassword);
  const showPasswordTooShort = passwordFocused && passwordHint.tooShort;

  return (
    <Card className={CARD}>
      <CardContent className="p-lg">
        <div className="mb-lg font-display text-heading font-medium text-ink">
          {t('profile.heading')}
        </div>

        <div className="mb-lg flex items-center gap-md">
          <div className="flex size-14 shrink-0 items-center justify-center rounded-full bg-porch font-display text-heading font-medium text-ink">
            {initials}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-md">
          <div>
            <FieldLabel htmlFor="settings-name">{t('profile.name')}</FieldLabel>
            <Input
              id="settings-name"
              value={form.fullName}
              onChange={(e) => onChange({ ...form, fullName: e.target.value })}
            />
          </div>
          <div>
            <FieldLabel htmlFor="settings-email">{t('profile.email')}</FieldLabel>
            <Input
              id="settings-email"
              value={email}
              readOnly
              title={t('profile.emailReadOnly')}
              className="font-mono text-label"
            />
            <p className="mt-xs text-label text-[#5C6B85]">{t('profile.emailReadOnly')}</p>
          </div>
          <div className="col-span-2">
            <FieldLabel htmlFor="settings-org">{t('profile.org')}</FieldLabel>
            <Input
              id="settings-org"
              value={orgDisplayValue}
              readOnly
              title={t('profile.orgReadOnly')}
              className="opacity-60"
            />
            <p className="mt-xs text-label text-[#5C6B85]">{t('profile.orgReadOnly')}</p>
          </div>
          <div>
            <FieldLabel htmlFor="settings-language">{t('profile.language')}</FieldLabel>
            <select
              id="settings-language"
              value={form.language}
              onChange={(e) => onChange({ ...form, language: e.target.value })}
              className="h-10 w-full rounded-md border border-ink/[.16] bg-card px-md text-body text-ink"
            >
              {LANGUAGE_OPTIONS.map((code) => (
                <option key={code} value={code}>
                  {t(`profile.languageOptions.${code}`)}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-lg border-t border-ink/10 pt-lg">
          <div className="mb-md font-display text-heading font-medium text-ink">
            {t('profile.password.heading')}
          </div>
          <div className="max-w-sm">
            <FieldLabel htmlFor="settings-current-password">
              {t('profile.password.currentLabel')}
            </FieldLabel>
            <Input
              id="settings-current-password"
              type="password"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={REAUTH_CODE_LENGTH}
              value={form.reauthCode}
              onChange={(e) =>
                onChange({ ...form, reauthCode: e.target.value.replace(/[^0-9]/g, '').slice(0, REAUTH_CODE_LENGTH) })
              }
            />
          </div>
          <div className="mt-md max-w-sm">
            <FieldLabel htmlFor="settings-new-password">{t('profile.password.label')}</FieldLabel>
            <Input
              id="settings-new-password"
              type="password"
              autoComplete="new-password"
              value={form.newPassword}
              onChange={(e) => onChange({ ...form, newPassword: e.target.value })}
              onFocus={() => setPasswordFocused(true)}
              onBlur={() => setPasswordFocused(false)}
            />
            <p className="mt-xs text-label text-[#5C6B85]">
              {showPasswordTooShort
                ? t('profile.password.tooShort', { n: passwordHint.remaining })
                : t('profile.password.hint')}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function TeamPanel({
  email,
  name,
  initials,
  roleLabel,
  loading,
}: {
  email: string;
  name: string;
  initials: string;
  roleLabel: string;
  loading: boolean;
}) {
  const { t } = useTranslation('settings');
  return (
    <Card className={CARD}>
      <CardContent className="p-lg">
        <div className="mb-lg flex items-end justify-between gap-md">
          <div>
            <div className="font-display text-heading font-medium text-ink">{t('team.heading')}</div>
            <div className="mt-xs text-body text-[#5C6B85]">{t('team.subtitle')}</div>
          </div>
          <Link
            to="/mitarbeiter"
            className="inline-flex h-9 shrink-0 items-center rounded-md border border-input bg-transparent px-md text-body font-medium text-foreground transition-colors hover:bg-muted"
          >
            {t('team.manageLink')}
          </Link>
        </div>

        <div className="overflow-hidden rounded-md border border-ink/10">
          <div className="grid grid-cols-[2fr_1.4fr_1fr] bg-muted px-md text-label font-medium uppercase tracking-[.02em] text-[#5C6B85]">
            <div className="py-sm">{t('team.table.member')}</div>
            <div className="py-sm">{t('team.table.role')}</div>
            <div className="py-sm text-right">{t('team.table.status')}</div>
          </div>

          {loading ? (
            <div className="p-md">
              <Skeleton className="h-8 w-full" />
            </div>
          ) : (
            <div className="grid grid-cols-[2fr_1.4fr_1fr] items-center border-b border-ink/[.06] px-md py-sm">
              <div className="flex min-w-0 items-center gap-sm">
                <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-porch text-label font-medium text-white">
                  {initials}
                </div>
                <div className="min-w-0">
                  <div className="truncate text-body font-medium text-ink">{name}</div>
                  <div className="truncate text-label text-[#8792a6]">{email || '—'}</div>
                </div>
              </div>
              <div className="truncate text-body text-ink">{roleLabel}</div>
              <div className="text-right">
                <Badge variant="active">{t('team.status.active')}</Badge>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function NotificationsPanel() {
  const { t } = useTranslation('settings');
  return (
    <Card className={CARD}>
      <CardContent className="p-lg">
        <p className="text-body text-[#5C6B85]">{t('notifications.repManaged')}</p>
      </CardContent>
    </Card>
  );
}

function ProfileSkeleton() {
  return (
    <Card className={CARD}>
      <CardContent className="p-lg">
        <Skeleton className="mb-lg h-[18px] w-24" />
        <Skeleton className="mb-lg size-14 rounded-full" />
        <div className="grid grid-cols-2 gap-md">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="col-span-2 h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      </CardContent>
    </Card>
  );
}
