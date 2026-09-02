import { describe, expect, it, vi } from 'vitest';

// No react-native-testing-library in this repo (SegmentedControl.test.tsx /
// InfoSheet.test.tsx precedent) — test the exported pure/DI'd logic
// (`isValidEmailShape`, `validateProfileEditForm`, `buildEditPatch`,
// `performProfileSave`) directly, never mount the component. ProfileEditScreen.tsx
// imports react-native + @expo/vector-icons + @react-navigation/native +
// react-native-safe-area-context at module scope, plus transitively pulls in
// ThemeProvider/AccessibilityProvider/DbBoundary/getSupabase's own native
// dependencies via useThemeColors/DbBoundary/useSessionIdentity — all stubbed
// here at the module boundary (mirrors InfoSheet.test.tsx's precedent), even
// though none of these are ever actually invoked (this file never mounts a
// component).
vi.mock('react-native', () => ({
  Image: () => null,
  Pressable: () => null,
  ScrollView: () => null,
  StyleSheet: { create: (s: unknown) => s },
  Text: () => null,
  View: () => null,
  Appearance: { getColorScheme: () => 'light', addChangeListener: vi.fn() },
}));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
vi.mock('@expo/vector-icons', () => ({ MaterialCommunityIcons: () => null }));
vi.mock('@react-navigation/native', () => ({ useNavigation: () => ({ goBack: vi.fn() }) }));
vi.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: vi.fn(),
  launchImageLibraryAsync: vi.fn(),
}));
vi.mock('../../app/useSessionDb', () => ({
  useSessionDb: () => ({ db: null, userId: null, ready: false }),
}));
vi.mock('../settings/settingsCache', () => ({
  createSettingsCache: () => ({ get: () => null, set: () => {} }),
}));
vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageCode: 'en' }],
}));
vi.mock('../../lib/auth/supabase', () => ({
  getSupabase: () => ({
    auth: { getSession: async () => ({ data: { session: null } }) },
    from: () => ({
      select: () => ({ eq: () => ({ single: async () => ({ data: null }) }) }),
      update: () => ({ eq: async () => ({ error: null }) }),
    }),
  }),
}));

import {
  buildEditPatch,
  extensionFromAsset,
  isValidEmailShape,
  performAvatarPick,
  performAvatarRemove,
  performProfileSave,
  validateProfileEditForm,
} from './ProfileEditScreen';

describe('isValidEmailShape', () => {
  it('accepts a well-formed address', () => {
    expect(isValidEmailShape('erika@example.com')).toBe(true);
  });

  it('rejects a malformed address', () => {
    expect(isValidEmailShape('not-an-email')).toBe(false);
  });
});

describe('validateProfileEditForm', () => {
  it('flags an empty display name with profile.editErrorNameRequired', () => {
    const errors = validateProfileEditForm({ fullName: '', contactEmail: '' });
    expect(errors.fullName).toBe('profile.editErrorNameRequired');
  });

  it('flags a whitespace-only display name as empty', () => {
    const errors = validateProfileEditForm({ fullName: '   ', contactEmail: '' });
    expect(errors.fullName).toBe('profile.editErrorNameRequired');
  });

  it('flags a malformed contact email with profile.editErrorInvalidEmail', () => {
    const errors = validateProfileEditForm({ fullName: 'Erika Musterfrau', contactEmail: 'not-an-email' });
    expect(errors.contactEmail).toBe('profile.editErrorInvalidEmail');
  });

  it('allows an empty contact email (optional field)', () => {
    const errors = validateProfileEditForm({ fullName: 'Erika Musterfrau', contactEmail: '' });
    expect(errors.contactEmail).toBeUndefined();
  });

  it('returns no errors for a valid name and email', () => {
    const errors = validateProfileEditForm({ fullName: 'Erika Musterfrau', contactEmail: 'erika@example.com' });
    expect(errors).toEqual({});
  });
});

describe('buildEditPatch', () => {
  it('includes only fields that changed from their initial value', () => {
    const patch = buildEditPatch({
      fullName: 'Erika Musterfrau',
      initialFullName: 'Erika Musterfrau',
      contactPhone: '+49 170 1234567',
      initialContactPhone: '',
      contactEmail: '',
      initialContactEmail: '',
    });
    expect(patch).toEqual({ contactPhone: '+49 170 1234567' });
  });

  it('includes full_name, contact_phone and contact_email together when all changed', () => {
    const patch = buildEditPatch({
      fullName: 'Erika Musterfrau',
      initialFullName: 'Old Name',
      contactPhone: '+49 170 1234567',
      initialContactPhone: '',
      contactEmail: 'erika@example.com',
      initialContactEmail: '',
    });
    expect(patch).toEqual({
      fullName: 'Erika Musterfrau',
      contactPhone: '+49 170 1234567',
      contactEmail: 'erika@example.com',
    });
  });
});

describe('performProfileSave', () => {
  const baseInput = {
    fullName: 'Erika Musterfrau',
    initialFullName: 'Old Name',
    contactPhone: '+49 170 1234567',
    initialContactPhone: '',
    contactEmail: 'erika@example.com',
    initialContactEmail: '',
  };

  it('blocks the save and returns profile.editErrorNameRequired for an empty display name', async () => {
    const updateFn = vi.fn(async () => {});
    const result = await performProfileSave({ ...baseInput, fullName: '' }, 'rep-1', updateFn);

    expect(result.errors.fullName).toBe('profile.editErrorNameRequired');
    expect(updateFn).not.toHaveBeenCalled();
  });

  it('calls profileRepo.update exactly once with only the whitelisted, changed fields on a valid save', async () => {
    const updateFn = vi.fn(async () => {});
    const result = await performProfileSave(baseInput, 'rep-1', updateFn);

    expect(updateFn).toHaveBeenCalledExactlyOnceWith('rep-1', {
      fullName: 'Erika Musterfrau',
      contactPhone: '+49 170 1234567',
      contactEmail: 'erika@example.com',
    });
    expect(result.saveState).toBe('saved');
  });

  it('surfaces the generic error state (profile.editErrorGeneric) when the write rejects', async () => {
    const updateFn = vi.fn(async () => {
      throw new Error('app_users update failed');
    });
    const result = await performProfileSave(baseInput, 'rep-1', updateFn);

    expect(result.saveState).toBe('error');
  });

  it('is a no-op write (saved, no updateFn call) when nothing actually changed', async () => {
    const updateFn = vi.fn(async () => {});
    const result = await performProfileSave(
      { ...baseInput, fullName: 'Old Name', contactPhone: '', contactEmail: '' },
      'rep-1',
      updateFn,
    );

    expect(updateFn).not.toHaveBeenCalled();
    expect(result.saveState).toBe('saved');
  });
});

describe('extensionFromAsset', () => {
  it('derives jpg from image/jpeg', () => {
    expect(extensionFromAsset({ uri: 'file://x', mimeType: 'image/jpeg' })).toBe('jpg');
  });

  it('derives png from image/png', () => {
    expect(extensionFromAsset({ uri: 'file://x', mimeType: 'image/png' })).toBe('png');
  });

  it('falls back to the filename extension when mimeType is absent', () => {
    expect(extensionFromAsset({ uri: 'file://x', fileName: 'photo.HEIC' })).toBe('heic');
  });

  it('falls back to jpg when neither mimeType nor filename yield an extension', () => {
    expect(extensionFromAsset({ uri: 'file://x' })).toBe('jpg');
  });
});

describe('performAvatarPick', () => {
  function makeDeps(overrides: Partial<Parameters<typeof performAvatarPick>[1]> = {}) {
    return {
      requestPermission: vi.fn(async () => ({ granted: true })),
      launchPicker: vi.fn(async () => ({
        canceled: false,
        assets: [{ uri: 'file://photo.jpg', mimeType: 'image/jpeg', fileSize: 1024 }],
      })),
      readAssetBytes: vi.fn(async () => new Uint8Array([1, 2, 3])),
      uploadAvatarFn: vi.fn(async () => 'rep-1/avatar.jpg'),
      updateFn: vi.fn(async () => {}),
      ...overrides,
    };
  }

  it('denies before ever calling the picker when permission is denied, and surfaces an error', async () => {
    const deps = makeDeps({ requestPermission: vi.fn(async () => ({ granted: false })) });
    const outcome = await performAvatarPick('rep-1', deps);

    expect(outcome.status).toBe('error');
    expect(deps.launchPicker).not.toHaveBeenCalled();
    expect(deps.uploadAvatarFn).not.toHaveBeenCalled();
  });

  it('returns canceled and calls neither uploadAvatarFn nor updateFn when the user cancels the picker', async () => {
    const deps = makeDeps({ launchPicker: vi.fn(async () => ({ canceled: true })) });
    const outcome = await performAvatarPick('rep-1', deps);

    expect(outcome.status).toBe('canceled');
    expect(deps.uploadAvatarFn).not.toHaveBeenCalled();
    expect(deps.updateFn).not.toHaveBeenCalled();
  });

  it('rejects an unsupported asset with 0 calls to uploadAvatarFn', async () => {
    const deps = makeDeps({
      launchPicker: vi.fn(async () => ({
        canceled: false,
        assets: [{ uri: 'file://photo.gif', mimeType: 'image/gif', fileSize: 1024 }],
      })),
    });
    const outcome = await performAvatarPick('rep-1', deps);

    expect(outcome.status).toBe('error');
    expect(deps.uploadAvatarFn).not.toHaveBeenCalled();
  });

  it('on a successful pick, calls uploadAvatarFn then updateFn exactly once with the returned path', async () => {
    const deps = makeDeps();
    const outcome = await performAvatarPick('rep-1', deps);

    expect(outcome).toEqual({ status: 'updated', avatarUrl: 'rep-1/avatar.jpg' });
    expect(deps.uploadAvatarFn).toHaveBeenCalledExactlyOnceWith({
      userId: 'rep-1',
      extension: 'jpg',
      mimeType: 'image/jpeg',
      data: expect.any(Uint8Array),
    });
    expect(deps.updateFn).toHaveBeenCalledExactlyOnceWith('rep-1', { avatarUrl: 'rep-1/avatar.jpg' });
  });

  it('surfaces an error and leaves the previous avatar untouched when uploadAvatarFn rejects', async () => {
    const deps = makeDeps({
      uploadAvatarFn: vi.fn(async () => {
        throw new Error('upload failed');
      }),
    });
    const outcome = await performAvatarPick('rep-1', deps);

    expect(outcome.status).toBe('error');
    expect(deps.updateFn).not.toHaveBeenCalled();
  });
});

describe('performAvatarRemove', () => {
  it('clears avatar_url via updateFn and returns updated', async () => {
    const updateFn = vi.fn(async () => {});
    const outcome = await performAvatarRemove('rep-1', updateFn);

    expect(outcome).toBe('updated');
    expect(updateFn).toHaveBeenCalledExactlyOnceWith('rep-1', { avatarUrl: '' });
  });

  it('returns error when updateFn rejects', async () => {
    const updateFn = vi.fn(async () => {
      throw new Error('write failed');
    });
    const outcome = await performAvatarRemove('rep-1', updateFn);

    expect(outcome).toBe('error');
  });
});
