import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import * as React from 'react';
import { useTranslation } from 'react-i18next';
import {
  type BrandingFieldKey,
  type BrandingFields,
  emptyBrandingFields,
  useCompanyBranding,
  useSaveBranding,
} from './useBranding';

/**
 * Two-layer white-label branding form (WLBL-01/WLBL-02). Every field inherits
 * the platform default until overridden; each field shows an inherited-vs-
 * overridden indicator + a "Zurücksetzen auf Standard" control, and the sender
 * identity fields drive a live `vertrag@firmenname.<send-domain>.de` preview.
 * Company colors are TENANT config (Iron Rule 6), never the dashboard palette.
 *
 * All operator text is sanitized (length + control-char charset) before save so
 * malformed config can never reach the PDF/email renderer (T-05-33 → T-05-23).
 */

/** Platform send domain the white-label sender address is built under (D-15). */
const SEND_DOMAIN =
  (import.meta.env.VITE_SEND_DOMAIN as string | undefined)?.trim() || 'partner';

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

/** Strip C0/C1 control chars (keep \n, \t) and clamp to max length. */
function sanitizeText(value: string, max: number): string {
  // Drop C0/C1 control chars (keep tab=9, newline=10, carriage-return=13);
  // strips injection/formatting artefacts before config reaches the renderer.
  let cleaned = "";
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

/** firmenname slug for the sender preview (lowercase alphanumerics only). */
function displaySlug(displayName: string | null | undefined): string {
  const slug = (displayName ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return slug || 'firmenname';
}

interface BrandingFormProps {
  companyId: string;
  /** The platform default row (inheritance source). */
  defaults: BrandingFields;
  onSaved?: () => void;
}

export function BrandingForm({ companyId, defaults, onSaved }: BrandingFormProps) {
  const { t } = useTranslation('companies');
  const { data: companyOverrides } = useCompanyBranding(companyId);
  const save = useSaveBranding();

  const [overrides, setOverrides] = React.useState<BrandingFields | null>(null);
  const [logoPreview, setLogoPreview] = React.useState<string | null>(null);

  // Seed local override state once the persisted company row loads.
  React.useEffect(() => {
    if (companyOverrides && overrides === null) {
      setOverrides(companyOverrides);
    }
  }, [companyOverrides, overrides]);

  const current = overrides ?? emptyBrandingFields();

  function isOverridden(key: BrandingFieldKey): boolean {
    return current[key] !== null && current[key] !== '';
  }

  /** Effective (rendered) value: the override if set, else the platform default. */
  function effective(key: BrandingFieldKey): string {
    const ov = current[key];
    if (ov !== null && ov !== '') {
      return ov;
    }
    return defaults[key] ?? '';
  }

  function setField(key: BrandingFieldKey, raw: string) {
    const sanitized =
      key === 'sender_local_part'
        ? sanitizeLocalPart(raw, MAX_LEN[key])
        : sanitizeText(raw, MAX_LEN[key]);
    // Empty input clears the override → the field falls back to the default.
    setOverrides({ ...current, [key]: sanitized === '' ? null : sanitized });
  }

  function resetField(key: BrandingFieldKey) {
    setOverrides({ ...current, [key]: null });
  }

  function handleLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    setLogoPreview(file ? URL.createObjectURL(file) : null);
  }

  const colorValue = effective('primary_color_hex');
  const colorInvalid = colorValue !== '' && !HEX_RE.test(colorValue);

  const senderLocal = effective('sender_local_part') || 'vertrag';
  const senderPreview = `${senderLocal}@${displaySlug(effective('company_display_name'))}.${SEND_DOMAIN}.de`;

  function handleSave() {
    if (colorInvalid) {
      return;
    }
    save.mutate(
      { companyId, overrides: current },
      { onSuccess: () => onSaved?.() },
    );
  }

  return (
    <div className="flex flex-col gap-lg">
      <div className="flex flex-col gap-xs">
        <h3 className="font-display text-heading text-foreground">{t('branding.heading')}</h3>
        <p className="text-body text-muted-foreground">{t('branding.body')}</p>
      </div>

      {/* Logo: this wizard step renders a client-side preview only and never
          persists the file — the real asset upload lives on the Branding page
          (BrandingPage). Labelled "Nur Vorschau" so it does not read as saved. */}
      <div className="flex flex-col gap-xs">
        <div className="flex items-center justify-between gap-sm">
          <Label>{t('branding.fields.logo')}</Label>
          <Badge variant="neutral">{t('branding.logoPreviewOnly')}</Badge>
        </div>
        <p className="text-label text-muted-foreground">{t('branding.logoPreviewOnlyHint')}</p>
        <input
          type="file"
          accept="image/png,image/jpeg,image/svg+xml"
          aria-label={t('branding.logoUpload')}
          onChange={handleLogo}
          className="text-body file:mr-md file:rounded-md file:border file:border-input file:bg-transparent file:px-md file:py-xs file:text-body"
        />
        {logoPreview ? (
          <img src={logoPreview} alt={t('branding.logoPreviewAlt')} className="mt-sm h-12 w-auto rounded border" />
        ) : null}
      </div>

      {/* Primary color — TENANT config (company palette), not the dashboard accent. */}
      <FieldRow
        label={t('branding.fields.primaryColor')}
        overridden={isOverridden('primary_color_hex')}
        onReset={() => resetField('primary_color_hex')}
      >
        <div className="flex items-center gap-sm">
          <input
            type="color"
            aria-label={t('branding.fields.primaryColor')}
            value={HEX_RE.test(colorValue) ? colorValue : '#000000'}
            onChange={(e) => setField('primary_color_hex', e.target.value)}
            className="h-10 w-14 cursor-pointer rounded-md border border-input bg-transparent p-xs"
          />
          <Input
            value={colorValue}
            placeholder="#rrggbb"
            onChange={(e) => setField('primary_color_hex', e.target.value)}
            aria-invalid={colorInvalid}
            className="max-w-[10rem] font-mono"
          />
        </div>
        {colorInvalid ? (
          <p role="alert" className="text-label text-destructive">
            {t('branding.colorInvalid')}
          </p>
        ) : null}
      </FieldRow>

      <TextField fieldKey="company_display_name" label={t('branding.fields.companyDisplayName')} placeholder={t('branding.placeholders.companyDisplayName')} value={effective('company_display_name')} overridden={isOverridden('company_display_name')} onChange={setField} onReset={resetField} />
      <TextField fieldKey="sender_local_part" label={t('branding.fields.senderLocalPart')} placeholder={t('branding.placeholders.senderLocalPart')} value={effective('sender_local_part')} overridden={isOverridden('sender_local_part')} onChange={setField} onReset={resetField} mono />
      <TextField fieldKey="sender_display_name" label={t('branding.fields.senderDisplayName')} placeholder={t('branding.placeholders.senderDisplayName')} value={effective('sender_display_name')} overridden={isOverridden('sender_display_name')} onChange={setField} onReset={resetField} />
      <TextField fieldKey="reply_to" label={t('branding.fields.replyTo')} placeholder={t('branding.placeholders.replyTo')} value={effective('reply_to')} overridden={isOverridden('reply_to')} onChange={setField} onReset={resetField} />

      {/* Live sender identity preview (D-15). */}
      <div className="rounded-md border border-porch/30 bg-porch/5 p-md">
        <p className="text-label uppercase tracking-wide text-muted-foreground">
          {t('branding.senderPreviewLabel')}
        </p>
        <p className="mt-xs font-mono text-body text-foreground" data-testid="sender-preview">
          {senderPreview}
        </p>
      </div>

      <TextAreaField fieldKey="agb_text" label={t('branding.fields.agbText')} placeholder={t('branding.placeholders.agbText')} value={effective('agb_text')} overridden={isOverridden('agb_text')} onChange={setField} onReset={resetField} />
      <TextAreaField fieldKey="belehrung_text" label={t('branding.fields.belehrungText')} placeholder={t('branding.placeholders.belehrungText')} value={effective('belehrung_text')} overridden={isOverridden('belehrung_text')} onChange={setField} onReset={resetField} />

      <div className="flex items-center justify-end gap-sm">
        {save.isSuccess ? <span className="text-label text-pine">{t('branding.saved')}</span> : null}
        <Button onClick={handleSave} disabled={save.isPending || colorInvalid}>
          {save.isPending ? t('branding.saving') : t('branding.save')}
        </Button>
      </div>
    </div>
  );
}

/** A field wrapper: label + inherited/overridden indicator + optional reset. */
function FieldRow({
  label,
  overridden,
  onReset,
  showReset = true,
  children,
}: {
  label: string;
  overridden: boolean;
  onReset: () => void;
  showReset?: boolean;
  children: React.ReactNode;
}) {
  const { t } = useTranslation('companies');
  return (
    <div className="flex flex-col gap-xs">
      <div className="flex items-center justify-between gap-sm">
        <Label>{label}</Label>
        <div className="flex items-center gap-sm">
          <Badge variant={overridden ? 'invited' : 'neutral'}>
            {overridden ? t('branding.overridden') : t('branding.inherited')}
          </Badge>
          {overridden && showReset ? (
            <button
              type="button"
              onClick={onReset}
              className="text-label text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              {t('branding.resetToDefault')}
            </button>
          ) : null}
        </div>
      </div>
      {children}
    </div>
  );
}

function TextField({
  fieldKey,
  label,
  placeholder,
  value,
  overridden,
  onChange,
  onReset,
  mono,
}: {
  fieldKey: BrandingFieldKey;
  label: string;
  placeholder: string;
  value: string;
  overridden: boolean;
  onChange: (key: BrandingFieldKey, value: string) => void;
  onReset: (key: BrandingFieldKey) => void;
  mono?: boolean;
}) {
  return (
    <FieldRow label={label} overridden={overridden} onReset={() => onReset(fieldKey)}>
      <Input
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(fieldKey, e.target.value)}
        className={cn(mono && 'font-mono')}
      />
    </FieldRow>
  );
}

function TextAreaField({
  fieldKey,
  label,
  placeholder,
  value,
  overridden,
  onChange,
  onReset,
}: {
  fieldKey: BrandingFieldKey;
  label: string;
  placeholder: string;
  value: string;
  overridden: boolean;
  onChange: (key: BrandingFieldKey, value: string) => void;
  onReset: (key: BrandingFieldKey) => void;
}) {
  return (
    <FieldRow label={label} overridden={overridden} onReset={() => onReset(fieldKey)}>
      <textarea
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(fieldKey, e.target.value)}
        rows={4}
        className="flex w-full rounded-md border border-input bg-transparent px-md py-sm text-body shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
    </FieldRow>
  );
}
