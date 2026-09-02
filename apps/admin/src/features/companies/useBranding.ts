import { getSupabase } from '@/lib/supabase';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

/**
 * White-label branding config data layer (WLBL-01/WLBL-02, table 0036).
 *
 * Two-layer inheritance: a SINGLE platform DEFAULT row (company_id IS NULL)
 * supplies fallback values; each per-company row overrides selectively and
 * inherits the rest. The merge is a read-time concern (05-UI-SPEC / the PDF+email
 * renderer), so both rows are fetched and the form computes effective values +
 * per-field inherited-vs-overridden indicators. This is tenant CONFIG the 05-07
 * PDF/email pipeline reads — never a per-company code branch (Iron Rule 6).
 */

/**
 * The override-able branding fields (text/color surface + asset paths).
 *
 * Extended by migrations 0050 (accent_color_hex, heading_font, footer_text,
 * favicon_path) so the branding form's Akzentfarbe / Typografie / Dokument-Fußzeile
 * and the logo/favicon upload become real, dirty-tracked, persisted config
 * (previously "Nur Vorschau"). logo_path pre-existed on 0036; favicon_path is new.
 */
export interface BrandingFields {
  primary_color_hex: string | null;
  accent_color_hex: string | null;
  heading_font: string | null;
  company_display_name: string | null;
  agb_text: string | null;
  belehrung_text: string | null;
  footer_text: string | null;
  sender_local_part: string | null;
  sender_display_name: string | null;
  reply_to: string | null;
  logo_path: string | null;
  favicon_path: string | null;
}

export type BrandingFieldKey = keyof BrandingFields;

export const BRANDING_FIELD_KEYS: readonly BrandingFieldKey[] = [
  'primary_color_hex',
  'accent_color_hex',
  'heading_font',
  'company_display_name',
  'agb_text',
  'belehrung_text',
  'footer_text',
  'sender_local_part',
  'sender_display_name',
  'reply_to',
  'logo_path',
  'favicon_path',
];

const SELECT_COLS =
  'primary_color_hex, accent_color_hex, heading_font, company_display_name, agb_text, belehrung_text, footer_text, sender_local_part, sender_display_name, reply_to, logo_path, favicon_path';

/** The private Storage bucket 0051 provisions for logo/favicon assets. */
export const BRANDING_ASSETS_BUCKET = 'branding-assets';

export function emptyBrandingFields(): BrandingFields {
  return {
    primary_color_hex: null,
    accent_color_hex: null,
    heading_font: null,
    company_display_name: null,
    agb_text: null,
    belehrung_text: null,
    footer_text: null,
    sender_local_part: null,
    sender_display_name: null,
    reply_to: null,
    logo_path: null,
    favicon_path: null,
  };
}

function emptyFields(): BrandingFields {
  return emptyBrandingFields();
}

/** The platform DEFAULT branding row (company_id IS NULL) — inheritance source. */
export function useBrandingDefault() {
  return useQuery({
    queryKey: ['branding', 'default'],
    queryFn: async (): Promise<BrandingFields> => {
      const supabase = getSupabase();
      const { data, error } = await supabase
        .from('company_branding_config')
        .select(SELECT_COLS)
        .is('company_id', null)
        .maybeSingle();
      if (error) {
        throw error;
      }
      return { ...emptyFields(), ...(data ?? {}) } as BrandingFields;
    },
  });
}

/** The per-company override row (may not exist yet → all-null overrides). */
export function useCompanyBranding(companyId: string | null) {
  return useQuery({
    queryKey: ['branding', 'company', companyId],
    enabled: Boolean(companyId),
    queryFn: async (): Promise<BrandingFields> => {
      const supabase = getSupabase();
      const { data, error } = await supabase
        .from('company_branding_config')
        .select(SELECT_COLS)
        .eq('company_id', companyId as string)
        .maybeSingle();
      if (error) {
        throw error;
      }
      return { ...emptyFields(), ...(data ?? {}) } as BrandingFields;
    },
  });
}

/**
 * Persist the per-company override row. One row per company (0036 partial unique
 * index); ON CONFLICT is banned on RLS tables, so insert-vs-update is resolved
 * by a prior read. The full field set is written on every save: a null column
 * clears that override, so the read-time merge inherits the platform default.
 */
export function useSaveBranding() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { companyId: string; overrides: BrandingFields }): Promise<void> => {
      const supabase = getSupabase();
      const { data: existing, error: readError } = await supabase
        .from('company_branding_config')
        .select('id')
        .eq('company_id', input.companyId)
        .maybeSingle();
      if (readError) {
        throw readError;
      }
      if (existing?.id) {
        const { error } = await supabase
          .from('company_branding_config')
          .update({ ...input.overrides, updated_at: new Date().toISOString() })
          .eq('id', existing.id);
        if (error) {
          throw error;
        }
        return;
      }
      const { error } = await supabase
        .from('company_branding_config')
        .insert({ company_id: input.companyId, ...input.overrides });
      if (error) {
        throw error;
      }
    },
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['branding', 'company', variables.companyId] });
    },
  });
}

/**
 * Upload a logo/favicon into the private `branding-assets` bucket (0051). The
 * object name is `<company_id>/<kind>.<ext>` — the first path segment must be a
 * company the caller can see (Storage RLS, MAND-02). Returns the stored path to
 * persist into logo_path / favicon_path. `upsert` replaces a same-extension asset.
 */
export async function uploadBrandingAsset(
  companyId: string,
  kind: 'logo' | 'favicon',
  file: File,
): Promise<string> {
  const supabase = getSupabase();
  const ext = (file.name.split('.').pop() ?? 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
  const path = `${companyId}/${kind}.${ext}`;
  const { error } = await supabase.storage
    .from(BRANDING_ASSETS_BUCKET)
    .upload(path, file, { upsert: true, contentType: file.type || undefined });
  if (error) {
    throw error;
  }
  return path;
}

/** Resolve a stored asset path to a short-lived signed URL for preview. */
export async function signBrandingAsset(path: string): Promise<string> {
  const supabase = getSupabase();
  const { data, error } = await supabase.storage
    .from(BRANDING_ASSETS_BUCKET)
    .createSignedUrl(path, 3600);
  if (error) {
    throw error;
  }
  return data.signedUrl;
}
