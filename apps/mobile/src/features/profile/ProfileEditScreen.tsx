import { useEffect, useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import type { AbstractPowerSyncDatabase } from '@powersync/common';
import { radius, spacing, typography } from '../../design/tokens';
import { t } from '../../i18n';
import { Button } from '../../ui/Button';
import { TextField } from '../../ui/TextField';
import { DbBoundary } from '../../app/DbBoundary';
import { getSupabase } from '../../lib/auth/supabase';
import { useThemeColors } from '../settings/theme/useThemeColors';
import { AVATARS_BUCKET, uploadAvatar, validateAvatarAsset, type UploadAvatarInput } from './db/avatarUpload';
import { createProfileRepo, type ProfileUpdatePatch } from './db/profileRepo';
import { useSessionIdentity } from './useSessionIdentity';

/**
 * Profile edit form (D-01/D-02/D-04, plan 12-13) — display name and contact
 * info, reached from `ProfileScreen`'s `settings.profileEntryLabel` row.
 * `Card`-based, reuses `ProfileScreen`'s 56dp avatar circle + initials
 * fallback (read-only here — the avatar PICKER is plan 12-14's own vertical
 * slice, D-03, not built in this plan).
 *
 * Validation here is UX feedback ONLY, layered on top of the real security
 * boundary (RLS + the connector's APP_USER_EDITABLE_COLUMNS whitelist,
 * 0072_app_users_profile_columns.sql) — never itself the boundary.
 */
export function ProfileEditScreen() {
  return <DbBoundary>{(db, userId) => <ProfileEditContent db={db} userId={userId ?? ''} />}</DbBoundary>;
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

/** Basic-shape email check — mirrors the 0072 DB CHECK constraint (UX layer only, not the boundary). */
export function isValidEmailShape(value: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value);
}

/** Pure form validator — returns field-level error keys, or an empty object when valid. */
export function validateProfileEditForm(input: {
  fullName: string;
  contactEmail: string;
}): { fullName?: 'profile.editErrorNameRequired'; contactEmail?: 'profile.editErrorInvalidEmail' } {
  const errors: { fullName?: 'profile.editErrorNameRequired'; contactEmail?: 'profile.editErrorInvalidEmail' } = {};
  if (!input.fullName.trim()) {
    errors.fullName = 'profile.editErrorNameRequired';
  }
  if (input.contactEmail.trim() && !isValidEmailShape(input.contactEmail.trim())) {
    errors.contactEmail = 'profile.editErrorInvalidEmail';
  }
  return errors;
}

/** Reduces the edited fields to the exact patch `profileRepo.update` should receive — only touched, non-empty fields. */
export function buildEditPatch(input: {
  fullName: string;
  initialFullName: string;
  contactPhone: string;
  initialContactPhone: string;
  contactEmail: string;
  initialContactEmail: string;
}): ProfileUpdatePatch {
  const patch: ProfileUpdatePatch = {};
  if (input.fullName.trim() !== input.initialFullName) {
    patch.fullName = input.fullName.trim();
  }
  if (input.contactPhone.trim() !== input.initialContactPhone) {
    patch.contactPhone = input.contactPhone.trim();
  }
  if (input.contactEmail.trim() !== input.initialContactEmail) {
    patch.contactEmail = input.contactEmail.trim();
  }
  return patch;
}

interface RawAppUserProfileRecord {
  full_name: string | null;
  avatar_url: string | null;
}

export interface PerformProfileSaveInput {
  fullName: string;
  initialFullName: string;
  contactPhone: string;
  initialContactPhone: string;
  contactEmail: string;
  initialContactEmail: string;
}

export interface PerformProfileSaveResult {
  errors: ReturnType<typeof validateProfileEditForm>;
  saveState: SaveState;
  patch: ProfileUpdatePatch;
}

/**
 * Pure(-ish, DI'd) save orchestration — no react-native-testing-library in
 * this repo (SegmentedControl.test.tsx precedent), so the save flow's
 * branching (validate -> no-op-if-unchanged -> write -> success/error) is
 * extracted here, fully testable via a mock `updateFn`, decoupled from React
 * state. `ProfileEditContent`'s `handleSave` is a thin wrapper that feeds
 * this function's result into `useState` setters.
 */
export async function performProfileSave(
  input: PerformProfileSaveInput,
  userId: string,
  updateFn: (userId: string, patch: ProfileUpdatePatch) => Promise<void>,
): Promise<PerformProfileSaveResult> {
  const errors = validateProfileEditForm({ fullName: input.fullName, contactEmail: input.contactEmail });
  if (Object.keys(errors).length > 0) {
    return { errors, saveState: 'idle', patch: {} };
  }
  const patch = buildEditPatch(input);
  if (Object.keys(patch).length === 0) {
    return { errors, saveState: 'saved', patch };
  }
  try {
    await updateFn(userId, patch);
    return { errors, saveState: 'saved', patch };
  } catch {
    return { errors, saveState: 'error', patch };
  }
}

/** The subset of an expo-image-picker result this module needs. */
export interface PickedAvatarAsset {
  uri: string;
  mimeType?: string | null;
  fileSize?: number | null;
  fileName?: string | null;
}

export interface AvatarPickerDeps {
  /** expo-image-picker's requestMediaLibraryPermissionsAsync. */
  requestPermission: () => Promise<{ granted: boolean }>;
  /** expo-image-picker's launchImageLibraryAsync. */
  launchPicker: () => Promise<{ canceled: boolean; assets?: PickedAvatarAsset[] | null }>;
  /** Reads the picked asset's local URI into whatever shape `uploadAvatarFn` accepts. */
  readAssetBytes: (uri: string) => Promise<unknown>;
  uploadAvatarFn: (input: UploadAvatarInput) => Promise<string>;
  updateFn: (userId: string, patch: ProfileUpdatePatch) => Promise<void>;
}

export type AvatarPickOutcome =
  | { status: 'updated'; avatarUrl: string }
  | { status: 'canceled' }
  | { status: 'error' };

/** Derives a Storage-safe extension from a picked asset's MIME type, falling back to its filename. */
export function extensionFromAsset(asset: PickedAvatarAsset): string {
  if (asset.mimeType === 'image/png') return 'png';
  if (asset.mimeType === 'image/jpeg') return 'jpg';
  const match = /\.([a-z0-9]{1,8})$/i.exec(asset.fileName ?? '');
  return match ? match[1]!.toLowerCase() : 'jpg';
}

/**
 * Pure(-ish, DI'd) avatar-pick orchestration (D-03/SET-10) — mirrors
 * `performProfileSave`'s testable-without-RNTL shape. Permission denial,
 * cancellation, a rejected asset (`validateAvatarAsset`) and an upload
 * failure all resolve to a terminal outcome without ever calling
 * `updateFn` — the previous avatar is left untouched on every failure path
 * (plan requirement).
 */
export async function performAvatarPick(userId: string, deps: AvatarPickerDeps): Promise<AvatarPickOutcome> {
  const permission = await deps.requestPermission();
  if (!permission.granted) {
    // Denied permission is a real user-facing outcome, never a silent
    // no-op/crash (plan §4: permission handling is a trust boundary).
    return { status: 'error' };
  }

  const result = await deps.launchPicker();
  const asset = result.canceled ? null : (result.assets?.[0] ?? null);
  if (!asset) {
    return { status: 'canceled' };
  }

  const validation = validateAvatarAsset({ mimeType: asset.mimeType, fileSize: asset.fileSize });
  if (!validation.valid) {
    return { status: 'error' };
  }

  try {
    const data = await deps.readAssetBytes(asset.uri);
    const extension = extensionFromAsset(asset);
    const avatarUrl = await deps.uploadAvatarFn({
      userId,
      extension,
      mimeType: asset.mimeType ?? 'image/jpeg',
      data,
    });
    await deps.updateFn(userId, { avatarUrl });
    return { status: 'updated', avatarUrl };
  } catch {
    return { status: 'error' };
  }
}

/**
 * Clears `avatar_url` back to empty (the "no avatar" state, rendered as the
 * initials fallback everywhere) — non-destructive/reversible, so the plan
 * calls for no confirmation dialog. Reuses the local PowerSync-routed half
 * of `profileRepo.update` (fullName/avatarUrl), same as a normal edit.
 */
export async function performAvatarRemove(
  userId: string,
  updateFn: (userId: string, patch: ProfileUpdatePatch) => Promise<void>,
): Promise<'updated' | 'error'> {
  try {
    await updateFn(userId, { avatarUrl: '' });
    return 'updated';
  } catch {
    return 'error';
  }
}

function ProfileEditContent({ db, userId }: { db: AbstractPowerSyncDatabase; userId: string }) {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const identity = useSessionIdentity();
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [fullName, setFullName] = useState('');
  const [initialFullName, setInitialFullName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [initialContactPhone, setInitialContactPhone] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [initialContactEmail, setInitialContactEmail] = useState('');
  const [errors, setErrors] = useState<ReturnType<typeof validateProfileEditForm>>({});
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [avatarPath, setAvatarPath] = useState<string | null>(null);
  const [avatarSignedUrl, setAvatarSignedUrl] = useState<string | null>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarError, setAvatarError] = useState(false);

  // Prefill: full_name/avatar_url come from the LOCAL synced table (fast,
  // offline-available); contact_phone/contact_email are NOT synced
  // (T-12-13-03) — a one-shot direct Supabase read of the rep's own row
  // (RLS-permitted, app_users_select).
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    void db
      .getAll<RawAppUserProfileRecord>('SELECT full_name, avatar_url FROM app_users WHERE id = ?', [userId])
      .then((rows) => {
        if (cancelled) return;
        const name = rows[0]?.full_name ?? identity.fullName ?? '';
        setFullName(name);
        setInitialFullName(name);
        setAvatarPath(rows[0]?.avatar_url || null);
      });
    return () => {
      cancelled = true;
    };
  }, [db, userId, identity.fullName]);

  // The avatars bucket is private (0073) — resolve a short-lived signed URL
  // at DISPLAY time only, never persist it (T-12-14-05, avatarUpload.ts doc).
  useEffect(() => {
    if (!avatarPath) {
      setAvatarSignedUrl(null);
      return;
    }
    let cancelled = false;
    void getSupabase()
      .storage.from(AVATARS_BUCKET)
      .createSignedUrl(avatarPath, 3600)
      .then(({ data }: { data: { signedUrl: string } | null }) => {
        if (!cancelled) setAvatarSignedUrl(data?.signedUrl ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, [avatarPath]);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    void getSupabase()
      .from('app_users')
      .select('contact_phone, contact_email')
      .eq('id', userId)
      .single()
      .then(({ data }: { data: { contact_phone: string | null; contact_email: string | null } | null }) => {
        if (cancelled || !data) return;
        setContactPhone(data.contact_phone ?? '');
        setInitialContactPhone(data.contact_phone ?? '');
        setContactEmail(data.contact_email ?? '');
        setInitialContactEmail(data.contact_email ?? '');
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const handleSave = async () => {
    const input: PerformProfileSaveInput = {
      fullName,
      initialFullName,
      contactPhone,
      initialContactPhone,
      contactEmail,
      initialContactEmail,
    };
    if (Object.keys(validateProfileEditForm({ fullName, contactEmail })).length === 0) {
      setSaveState('saving');
    }
    const repo = createProfileRepo({ db, supabase: getSupabase() });
    const result = await performProfileSave(input, userId, (id, patch) => repo.update(id, patch));
    setErrors(result.errors);
    setSaveState(result.saveState);
    if (result.saveState === 'saved') {
      if (result.patch.fullName !== undefined) setInitialFullName(result.patch.fullName);
      if (result.patch.contactPhone !== undefined) setInitialContactPhone(result.patch.contactPhone);
      if (result.patch.contactEmail !== undefined) setInitialContactEmail(result.patch.contactEmail);
    }
  };

  const handleAvatarPick = async () => {
    setAvatarError(false);
    setAvatarBusy(true);
    const repo = createProfileRepo({ db, supabase: getSupabase() });
    const outcome = await performAvatarPick(userId, {
      requestPermission: () => ImagePicker.requestMediaLibraryPermissionsAsync(),
      launchPicker: () => ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.9 }),
      // fetch() supports local file:// URIs in the Hermes/RN runtime — the
      // standard Expo pattern for turning an expo-image-picker result into
      // upload-ready bytes without a native FileSystem read.
      readAssetBytes: async (uri) => (await fetch(uri)).arrayBuffer(),
      uploadAvatarFn: (input) => uploadAvatar(input, { supabase: getSupabase() }),
      updateFn: (id, patch) => repo.update(id, patch),
    });
    setAvatarBusy(false);
    if (outcome.status === 'updated') {
      setAvatarPath(outcome.avatarUrl);
    } else if (outcome.status === 'error') {
      setAvatarError(true);
    }
  };

  const handleAvatarRemove = async () => {
    setAvatarError(false);
    setAvatarBusy(true);
    const repo = createProfileRepo({ db, supabase: getSupabase() });
    const outcome = await performAvatarRemove(userId, (id, patch) => repo.update(id, patch));
    setAvatarBusy(false);
    if (outcome === 'updated') {
      setAvatarPath(null);
    } else {
      setAvatarError(true);
    }
  };

  const saveCtaTitle =
    saveState === 'saving'
      ? t('profile.editSaving')
      : saveState === 'saved'
        ? t('profile.editSaved')
        : t('profile.editSaveCta');

  return (
    <View style={styles.container} testID="profile-edit-screen">
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable
          style={styles.backButton}
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
          onPress={() => navigation.goBack()}
          hitSlop={8}
        >
          <MaterialCommunityIcons name="chevron-left" size={26} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.title}>{t('profile.editTitle')}</Text>
      </View>

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xl }]}>
        <View style={styles.avatarRow}>
          <Pressable
            style={styles.avatar}
            accessibilityRole="button"
            accessibilityLabel={t('profile.editAvatarCta')}
            onPress={() => void handleAvatarPick()}
            disabled={avatarBusy}
            hitSlop={8}
          >
            {avatarSignedUrl ? (
              <Image source={{ uri: avatarSignedUrl }} style={styles.avatarImage} />
            ) : (
              <Text style={styles.avatarText}>{identity.initials}</Text>
            )}
          </Pressable>
          <Text style={styles.avatarCtaLabel}>{t('profile.editAvatarCta')}</Text>
          {avatarPath ? (
            <Pressable accessibilityRole="button" onPress={() => void handleAvatarRemove()} disabled={avatarBusy}>
              <Text style={styles.avatarRemoveLabel}>{t('profile.editAvatarRemove')}</Text>
            </Pressable>
          ) : null}
        </View>

        {avatarError ? <Text style={styles.errorBanner}>{t('profile.editErrorGeneric')}</Text> : null}

        <View style={styles.card}>
          <TextField
            label={t('profile.editNameLabel')}
            value={fullName}
            onChangeText={(value) => {
              setFullName(value);
              if (errors.fullName) setErrors((prev) => ({ ...prev, fullName: undefined }));
            }}
            placeholder={t('profile.editNamePlaceholder')}
            errorText={errors.fullName ? t(errors.fullName) : null}
            accessibilityLabel={t('profile.editNameLabel')}
          />
          <TextField
            label={t('profile.editPhoneLabel')}
            value={contactPhone}
            onChangeText={setContactPhone}
            keyboardType="phone-pad"
            accessibilityLabel={t('profile.editPhoneLabel')}
          />
          <TextField
            label={t('profile.editEmailLabel')}
            value={contactEmail}
            onChangeText={(value) => {
              setContactEmail(value);
              if (errors.contactEmail) setErrors((prev) => ({ ...prev, contactEmail: undefined }));
            }}
            keyboardType="email-address"
            autoCapitalize="none"
            errorText={errors.contactEmail ? t(errors.contactEmail) : null}
            accessibilityLabel={t('profile.editEmailLabel')}
          />
        </View>

        {saveState === 'error' ? <Text style={styles.errorBanner}>{t('profile.editErrorGeneric')}</Text> : null}

        <Button
          title={saveCtaTitle}
          onPress={() => void handleSave()}
          loading={saveState === 'saving'}
        />
      </ScrollView>
    </View>
  );
}

function makeStyles(colors: ReturnType<typeof useThemeColors>) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingBottom: spacing.md,
    },
    backButton: {
      width: spacing.touchTarget,
      height: spacing.touchTarget,
      borderRadius: radius.input,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    title: { ...typography.display, color: colors.textPrimary },
    content: { paddingHorizontal: spacing.md + spacing.xs, gap: spacing.md },
    avatarRow: { alignItems: 'center', marginBottom: spacing.sm },
    avatar: {
      width: 56,
      height: 56,
      borderRadius: radius.card,
      backgroundColor: colors.ink,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarText: { ...typography.heading, color: colors.onAccent },
    avatarImage: { width: 56, height: 56, borderRadius: radius.card },
    avatarCtaLabel: {
      ...typography.label,
      fontWeight: '600',
      color: colors.accentText,
      marginTop: spacing.sm,
    },
    avatarRemoveLabel: {
      ...typography.label,
      color: colors.textSecondary,
      marginTop: spacing.xs,
    },
    card: {
      backgroundColor: colors.surface,
      borderRadius: radius.card,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.md + 2,
    },
    errorBanner: { ...typography.label, color: colors.destructive, textAlign: 'center' },
  });
}
