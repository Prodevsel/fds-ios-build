import { type HouseStatus, tokens } from '@/design/tokens';
import { useTranslation } from 'react-i18next';

/**
 * Legend for the house traffic-light hues. Colour on the map is never the only
 * carrier of meaning — every hue is repeated here next to its German label.
 */
const ORDER: readonly HouseStatus[] = [
  'new',
  'not_home',
  'follow_up',
  'no_interest',
  'success',
  'blacklist',
];

export function MapLegend() {
  const { t } = useTranslation('territories');
  return (
    <div className="flex flex-wrap items-center gap-md">
      <span className="text-label font-medium uppercase tracking-[0.08em] text-[#5C6B85]">
        {t('legend.title')}
      </span>
      {ORDER.map((status) => (
        <span key={status} className="flex items-center gap-xs text-label text-ink">
          <span
            aria-hidden
            className="size-2.5 rounded-full ring-2 ring-white"
            style={{ backgroundColor: tokens.houseStatus[status] }}
          />
          {t(`legend.${status}`)}
        </span>
      ))}
    </div>
  );
}
