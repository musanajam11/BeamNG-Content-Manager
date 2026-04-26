import { useState, useMemo, type ReactElement } from 'react'
import { ChevronDown, ChevronUp, BookOpen } from 'lucide-react'
import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'

/* ── Raw README markdown files ── */
import careermpModMd from '../../assets/readmes/careermp-mod.md?raw'
import rlsModMd from '../../assets/readmes/rls-mod.md?raw'
import careermpBankingMd from '../../assets/readmes/careermp-banking.md?raw'
import rlsCareerMpCompatPatchMd from '../../assets/readmes/rls-careermp-compat-patch.md?raw'
import buberMd from '../../assets/readmes/buber.md?raw'
import dynamicTrafficMd from '../../assets/readmes/dynamic-traffic.md?raw'
import cobaltEssentialsMd from '../../assets/readmes/cobalt-essentials.md?raw'
import cobaltEssentialsInterfaceMd from '../../assets/readmes/cobalt-essentials-interface.md?raw'
import restartNotifierMd from '../../assets/readmes/restart-notifier.md?raw'
import profilterMd from '../../assets/readmes/profilter.md?raw'
import beammpQuickChatMd from '../../assets/readmes/beammp-quick-chat.md?raw'
import citybusDisplaysSyncMd from '../../assets/readmes/citybus-displays-sync.md?raw'

/* ── CareerMP local images (GitHub user-attachments don't load in Electron) ── */
import cmpBanner from '../../assets/careermp-readme/banner.png'
import cmpGallery1 from '../../assets/careermp-readme/gallery1.png'
import cmpGallery2 from '../../assets/careermp-readme/gallery2.png'
import cmpGallery3 from '../../assets/careermp-readme/gallery3.png'
import cmpGallery4 from '../../assets/careermp-readme/gallery4.png'
import cmpGallery5 from '../../assets/careermp-readme/gallery5.png'
import cmpGallery6 from '../../assets/careermp-readme/gallery6.png'
import cmpGallery7 from '../../assets/careermp-readme/gallery7.png'

/* ── CEI local images ── */
import ceiBanner from '../../assets/cei-readme/banner.png'
import ceiGallery1 from '../../assets/cei-readme/gallery1.png'
import ceiGallery2 from '../../assets/cei-readme/gallery2.png'
import ceiGallery3 from '../../assets/cei-readme/gallery3.png'
import ceiGallery4 from '../../assets/cei-readme/gallery4.png'
import ceiGallery5 from '../../assets/cei-readme/gallery5.png'
import ceiGallery6 from '../../assets/cei-readme/gallery6.png'
import ceiGallery7 from '../../assets/cei-readme/gallery7.png'
import ceiGallery8 from '../../assets/cei-readme/gallery8.png'
import ceiGallery9 from '../../assets/cei-readme/gallery9.png'
import ceiGallery10 from '../../assets/cei-readme/gallery10.png'
import ceiGallery11 from '../../assets/cei-readme/gallery11.png'
import ceiGallery12 from '../../assets/cei-readme/gallery12.png'

/* ── Plugin ID → raw markdown ── */
const README_BY_ID: Record<string, string> = {
  'careermp-mod': careermpModMd,
  'rls-mod': rlsModMd,
  'rls-careermp-compat-patch': rlsCareerMpCompatPatchMd,
  'careermp-banking': careermpBankingMd,
  buber: buberMd,
  'dynamic-traffic': dynamicTrafficMd,
  'cobalt-essentials': cobaltEssentialsMd,
  'cobalt-essentials-interface': cobaltEssentialsInterfaceMd,
  'restart-notifier': restartNotifierMd,
  profilter: profilterMd,
  'beammp-quick-chat': beammpQuickChatMd,
  'citybus-displays-sync': citybusDisplaysSyncMd
}

/* ── Remote image URL → bundled local asset ── */
const IMAGE_URL_MAP: Record<string, string> = {
  // CareerMP README images (in markdown order)
  'https://github.com/user-attachments/assets/bd9bcb2f-530f-4fcd-a76b-732ec6ce7159': cmpBanner,
  'https://github.com/user-attachments/assets/ffe64e84-09db-4894-8338-3835dbad39ac': cmpGallery1,
  'https://github.com/user-attachments/assets/bb741ab2-7710-42e6-8835-0fc028933e8d': cmpGallery2,
  'https://github.com/user-attachments/assets/481bd55a-cc52-4b21-b290-ce934bb7a956': cmpGallery3,
  'https://github.com/user-attachments/assets/a610afff-fb08-4c9f-937c-ba7bfbbe72d1': cmpGallery4,
  'https://github.com/user-attachments/assets/769505e7-bdb1-4eed-a6b7-a5640671353b': cmpGallery5,
  'https://github.com/user-attachments/assets/14cab7ec-0ebb-4a37-a08d-0e7780360036': cmpGallery6,
  'https://github.com/user-attachments/assets/bdc5aa9f-e731-43c0-bb14-31ea6bf0647c': cmpGallery7,
  // CEI README images (in markdown order)
  'https://github.com/user-attachments/assets/045e716b-6e17-42fb-8688-e08cefd51570': ceiBanner,
  'https://user-images.githubusercontent.com/49531350/198840298-9c8051d2-2af8-4c09-9510-7b38681c0a12.png': ceiGallery1,
  'https://user-images.githubusercontent.com/49531350/198840314-2020dd72-8167-418a-8690-ea62d573f0d9.png': ceiGallery2,
  'https://user-images.githubusercontent.com/49531350/198840327-046de3d6-88a1-48da-9e94-401a11204f66.png': ceiGallery3,
  'https://user-images.githubusercontent.com/49531350/198840338-05652513-452d-446a-a579-dd1d2be9e379.png': ceiGallery4,
  'https://user-images.githubusercontent.com/49531350/198840354-f2447b2e-1a2b-45eb-a129-8c6c6530c772.png': ceiGallery5,
  'https://user-images.githubusercontent.com/49531350/198840369-ad1ad214-5cb5-4b3d-aab7-20c6ef39c743.png': ceiGallery6,
  'https://user-images.githubusercontent.com/49531350/198840391-93c03f21-6f81-412e-a8e4-5da06ec9222d.png': ceiGallery7,
  'https://user-images.githubusercontent.com/49531350/198840408-e6bb4bfa-b49d-489d-b4af-169e54ab17b1.png': ceiGallery8,
  'https://user-images.githubusercontent.com/49531350/198840423-6c86d513-a0a9-4850-9b02-ea43ef4a0396.png': ceiGallery9,
  'https://user-images.githubusercontent.com/49531350/198840433-92d40023-0908-4074-aadf-4e07735e871a.png': ceiGallery10,
  'https://user-images.githubusercontent.com/49531350/198840445-cbff3513-6d94-4413-bc42-ac392af9060f.png': ceiGallery11,
  'https://user-images.githubusercontent.com/49531350/198840453-95532b39-2048-40b1-904b-7ad2eda28394.png': ceiGallery12
}

interface Props {
  pluginId: string
}

export function PluginReadmeToggle({ pluginId }: Props): ReactElement | null {
  const [open, setOpen] = useState(false)
  const markdown = README_BY_ID[pluginId]

  const components: Components = useMemo(
    () => ({
      img: ({ src, alt, ...rest }) => {
        const srcStr = typeof src === 'string' ? src : ''
        const mapped = srcStr && IMAGE_URL_MAP[srcStr] ? IMAGE_URL_MAP[srcStr] : srcStr
        return (
          <img
            src={mapped}
            alt={alt || ''}
            className="rounded-lg max-w-full h-auto my-2"
            loading="lazy"
            {...rest}
          />
        )
      },
      a: ({ href, children, ...rest }) => (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[var(--color-accent)] hover:underline"
          {...rest}
        >
          {children}
        </a>
      )
    }),
    []
  )

  if (!markdown) return null

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)] hover:text-[var(--color-accent)] transition-colors"
      >
        <BookOpen size={12} />
        README
        {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
      </button>
      {open && (
        <div className="mt-2 max-h-64 overflow-y-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-scrim-20)] p-3 text-xs text-[var(--text-muted)] scrollbar-thin readme-prose">
          <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]} components={components}>
            {markdown}
          </Markdown>
        </div>
      )}
    </div>
  )
}

