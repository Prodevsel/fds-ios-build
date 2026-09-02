import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import i18n from '@/i18n';
import { cn } from '@/lib/utils';
import { Check, Plus, Save, Upload } from 'lucide-react';
import * as React from 'react';
import { useTranslation } from 'react-i18next';
import brandingDe from './brandingI18n/de.json';
import {
  type BrandingFieldKey,
  type BrandingFields,
  emptyBrandingFields,
  signBrandingAsset,
  uploadBrandingAsset,
  useBrandingDefault,
  useCompanyBranding,
  useSaveBranding,
} from './useBranding';
import { type Company, useCompanies } from './useCompanies';

/**
 * Standard-Branding screen — a 1:1 port of `.planning/design/screens/Branding.dc.html`.
 *
 * White-label branding config (WLBL-01/WLBL-02, table 0036) with the platform
 * DEFAULT row (company_id IS NULL) as the inheritance source. A company selector
 * chooses whose branding to edit; each persistable field shows a per-field
 * inherited-vs-overridden indicator + a "Zurücksetzen auf Standard" control, plus
 * the live sender-identity preview `vertrag@firmenname.<send-domain>.de` (D-15).
 * The right column renders a live PDF/E-Mail/Portal preview in the PARTNER's
 * colours (tenant config, Iron Rule 6) — never the dashboard palette.
 *
 * Copy lives in the sibling `brandingI18n/de.json`, registered here under a
 * dedicated `branding` i18next namespace (the shared companies/i18n de.json is
 * owned by another feature and is left untouched).
 */

// Register the branding copy as its own namespace. The app-wide glob only picks
// up `features/**/i18n/de.json`, so this sibling bundle is added explicitly.
i18n.addResourceBundle('de', 'branding', brandingDe, true, true);

const HEX_RE = /^#[0-9A-Fa-f]{6}$/;

/** Per-field max lengths (T-05-33): identity fields short, legal modules long. */
const MAX_LEN: Record<BrandingFieldKey, number> = {
  primary_color_hex: 7,
  accent_color_hex: 7,
  heading_font: 64,
  company_display_name: 200,
  agb_text: 20000,
  belehrung_text: 20000,
  footer_text: 400,
  sender_local_part: 64,
  sender_display_name: 200,
  reply_to: 200,
  logo_path: 512,
  favicon_path: 512,
};

/** Preview fallbacks used when neither the override nor the platform default set. */
const DEFAULT_PRIMARY = '#1D4E89';
const DEFAULT_ACCENT = '#F0A202';
/** Heading-font fallback — must be a member of the 0050 heading_font allow-list. */
const DEFAULT_FONT = 'Inter';

interface Preset {
  readonly name: string;
  readonly primary: string;
  readonly accent: string;
}
const PRESETS: readonly Preset[] = [
  { name: 'Ink & Amber', primary: '#1D4E89', accent: '#F0A202' },
  { name: 'Waldgrün', primary: '#1F5C4B', accent: '#E0993A' },
  { name: 'Bordeaux', primary: '#5A2233', accent: '#C77D4E' },
  { name: 'Graphit', primary: '#2A2E37', accent: '#4C8FCB' },
];

interface FontDef {
  readonly key: string;
  readonly name: string;
  readonly stack: string;
}
// heading_font persists the `key` verbatim; every key is a member of the 0050
// CHECK allow-list ('Inter','Roboto','Open Sans','Lato','Montserrat','Source Sans 3')
// so a persisted value can never violate the column constraint.
const FONTS: readonly FontDef[] = [
  { key: 'Inter', name: 'Inter', stack: 'Inter, sans-serif' },
  { key: 'Montserrat', name: 'Montserrat', stack: "'Montserrat', sans-serif" },
  { key: 'Lato', name: 'Lato', stack: "'Lato', sans-serif" },
];

type PreviewTab = 'pdf' | 'mail' | 'portal';
const TABS: readonly PreviewTab[] = ['pdf', 'mail', 'portal'];

function emptyFields(): BrandingFields {
  return emptyBrandingFields();
}

/** Strip C0/C1 control chars (keep \n, \t) and clamp to max length. */
function sanitizeText(value: string, max: number): string {
  let cleaned = '';
  for (const ch of value) {
    const code = ch.charCodeAt(0);
    const isControl = code < 32 && code !== 9 && code !== 10 && code !== 13;
    if (!isControl && code !== 127) {
      cleaned += ch;
    }
  }
  return cleaned.slice(0, max);
}

/** Email local-part charset (RFC-safe subset) for the sender address. */
function sanitizeLocalPart(value: string, max: number): string {
  return value.replace(/[^A-Za-z0-9._+-]/g, '').slice(0, max);
}

export function BrandingPage() {
  const { t } = useTranslation('branding');
  const { data: companies } = useCompanies();
  const { data: brandingDefault } = useBrandingDefault();

  const [companyId, setCompanyId] = React.useState<string>('');
  const { data: companyOverrides } = useCompanyBranding(companyId || null);
  const save = useSaveBranding();

  const [overrides, setOverrides] = React.useState<BrandingFields>(emptyFields);
  // Instant client-side previews for a freshly-selected file (object URLs). The
  // `light` logo maps to the persisted logo_path; `dark` is client-only preview
  // (no dark-logo column in 0036/0050 — kept honest, not persisted).
  const [logoPreviews, setLogoPreviews] = React.useState<{
    light: string | null;
    dark: string | null;
  }>({ light: null, dark: null });
  const [faviconPreview, setFaviconPreview] = React.useState<string | null>(null);
  // Files chosen but not yet uploaded. Deferring the upload to Save keeps the
  // bucket object intact until the operator commits, so "Zurücksetzen" (and simply
  // navigating away) is non-destructive — the previously persisted asset survives.
  const [pendingLogo, setPendingLogo] = React.useState<File | null>(null);
  const [pendingFavicon, setPendingFavicon] = React.useState<File | null>(null);
  // Signed URLs resolved for already-persisted logo_path / favicon_path on load.
  const [assetUrls, setAssetUrls] = React.useState<{ logo: string | null; favicon: string | null }>({
    logo: null,
    favicon: null,
  });
  const [uploadError, setUploadError] = React.useState<string>('');
  const [tab, setTab] = React.useState<PreviewTab>('pdf');
  const [dirty, setDirty] = React.useState(false);
  const [toast, setToast] = React.useState<string>('');
  const toastTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const defaults = brandingDefault ?? emptyFields();
  const readOnly = companyId === '';

  // Re-seed local override state whenever the selected company's row loads.
  React.useEffect(() => {
    setOverrides(companyOverrides ?? emptyFields());
    setLogoPreviews({ light: null, dark: null });
    setFaviconPreview(null);
    setPendingLogo(null);
    setPendingFavicon(null);
    setAssetUrls({ logo: null, favicon: null });
    setUploadError('');
    setDirty(false);
  }, [companyOverrides]);

  // Resolve signed preview URLs for already-persisted assets (0051 private bucket).
  const persistedLogoPath = companyOverrides?.logo_path ?? null;
  const persistedFaviconPath = companyOverrides?.favicon_path ?? null;
  React.useEffect(() => {
    let cancelled = false;
    if (persistedLogoPath) {
      void signBrandingAsset(persistedLogoPath)
        .then((url) => {
          if (!cancelled) {
            setAssetUrls((prev) => ({ ...prev, logo: url }));
          }
        })
        .catch(() => undefined);
    }
    if (persistedFaviconPath) {
      void signBrandingAsset(persistedFaviconPath)
        .then((url) => {
          if (!cancelled) {
            setAssetUrls((prev) => ({ ...prev, favicon: url }));
          }
        })
        .catch(() => undefined);
    }
    return () => {
      cancelled = true;
    };
  }, [persistedLogoPath, persistedFaviconPath]);

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

  /** Persisted-field override value (null == inherit the platform default). */
  const persisted = readOnly ? emptyFields() : overrides;

  function isOverridden(key: BrandingFieldKey): boolean {
    return !readOnly && persisted[key] !== null && persisted[key] !== '';
  }

  /** Effective (rendered) value: the override if set, else the platform default. */
  function effective(key: BrandingFieldKey): string {
    const ov = persisted[key];
    if (ov !== null && ov !== '') {
      return ov;
    }
    return defaults[key] ?? '';
  }

  function setField(key: BrandingFieldKey, raw: string) {
    if (readOnly) {
      return;
    }
    const sanitized =
      key === 'sender_local_part'
        ? sanitizeLocalPart(raw, MAX_LEN[key])
        : sanitizeText(raw, MAX_LEN[key]);
    // Functional updater: consecutive setField calls in one handler (e.g. a colour
    // preset setting primary + accent) must compose, not each spread the same
    // stale render-scope overrides object and clobber the previous update.
    setOverrides((prev) => ({ ...prev, [key]: sanitized === '' ? null : sanitized }));
    setDirty(true);
  }

  function resetField(key: BrandingFieldKey) {
    setOverrides((prev) => ({ ...prev, [key]: null }));
    setDirty(true);
  }

  /** "Standard anpassen": copy the effective defaults of every surfaced field into
   *  editable overrides. Non-surfaced columns keep inheriting (see deviations). */
  function adoptStandard() {
    setOverrides((prev) => {
      const next = { ...prev };
      for (const key of BRANDING_KEYS) {
        next[key] = effective(key) || null;
      }
      return next;
    });
    setDirty(true);
  }

  /**
   * Logo selection. The `light` slot is the persisted primary logo: the chosen
   * file is held pending and only uploaded to the 0051 branding-assets bucket on
   * Save (see handleSave), so selecting a file never destroys the persisted asset
   * before the operator commits. The `dark` slot has no backing column, so it is a
   * client-only preview (honest) and does not mark the form dirty.
   */
  function handleLogo(slot: 'light' | 'dark', e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setLogoPreviews((prev) => ({ ...prev, [slot]: file ? URL.createObjectURL(file) : null }));
    if (slot !== 'light' || readOnly) {
      return;
    }
    setPendingLogo(file);
    setUploadError('');
    setDirty(true);
  }

  /** Favicon selection → held pending, uploaded into favicon_path on Save (0050/0051). */
  function handleFavicon(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setFaviconPreview(file ? URL.createObjectURL(file) : null);
    if (readOnly) {
      return;
    }
    setPendingFavicon(file);
    setUploadError('');
    setDirty(true);
  }

  const colorValue = effective('primary_color_hex');
  const colorInvalid = colorValue !== '' && !HEX_RE.test(colorValue);
  const accentValue = effective('accent_color_hex');
  const accentInvalid = accentValue !== '' && !HEX_RE.test(accentValue);
  const headValue = effective('heading_font') || DEFAULT_FONT;
  const footerValue = effective('footer_text');

  const hasAnyOverride = !readOnly && BRANDING_KEYS.some((k) => isOverridden(k));

  // Effective values powering the live preview (partner colours, Iron Rule 6).
  const previewPrimary = HEX_RE.test(colorValue) ? colorValue : DEFAULT_PRIMARY;
  const previewAccent = HEX_RE.test(accentValue) ? accentValue : DEFAULT_ACCENT;
  const headStack = FONTS.find((f) => f.key === headValue)?.stack ?? 'Inter, sans-serif';
  const selectedCompany = companies?.find((c) => c.id === companyId);
  const companyName = effective('company_display_name') || selectedCompany?.name || 'Muster GmbH';
  const senderName = effective('sender_display_name') || companyName;
  const replyTo = effective('reply_to') || t('sender.replyPlaceholder');
  const monogram = (companyName.trim()[0] ?? 'M').toUpperCase();

  async function handleSave() {
    if (readOnly || colorInvalid || accentInvalid) {
      return;
    }
    // Commit pending asset selections first: only now (on Save) do we touch the
    // bucket, so cancelling before this never overwrites the persisted asset.
    let next = persisted;
    try {
      if (pendingLogo) {
        next = { ...next, logo_path: await uploadBrandingAsset(companyId, 'logo', pendingLogo) };
      }
      if (pendingFavicon) {
        next = {
          ...next,
          favicon_path: await uploadBrandingAsset(companyId, 'favicon', pendingFavicon),
        };
      }
    } catch {
      setUploadError(t('logo.uploadError'));
      return;
    }
    setUploadError('');
    save.mutate(
      { companyId, overrides: next },
      {
        onSuccess: () => {
          setPendingLogo(null);
          setPendingFavicon(null);
          setDirty(false);
          fireToast(t('toast.saved'));
        },
      },
    );
  }

  function handleReset() {
    setOverrides(companyOverrides ?? emptyFields());
    setLogoPreviews({ light: null, dark: null });
    setFaviconPreview(null);
    setPendingLogo(null);
    setPendingFavicon(null);
    setUploadError('');
    setDirty(false);
    fireToast(t('toast.reset'));
  }

  return (
    <div className="flex flex-col">
      {/* Screen action bar — 1:1 with the design's 64px top bar: dirty indicator
          + Zurücksetzen/Speichern, right-aligned. Full-bleed to align with the
          shell's 32px content padding. The breadcrumb is owned by the shell
          header; this bar's left slot carries the company selector (a data-real
          addition the design omits — see deviations/branding.md). */}
      <div className="-mx-8 -mt-8 mb-8 flex h-16 shrink-0 items-center justify-between gap-md border-b border-ink/10 px-8">
        <div className="flex items-center gap-sm">
          <label
            htmlFor="branding-company"
            className="text-[11px] font-medium uppercase tracking-[0.02em] text-[#5C6B85]"
          >
            {t('company.label')}
          </label>
          <select
            id="branding-company"
            className="h-9 rounded-[9px] border border-ink/15 bg-card px-sm text-[13px] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={companyId}
            onChange={(e) => setCompanyId(e.target.value)}
          >
            <option value="">{t('company.standard')}</option>
            {companies?.map((c: Company) => (
              <option key={c.id} value={c.id}>
                {c.name || c.id}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-sm">
          {dirty ? (
            <span className="inline-flex items-center gap-xs text-[12px] font-medium text-[#b56a1c]">
              <span className="size-[7px] rounded-full bg-porch" aria-hidden />
              {t('actions.dirty')}
            </span>
          ) : null}
          <button
            type="button"
            onClick={handleReset}
            disabled={!dirty}
            className="h-[38px] rounded-[9px] border border-ink/15 bg-card px-[14px] text-[13px] font-medium text-ink transition-colors hover:bg-[#f0f1f4] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t('actions.reset')}
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={readOnly || colorInvalid || accentInvalid || save.isPending}
            className="inline-flex h-[38px] items-center gap-[7px] rounded-[9px] bg-porch px-4 text-[13px] font-medium text-white transition-colors hover:bg-[#d9781f] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Save aria-hidden className="size-[15px]" />
            {save.isPending ? t('actions.saving') : t('actions.save')}
          </button>
        </div>
      </div>

      <div className="mx-auto flex w-full max-w-[1160px] flex-col gap-6">
        <div>
          <h1 className="mb-[4px] font-display text-[28px] font-medium leading-[34px] text-ink">
            {t('title')}
          </h1>
          <p className="max-w-[620px] text-[14px] text-[#5C6B85]">{t('subtitle')}</p>
        </div>

        {readOnly ? (
          <div className="rounded-[12px] border border-ink/10 bg-porch/5 p-md text-[13px] text-[#5C6B85]">
            {t('readOnlyNote')}
          </div>
        ) : hasAnyOverride ? null : (
          <div className="flex flex-wrap items-center justify-between gap-md rounded-[12px] border border-porch/30 bg-porch/5 p-md">
            <div className="flex flex-col gap-xs">
              <p className="font-display text-[16px] font-medium text-ink">
                {t('standardBanner.heading')}
              </p>
              <p className="max-w-[560px] text-[13px] text-[#5C6B85]">{t('standardBanner.body')}</p>
            </div>
            <button
              type="button"
              onClick={adoptStandard}
              className="inline-flex h-[38px] items-center gap-[7px] rounded-[9px] border border-ink/15 bg-card px-[14px] text-[13px] font-medium text-ink transition-colors hover:bg-[#f0f1f4]"
            >
              <Plus aria-hidden className="size-4" />
              {t('standardBanner.adopt')}
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 items-start gap-7 lg:grid-cols-2">
        {/* LEFT — CONTROLS */}
        <div className="flex flex-col gap-5">
          {/* LOGO */}
          <Section heading={t('logo.heading')} body={t('logo.body')}>
            <div className="grid grid-cols-2 gap-[14px]">
              <LogoDrop
                caption={t('logo.onLight')}
                fileName={t('logo.lightFile')}
                upload={t('logo.upload')}
                previewAlt={t('logo.previewAlt')}
                preview={logoPreviews.light ?? assetUrls.logo}
                onChange={(e) => handleLogo('light', e)}
                dark={false}
                disabled={readOnly}
              />
              <LogoDrop
                caption={t('logo.onDark')}
                fileName={t('logo.darkFile')}
                upload={t('logo.upload')}
                previewAlt={t('logo.previewAlt')}
                preview={logoPreviews.dark}
                onChange={(e) => handleLogo('dark', e)}
                dark
                disabled={readOnly}
              />
            </div>
            <div className="mt-4 flex items-center gap-3">
              <span className="text-[11px] font-medium uppercase tracking-[0.02em] text-[#5C6B85]">
                {t('logo.favicon')}
              </span>
              <label
                className={cn(
                  'flex size-10 cursor-pointer items-center justify-center overflow-hidden rounded-lg border-[1.5px] border-dashed border-ink/20 bg-paper text-[#8792a6] transition-colors hover:border-porch',
                  readOnly && 'cursor-not-allowed opacity-60',
                )}
              >
                {faviconPreview ?? assetUrls.favicon ? (
                  <img
                    src={(faviconPreview ?? assetUrls.favicon) as string}
                    alt={t('logo.faviconPreviewAlt')}
                    className="size-full object-contain"
                  />
                ) : (
                  <Plus aria-hidden className="size-4" />
                )}
                <input
                  type="file"
                  accept="image/png,image/x-icon,image/svg+xml"
                  aria-label={t('logo.faviconUpload')}
                  onChange={handleFavicon}
                  disabled={readOnly}
                  className="sr-only"
                />
              </label>
              <span className="font-mono text-[11px] text-[#8792a6]">{t('logo.faviconHint')}</span>
            </div>
            {uploadError ? (
              <p role="alert" className="mt-2 text-[11px] text-destructive">
                {uploadError}
              </p>
            ) : null}
          </Section>

          {/* MARKENFARBEN */}
          <Section heading={t('colors.heading')} body={t('colors.body')}>
            <div className="grid grid-cols-2 gap-[14px]">
              <div className="flex flex-col">
                <FieldHeader
                  label={t('colors.primary')}
                  overridden={isOverridden('primary_color_hex')}
                  onReset={() => resetField('primary_color_hex')}
                  readOnly={readOnly}
                />
                <div className="flex items-center gap-[9px] rounded-[9px] border border-ink/15 px-[9px] py-[6px]">
                  <input
                    type="color"
                    aria-label={t('colors.primary')}
                    value={HEX_RE.test(colorValue) ? colorValue : DEFAULT_PRIMARY}
                    onChange={(e) => setField('primary_color_hex', e.target.value)}
                    disabled={readOnly}
                    className="size-[30px] shrink-0 cursor-pointer rounded-md border-none bg-transparent p-0 disabled:cursor-not-allowed"
                  />
                  <Input
                    value={colorValue}
                    placeholder="#rrggbb"
                    onChange={(e) => setField('primary_color_hex', e.target.value)}
                    aria-invalid={colorInvalid}
                    disabled={readOnly}
                    className="h-[30px] min-w-0 flex-1 font-mono uppercase"
                  />
                </div>
              </div>
              <div className="flex flex-col">
                <FieldHeader
                  label={t('colors.accent')}
                  overridden={isOverridden('accent_color_hex')}
                  onReset={() => resetField('accent_color_hex')}
                  readOnly={readOnly}
                />
                <div className="flex items-center gap-[9px] rounded-[9px] border border-ink/15 px-[9px] py-[6px]">
                  <input
                    type="color"
                    aria-label={t('colors.accent')}
                    value={HEX_RE.test(accentValue) ? accentValue : DEFAULT_ACCENT}
                    onChange={(e) => setField('accent_color_hex', e.target.value)}
                    disabled={readOnly}
                    className="size-[30px] shrink-0 cursor-pointer rounded-md border-none bg-transparent p-0 disabled:cursor-not-allowed"
                  />
                  <Input
                    value={accentValue}
                    placeholder="#rrggbb"
                    onChange={(e) => setField('accent_color_hex', e.target.value)}
                    aria-invalid={accentInvalid}
                    disabled={readOnly}
                    className="h-[30px] min-w-0 flex-1 font-mono uppercase"
                  />
                </div>
              </div>
            </div>
            {colorInvalid || accentInvalid ? (
              <p role="alert" className="mt-2 text-[11px] text-destructive">
                {t('colors.invalid')}
              </p>
            ) : null}

            <div className="mb-[9px] mt-[18px] text-[11px] font-medium uppercase tracking-[0.02em] text-[#5C6B85]">
              {t('colors.presets')}
            </div>
            <div className="flex flex-wrap gap-[10px]">
              {PRESETS.map((p) => {
                const activePreset = colorValue === p.primary && accentValue === p.accent;
                return (
                  <button
                    key={p.name}
                    type="button"
                    title={p.name}
                    disabled={readOnly}
                    onClick={() => {
                      setField('primary_color_hex', p.primary);
                      setField('accent_color_hex', p.accent);
                    }}
                    className={cn(
                      'flex overflow-hidden rounded-[9px] border-[1.5px] disabled:cursor-not-allowed disabled:opacity-50',
                      activePreset ? 'border-porch' : 'border-ink/15',
                    )}
                  >
                    <span className="h-[30px] w-[26px]" style={{ background: p.primary }} />
                    <span className="h-[30px] w-[26px]" style={{ background: p.accent }} />
                  </button>
                );
              })}
            </div>
          </Section>

          {/* TYPOGRAFIE */}
          <Section heading={t('typography.heading')} body={t('typography.body')}>
            <div className="flex gap-[10px]">
              {FONTS.map((f) => {
                const activeFont = f.key === headValue;
                return (
                  <button
                    key={f.key}
                    type="button"
                    disabled={readOnly}
                    onClick={() => setField('heading_font', f.key)}
                    className={cn(
                      'flex-1 rounded-[10px] border-[1.5px] px-[14px] py-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                      activeFont ? 'border-porch bg-porch/[.08]' : 'border-ink/15 bg-card',
                    )}
                  >
                    <div
                      className="mb-[2px] text-[18px] font-medium text-ink"
                      style={{ fontFamily: f.stack }}
                    >
                      Ag
                    </div>
                    <div className="text-[12px] text-[#5C6B85]">{f.name}</div>
                  </button>
                );
              })}
            </div>
          </Section>

          {/* ABSENDER & FUßZEILE */}
          <Section heading={t('sender.heading')} body={t('sender.body')}>
            <div className="mb-4 grid grid-cols-2 gap-4">
              <div className="flex flex-col">
                <FieldHeader
                  label={t('sender.name')}
                  overridden={isOverridden('sender_display_name')}
                  onReset={() => resetField('sender_display_name')}
                  readOnly={readOnly}
                />
                <Input
                  value={effective('sender_display_name')}
                  placeholder={t('sender.namePlaceholder')}
                  onChange={(e) => setField('sender_display_name', e.target.value)}
                  disabled={readOnly}
                  className="h-10"
                />
              </div>
              <div className="flex flex-col">
                <FieldHeader
                  label={t('sender.reply')}
                  overridden={isOverridden('reply_to')}
                  onReset={() => resetField('reply_to')}
                  readOnly={readOnly}
                />
                <Input
                  value={effective('reply_to')}
                  placeholder={t('sender.replyPlaceholder')}
                  onChange={(e) => setField('reply_to', e.target.value)}
                  disabled={readOnly}
                  className="h-10 font-mono text-[13px]"
                />
              </div>
            </div>

            <FieldHeader
              label={t('sender.footer')}
              overridden={isOverridden('footer_text')}
              onReset={() => resetField('footer_text')}
              readOnly={readOnly}
            />
            <textarea
              value={footerValue}
              placeholder={t('sender.footerPlaceholder')}
              onChange={(e) => setField('footer_text', e.target.value)}
              disabled={readOnly}
              rows={2}
              className="flex w-full resize-y rounded-[9px] border border-ink/15 bg-card px-3 py-[10px] text-[13px] leading-[18px] transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            />
          </Section>
        </div>

        {/* RIGHT — LIVE PREVIEW */}
        <div className="sticky top-0">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-[11px] font-medium uppercase tracking-[0.02em] text-[#5C6B85]">
              {t('preview.label', { company: companyName })}
            </span>
            <div className="flex gap-[2px] rounded-[9px] bg-ink/[.06] p-[3px]">
              {TABS.map((key) => {
                const activeTab = key === tab;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setTab(key)}
                    className={cn(
                      'rounded-[7px] px-[13px] py-[6px] text-[12px] font-medium transition-colors',
                      activeTab
                        ? 'bg-card text-ink shadow-sm'
                        : 'text-[#5C6B85] hover:text-ink',
                    )}
                  >
                    {t(`preview.tabs.${key}`)}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="min-h-[520px] rounded-[12px] border border-ink/10 bg-card p-[22px]">
            {tab === 'pdf' ? (
              <PdfPreview
                primary={previewPrimary}
                accent={previewAccent}
                headStack={headStack}
                company={companyName}
                monogram={monogram}
                footer={footerValue || t('sender.footerPlaceholder')}
                t={t}
              />
            ) : tab === 'mail' ? (
              <MailPreview
                primary={previewPrimary}
                accent={previewAccent}
                headStack={headStack}
                company={companyName}
                monogram={monogram}
                sender={senderName}
                reply={replyTo}
                footer={footerValue || t('sender.footerPlaceholder')}
                t={t}
              />
            ) : (
              <PortalPreview
                primary={previewPrimary}
                accent={previewAccent}
                headStack={headStack}
                company={companyName}
                monogram={monogram}
                t={t}
              />
            )}
          </div>
          <p className="mt-[10px] text-center text-[12px] text-[#8792a6]">{t('preview.note')}</p>
        </div>
        </div>
      </div>

      {toast ? (
        <output className="fixed bottom-6 right-6 z-50 flex items-center gap-sm rounded-md bg-ink px-md py-sm text-paper shadow-lg">
          <Check aria-hidden className="size-4 text-pine" />
          <span className="text-body font-medium">{toast}</span>
        </output>
      ) : null}
    </div>
  );
}

// Every override field the page actually wires (colours, typography, footer,
// sender identity, and the logo/favicon assets from 0050). hasAnyOverride and
// adoptStandard must cover all of them — a company overriding only e.g. the
// accent colour or a logo is still overridden. The remaining 0036/0050 columns
// (company_display_name, sender_local_part, agb_text, belehrung_text) are not
// surfaced on this page and keep inheriting (logged in deviations/branding.md).
const BRANDING_KEYS: readonly BrandingFieldKey[] = [
  'primary_color_hex',
  'accent_color_hex',
  'heading_font',
  'footer_text',
  'sender_display_name',
  'reply_to',
  'logo_path',
  'favicon_path',
];

/** White card section wrapper matching the design's section chrome. */
function Section({
  heading,
  body,
  children,
}: {
  heading: string;
  body: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[12px] border border-ink/10 bg-card px-6 py-[22px]">
      <div className="mb-[2px] font-display text-[16px] font-medium text-ink">{heading}</div>
      <div className="mb-[18px] text-[13px] text-[#5C6B85]">{body}</div>
      {children}
    </section>
  );
}

/**
 * The design's field label — small uppercase slate, single line (11px / .02em).
 * The inherited/overridden indicator + per-field reset are data-real additions
 * the design omits; they only appear when a specific company is selected
 * (`!readOnly` and not a preview-only field) and sit to the RIGHT of the short
 * label without ever forcing it to wrap. In the platform-default view the row is
 * a plain label, identical to the design.
 */
function FieldHeader({
  label,
  overridden,
  onReset,
  readOnly,
  previewOnly,
}: {
  label: string;
  overridden?: boolean;
  onReset?: () => void;
  readOnly?: boolean;
  previewOnly?: boolean;
}) {
  const { t } = useTranslation('branding');
  const showIndicator = !previewOnly && !readOnly;
  return (
    <div className="mb-[7px] flex min-h-[16px] items-center justify-between gap-sm">
      <span className="text-[11px] font-medium uppercase tracking-[0.02em] text-[#5C6B85]">
        {label}
      </span>
      {showIndicator ? (
        <div className="flex items-center gap-sm">
          <Badge variant={overridden ? 'invited' : 'neutral'}>
            {overridden ? t('overridden') : t('inherited')}
          </Badge>
          {overridden && onReset ? (
            <button
              type="button"
              onClick={onReset}
              className="text-[11px] text-[#5C6B85] underline-offset-2 hover:text-ink hover:underline"
            >
              {t('resetToDefault')}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** A single logo upload drop-zone (light or dark surface). */
function LogoDrop({
  caption,
  fileName,
  upload,
  previewAlt,
  preview,
  onChange,
  dark,
  disabled,
}: {
  caption: string;
  fileName: string;
  upload: string;
  previewAlt: string;
  preview: string | null;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  dark: boolean;
  disabled: boolean;
}) {
  return (
    <div className="flex flex-col">
      <span className="mb-[7px] text-[11px] font-medium uppercase tracking-[0.02em] text-[#5C6B85]">
        {caption}
      </span>
      <label
        className={cn(
          'flex h-[104px] cursor-pointer flex-col items-center justify-center gap-[7px] rounded-[10px] border-[1.5px] border-dashed transition-colors hover:border-porch',
          dark ? 'border-paper/[.28] bg-ink text-paper/60' : 'border-ink/[.22] bg-[#fafbfc] text-[#8792a6]',
          disabled && 'cursor-not-allowed opacity-60',
        )}
      >
        {preview ? (
          <img src={preview} alt={previewAlt} className="max-h-[72px] w-auto" />
        ) : (
          <>
            <Upload aria-hidden className="size-[22px]" strokeWidth={1.8} />
            <span className="font-mono text-[11px]">{fileName}</span>
          </>
        )}
        <input
          type="file"
          accept="image/png,image/jpeg,image/svg+xml"
          aria-label={upload}
          onChange={onChange}
          disabled={disabled}
          className="sr-only"
        />
      </label>
    </div>
  );
}

type TFn = (key: string, opts?: Record<string, unknown>) => string;

/** PDF document preview — partner colours + selected heading font. */
function PdfPreview({
  primary,
  accent,
  headStack,
  company,
  monogram,
  footer,
  t,
}: {
  primary: string;
  accent: string;
  headStack: string;
  company: string;
  monogram: string;
  footer: string;
  t: TFn;
}) {
  return (
    <div className="overflow-hidden rounded-md border border-ink/10 shadow-lg">
      <div
        className="flex items-center justify-between p-md text-white"
        style={{ background: primary }}
      >
        <div className="flex items-center gap-sm">
          <div
            className="flex size-9 items-center justify-center rounded-md font-display text-body font-medium"
            style={{ background: accent, color: primary }}
          >
            {monogram}
          </div>
          <div className="font-medium" style={{ fontFamily: headStack }}>
            {company}
          </div>
        </div>
        <div className="font-mono text-label opacity-80">{t('preview.pdf.docNo')}</div>
      </div>
      <div className="p-md">
        <div
          className="mb-md text-heading font-medium text-foreground"
          style={{ fontFamily: headStack }}
        >
          {t('preview.pdf.title')}
        </div>
        <SkeletonLine w="92%" />
        <SkeletonLine w="100%" />
        <SkeletonLine w="78%" />
        <div className="mb-md mt-md overflow-hidden rounded-md border border-ink/10">
          <div className="flex justify-between bg-ink/[.04] px-md py-sm text-label font-medium text-muted-foreground">
            <span>{t('preview.pdf.product')}</span>
            <span>{t('preview.pdf.commission')}</span>
          </div>
          <div className="flex justify-between border-t border-ink/[.06] px-md py-sm">
            <span className="text-body">{t('preview.pdf.row1')}</span>
            <span className="font-mono text-body font-medium">{t('preview.pdf.row1Value')}</span>
          </div>
          <div className="flex justify-between border-t border-ink/[.06] px-md py-sm">
            <span className="text-body">{t('preview.pdf.row2')}</span>
            <span className="font-mono text-body font-medium">{t('preview.pdf.row2Value')}</span>
          </div>
        </div>
        <button
          type="button"
          className="rounded-md px-md py-sm text-body font-medium text-white"
          style={{ background: accent }}
        >
          {t('preview.pdf.cta')}
        </button>
      </div>
      <div className="border-t border-ink/[.08] px-md py-sm text-label text-muted-foreground">
        {footer}
      </div>
    </div>
  );
}

/** Confirmation-email preview. */
function MailPreview({
  primary,
  accent,
  headStack,
  company,
  monogram,
  sender,
  reply,
  footer,
  t,
}: {
  primary: string;
  accent: string;
  headStack: string;
  company: string;
  monogram: string;
  sender: string;
  reply: string;
  footer: string;
  t: TFn;
}) {
  return (
    <div className="overflow-hidden rounded-md border border-ink/10 shadow-lg">
      <div className="border-b border-ink/[.08] bg-paper p-md">
        <div className="mb-xs text-body font-medium text-foreground">
          {t('preview.mail.subject')}
        </div>
        <div className="flex items-center gap-sm text-label text-muted-foreground">
          <span
            className="flex size-[22px] items-center justify-center rounded-full text-label font-medium"
            style={{ background: accent, color: primary }}
          >
            {monogram}
          </span>
          {sender} · {reply}
        </div>
      </div>
      <div className="p-md text-center text-white" style={{ background: primary }}>
        <div className="font-medium" style={{ fontFamily: headStack }}>
          {company}
        </div>
      </div>
      <div className="p-md">
        <div className="mb-sm text-body text-foreground">{t('preview.mail.greeting')}</div>
        <SkeletonLine w="100%" />
        <SkeletonLine w="88%" />
        <div className="my-md text-center">
          <button
            type="button"
            className="rounded-md px-lg py-sm text-body font-medium text-white"
            style={{ background: accent }}
          >
            {t('preview.mail.cta')}
          </button>
        </div>
        <div className="h-2 w-[70%] rounded-full bg-ink/5" />
      </div>
      <div className="border-t border-ink/[.08] px-md py-sm text-center text-label text-muted-foreground">
        {footer}
      </div>
    </div>
  );
}

/** Partner portal preview. */
function PortalPreview({
  primary,
  accent,
  headStack,
  company,
  monogram,
  t,
}: {
  primary: string;
  accent: string;
  headStack: string;
  company: string;
  monogram: string;
  t: TFn;
}) {
  return (
    <div className="overflow-hidden rounded-md border border-ink/10 shadow-lg">
      <div
        className="flex items-center justify-between p-md text-white"
        style={{ background: primary }}
      >
        <div className="flex items-center gap-sm">
          <div
            className="flex size-7 items-center justify-center rounded-md font-display text-label font-medium"
            style={{ background: accent, color: primary }}
          >
            {monogram}
          </div>
          <div className="font-medium" style={{ fontFamily: headStack }}>
            {company}
          </div>
        </div>
        <div className="flex gap-md text-label opacity-80">
          <span>{t('preview.portal.navContracts')}</span>
          <span>{t('preview.portal.navCommission')}</span>
          <span>{t('preview.portal.navAccount')}</span>
        </div>
      </div>
      <div className="bg-paper p-md">
        <div
          className="mb-md text-heading font-medium text-foreground"
          style={{ fontFamily: headStack }}
        >
          {t('preview.portal.welcome')}
        </div>
        <div className="mb-md grid grid-cols-2 gap-sm">
          <div className="rounded-md border border-ink/10 bg-card p-md">
            <div className="mb-xs font-mono text-label text-muted-foreground">
              {t('preview.portal.openContracts')}
            </div>
            <div className="font-display text-heading font-medium" style={{ color: primary }}>
              {t('preview.portal.openContractsValue')}
            </div>
          </div>
          <div className="rounded-md border border-ink/10 bg-card p-md">
            <div className="mb-xs font-mono text-label text-muted-foreground">
              {t('preview.portal.commissionMtd')}
            </div>
            <div className="font-display text-heading font-medium" style={{ color: primary }}>
              {t('preview.portal.commissionMtdValue')}
            </div>
          </div>
        </div>
        <button
          type="button"
          className="w-full rounded-md py-sm text-body font-medium text-white"
          style={{ background: accent }}
        >
          {t('preview.portal.cta')}
        </button>
      </div>
    </div>
  );
}

function SkeletonLine({ w }: { w: string }) {
  return <div className="mb-sm h-[9px] rounded-sm bg-ink/[.06]" style={{ width: w }} />;
}
