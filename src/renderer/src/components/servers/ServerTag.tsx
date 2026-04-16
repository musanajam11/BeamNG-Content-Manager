import type { RichTag } from '../../utils/serverTags'
import { TAG_TONES } from '../../utils/serverTags'

interface Props {
  tag: RichTag
  /** Compact mode for list rows (smaller text, tighter padding). */
  compact?: boolean
}

export function ServerTagBadge({ tag, compact }: Props): React.JSX.Element {
  const Icon = tag.icon
  const toneClass = TAG_TONES[tag.tone] || TAG_TONES.default

  return (
    <span
      className={`inline-flex items-center gap-1 border ${toneClass} ${
        compact
          ? 'px-1.5 py-0 text-[9px]'
          : 'rounded-full px-2.5 py-1 text-[11px]'
      } font-medium leading-snug`}
      title={tag.label}
    >
      <Icon size={compact ? 8 : 10} className="shrink-0" />
      <span className={compact ? 'max-w-[72px] truncate' : ''}>{tag.label}</span>
    </span>
  )
}
