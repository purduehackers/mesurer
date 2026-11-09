// Two sliders: nudge an element's values.
export function TweakIcon({ size = 20 }: { size?: number }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" className="msr:block">
      <path d="M4 8h9M17 8h3M4 16h3M11 16h9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="15" cy="8" r="2" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="9" cy="16" r="2" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}
