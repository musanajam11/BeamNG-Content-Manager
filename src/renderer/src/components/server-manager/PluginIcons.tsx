import buberImg from '../../assets/plugin-icons/buber.png'
import bankingImg from '../../assets/plugin-icons/bank.jpg'

/**
 * Optional preview-image URL per plugin id, shown as a popover on hover in the
 * plugin browser. Returns undefined for plugins without a screenshot.
 */
export function pluginPreviewImage(pluginId: string): string | undefined {
  switch (pluginId) {
    case 'buber':
      return buberImg
    case 'careermp-banking':
      return bankingImg
    default:
      return undefined
  }
}

interface IconProps {
  size?: number
  className?: string
}

const defaults = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.3,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const
}

/**
 * Render an emoji glyph at the same size/className contract as our SVG icons.
 * Uses leading-none + a slight downsize so the glyph optically matches the
 * 16px stroke icons rendered alongside it.
 */
function EmojiIcon({ glyph, size = 16, className = '' }: IconProps & { glyph: string }) {
  return (
    <span
      className={className}
      style={{
        fontSize: size,
        lineHeight: 1,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size
      }}
      aria-hidden="true"
    >
      {glyph}
    </span>
  )
}

/**
 * Buber — ride-hailing parody. Renders the 🚕 taxi emoji.
 */
export function BuberIcon({ size = 16, className = '' }: IconProps) {
  return <EmojiIcon glyph="🚕" size={size} className={className} />
}

/**
 * Banking — renders the 🏦 bank emoji.
 */
export function BankingIcon({ size = 16, className = '' }: IconProps) {
  return <EmojiIcon glyph="🏦" size={size} className={className} />
}

/**
 * DynamicTraffic — renders the 🚦 traffic light emoji.
 */
export function DynamicTrafficIcon({ size = 16, className = '' }: IconProps) {
  return <EmojiIcon glyph="🚦" size={size} className={className} />
}

/**
 * CobaltEssentials — hexagonal gem with an admin star.
 */
export function CobaltEssentialsIcon({ size = 16, className = '' }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      className={className}
      {...defaults}
    >
      {/* hexagon */}
      <path d="M8 1L13.5 4.25v7.5L8 15 2.5 11.75v-7.5Z" />
      {/* facet lines — gem feel */}
      <path d="M8 1v5.5M2.5 4.25L8 6.5M13.5 4.25L8 6.5" />
      {/* small 4-point star in centre */}
      <path d="M8 7.5l.7 1.8L10.5 10l-1.8.7L8 12.5l-.7-1.8L5.5 10l1.8-.7Z" />
    </svg>
  )
}

/**
 * CEI — monitor/panel with slider controls representing the Dear ImGui admin overlay.
 */
export function CEIIcon({ size = 16, className = '' }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      className={className}
      {...defaults}
    >
      {/* monitor frame */}
      <rect x="1.5" y="1.5" width="13" height="10" rx="1.2" />
      {/* stand */}
      <path d="M6 11.5v2h4v-2" />
      {/* slider tracks inside screen */}
      <line x1="4" y1="4.5" x2="12" y2="4.5" />
      <line x1="4" y1="7" x2="12" y2="7" />
      <line x1="4" y1="9.5" x2="12" y2="9.5" />
      {/* slider knobs at different positions */}
      <circle cx="7" cy="4.5" r=".7" fill="currentColor" stroke="none" />
      <circle cx="10" cy="7" r=".7" fill="currentColor" stroke="none" />
      <circle cx="5.5" cy="9.5" r=".7" fill="currentColor" stroke="none" />
    </svg>
  )
}

/**
 * RestartNotifier — circular restart arrow with a bell.
 */
export function RestartNotifierIcon({ size = 16, className = '' }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      className={className}
      {...defaults}
    >
      {/* circular arrow — restart */}
      <path d="M2.5 8a5.5 5.5 0 1 1 1.1 3.3" />
      <path d="M2.5 8L1 5.8M2.5 8L5 6.5" />
      {/* bell in centre */}
      <path d="M7 5.5a1 1 0 0 1 2 0c0 1.2 1.2 1.8 1.2 3H5.8c0-1.2 1.2-1.8 1.2-3Z" />
      <path d="M7.4 10.5a.6.6 0 0 0 1.2 0" />
    </svg>
  )
}

/**
 * ProFilter — renders the 🤬 cursing-face emoji to convey chat filtering.
 */
export function ProFilterIcon({ size = 16, className = '' }: IconProps) {
  return <EmojiIcon glyph="🤬" size={size} className={className} />
}

/**
 * QuickChat — speech bubble with a lightning bolt, conveying fast preset messaging.
 */
export function QuickChatIcon({ size = 16, className = '' }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      className={className}
      {...defaults}
    >
      {/* rounded speech bubble */}
      <path d="M2 2.5h12a.5.5 0 0 1 .5.5v7.5a.5.5 0 0 1-.5.5H6l-3 3v-3H2a.5.5 0 0 1-.5-.5V3a.5.5 0 0 1 .5-.5Z" />
      {/* lightning bolt */}
      <path d="M9.2 4L6.5 7.8h2l-.7 3L11 7h-2Z" fill="currentColor" />
    </svg>
  )
}
