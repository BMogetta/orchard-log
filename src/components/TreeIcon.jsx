import React, { useId } from "react";

// Composable plant glyph in a shared 100x100 space: a foliage silhouette (base)
// with an optional pollination orbit and an optional corner condition badge.
// Ported from a modular system; colours come from --tree-* CSS variables so it
// themes with the app. The arrowhead marker id is per-instance — two icons on a
// page sharing one id would make url(#id) resolve to whichever came first.

const LEAF = "var(--tree-leaf)";
const BARK = "var(--tree-bark)";
const POLLEN = "var(--tree-pollen)";
const WATER = "var(--tree-water)";
const ALERT = "var(--tree-alert)";

const Trunk = ({ y, height }) => <rect x="45" y={y} width="10" height={height} fill={BARK} />;

// Layer 1 — foliage. All three share a footprint so swapping never shifts things.
const BASES = {
  evergreen: () => (
    <g>
      <circle cx="50" cy="40" r="22" fill={LEAF} />
      <Trunk y="58" height="30" />
    </g>
  ),
  semiDeciduous: () => (
    <g>
      <path d="M50 52L72 30" fill="none" stroke={BARK} strokeWidth="3" strokeLinecap="round" />
      <path d="M50 40L68 26" fill="none" stroke={BARK} strokeWidth="3" strokeLinecap="round" />
      <path d="M50 18A22 22 0 0 0 50 62Z" fill={LEAF} />
      <Trunk y="58" height="30" />
    </g>
  ),
  deciduous: () => (
    <g>
      <g fill="none" stroke={BARK} strokeLinecap="round">
        <path d="M50 46L50 20" strokeWidth="4" />
        <path d="M50 32L32 20" strokeWidth="3" />
        <path d="M50 26L68 18" strokeWidth="3" />
        <path d="M50 44L34 34" strokeWidth="3" />
      </g>
      <Trunk y="44" height="44" />
    </g>
  ),
};

// Layer 2 — pollination, ringing the base with a 50° gap at bottom-right (the
// badge slot). Closed loop = self-fertile; dashed = partial; external = needs one.
const ORBIT_PATH = "M83.8 62.3A36 36 0 1 0 62.3 83.8";
const OrbitArc = ({ markerId, dashed }) => (
  <path
    d={ORBIT_PATH}
    fill="none"
    stroke={POLLEN}
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeDasharray={dashed ? "6 5" : undefined}
    markerEnd={`url(#${markerId})`}
  />
);
const ORBITS = {
  selfFertile: ({ markerId }) => <OrbitArc markerId={markerId} />,
  partiallySelfFertile: ({ markerId }) => <OrbitArc markerId={markerId} dashed />,
  needsPartner: ({ markerId }) => (
    <g>
      <circle cx="12" cy="14" r="5" fill={POLLEN} />
      <path
        d="M17 19L29 26"
        fill="none"
        stroke={POLLEN}
        strokeWidth="2.5"
        strokeLinecap="round"
        markerEnd={`url(#${markerId})`}
      />
    </g>
  ),
};

// Layer 3 — one corner condition badge (legibility floor ~40px, so small list
// use should keep to a single, high-contrast badge).
const BADGES = {
  lowWater: () => <path d="M76 64C85 77 85 87 76 87C67 87 67 77 76 64Z" fill={WATER} />,
  frostSensitive: () => (
    <g>
      <g fill="none" stroke={WATER} strokeWidth="2" strokeLinecap="round">
        <path d="M69 76H83" />
        <path d="M72.5 70L79.5 82" />
        <path d="M79.5 70L72.5 82" />
      </g>
      <g fill="none" stroke={ALERT} strokeWidth="3" strokeLinecap="round">
        <circle cx="76" cy="76" r="11" />
        <path d="M68.2 68.2L83.8 83.8" />
      </g>
    </g>
  ),
};

export function TreeIcon({ foliage, pollination, badge, size = 28, title, className }) {
  const markerId = `${useId()}tarrow`;
  const Base = BASES[foliage];
  if (!Base) return null;
  const Orbit = pollination ? ORBITS[pollination] : null;
  const Badge = badge ? BADGES[badge] : null;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      className={className}
      role="img"
      aria-label={title}
    >
      {title && <title>{title}</title>}
      {Orbit && (
        <defs>
          <marker
            id={markerId}
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="5"
            markerHeight="5"
            orient="auto-start-reverse"
          >
            <path
              d="M2 1L8 5L2 9"
              fill="none"
              stroke="context-stroke"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </marker>
        </defs>
      )}
      <Base />
      {Orbit && <Orbit markerId={markerId} />}
      {Badge && <Badge />}
    </svg>
  );
}
