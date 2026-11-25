// The Purdue Hackers glider, as purduehackers.com draws it (ph.svg): five square cells, no gaps,
// `.X. / .XX / X.X`. The loose cell is a dashed outline, the way Mesurer outlines a selected
// element, and a cursor sits in the glider's empty cell pointing at it. Drawn on whole pixels at
// 20 × 20 so it stays sharp at its usual size.
export function MesurerMarkIcon({
  size = 20,
}: {
  size?: number
}) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
    >
      {/* The loose cell, dashed: an L at each corner and a dash mid-side. */}
      <rect
        x="1.5"
        y="12.5"
        width="5"
        height="5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
        strokeDasharray="2 1 1 1"
        strokeDashoffset="1"
      />
      {/* The other four cells, joined. */}
      <path d="M7 0H13V6H19V18H13V12H7Z" />
      {/* The cursor, edged in the toolbar's surface colour so it stands off the cells beside it. */}
      <path
        transform="translate(8 12.5) scale(0.55)"
        d="M0 0V11.2L3 8.4L5 13L7 12.1L5 7.6H9.2Z"
        stroke="var(--msr-surface, #fff)"
        strokeWidth="2.7"
        strokeLinejoin="round"
        paintOrder="stroke"
      />
    </svg>
  )
}
