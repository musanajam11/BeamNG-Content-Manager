export function AppLogo({ height = 22, className = '' }: { height?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 1100 130"
      height={height}
      className={className}
      style={{ width: 'auto' }}
      aria-label="BeamNG CM"
      role="img"
    >
      <defs>
        <radialGradient id="logo-node" cx="30%" cy="30%">
          <stop offset="0%" stopColor="#fff7e0" />
          <stop offset="60%" style={{ stopColor: 'var(--color-accent, #f97316)' }} />
          <stop offset="100%" style={{ stopColor: 'var(--color-accent, #f97316)' }} />
        </radialGradient>
      </defs>

      {/* === BeamNG Node Icon === */}
      <g transform="translate(15, 0)">
        {/* Connecting bars (behind circles) */}
        <g stroke="white" strokeWidth="14" strokeLinecap="round">
          <line x1="35" y1="85" x2="88" y2="18" />
          <line x1="88" y1="18" x2="115" y2="78" />
          <line x1="35" y1="85" x2="115" y2="78" />
        </g>

        {/* Node circles */}
        <circle cx="35" cy="85" r="32" fill="url(#logo-node)" />
        <circle cx="88" cy="18" r="18" fill="url(#logo-node)" />
        <circle cx="115" cy="78" r="23" fill="url(#logo-node)" />
      </g>

      {/* === Logo Text === */}
      <text
        y="105"
        fontFamily="'Segoe UI', system-ui, -apple-system, sans-serif"
        fontSize="132"
        letterSpacing="-1.5"
      >
        <tspan x="180" fill="white" fontWeight="600">BeamNG</tspan>
        <tspan fill="var(--color-accent, #f97316)" fontWeight="800" dx="24">CM</tspan>
      </text>
    </svg>
  )
}
