import { useEffect, useMemo, useState } from 'react';
import {
  Animated,
  BackHandler,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { AbstractPowerSyncDatabase } from '@powersync/common';
import {
  radius,
  spacing,
  statusColor,
  statusIcon,
  typography,
  type HouseStatus,
} from '../../design/tokens';
import { useThemeColors } from '../settings/theme/useThemeColors';
import { t } from '../../i18n';
import { Button } from '../../ui/Button';
import {
  InfoSheet,
  InfoSheetSection,
  InfoLegendRow,
  InfoIconButton,
  HintRow,
  buildStatusLegend,
} from '../../ui/InfoSheet';
import { useReducedMotion } from '../../ui/useReducedMotion';
import { useSwipeToDismiss } from '../../ui/useSwipeToDismiss';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { maxSheetHeight } from './mapChrome';
import { createHousesRepo, type HouseRow } from './db/housesRepo';
import {
  deriveBuildingStatus,
  hasNoSolicitationLock,
  normalizeUnitCount,
  planUnitSync,
} from './buildingStatus';
import { reverseGeocode } from './reverseGeocode';
import { createAppointmentsRepo, type AppointmentsRepo } from '../termine/db/appointmentsRepo';
import {
  buildFollowUpPresets,
  defaultFollowUpDate,
  useFollowUpSchedule,
  type FollowUpPresetKey,
} from './useFollowUpSchedule';
import { createFlowDraftsRepo, type FlowDraftsRepo } from '../flow-runner/db/flowDraftsRepo';
import {
  createProductDefinitionsRepo,
  type ProductDefinitionRow,
} from '../flow-runner/db/productDefinitionsRepo';
import { ConsultationFlow } from '../flow-runner/ConsultationFlow';
import { lookupOffer } from '../flow-runner/offerCode';

/**
 * D-09 is closed: the sheet lists every product `productDefinitionsRepo
 * .listSellable()` finds on the device, so a rep carrying two partners'
 * catalogues can start either one. What is sellable is decided by RLS and the
 * sync stream, never by the build.
 *
 * This constant survives as the LAST-RESORT product for a redeemed offer whose
 * frozen snapshot carries no slug — an offer written before the snapshot
 * included one. Everything else reads the list.
 *
 * (It has been wrong before: it once pointed at 'glasfaser-home', a file under
 * products/ that was never published anywhere, so "Beratung starten" failed
 * with "no product definition locally available" on every device, always. A
 * slug constant nothing matches fails at the last step of the funnel and looks
 * exactly like a sync problem. One more reason for the list to be the source.)
 */
const DEMO_PRODUCT_SLUG = 'smaica-social-media';

/**
 * MAP-02 / MAP-05: the tap-to-drop-pin bottom sheet (UI-SPEC "Tap-to-drop-pin
 * flow"). A single sheet, three states:
 *  1. Status grid (4 buttons ≥64dp) — tapping New/Success/Follow-up writes
 *     the status immediately (reversible, no confirmation).
 *  2. Follow-up inline picker — revealed after tapping "Wiedervorlage",
 *     defaults to `defaultFollowUpDate()` (tomorrow, next 30-min rounding).
 *  3. Blacklist destructive confirm — revealed after tapping "Blacklist";
 *     the blacklist_entries row is only written on confirm, never on the tap.
 *
 * Owns the housesRepo write calls and useFollowUpSchedule directly (not
 * delegated to the caller) — MapScreen only supplies `db`/`teamId`/`createdBy`
 * and the tap target (a fresh point, or an existing house to reopen
 * pre-selected).
 */

export type StatusSheetTarget =
  /**
   * `address` is set only when the point came from the map's address search —
   * the rep searched a street, jumped there and pressed "Pin setzen", so the
   * address is known before the row exists. A plain map tap leaves it
   * undefined and the sheet resolves one after the insert, as it always has.
   */
  | { mode: 'create'; lngLat: [number, number]; address?: string }
  | { mode: 'edit'; house: HouseRow };

export interface StatusSheetProps {
  visible: boolean;
  /**
   * Height of the container this sheet is positioned inside, measured by the
   * host. Null until the host's first onLayout, and the window is used for that
   * one frame. NOT the window height — see maxSheetHeight.
   */
  availableHeight: number | null;
  db: AbstractPowerSyncDatabase;
  teamId: string;
  createdBy: string;
  target: StatusSheetTarget;
  onDismiss: () => void;
  /** D-11: optional pass-through to the success screen's secondary CTA ("Meine Abschlüsse", 04-09). */
  onViewContracts?: () => void;
}

// Roughly "still to do" -> "done": Neu · Nicht angetroffen · Wiedervorlage ·
// Kein Interesse · Abschluss · Keine Ansprache. Six wraps to two rows of three
// (see `statusTrack`); the legal lock sits last because it is the rarest and
// the only one that is not undoable by the rep.
const STATUS_ORDER: HouseStatus[] = [
  'new',
  'not_home',
  'follow_up',
  'no_interest',
  'success',
  'blacklist',
];

/** i18n label key for each follow-up preset chip. */
const PRESET_LABEL_KEY: Record<FollowUpPresetKey, Parameters<typeof t>[0]> = {
  today18: 'followUp.presetToday18',
  tomorrow11: 'followUp.presetTomorrow11',
  in3days: 'followUp.presetIn3Days',
  nextWeek: 'followUp.presetNextWeek',
};

/** Structural slice of HousesRepo the pure core logic below depends on (injectable for tests). */
export type StatusSheetRepo = Pick<
  ReturnType<typeof createHousesRepo>,
  | 'insertHouseAtPoint'
  | 'setStatus'
  | 'setNote'
  | 'setAddress'
  | 'addBlacklistEntry'
  // 0088: the party (Partei) half of the sheet.
  | 'insertUnit'
  | 'setUnitLabel'
  | 'setUnitCount'
>;

function targetPoint(target: StatusSheetTarget): [number, number] {
  return target.mode === 'edit' ? [target.house.lon, target.house.lat] : target.lngLat;
}

export interface WriteHouseStatusParams {
  repo: StatusSheetRepo;
  target: StatusSheetTarget;
  activeHouseId: string | null;
  status: HouseStatus;
  teamId: string;
  createdBy: string;
}

/**
 * Pure, DI'd core write logic (mirrors useSkeletonFlow.test.ts's pattern —
 * test the logic directly against a fake repo, never render/mount the
 * component). Creates the house on first write (create mode) or updates it
 * (edit mode / after the id has already been created once this sheet open).
 */
export async function writeHouseStatus(params: WriteHouseStatusParams): Promise<string> {
  const { repo, target, activeHouseId, status, teamId, createdBy } = params;
  if (activeHouseId) {
    await repo.setStatus(activeHouseId, status);
    return activeHouseId;
  }
  const [lon, lat] = targetPoint(target);
  return repo.insertHouseAtPoint({
    lngLat: [lon, lat],
    status,
    teamId,
    createdBy,
    address: target.mode === 'create' ? (target.address ?? null) : null,
  });
}

export interface SaveHouseNoteParams {
  repo: StatusSheetRepo;
  target: StatusSheetTarget;
  activeHouseId: string | null;
  teamId: string;
  createdBy: string;
  /** Trimmed note text, or null to clear it. */
  note: string | null;
}

/**
 * Persists the house's free-text note (0060_houses_note.sql). Ensures a house
 * row exists first (create-mode pins have no id until the first write) — the
 * note is a legitimate reason to materialize the pin, defaulting a fresh pin to
 * 'new' (edit mode keeps its current status). Offline-capable via the
 * PowerSync houses write path (repo.setNote). Pure/DI'd, unit-tested directly.
 */
export async function saveHouseNote(params: SaveHouseNoteParams): Promise<string> {
  const { repo, target, activeHouseId, teamId, createdBy, note } = params;
  const houseId =
    activeHouseId ??
    (await writeHouseStatus({
      repo,
      target,
      activeHouseId,
      status: target.mode === 'edit' ? target.house.status : 'new',
      teamId,
      createdBy,
    }));
  await repo.setNote(houseId, note);
  return houseId;
}

/** Structural slice of FlowDraftsRepo the pure consultation-start logic below depends on (injectable for tests). */
export type StatusSheetFlowDraftsRepo = Pick<FlowDraftsRepo, 'getDraftForHouse'>;

export interface StartConsultationParams {
  repo: StatusSheetRepo;
  flowDraftsRepo: StatusSheetFlowDraftsRepo;
  target: StatusSheetTarget;
  activeHouseId: string | null;
  teamId: string;
  createdBy: string;
}

/**
 * "Beratung starten" (D-04): ensures a house row exists at the tap point
 * (reusing writeHouseStatus, same as any other one-tap status write — the
 * flow needs a house_id to attach to), then checks for an existing
 * in_progress draft to resume instead of silently starting a duplicate one.
 */
export async function startConsultation(
  params: StartConsultationParams,
): Promise<{ houseId: string; resuming: boolean }> {
  const { repo, flowDraftsRepo, target, activeHouseId, teamId, createdBy } = params;
  const houseId =
    activeHouseId ??
    (await writeHouseStatus({
      repo,
      target,
      activeHouseId,
      status: target.mode === 'edit' ? target.house.status : 'new',
      teamId,
      createdBy,
    }));
  const existingDraft = await flowDraftsRepo.getDraftForHouse(houseId);
  return { houseId, resuming: existingDraft !== null };
}

export interface ConfirmBlacklistParams {
  repo: StatusSheetRepo;
  target: StatusSheetTarget;
  activeHouseId: string | null;
  teamId: string;
  createdBy: string;
}

/** MAP-05: writes the 'blacklist' status THEN the GDPR-minimal blacklist_entries row — only called after the destructive confirm. */
export async function confirmBlacklist(
  params: ConfirmBlacklistParams,
): Promise<{ houseId: string; blacklistId: string }> {
  const houseId = await writeHouseStatus({ ...params, status: 'blacklist' });
  const [lon, lat] = targetPoint(params.target);
  const blacklistId = await params.repo.addBlacklistEntry({
    teamId: params.teamId,
    createdBy: params.createdBy,
    lat,
    lon,
    houseId,
  });
  return { houseId, blacklistId };
}

/** Structural slice of AppointmentsRepo the follow-up producer depends on (injectable for tests). */
export type StatusSheetAppointmentsRepo = Pick<AppointmentsRepo, 'createFollowUpAppointment'>;

export interface SaveFollowUpParams {
  repo: StatusSheetRepo;
  appointmentsRepo: StatusSheetAppointmentsRepo;
  target: StatusSheetTarget;
  activeHouseId: string | null;
  teamId: string;
  createdBy: string;
  when: Date;
  scheduleFollowUp: (houseId: string, when: Date) => Promise<boolean>;
}

/**
 * MAP-02: persists follow_up_at, creates the real Folgetermin (appointments
 * row — design SSOT "Follow-up setzt einen Folgetermin"), THEN schedules the
 * exact-time OS notification. The appointment carries rep_id (the acting rep),
 * team_id (the house's visible team) and house_id so the Termine/Aktuelles/
 * Suche/Profil screens fill from this real write, not seed fixtures. Address/
 * floor stay null — the GDPR-minimal houses table has no address to copy (the
 * documented gap in mobile-map.md); never faked.
 */
export async function saveFollowUp(params: SaveFollowUpParams): Promise<string> {
  const houseId = await writeHouseStatus({ ...params, status: 'follow_up' });
  await params.repo.setStatus(houseId, 'follow_up', params.when.toISOString());
  await params.appointmentsRepo.createFollowUpAppointment({
    repId: params.createdBy,
    teamId: params.teamId,
    houseId,
    scheduledAt: params.when,
  });
  await params.scheduleFollowUp(houseId, params.when);
  return houseId;
}

export interface ApplyUnitCountParams {
  repo: StatusSheetRepo;
  buildingId: string;
  existingUnits: HouseRow[];
  desiredCount: number;
  teamId: string;
  createdBy: string;
  /** The BUILDING's point — a party inherits it (both columns are NOT NULL). */
  lat: number;
  lon: number;
}

/**
 * 0088: "the doorbell panel says 12" -> the building carries 12, and twelve
 * party rows exist. The number is the input, the list is the consequence.
 *
 * Pure/DI'd in the style of `writeHouseStatus`/`saveHouseNote` so it is
 * testable without a renderer. Only the MISSING rows are created (`planUnitSync`),
 * so re-blurring the same number writes no new rows — and no row is ever
 * removed, because there is no upload path for a delete (see `planUnitSync`).
 *
 * `territory_id` is never set: it is server-computed (0017), exactly as in
 * `insertHouseAtPoint`.
 */
export async function applyUnitCount(
  params: ApplyUnitCountParams,
): Promise<{ createdIds: string[]; storedCount: number }> {
  const { repo, buildingId, existingUnits, desiredCount, teamId, createdBy, lat, lon } = params;
  const storedCount = normalizeUnitCount(desiredCount);
  await repo.setUnitCount(buildingId, storedCount);
  const { createCount } = planUnitSync(existingUnits, storedCount);
  const createdIds: string[] = [];
  for (let index = 0; index < createCount; index += 1) {
    createdIds.push(
      await repo.insertUnit({ parentHouseId: buildingId, teamId, createdBy, lat, lon }),
    );
  }
  return { createdIds, storedCount };
}

/**
 * 0088: a status tapped on a PARTY writes to the party row. The building's own
 * status is derived from these and is never typed.
 */
export async function writeUnitStatus(params: {
  repo: StatusSheetRepo;
  unitId: string;
  status: HouseStatus;
}): Promise<string> {
  await params.repo.setStatus(params.unitId, params.status);
  return params.unitId;
}

/** 0088: the party's POSITIONAL label. Empty input clears it back to NULL. */
export async function writeUnitLabel(params: {
  repo: StatusSheetRepo;
  unitId: string;
  label: string;
}): Promise<void> {
  const trimmed = params.label.trim();
  await params.repo.setUnitLabel(params.unitId, trimmed === '' ? null : trimmed);
}

/**
 * RBTT-02: territory attribution for a flow started from this sheet comes
 * from the house row at flow-start time. Create-mode pins have no territory
 * locally yet (assigned server-side by the Phase 2 trigger), so only
 * edit-mode houses can carry one.
 */
export function flowTerritoryId(target: StatusSheetTarget): string | null {
  return target.mode === 'edit' ? target.house.territory_id : null;
}

export function StatusSheet({
  visible,
  availableHeight,
  db,
  teamId,
  createdBy,
  target,
  onDismiss,
  onViewContracts,
}: StatusSheetProps) {
  const repo = useMemo(() => createHousesRepo({ db }), [db]);
  const appointmentsRepo = useMemo(() => createAppointmentsRepo({ db }), [db]);
  const { scheduleFollowUp } = useFollowUpSchedule();
  const reducedMotion = useReducedMotion();
  const { translateY, panHandlers } = useSwipeToDismiss({ onClose: onDismiss, reducedMotion });
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [activeHouseId, setActiveHouseId] = useState<string | null>(
    target.mode === 'edit' ? target.house.id : null,
  );
  const [showFollowUpPicker, setShowFollowUpPicker] = useState(false);
  const [showBlacklistConfirm, setShowBlacklistConfirm] = useState(false);
  /**
   * The party the rep asked to remove, held until they confirm. Only ever set
   * for a party that has ALREADY been worked; an untouched one is removed
   * straight away, because there is nothing to lose and a dialog on every tap
   * trains people to dismiss dialogs.
   */
  const [unitPendingRemoval, setUnitPendingRemoval] = useState<HouseRow | null>(null);
  // Status-meaning explainer sheet (tablet statusHint, ported to a phone sheet).
  const sheetInsets = useSafeAreaInsets();
  // Defect 6: the sheet's height is a bounded property of the VIEWPORT, never an
  // emergent property of its content. Computed here rather than in makeStyles,
  // which takes colours only and cannot see runtime window size or insets.
  const { height: windowHeight } = useWindowDimensions();
  // The measured host, with the window only as a fallback for the first frame
  // before onLayout has fired. See maxSheetHeight: the window is NOT the box
  // this sheet lives in.
  const sheetMaxHeight = maxSheetHeight({
    availableHeight: availableHeight ?? windowHeight,
    insetTop: sheetInsets.top,
  });
  const [showStatusInfo, setShowStatusInfo] = useState(false);
  const [followUpDate, setFollowUpDate] = useState<Date>(() => defaultFollowUpDate());
  // Persistent Notiz (0060_houses_note.sql): prefilled from the house in edit
  // mode, saved on blur via the offline PowerSync houses write path.
  const [note, setNote] = useState<string>(target.mode === 'edit' ? (target.house.note ?? '') : '');
  // 0083: the stored address, or null while it has never been resolved. Held in
  // state rather than read straight off the house so a fresh lookup shows
  // without waiting for the sync round trip back into the row.
  const [address, setAddress] = useState<string | null>(
    target.mode === 'edit' ? (target.house.address ?? null) : (target.address ?? null),
  );

  // Resolve ONCE per house, and only when it has no address yet. Offline or a
  // failed lookup leaves it null — the row then shows the "wird ermittelt"
  // placeholder, which is honest: the app does not know the address, and
  // inventing one from coordinates would be worse than saying so.
  useEffect(() => {
    if (target.mode !== 'edit') return;
    const house = target.house;
    if (house.address) {
      setAddress(house.address);
      return;
    }
    let cancelled = false;
    void reverseGeocode(house.lat, house.lon).then((resolved) => {
      if (cancelled || !resolved) return;
      setAddress(resolved);
      void repo.setAddress(house.id, resolved).catch(() => {
        // The lookup still helps this session even if the write fails; the next
        // open simply resolves again.
      });
    });
    return () => {
      cancelled = true;
    };
  }, [target.mode === 'edit' ? target.house.id : null]);
  // One-tap follow-up presets, recomputed against "now" each time the picker
  // opens so "Heute 18:00" et al. are always relative to the current day.
  const followUpPresets = useMemo(() => buildFollowUpPresets(), [showFollowUpPicker]);
  // "Beratung starten" (D-04/D-19): once set, the sheet renders FlowRunnerScreen
  // full-screen instead of the status grid — the sheet stays mounted (never
  // dismissed) so this local state survives until FlowRunnerScreen's own
  // onExit fires. D-09: FlowRunnerScreen now resolves the product/version
  // itself (getLatestPublished / pinned getVersion on resume) — this sheet
  // no longer pre-fetches a ProductDefinitionRow.
  const [activeFlow, setActiveFlow] = useState<{
    houseId: string;
    territoryId: string | null;
    productSlug: string;
    /** §5.2: set when this consultation was opened by redeeming an offer code. */
    redeemedLeadId?: string | null;
    redeemedOfferCode?: string | null;
  } | null>(null);
  // §5.2: "und wenn er es sich später anders überlegt?" — the rep types the
  // code from the customer's offer mail and picks the conversation back up.
  const [redeemOpen, setRedeemOpen] = useState(false);
  const [redeemInput, setRedeemInput] = useState('');
  const [redeemError, setRedeemError] = useState<string | null>(null);
  // D-09: what this rep may sell is whatever RLS and the sync stream put on
  // this device — never a slug compiled into the build. Two hard-coded buttons
  // worked for exactly one company; with a second partner they cannot.
  const [sellable, setSellable] = useState<ProductDefinitionRow[] | null>(null);
  // 0088: the parties of THIS building, live. Empty for a create-mode pin and
  // for every party-less house — which is every house in the running demo.
  const [units, setUnits] = useState<HouseRow[]>([]);
  const [unitCountInput, setUnitCountInput] = useState<string>(
    target.mode === 'edit' && target.house.unit_count !== null
      ? String(target.house.unit_count)
      : '',
  );
  // Which party "Beratung starten" was tapped on; the product list below is
  // then scoped to that party instead of the building.
  const [consultationUnitId, setConsultationUnitId] = useState<string | null>(null);

  const targetKey = target.mode === 'edit' ? target.house.id : target.lngLat.join(',');

  // Reset all transient sheet state whenever it (re)opens for a new target —
  // reopening on a different pin must not carry over the previous pin's
  // in-progress picker/confirm state.
  useEffect(() => {
    if (!visible) return;
    setActiveHouseId(target.mode === 'edit' ? target.house.id : null);
    setShowFollowUpPicker(false);
    setShowBlacklistConfirm(false);
    setFollowUpDate(defaultFollowUpDate());
    setNote(target.mode === 'edit' ? (target.house.note ?? '') : '');
    setActiveFlow(null);
    setRedeemOpen(false);
    setRedeemInput('');
    setRedeemError(null);
    setUnitCountInput(
      target.mode === 'edit' && target.house.unit_count !== null
        ? String(target.house.unit_count)
        : '',
    );
    setConsultationUnitId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, targetKey]);

  // 0088: watch the parties of this building. A create-mode pin is always a
  // building first, so it has none until it exists.
  useEffect(() => {
    if (!visible || target.mode !== 'edit') {
      setUnits([]);
      return;
    }
    const buildingId = target.house.id;
    return repo.watchUnits((rows) =>
      setUnits(rows.filter((row) => row.parent_house_id === buildingId)),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, targetKey, repo]);

  // Loaded when the sheet opens rather than on every render: the set only
  // changes when sync brings a new product down, and the sheet is short-lived.
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    void createProductDefinitionsRepo({ db })
      .listSellable()
      .then((rows) => {
        if (!cancelled) setSellable(rows);
      })
      .catch(() => {
        // An unreadable local table is not a reason to block the sheet — the
        // empty state below says plainly that there is nothing to sell.
        if (!cancelled) setSellable([]);
      });
    return () => {
      cancelled = true;
    };
  }, [visible, db]);

  // Defect 6, exit #3: Android hardware back closes the sheet. The normal sheet
  // is a plain absolute Animated.View, NOT a Modal, so it has no
  // `onRequestClose` and back did nothing at all before this. Returning `true`
  // consumes the event, so back dismisses the sheet instead of navigating away
  // or backgrounding the app. No-op on iOS, which has no hardware back.
  //
  // Deliberately NOT subscribed while `activeFlow` is set: that branch renders
  // its own Modal with its own `onRequestClose`, and a second handler here would
  // close the sheet underneath the open flow.
  useEffect(() => {
    if (!visible || activeFlow) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onDismiss();
      return true;
    });
    return () => subscription.remove();
  }, [visible, activeFlow, onDismiss]);

  if (!visible) return null;

  if (activeFlow) {
    const exitFlow = () => {
      setActiveFlow(null);
      onDismiss();
    };
    // Design 04-09: the consultation flow is a FULL-SCREEN experience — no
    // bottom tab bar. A native Modal renders above the tab navigator (a plain
    // absolute View inside the tab screen cannot cover the tab bar), so the
    // flow owns the whole screen exactly as in the design.
    return (
      <Modal
        visible
        animationType="slide"
        presentationStyle="fullScreen"
        statusBarTranslucent
        onRequestClose={exitFlow}
      >
        {/* The Modal is statusBarTranslucent and the overlay starts at top: 0,
            so without the inset the flow's own heading sat UNDER the clock and
            battery — visible on any notched iPhone. Applied here rather than in
            each screen: this is where the full-bleed decision is made, and it
            covers the wizard and the PDF flow in one place. */}
        <View
          style={[
            styles.fullScreenFlow,
            { paddingTop: sheetInsets.top, paddingBottom: sheetInsets.bottom },
          ]}
          testID="flow-runner-overlay"
        >
          <ConsultationFlow
            db={db}
            productSlug={activeFlow.productSlug}
            houseId={activeFlow.houseId}
            // The customer's address, which the flow never asks for: the
            // consultation started at THIS house. It fills the contract's
            // Anschrift line, and the device has to stamp the same value the
            // server does, or preview and document disagree.
            houseAddress={address}
            territoryId={activeFlow.territoryId}
            createdBy={createdBy}
            teamId={teamId}
            onExit={exitFlow}
            // The deal moves the pin, and it moves the RIGHT one: `houseId`
            // here is already the PARTY's id whenever a party was picked
            // (see handleStartConsultation) — the party signed, not the
            // building. Writing the building would paint a whole block green
            // because one door said yes, which is exactly the lie
            // `deriveBuildingStatus` exists to prevent: the building's colour
            // is DERIVED from its parties and stays open while any door is.
            //
            // Failure is swallowed on purpose. The contract is already
            // persisted and syncing; a status write that could not land must
            // never surface as "your deal failed". The rep can still set the
            // status by hand, which is what they did before this existed.
            onContractSigned={() => {
              void repo.setStatus(activeFlow.houseId, 'success').catch(() => {});
            }}
            onViewContracts={onViewContracts}
            redeemedLeadId={activeFlow.redeemedLeadId ?? null}
            redeemedOfferCode={activeFlow.redeemedOfferCode ?? null}
          />
        </View>
      </Modal>
    );
  }

  async function handleStartConsultation(
    productSlug: string = DEMO_PRODUCT_SLUG,
    redeemed?: { leadId: string; code: string },
  ) {
    const flowDraftsRepo = createFlowDraftsRepo({ db });
    // 0088: the contract hangs on flow_drafts.house_id, and that must be the
    // PARTY's id when one was picked — the party signs, not the building.
    const { houseId } = await startConsultation({
      repo,
      flowDraftsRepo,
      target,
      activeHouseId: consultationUnitId ?? activeHouseId,
      teamId,
      createdBy,
    });
    if (consultationUnitId === null) {
      setActiveHouseId(houseId);
    }
    setActiveFlow({
      houseId,
      territoryId: flowTerritoryId(target),
      productSlug,
      redeemedLeadId: redeemed?.leadId ?? null,
      redeemedOfferCode: redeemed?.code ?? null,
    });
  }

  /**
   * Resolves a typed offer code against the locally synced leads (offline —
   * `lookupOffer` never leaves the device) and, if it is live, opens the
   * consultation for the product the offer was made on. An expired or spent
   * offer names the date/fact rather than a bare "ungültig": the rep has to
   * explain it to someone standing in front of them.
   */
  async function handleRedeem() {
    setRedeemError(null);
    const result = await lookupOffer(db, redeemInput);
    if (result.status === 'unknown') {
      setRedeemError(t('offer.redeemUnknown'));
      return;
    }
    if (result.status === 'expired') {
      const date = result.offer.offerExpiresAtIso
        ? new Date(result.offer.offerExpiresAtIso).toLocaleDateString('de-DE')
        : '';
      setRedeemError(t('offer.redeemExpired').replace('{date}', date));
      return;
    }
    if (result.status === 'already_redeemed') {
      setRedeemError(t('offer.redeemAlreadyUsed'));
      return;
    }
    // The slug is read from the FROZEN offer snapshot, not from the free-text
    // product_interest field the rep may have edited — an unknown slug would
    // only fail later, at "no product definition locally available".
    const slug =
      typeof result.offer.snapshot?.productSlug === 'string'
        ? result.offer.snapshot.productSlug
        : DEMO_PRODUCT_SLUG;
    setRedeemOpen(false);
    await handleStartConsultation(slug, {
      leadId: result.offer.leadId,
      code: redeemInput.trim().toUpperCase(),
    });
  }

  async function handleTapStatus(status: HouseStatus) {
    if (status === 'blacklist') {
      setShowBlacklistConfirm(true);
      return;
    }
    if (status === 'follow_up') {
      const houseId = await writeHouseStatus({
        repo,
        target,
        activeHouseId,
        status,
        teamId,
        createdBy,
      });
      setActiveHouseId(houseId);
      setShowFollowUpPicker(true);
      return;
    }
    await writeHouseStatus({ repo, target, activeHouseId, status, teamId, createdBy });
    onDismiss();
  }

  /**
   * A party is "worked" once it is anything but untouched, or once it carries a
   * position label the rep typed. Removing that throws away a recorded result,
   * so it asks first; an untouched row is just a miscounted doorbell panel.
   */
  function isUnitWorked(unitRow: HouseRow): boolean {
    return unitRow.status !== 'new' || (unitRow.unit_label ?? '').trim().length > 0;
  }

  async function handleRemoveUnit(unitRow: HouseRow) {
    if (isUnitWorked(unitRow)) {
      setUnitPendingRemoval(unitRow);
      return;
    }
    await repo.deleteUnit(unitRow.id);
  }

  async function handleConfirmRemoveUnit() {
    const unitRow = unitPendingRemoval;
    if (!unitRow) return;
    setUnitPendingRemoval(null);
    // The consultation cannot stay pointed at a party that no longer exists.
    if (consultationUnitId === unitRow.id) setConsultationUnitId(null);
    await repo.deleteUnit(unitRow.id);
  }

  async function handleSaveFollowUp() {
    await saveFollowUp({
      repo,
      appointmentsRepo,
      target,
      activeHouseId,
      teamId,
      createdBy,
      when: followUpDate,
      scheduleFollowUp,
    });
    onDismiss();
  }

  async function handleConfirmBlacklist() {
    await confirmBlacklist({ repo, target, activeHouseId, teamId, createdBy });
    onDismiss();
  }

  async function handleSaveNote() {
    const trimmed = note.trim();
    const normalized = trimmed === '' ? null : trimmed;
    // Don't materialize a fresh pin just because an empty note field blurred.
    if (normalized === null && !activeHouseId) return;
    const houseId = await saveHouseNote({
      repo,
      target,
      activeHouseId,
      teamId,
      createdBy,
      note: normalized,
    });
    setActiveHouseId(houseId);
  }

  async function handleSaveUnitCount() {
    if (target.mode !== 'edit') return;
    const building = target.house;
    const parsed = Number.parseInt(unitCountInput, 10);
    const { storedCount } = await applyUnitCount({
      repo,
      buildingId: building.id,
      existingUnits: units,
      desiredCount: Number.isNaN(parsed) ? 0 : parsed,
      teamId,
      createdBy,
      lat: building.lat,
      lon: building.lon,
    });
    // Reflect what was actually stored (clamped), never what was typed.
    setUnitCountInput(storedCount === 0 ? '' : String(storedCount));
  }

  function adjustFollowUpMinutes(deltaMinutes: number) {
    setFollowUpDate((prev) => new Date(prev.getTime() + deltaMinutes * 60_000));
  }

  // 0088: a building is a house row without a parent. A create-mode pin is
  // always a building first — a fresh pin is never a party.
  const isBuilding = target.mode !== 'edit' || target.house.parent_house_id === null;
  const hasUnits = units.length > 0;
  // Read-only once parties exist: the building status is DERIVED, never typed.
  const buildingRollup =
    target.mode === 'edit'
      ? deriveBuildingStatus({
          building: target.house,
          units,
          noSolicitation: hasNoSolicitationLock([], target.house.id, target.house.status),
        })
      : null;

  return (
    <>
      {/* Defect 6, exit #2: tap beside the sheet to close it. It is rendered in
          the main return, i.e. behind `if (!visible) return null` AND behind
          MapScreen's conditional mount on `sheetTarget`, so it structurally
          cannot outlive the open sheet and swallow map pans or pin taps
          (T-GRK-07). That is a property of where it lives, not of a flag.
          `accessible={false}`: assistive tech uses the labelled close button,
          and a second unlabelled full-screen node would only add noise. */}
      <Pressable
        style={styles.backdrop}
        onPress={onDismiss}
        accessible={false}
        testID="status-sheet-backdrop"
      />
      <Animated.View
        style={[styles.sheet, { maxHeight: sheetMaxHeight }, { transform: [{ translateY }] }]}
        testID="status-sheet"
      >
        {/* FIXED header — the anti-regression structure. The grabber doubles as
            the swipe-down drag zone and the close button is the discoverable
            exit; both are pinned to the sheet surface OUTSIDE the ScrollView
            below, so no amount of added content can displace them off-screen the
            way 0088's fields did. useSwipeToDismiss claims a gesture only at
            dy > 4 and downward, so the close button's tap falls through to it. */}
        <View {...panHandlers} style={styles.handleZone}>
          <View style={styles.handle} />
          <Pressable
            style={styles.closeButton}
            accessibilityRole="button"
            accessibilityLabel={t('common.closeSheet')}
            onPress={onDismiss}
            testID="status-sheet-close"
          >
            <MaterialCommunityIcons name="close" size={22} color={colors.textSecondary} />
          </Pressable>
        </View>

        {/* The scroll indicator is hidden, and that is a decision, not a tidy-up.
            It DOES carry information ("there is more below"), so it is worth
            saying why it loses here.

            1. It cannot be made correct in both themes. `indicatorStyle` is an
               iOS-only prop with three values, and the sheet surface flips from
               #FFFFFF (light) to #16223B (dark) — 'default' (black) is wrong on
               the dark surface, 'white' is wrong on the light one, and Android
               offers no equivalent knob at all. A control that is guaranteed to
               be miscoloured on one of the two themes does not belong on the
               app's most-used surface.
            2. Its information value here is close to zero anyway. The operator
               photographed it as a bright line down the FULL height of the
               sheet — a near-full-height thumb, which is what you get when the
               content only just overflows. "There is a sliver more" is not
               worth a hard bright rule across the primary surface.
            3. The affordance survives without it: `maxHeight` hard-clips at the
               scroll viewport, so an overflowing sheet always cuts its last row
               mid-element — the standard, theme-independent "continues below"
               cue.

            This also matches the app's own precedent rather than inventing one:
            InfoSheet (the sheet primitive), AbschlussDetailScreen and
            AppLockGate all hide it. The single place it is deliberately ON is
            BelehrungBlock, where scrolling the statutory Widerrufsbelehrung to
            the end is legally load-bearing. This sheet is not that. */}
        <ScrollView
          style={styles.scrollBody}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {unitPendingRemoval ? (
            <View>
              <Text style={styles.title}>{t('destructive.removeUnitTitle')}</Text>
              <Text style={styles.body}>
                {t('destructive.removeUnitBody').replace(
                  '{unit}',
                  unitPendingRemoval.unit_label?.trim() || t('house.unitsSectionLabel'),
                )}
              </Text>
              <View style={styles.confirmRow}>
                <Button
                  title={t('cta.cancel')}
                  variant="secondary"
                  fullWidth={false}
                  onPress={() => setUnitPendingRemoval(null)}
                  style={styles.confirmButton}
                />
                <Button
                  title={t('cta.removeUnit')}
                  variant="destructive"
                  fullWidth={false}
                  onPress={() => void handleConfirmRemoveUnit()}
                  style={styles.confirmButton}
                />
              </View>
            </View>
          ) : showBlacklistConfirm ? (
            <View>
              <Text style={styles.title}>{t('destructive.blacklistTitle')}</Text>
              <Text style={styles.body}>{t('destructive.blacklistBody')}</Text>
              <View style={styles.confirmRow}>
                <Button
                  title={t('cta.cancel')}
                  variant="secondary"
                  fullWidth={false}
                  onPress={() => setShowBlacklistConfirm(false)}
                  style={styles.confirmButton}
                />
                <Button
                  title={t('cta.addToBlacklist')}
                  variant="destructive"
                  fullWidth={false}
                  onPress={() => void handleConfirmBlacklist()}
                  style={styles.confirmButton}
                />
              </View>
            </View>
          ) : showFollowUpPicker ? (
            <View>
              <Text style={styles.title}>{t('status.follow_up')}</Text>

              {/* One-tap presets (JS-only, no native picker) — each carries a real
              Date fed straight into createFollowUpAppointment. */}
              <Text style={styles.pickerLabel}>{t('followUp.presetsLabel')}</Text>
              <View style={styles.presetRow}>
                {followUpPresets.map((preset) => {
                  const selected = preset.date.getTime() === followUpDate.getTime();
                  return (
                    <Pressable
                      key={preset.key}
                      style={[styles.presetChip, selected ? styles.presetChipSelected : null]}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      onPress={() => setFollowUpDate(preset.date)}
                      testID={`followup-preset-${preset.key}`}
                    >
                      <Text
                        style={[
                          styles.presetChipText,
                          selected ? styles.presetChipTextSelected : null,
                        ]}
                      >
                        {t(PRESET_LABEL_KEY[preset.key])}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              {/* Chosen time + a JS-only manual stepper to fine-tune it. */}
              <Text style={styles.pickerLabel}>{t('followUp.pickerLabel')}</Text>
              <Text style={styles.pickerValue} testID="followup-chosen-value">
                {formatFollowUpDate(followUpDate)}
              </Text>
              <View style={styles.pickerAdjustRow}>
                <FollowUpAdjustButton
                  labelKey="followUp.adjustMinusDay"
                  onPress={() => adjustFollowUpMinutes(-24 * 60)}
                  styles={styles}
                />
                <FollowUpAdjustButton
                  labelKey="followUp.adjustMinus30"
                  onPress={() => adjustFollowUpMinutes(-30)}
                  styles={styles}
                />
                <FollowUpAdjustButton
                  labelKey="followUp.adjustPlus30"
                  onPress={() => adjustFollowUpMinutes(30)}
                  styles={styles}
                />
                <FollowUpAdjustButton
                  labelKey="followUp.adjustPlusDay"
                  onPress={() => adjustFollowUpMinutes(24 * 60)}
                  styles={styles}
                />
              </View>

              <Button title={t('cta.saveFollowUp')} onPress={() => void handleSaveFollowUp()} />
            </View>
          ) : (
            <View>
              {/* 0083: the address IS the pin's identity. A rep standing on the
              street needs to know which building this is; lat/lon does not
              answer that. Falls back to coordinates while unresolved rather
              than showing an empty row. */}
              <View style={styles.addressSection}>
                <Text style={styles.sectionLabel}>{t('statusSheet.addressLabel')}</Text>
                <Text style={styles.addressValue} testID="status-sheet-address">
                  {address ?? t('statusSheet.addressResolving')}
                </Text>
              </View>

              {hasUnits && buildingRollup ? (
                /* 0088: once the building has parties, its status is the rollup of
               those parties (locked > appointment > open > done) and is shown
               read-only. Tapping a building status here would overwrite a value
               nothing reads any more. */
                <View style={styles.derivedStatusSection} testID="derived-building-status">
                  <Text style={styles.sectionLabel}>{t('house.derivedStatusLabel')}</Text>
                  <View style={styles.derivedStatusRow}>
                    <MaterialCommunityIcons
                      name={
                        statusIcon[buildingRollup.status] as React.ComponentProps<
                          typeof MaterialCommunityIcons
                        >['name']
                      }
                      size={18}
                      color={statusColor[buildingRollup.status]}
                    />
                    <Text style={styles.derivedStatusValue}>
                      {t(`status.${buildingRollup.status}` as Parameters<typeof t>[0])}
                      {buildingRollup.openUnits !== null && buildingRollup.openUnits > 0
                        ? ` · ${t('map.pinOpenUnits').replace('{count}', String(buildingRollup.openUnits))}`
                        : ` · ${t('map.pinAllUnitsDone')}`}
                    </Text>
                  </View>
                  <Text style={styles.unitHint}>{t('house.derivedStatusHint')}</Text>
                </View>
              ) : (
                <>
                  <View style={styles.sectionLabelRow}>
                    <Text style={styles.sectionLabel}>{t('cta.setStatus')}</Text>
                    <InfoIconButton
                      accessibilityLabel={t('help.statusInfoLabel')}
                      onPress={() => setShowStatusInfo(true)}
                      testID="status-info-button"
                    />
                  </View>
                  <View style={styles.statusTrack}>
                    {STATUS_ORDER.map((status) => (
                      <StatusSegment
                        key={status}
                        status={status}
                        selected={target.mode === 'edit' && target.house.status === status}
                        onPress={() => void handleTapStatus(status)}
                        colors={colors}
                        styles={styles}
                      />
                    ))}
                  </View>
                </>
              )}

              {/* Persistent Notiz (0060): a rep's own memo for this house, saved on
              blur via the offline PowerSync houses write path. */}
              <View style={styles.noteSection}>
                <Text style={styles.sectionLabel}>{t('statusSheet.noteLabel')}</Text>
                <TextInput
                  style={styles.noteInput}
                  value={note}
                  onChangeText={setNote}
                  onBlur={() => void handleSaveNote()}
                  placeholder={t('statusSheet.notePlaceholder')}
                  placeholderTextColor={colors.textSecondary}
                  multiline
                  maxLength={1000}
                  accessibilityLabel={t('statusSheet.noteLabel')}
                  testID="status-note-input"
                />
              </View>

              {/* 0088: the doorbell-panel count and the parties it produced. Only on
              a BUILDING in edit mode — a create-mode pin is a building that does
              not exist yet, and a party has no parties of its own. A house whose
              count is empty renders nothing extra: the sheet below this point is
              word for word the sheet it was before 0088. */}
              {target.mode === 'edit' && isBuilding ? (
                <View style={styles.unitSection}>
                  <Text style={styles.sectionLabel}>{t('house.unitCountLabel')}</Text>
                  <TextInput
                    style={styles.unitCountInput}
                    value={unitCountInput}
                    onChangeText={setUnitCountInput}
                    onBlur={() => void handleSaveUnitCount()}
                    placeholder={t('house.unitCountPlaceholder')}
                    placeholderTextColor={colors.textSecondary}
                    keyboardType="number-pad"
                    maxLength={3}
                    accessibilityLabel={t('house.unitCountLabel')}
                    testID="unit-count-input"
                  />
                  <Text style={styles.unitHint}>{t('house.unitCountHint')}</Text>

                  {hasUnits ? (
                    <View style={styles.unitList} testID="unit-list">
                      <Text style={styles.sectionLabel}>{t('house.unitsSectionLabel')}</Text>
                      {/* The label is a POSITION ("3. OG links"), never a name from
                      the Klingelschild — the same guarantee the 0088 column
                      comment carries. The rep should not have to type names. */}
                      <Text style={styles.unitHint}>{t('house.unitLabelNoNamesHint')}</Text>
                      {units.map((unitRow, index) => (
                        <UnitRow
                          key={unitRow.id}
                          unit={unitRow}
                          index={index}
                          selectedForConsultation={consultationUnitId === unitRow.id}
                          onChangeLabel={(label) =>
                            void writeUnitLabel({ repo, unitId: unitRow.id, label })
                          }
                          onTapStatus={(status) =>
                            void writeUnitStatus({ repo, unitId: unitRow.id, status })
                          }
                          onStartConsultation={() => setConsultationUnitId(unitRow.id)}
                          onRemove={() => void handleRemoveUnit(unitRow)}
                          colors={colors}
                          styles={styles}
                        />
                      ))}
                    </View>
                  ) : null}
                </View>
              ) : null}

              {/* Do-not-knock (blacklist) houses get the tablet's "Beratung gesperrt"
              explainer in place of the start CTA — a UI gate on the status sheet,
              not a change to the FlowRunner signing/consent behavior. */}
              {hasUnits &&
              consultationUnitId ===
                null ? /* 0088: with parties, a consultation belongs to ONE door. The
               product buttons appear once a party has been picked above. */
              null : target.mode === 'edit' && !hasUnits && target.house.status === 'blacklist' ? (
                <HintRow
                  tone="danger"
                  iconName="lock-outline"
                  title={t('hints.blacklistBlockedTitle')}
                  testID="blacklist-blocked-hint"
                >
                  {t('hints.blacklistBlockedBody')}
                </HintRow>
              ) : (
                /* Two published products behind one decision: the guided wizard, or
               the company's own contract PDF signed in place. Which one closes
               better is a doorstep judgement, so it belongs to the rep and not
               to whichever slug happened to be compiled in. */
                <View style={styles.consultationCtas}>
                  {sellable === null ? (
                    <Text style={styles.productHint}>{t('products.loading')}</Text>
                  ) : sellable.length === 0 ? (
                    <Text style={styles.productHint}>{t('products.none')}</Text>
                  ) : (
                    sellable.map((product, index) => (
                      <Button
                        key={product.id}
                        // product_definitions carries no display-name column — the
                        // slug IS the name here, the same honesty
                        // deriveSignatureSummary applies on the success screen.
                        title={product.slug}
                        variant={index === 0 ? 'primary' : 'secondary'}
                        onPress={() => void handleStartConsultation(product.slug)}
                        trailingIcon={
                          <MaterialCommunityIcons
                            name={
                              product.contract_mode === 'direct_pdf'
                                ? 'file-document-outline'
                                : 'arrow-right'
                            }
                            size={20}
                            color={index === 0 ? colors.onAccent : colors.textPrimary}
                          />
                        }
                      />
                    ))
                  )}
                  {redeemOpen ? (
                    <>
                      <TextInput
                        style={styles.noteInput}
                        placeholder={t('offer.redeemPlaceholder')}
                        placeholderTextColor={colors.textMuted}
                        autoCapitalize="characters"
                        autoCorrect={false}
                        value={redeemInput}
                        onChangeText={setRedeemInput}
                        testID="offer-redeem-input"
                      />
                      {redeemError ? (
                        <Text style={styles.redeemError} testID="offer-redeem-error">
                          {redeemError}
                        </Text>
                      ) : null}
                      <Button
                        title={t('offer.redeemSubmit')}
                        variant="secondary"
                        onPress={() => void handleRedeem()}
                      />
                    </>
                  ) : (
                    <Button
                      title={t('offer.redeemCta')}
                      variant="secondary"
                      onPress={() => setRedeemOpen(true)}
                      trailingIcon={
                        <MaterialCommunityIcons
                          name="ticket-confirmation-outline"
                          size={20}
                          color={colors.textPrimary}
                        />
                      }
                    />
                  )}
                </View>
              )}
            </View>
          )}
        </ScrollView>

        {/* Outside the ScrollView: InfoSheet is itself an overlay, not part of the
          scrolled body. */}
        <InfoSheet
          visible={showStatusInfo}
          onClose={() => setShowStatusInfo(false)}
          title={t('help.statusMeaningTitle')}
          subtitle={t('help.statusMeaningSubtitle')}
          testID="status-info-sheet"
        >
          <InfoSheetSection heading={t('help.legendHeading')}>
            {buildStatusLegend().map((entry) => (
              <InfoLegendRow
                key={entry.status}
                dotColor={entry.color}
                iconName={entry.iconName}
                label={entry.label}
                meaning={entry.meaning}
              />
            ))}
          </InfoSheetSection>
        </InfoSheet>
      </Animated.View>
    </>
  );
}

/**
 * One segment of the status selector — design screen 03's segmented control:
 * equal-width pills in a soft Ink-Navy@6% track, the selected pill filled amber
 * (Porch-Light). Each pill pairs its traffic-light status glyph with the label
 * (Foundations: status is never colour alone) — the icon carries the status
 * hue when unselected, white when the amber pill is active.
 */
function StatusSegment({
  status,
  selected,
  onPress,
  colors,
  styles,
}: {
  status: HouseStatus;
  selected: boolean;
  onPress: () => void;
  colors: ReturnType<typeof useThemeColors>;
  styles: ReturnType<typeof makeStyles>;
}) {
  const iconName = statusIcon[status] as React.ComponentProps<
    typeof MaterialCommunityIcons
  >['name'];
  return (
    <Pressable
      style={[styles.statusSegment, selected ? styles.statusSegmentSelected : null]}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={t(`status.${status}` as Parameters<typeof t>[0])}
      onPress={onPress}
    >
      <MaterialCommunityIcons
        name={iconName}
        size={18}
        color={selected ? colors.onAccent : statusColor[status]}
      />
      <Text
        style={[styles.statusSegmentLabel, selected ? styles.statusSegmentLabelSelected : null]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.8}
      >
        {t(`status.${status}` as Parameters<typeof t>[0])}
      </Text>
    </Pressable>
  );
}

/**
 * One party (Partei) of a building: its POSITIONAL label, its own status
 * segment, and its own "Beratung starten". Everything here writes to the
 * PARTY's id — the contract hangs on `flow_drafts.house_id`, and that is the
 * door that signed.
 *
 * The label placeholder shows a position ("z. B. 3. OG links") and never a
 * name; the hint above the list says so in words. That is the UI half of the
 * same guarantee the 0088 column comment carries — not decoration.
 */
function UnitRow({
  unit,
  index,
  selectedForConsultation,
  onChangeLabel,
  onTapStatus,
  onStartConsultation,
  onRemove,
  colors,
  styles,
}: {
  unit: HouseRow;
  index: number;
  selectedForConsultation: boolean;
  onChangeLabel: (label: string) => void;
  onTapStatus: (status: HouseStatus) => void;
  onStartConsultation: () => void;
  onRemove: () => void;
  colors: ReturnType<typeof useThemeColors>;
  styles: ReturnType<typeof makeStyles>;
}) {
  const [label, setLabel] = useState<string>(unit.unit_label ?? '');
  return (
    <View style={styles.unitRow} testID={`unit-row-${unit.id}`}>
      {/* Remove sits on the row it removes, trailing the title. Deliberately a
      button and NOT swipe-to-delete: this list lives inside a scrolling bottom
      sheet, where a horizontal swipe fights the vertical scroll, and a gesture
      with no visible affordance is undiscoverable for the one rep who needs it
      once a week. */}
      <View style={styles.unitRowHeader}>
        <Text style={styles.unitRowTitle}>
          {unit.unit_label ?? t('house.unitFallbackName').replace('{n}', String(index + 1))}
        </Text>
        <Pressable
          onPress={onRemove}
          accessibilityRole="button"
          accessibilityLabel={t('cta.removeUnit')}
          hitSlop={spacing.sm}
          style={styles.unitRemoveButton}
          testID={`unit-remove-${unit.id}`}
        >
          <MaterialCommunityIcons name="close" size={18} color={colors.textSecondary} />
        </Pressable>
      </View>
      <TextInput
        style={styles.unitLabelInput}
        value={label}
        onChangeText={setLabel}
        onBlur={() => onChangeLabel(label)}
        placeholder={t('house.unitLabelPlaceholder')}
        placeholderTextColor={colors.textSecondary}
        maxLength={60}
        accessibilityLabel={t('house.unitsSectionLabel')}
        testID={`unit-label-input-${unit.id}`}
      />
      <View style={styles.statusTrack}>
        {STATUS_ORDER.map((status) => (
          <StatusSegment
            key={status}
            status={status}
            selected={unit.status === status}
            onPress={() => onTapStatus(status)}
            colors={colors}
            styles={styles}
          />
        ))}
      </View>
      <Button
        title={t('cta.startConsultation')}
        variant={selectedForConsultation ? 'primary' : 'secondary'}
        onPress={onStartConsultation}
      />
    </View>
  );
}

/** One manual-stepper button in the follow-up picker (labelled via i18n). */
function FollowUpAdjustButton({
  labelKey,
  onPress,
  styles,
}: {
  labelKey: Parameters<typeof t>[0];
  onPress: () => void;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <Pressable style={styles.pickerAdjustButton} accessibilityRole="button" onPress={onPress}>
      <Text
        style={styles.pickerAdjustText}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.8}
      >
        {t(labelKey)}
      </Text>
    </Pressable>
  );
}

/** `DD.MM.YYYY HH:MM` — plain manual formatting, no `Intl` locale-data dependency on Hermes. */
function formatFollowUpDate(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function makeStyles(colors: ReturnType<typeof useThemeColors>) {
  return StyleSheet.create({
    fullScreenFlow: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: colors.surface,
      elevation: 10,
    },
    sheet: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: colors.surface,
      borderTopLeftRadius: 26,
      borderTopRightRadius: 26,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.md,
      paddingBottom: spacing.xl,
      elevation: 12,
      shadowColor: colors.ink,
      shadowOpacity: 0.28,
      shadowRadius: 24,
      shadowOffset: { width: 0, height: -12 },
    },
    // Defect 6: one tier below the sheet's elevation 12, so it dims and catches
    // taps around the sheet without ever covering it.
    backdrop: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: colors.ink,
      opacity: 0.28,
      elevation: 11,
    },
    // Full-width grab strip so the whole top of the sheet drags, not just the
    // pill. `minHeight` is the touch target so the close button (absolutely
    // positioned at the right edge) never overlaps the centred pill and the
    // header keeps a stable height whatever the body does.
    handleZone: {
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: spacing.touchTarget,
    },
    // A literal 48dp box, not a hitSlop expansion of a smaller one: this is a
    // primary exit from the app's primary interaction, so the target is real.
    closeButton: {
      position: 'absolute',
      right: 0,
      top: 0,
      width: spacing.touchTarget,
      height: spacing.touchTarget,
      alignItems: 'center',
      justifyContent: 'center',
    },
    // `flexShrink: 1` is load-bearing, not cosmetic: without it the children
    // still force the sheet past its maxHeight parent and the cap is inert.
    scrollBody: { flexShrink: 1 },
    scrollContent: { paddingBottom: spacing.xs },
    handle: {
      alignSelf: 'center',
      width: 44,
      height: 5,
      borderRadius: 3,
      backgroundColor: colors.subtleFill,
      // The gap below the pill used to be a marginBottom here; it now comes from
      // the header's own 48dp minHeight, which also keeps the pill optically
      // centred against the close button instead of pushed upward by its margin.
    },
    title: { ...typography.heading, color: colors.textPrimary, marginBottom: spacing.sm },
    body: { ...typography.body, color: colors.textSecondary, marginBottom: spacing.lg },
    sectionLabelRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: spacing.sm + 2,
    },
    sectionLabel: {
      ...typography.label,
      fontWeight: '600',
      color: colors.textSecondary,
    },
    statusTrack: {
      flexDirection: 'row',
      // Six statuses do not fit one row at a readable label size, so the track
      // wraps to two rows of three (`flexBasis` below is what actually decides
      // the three; with the old `flex: 1` every segment had basis 0 and they
      // all stayed on one line however many there were).
      flexWrap: 'wrap',
      gap: spacing.xs,
      padding: spacing.xs,
      borderRadius: radius.input + 1,
      backgroundColor: colors.subtleFill,
      marginBottom: spacing.lg,
    },
    statusSegment: {
      // ~30% leaves room for two `spacing.xs` gaps; flexGrow then spreads the
      // remainder so a row of three fills the track exactly.
      flexBasis: '30%',
      flexGrow: 1,
      minHeight: spacing['2xl'] + 4,
      borderRadius: radius.md - 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: spacing.xs,
      paddingHorizontal: spacing.xs,
      gap: spacing.xs / 2,
    },
    statusSegmentSelected: {
      backgroundColor: colors.accent,
      shadowColor: colors.ink,
      shadowOpacity: 0.28,
      shadowRadius: 6,
      shadowOffset: { width: 0, height: 3 },
      elevation: 2,
    },
    statusSegmentLabel: { ...typography.label, fontWeight: '600', color: colors.textSecondary },
    statusSegmentLabelSelected: { color: colors.onAccent },
    confirmRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm },
    confirmButton: { paddingHorizontal: spacing.lg },
    noteSection: { marginBottom: spacing.lg },
    unitSection: { marginBottom: spacing.lg },
    unitRowHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    unitRemoveButton: {
      // 48dp is the floor for every interactive element in this app; the glyph
      // is 18dp and the rest is hitSlop plus this box.
      minWidth: spacing.touchTarget,
      minHeight: spacing.touchTarget,
      alignItems: 'center',
      justifyContent: 'center',
    },
    unitCountInput: {
      ...typography.body,
      color: colors.textPrimary,
      minHeight: spacing['2xl'] + 4,
      borderWidth: 1.5,
      borderColor: colors.border,
      borderRadius: radius.input,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      backgroundColor: colors.surface,
      marginTop: spacing.xs,
    },
    unitHint: { ...typography.label, color: colors.textMuted, marginTop: spacing.xs },
    unitList: { marginTop: spacing.md, gap: spacing.sm },
    unitRow: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.input,
      padding: spacing.sm,
      gap: spacing.xs,
      backgroundColor: colors.surface,
    },
    unitRowTitle: { ...typography.label, fontWeight: '600', color: colors.textPrimary },
    unitLabelInput: {
      ...typography.body,
      color: colors.textPrimary,
      minHeight: spacing['2xl'],
      borderWidth: 1.5,
      borderColor: colors.border,
      borderRadius: radius.input,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
      backgroundColor: colors.surface,
    },
    derivedStatusSection: { marginBottom: spacing.lg },
    derivedStatusRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      marginTop: spacing.xs,
    },
    derivedStatusValue: { ...typography.heading, fontSize: 16, color: colors.textPrimary },
    consultationCtas: { gap: spacing.sm },
    productHint: { ...typography.label, color: colors.textMuted },
    redeemError: { ...typography.label, color: colors.brick },
    addressSection: { marginBottom: spacing.md },
    addressValue: {
      ...typography.heading,
      fontSize: 16,
      color: colors.textPrimary,
      marginTop: 2,
    },
    noteInput: {
      ...typography.body,
      color: colors.textPrimary,
      minHeight: spacing['3xl'],
      borderWidth: 1.5,
      borderColor: colors.border,
      borderRadius: radius.input,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      textAlignVertical: 'top',
      backgroundColor: colors.surface,
      marginTop: spacing.xs,
    },
    pickerLabel: { ...typography.label, color: colors.textSecondary, marginBottom: spacing.xs },
    pickerValue: { ...typography.heading, color: colors.textPrimary, marginBottom: spacing.md },
    presetRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.sm,
      marginBottom: spacing.md,
    },
    presetChip: {
      minHeight: spacing.touchTarget,
      paddingHorizontal: spacing.md,
      justifyContent: 'center',
      alignItems: 'center',
      borderRadius: radius.input,
      borderWidth: 1.5,
      borderColor: colors.borderStrong,
      backgroundColor: colors.surface,
    },
    presetChipSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
    presetChipText: { ...typography.label, fontWeight: '600', color: colors.textPrimary },
    presetChipTextSelected: { color: colors.onAccent },
    pickerAdjustRow: { flexDirection: 'row', marginBottom: spacing.lg, gap: spacing.sm },
    pickerAdjustButton: {
      flex: 1,
      minHeight: spacing.touchTarget,
      paddingHorizontal: spacing.sm,
      justifyContent: 'center',
      alignItems: 'center',
      borderRadius: radius.input,
      borderWidth: 1.5,
      borderColor: colors.borderStrong,
      backgroundColor: colors.surface,
    },
    pickerAdjustText: { ...typography.label, fontWeight: '600', color: colors.textPrimary },
  });
}
