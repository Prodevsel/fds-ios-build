import { useMemo, type ReactNode } from 'react';
import {
  Animated,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useReducedMotion } from './useReducedMotion';
import { useSwipeToDismiss } from './useSwipeToDismiss';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  radius,
  spacing,
  statusColor,
  statusIcon,
  typography,
  type HouseStatus,
} from '../design/tokens';
import { useThemeColors } from '../features/settings/theme/useThemeColors';
import { t, type TranslationKey } from '../i18n';

type MciName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

/**
 * InfoSheet — the single reusable "quality-of-life" (QoL) primitive that carries
 * the tablet design's help/legend/explainer affordances onto the phone form
 * factor. The tablet expresses these as side panels and hover popovers; on the
 * phone they all funnel through ONE bottom sheet plus a small set of inline
 * companions, so no screen re-authors this styling:
 *
 *  - `InfoSheet`       controlled bottom-sheet shell (grabber, title, close).
 *  - `InfoSheetSection` a titled block inside the sheet (icon + heading + body).
 *  - `InfoLegendRow`   a coloured dot/glyph + label + meaning row (pin legend).
 *  - `HintRow`         an inline tinted hint strip for contextual explainers
 *                      (Widerruf Pflichtschritt, IBAN encryption, do-not-knock).
 *  - `InfoIconButton`  the "?"/info trigger affordance that opens a sheet.
 *
 * Everything is token-driven (colours, radii, spacing, typography) — never
 * hardcoded — and all end-user copy comes through the typed `t()` accessor.
 */

export interface InfoSheetProps {
  visible: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  /** testID forwarded to the sheet surface (default "info-sheet"). */
  testID?: string;
}

export function InfoSheet({
  visible,
  onClose,
  title,
  subtitle,
  children,
  testID = 'info-sheet',
}: InfoSheetProps) {
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  const { translateY, panHandlers } = useSwipeToDismiss({ onClose, reducedMotion });
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable
        style={styles.backdrop}
        accessibilityRole="button"
        accessibilityLabel={t('common.closeSheet')}
        onPress={onClose}
      />
      <View style={styles.sheetAnchor} pointerEvents="box-none">
        <Animated.View
          style={[
            styles.sheet,
            { paddingBottom: insets.bottom + spacing.lg, transform: [{ translateY }] },
          ]}
          testID={testID}
        >
          {/* Grabber + header double as the swipe-down-to-dismiss drag zone —
              attached here (not the ScrollView) so scrolling content still
              scrolls. */}
          <View {...panHandlers}>
            <View style={styles.handle} />
            <View style={styles.headerRow}>
            <View style={styles.headerText}>
              <Text style={styles.title}>{title}</Text>
              {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
            </View>
            <Pressable
              style={styles.closeIcon}
              accessibilityRole="button"
              accessibilityLabel={t('common.closeSheet')}
              onPress={onClose}
            >
              <MaterialCommunityIcons name="close" size={20} color={colors.textSecondary} />
            </Pressable>
            </View>
          </View>
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {children}
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

/**
 * A titled block inside an InfoSheet (icon + heading, then either `body` copy or
 * arbitrary `children` — e.g. a list of `InfoLegendRow`s under the heading).
 */
export function InfoSheetSection({
  iconName,
  heading,
  body,
  children,
}: {
  iconName?: MciName;
  heading: string;
  body?: string;
  children?: ReactNode;
}) {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeadingRow}>
        {iconName ? (
          <MaterialCommunityIcons name={iconName} size={18} color={colors.textSecondary} />
        ) : null}
        <Text style={styles.sectionHeading}>{heading}</Text>
      </View>
      {body ? <Text style={styles.sectionBody}>{body}</Text> : null}
      {children}
    </View>
  );
}

/** One legend/status-meaning row: a coloured dot (+ optional glyph) with a label and meaning. */
export function InfoLegendRow({
  dotColor,
  iconName,
  label,
  meaning,
}: {
  dotColor: string;
  iconName?: MciName;
  label: string;
  meaning?: string;
}) {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.legendRow}>
      <View style={[styles.legendDot, { backgroundColor: dotColor }]}>
        {iconName ? <MaterialCommunityIcons name={iconName} size={14} color={colors.onAccent} /> : null}
      </View>
      <View style={styles.legendText}>
        <Text style={styles.legendLabel}>{label}</Text>
        {meaning ? <Text style={styles.legendMeaning}>{meaning}</Text> : null}
      </View>
    </View>
  );
}

export type HintTone = 'neutral' | 'danger';

/**
 * Inline tinted hint strip (icon + copy) for contextual explainers placed
 * directly in the flow — the phone analogue of the tablet's inline hint rows.
 * `danger` tone carries the do-not-knock / blocked framing (brick tint).
 */
export function HintRow({
  iconName,
  children,
  tone = 'neutral',
  title,
  style,
  testID,
}: {
  iconName: MciName;
  children: ReactNode;
  tone?: HintTone;
  /** Optional bold lead-in line above the body (e.g. "Beratung gesperrt"). */
  title?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const danger = tone === 'danger';
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={[styles.hintRow, danger ? styles.hintRowDanger : null, style]} testID={testID}>
      <MaterialCommunityIcons
        name={iconName}
        size={18}
        color={danger ? colors.brick : colors.textSecondary}
        style={styles.hintIcon}
      />
      <View style={styles.hintTextWrap}>
        {title ? (
          <Text style={[styles.hintTitle, danger ? styles.hintTitleDanger : null]}>{title}</Text>
        ) : null}
        <Text style={[styles.hintBody, danger ? styles.hintBodyDanger : null]}>{children}</Text>
      </View>
    </View>
  );
}

export type InfoIconButtonVariant = 'inline' | 'mapControl';

/**
 * The "?"/info trigger affordance. `mapControl` is the floating white "?" map
 * control from the phone design SSOT; `inline` is a compact information glyph
 * used next to a label inside a screen. Both open an InfoSheet via `onPress`.
 */
export function InfoIconButton({
  onPress,
  accessibilityLabel,
  variant = 'inline',
  style,
  testID,
}: {
  onPress: () => void;
  accessibilityLabel: string;
  variant?: InfoIconButtonVariant;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <Pressable
      style={[variant === 'mapControl' ? styles.mapControl : styles.inlineButton, style]}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={variant === 'inline' ? spacing.sm : undefined}
      onPress={onPress}
      testID={testID}
    >
      {variant === 'mapControl' ? (
        <Text style={styles.mapControlGlyph}>?</Text>
      ) : (
        <MaterialCommunityIcons name="information-outline" size={20} color={colors.textSecondary} />
      )}
    </Pressable>
  );
}

export interface StatusLegendEntry {
  status: HouseStatus;
  color: string;
  iconName: MciName;
  label: string;
  meaning: string;
}

// Map legend order, roughly "still to do" -> "done": Neu · Nicht angetroffen ·
// Wiedervorlage · Kein Interesse · Abschluss · Keine Ansprache. The legal lock
// sits last because it is the rarest and the heaviest.
const LEGEND_ORDER: HouseStatus[] = [
  'new',
  'not_home',
  'follow_up',
  'no_interest',
  'success',
  'blacklist',
];
const STATUS_MEANING_KEY: Record<HouseStatus, TranslationKey> = {
  new: 'help.statusMeaningNew',
  not_home: 'help.statusMeaningNotHome',
  follow_up: 'help.statusMeaningFollowUp',
  no_interest: 'help.statusMeaningNoInterest',
  success: 'help.statusMeaningSuccess',
  blacklist: 'help.statusMeaningBlacklist',
};

/**
 * Pure, exported: the six house-status legend entries, each pairing its
 * traffic-light colour + glyph (from the design tokens — never colour alone,
 * colourblind-safe) with the German label and one-line meaning. Drives both the
 * Karte help sheet's Pin-Legende and the StatusSheet's status-meaning sheet from
 * a single source, so the two can never drift.
 */
export function buildStatusLegend(): StatusLegendEntry[] {
  return LEGEND_ORDER.map((status) => ({
    status,
    color: statusColor[status],
    iconName: statusIcon[status] as MciName,
    label: t(`status.${status}` as TranslationKey),
    meaning: t(STATUS_MEANING_KEY[status]),
  }));
}

function makeStyles(colors: ReturnType<typeof useThemeColors>) {
  return StyleSheet.create({
    backdrop: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(13,22,38,0.35)',
    },
    sheetAnchor: {
      flex: 1,
      justifyContent: 'flex-end',
    },
    sheet: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: 26,
      borderTopRightRadius: 26,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.md,
      maxHeight: '82%',
      elevation: 12,
      shadowColor: colors.ink,
      shadowOpacity: 0.28,
      shadowRadius: 24,
      shadowOffset: { width: 0, height: -12 },
    },
    handle: {
      alignSelf: 'center',
      width: 44,
      height: 5,
      borderRadius: 3,
      backgroundColor: colors.subtleFill,
      marginBottom: spacing.md,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: spacing.sm,
    },
    headerText: { flex: 1, minWidth: 0 },
    title: { ...typography.heading, color: colors.textPrimary },
    subtitle: { ...typography.label, color: colors.textSecondary, marginTop: 2 },
    closeIcon: {
      width: spacing.touchTarget,
      height: spacing.touchTarget,
      borderRadius: radius.input,
      backgroundColor: colors.paper,
      alignItems: 'center',
      justifyContent: 'center',
    },
    scroll: { marginTop: spacing.md },
    scrollContent: { paddingBottom: spacing.sm },
    section: { marginBottom: spacing.lg },
    sectionHeadingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm - 2, marginBottom: spacing.xs + 2 },
    sectionHeading: { ...typography.label, fontWeight: '600', color: colors.textPrimary },
    sectionBody: { ...typography.body, color: colors.textSecondary, lineHeight: 22 },
    legendRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 2, paddingVertical: spacing.sm },
    legendDot: {
      width: 24,
      height: 24,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
    },
    legendText: { flex: 1, minWidth: 0 },
    legendLabel: { ...typography.body, fontWeight: '600', color: colors.textPrimary },
    legendMeaning: { ...typography.label, color: colors.textSecondary, marginTop: 1 },
    hintRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.sm + 2,
      backgroundColor: colors.subtleFill,
      borderRadius: radius.input,
      padding: spacing.md - 2,
    },
    hintRowDanger: {
      backgroundColor: 'rgba(192,54,44,0.08)',
      borderWidth: 1.5,
      borderColor: 'rgba(192,54,44,0.30)',
    },
    hintIcon: { marginTop: 1 },
    hintTextWrap: { flex: 1, minWidth: 0 },
    hintTitle: { ...typography.body, fontWeight: '600', color: colors.textPrimary, marginBottom: 2 },
    hintTitleDanger: { color: colors.brick },
    hintBody: { ...typography.label, color: colors.noticeText, lineHeight: 20 },
    hintBodyDanger: { color: colors.brick },
    inlineButton: {
      minWidth: spacing.touchTarget,
      minHeight: spacing.touchTarget,
      alignItems: 'center',
      justifyContent: 'center',
    },
    mapControl: {
      width: 52,
      height: 52,
      borderRadius: radius.card - 2,
      backgroundColor: colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
      elevation: 4,
      shadowColor: colors.ink,
      shadowOpacity: 0.28,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 6 },
    },
    mapControlGlyph: { ...typography.heading, color: colors.textPrimary },
  });
}
