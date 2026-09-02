/**
 * FrontDoorSales mark — the amber "door" glyph from the Claude Design contract.
 * Single source of truth for the logo (reused in Login + Sidebar). Size in px.
 */
export function BrandLogo({ size = 34, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      className={className}
      style={{ flex: 'none' }}
      aria-hidden
    >
      <rect width="100" height="100" rx="26" fill="#0d1830" />
      <rect x="29" y="25" width="42" height="57" rx="7" fill="#E8862C" />
      <g fill="#0d1830">
        <rect x="37" y="35" width="9" height="47" rx="1.5" />
        <rect x="37" y="35" width="24" height="9" rx="1.5" />
        <rect x="37" y="50" width="16" height="8" rx="1.5" />
      </g>
    </svg>
  );
}
