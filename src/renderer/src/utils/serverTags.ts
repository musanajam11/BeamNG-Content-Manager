/**
 * Rich server tag classification system.
 *
 * Parses raw comma-separated tag strings from the BeamMP server API into
 * structured tags with icons, colors, and categories.  Handles fuzzy matching,
 * category-prefix stripping (e.g. "Racing:Rally" → "Rally"), common aliases,
 * language detection, and graceful fallback for unknown tags.
 */

import {
  ShieldAlert, Compass, Briefcase, Users, Trophy, Sparkles,
  Flag, CircleDot, ArrowRight, Mountain, Wind, Flame,
  TreePine, Droplets, Snowflake, CloudRain,
  Clock, Moon, CloudLightning,
  Bug, Shield, Target, Zap,
  Truck, Coins, ArrowLeftRight, BarChart3, Calendar,
  Package, Paintbrush, Gamepad2, Wrench,
  Globe, Leaf, ShieldOff, ShieldCheck, Hammer, Tag
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface RichTag {
  id: string
  label: string
  icon: LucideIcon
  tone: string
  category: string
}

// ---------------------------------------------------------------------------
// Tone palette (Tailwind classes)
// ---------------------------------------------------------------------------

export const TAG_TONES: Record<string, string> = {
  red:     'border-red-400/25 bg-red-400/10 text-red-300',
  amber:   'border-amber-400/25 bg-amber-400/10 text-amber-300',
  yellow:  'border-yellow-400/25 bg-yellow-400/10 text-yellow-200',
  emerald: 'border-emerald-400/25 bg-emerald-400/10 text-emerald-300',
  teal:    'border-teal-400/25 bg-teal-400/10 text-teal-300',
  sky:     'border-sky-400/25 bg-sky-400/10 text-sky-300',
  blue:    'border-blue-400/25 bg-blue-400/10 text-blue-300',
  purple:  'border-purple-400/25 bg-purple-400/10 text-purple-300',
  stone:   'border-stone-400/25 bg-stone-400/10 text-stone-300',
  default: 'border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-secondary)]',
  accent:  'border-[var(--color-accent-25)] bg-[var(--color-accent-subtle)] text-[var(--color-accent-text-muted)]',
}

// ---------------------------------------------------------------------------
// Canonical tag definitions
// ---------------------------------------------------------------------------

interface TagDef {
  label: string
  icon: LucideIcon
  tone: string
  category: string
}

/** Lookup table – keys are normalised (lowercase, trimmed). */
const TAGS: Record<string, TagDef> = {
  // ── Disclaimers ──────────────────────────────────────────────────────
  'mature':              { label: '18+',              icon: ShieldAlert,    tone: 'red',     category: 'disclaimer' },
  '18+':                 { label: '18+',              icon: ShieldAlert,    tone: 'red',     category: 'disclaimer' },
  'nsfw':                { label: '18+',              icon: ShieldAlert,    tone: 'red',     category: 'disclaimer' },

  // ── Gameplay ─────────────────────────────────────────────────────────
  'freeroam':            { label: 'Freeroam',         icon: Compass,        tone: 'blue',    category: 'gameplay' },
  'free roam':           { label: 'Freeroam',         icon: Compass,        tone: 'blue',    category: 'gameplay' },
  'career':              { label: 'Career',           icon: Briefcase,      tone: 'blue',    category: 'gameplay' },
  'roleplay':            { label: 'Roleplay',         icon: Users,          tone: 'blue',    category: 'gameplay' },
  'rp':                  { label: 'Roleplay',         icon: Users,          tone: 'blue',    category: 'gameplay' },
  'custom':              { label: 'Custom',           icon: Sparkles,       tone: 'blue',    category: 'gameplay' },

  // ── Motorsports ──────────────────────────────────────────────────────
  'motorsports':         { label: 'Motorsports',      icon: Trophy,         tone: 'amber',   category: 'motorsports' },
  'motorsport':          { label: 'Motorsports',      icon: Trophy,         tone: 'amber',   category: 'motorsports' },
  'racing':              { label: 'Racing',           icon: Trophy,         tone: 'amber',   category: 'motorsports' },
  'track':               { label: 'Track',            icon: Flag,           tone: 'amber',   category: 'motorsports' },
  'circuit':             { label: 'Track',            icon: Flag,           tone: 'amber',   category: 'motorsports' },
  'nascar':              { label: 'NASCAR',           icon: CircleDot,      tone: 'amber',   category: 'motorsports' },
  'drag racing':         { label: 'Drag Racing',      icon: ArrowRight,     tone: 'amber',   category: 'motorsports' },
  'drag':                { label: 'Drag Racing',      icon: ArrowRight,     tone: 'amber',   category: 'motorsports' },
  'rally':               { label: 'Rally',            icon: Mountain,       tone: 'amber',   category: 'motorsports' },
  'dakar':               { label: 'Dakar',            icon: Mountain,       tone: 'amber',   category: 'motorsports' },
  'drifting':            { label: 'Drifting',         icon: Wind,           tone: 'amber',   category: 'motorsports' },
  'drift':               { label: 'Drifting',         icon: Wind,           tone: 'amber',   category: 'motorsports' },
  'touge':               { label: 'Touge',            icon: Mountain,       tone: 'amber',   category: 'motorsports' },
  'togue':               { label: 'Touge',            icon: Mountain,       tone: 'amber',   category: 'motorsports' },
  'destruction':         { label: 'Destruction',      icon: Flame,          tone: 'amber',   category: 'motorsports' },
  'demolition':          { label: 'Demolition Derby', icon: Flame,          tone: 'amber',   category: 'motorsports' },

  // ── Off-road ─────────────────────────────────────────────────────────
  'offroad':             { label: 'Off-road',         icon: TreePine,       tone: 'emerald', category: 'offroad' },
  'off-road':            { label: 'Off-road',         icon: TreePine,       tone: 'emerald', category: 'offroad' },
  'off road':            { label: 'Off-road',         icon: TreePine,       tone: 'emerald', category: 'offroad' },
  'rock crawling':       { label: 'Rock Crawling',    icon: Mountain,       tone: 'emerald', category: 'offroad' },
  'rockcrawling':        { label: 'Rock Crawling',    icon: Mountain,       tone: 'emerald', category: 'offroad' },
  'crawling':            { label: 'Rock Crawling',    icon: Mountain,       tone: 'emerald', category: 'offroad' },

  // ── Surface ──────────────────────────────────────────────────────────
  'asphalt':             { label: 'Asphalt',          icon: CircleDot,      tone: 'stone',   category: 'surface' },
  'paved':               { label: 'Asphalt',          icon: CircleDot,      tone: 'stone',   category: 'surface' },
  'tarmac':              { label: 'Asphalt',          icon: CircleDot,      tone: 'stone',   category: 'surface' },
  'dirt':                { label: 'Dirt',             icon: Leaf,           tone: 'stone',   category: 'surface' },
  'gravel':              { label: 'Gravel',           icon: Leaf,           tone: 'stone',   category: 'surface' },
  'mud':                 { label: 'Mud',              icon: Droplets,       tone: 'stone',   category: 'surface' },
  'muddy':               { label: 'Mud',              icon: Droplets,       tone: 'stone',   category: 'surface' },
  'ice':                 { label: 'Ice',              icon: Snowflake,      tone: 'sky',     category: 'surface' },
  'icy':                 { label: 'Ice',              icon: Snowflake,      tone: 'sky',     category: 'surface' },
  'snow':                { label: 'Snow',             icon: Snowflake,      tone: 'sky',     category: 'surface' },
  'snowy':               { label: 'Snow',             icon: Snowflake,      tone: 'sky',     category: 'surface' },
  'rain':                { label: 'Rain',             icon: CloudRain,      tone: 'sky',     category: 'surface' },
  'rainy':               { label: 'Rain',             icon: CloudRain,      tone: 'sky',     category: 'surface' },
  'wet':                 { label: 'Rain',             icon: CloudRain,      tone: 'sky',     category: 'surface' },

  // ── Weather ──────────────────────────────────────────────────────────
  'time cycle':          { label: 'Time Cycle',       icon: Clock,          tone: 'sky',     category: 'weather' },
  'day-night':           { label: 'Time Cycle',       icon: Clock,          tone: 'sky',     category: 'weather' },
  'day night':           { label: 'Time Cycle',       icon: Clock,          tone: 'sky',     category: 'weather' },
  'day/night':           { label: 'Time Cycle',       icon: Clock,          tone: 'sky',     category: 'weather' },
  'night':               { label: 'Night',            icon: Moon,           tone: 'sky',     category: 'weather' },
  'natural disaster':    { label: 'Natural Disaster', icon: CloudLightning, tone: 'sky',     category: 'weather' },
  'disaster':            { label: 'Natural Disaster', icon: CloudLightning, tone: 'sky',     category: 'weather' },
  'storm':               { label: 'Storm',            icon: CloudLightning, tone: 'sky',     category: 'weather' },

  // ── Gamemode ─────────────────────────────────────────────────────────
  'derby':               { label: 'Derby',            icon: Flame,          tone: 'purple',  category: 'gamemode' },
  'demolition derby':    { label: 'Demolition Derby', icon: Flame,          tone: 'purple',  category: 'gamemode' },
  'demo derby':          { label: 'Demolition Derby', icon: Flame,          tone: 'purple',  category: 'gamemode' },
  'infection':           { label: 'Infection',        icon: Bug,            tone: 'purple',  category: 'gamemode' },
  'zombie':              { label: 'Infection',        icon: Bug,            tone: 'purple',  category: 'gamemode' },
  'zombies':             { label: 'Infection',        icon: Bug,            tone: 'purple',  category: 'gamemode' },
  'cops-robbers':        { label: 'Cops & Robbers',   icon: Shield,         tone: 'purple',  category: 'gamemode' },
  'cops and robbers':    { label: 'Cops & Robbers',   icon: Shield,         tone: 'purple',  category: 'gamemode' },
  'cops robbers':        { label: 'Cops & Robbers',   icon: Shield,         tone: 'purple',  category: 'gamemode' },
  'police':              { label: 'Cops & Robbers',   icon: Shield,         tone: 'purple',  category: 'gamemode' },
  'sumo':                { label: 'Sumo',             icon: Target,         tone: 'purple',  category: 'gamemode' },
  'chases':              { label: 'Chases',           icon: Zap,            tone: 'purple',  category: 'gamemode' },
  'chase':               { label: 'Chases',           icon: Zap,            tone: 'purple',  category: 'gamemode' },
  'pursuit':             { label: 'Chases',           icon: Zap,            tone: 'purple',  category: 'gamemode' },

  // ── Features ─────────────────────────────────────────────────────────
  'delivery':            { label: 'Delivery',         icon: Truck,          tone: 'teal',    category: 'features' },
  'deliveries':          { label: 'Delivery',         icon: Truck,          tone: 'teal',    category: 'features' },
  'economy':             { label: 'Economy',          icon: Coins,          tone: 'teal',    category: 'features' },
  'trading':             { label: 'Trading',          icon: ArrowLeftRight, tone: 'teal',    category: 'features' },
  'trade':               { label: 'Trading',          icon: ArrowLeftRight, tone: 'teal',    category: 'features' },
  'missions':            { label: 'Missions',         icon: Target,         tone: 'teal',    category: 'features' },
  'mission':             { label: 'Missions',         icon: Target,         tone: 'teal',    category: 'features' },
  'leaderboard':         { label: 'Leaderboard',      icon: BarChart3,      tone: 'teal',    category: 'features' },
  'leaderboards':        { label: 'Leaderboard',      icon: BarChart3,      tone: 'teal',    category: 'features' },
  'events':              { label: 'Events',           icon: Calendar,       tone: 'teal',    category: 'features' },
  'event':               { label: 'Events',           icon: Calendar,       tone: 'teal',    category: 'features' },

  // ── Mods ─────────────────────────────────────────────────────────────
  'modded':              { label: 'Modded',           icon: Package,        tone: 'yellow',  category: 'mods' },
  'mods':                { label: 'Modded',           icon: Package,        tone: 'yellow',  category: 'mods' },
  'beampaint':           { label: 'BeamPaint',        icon: Paintbrush,     tone: 'yellow',  category: 'mods' },
  'beam paint':          { label: 'BeamPaint',        icon: Paintbrush,     tone: 'yellow',  category: 'mods' },
  'beamjoy':             { label: 'BeamJoy',          icon: Gamepad2,       tone: 'yellow',  category: 'mods' },
  'beam joy':            { label: 'BeamJoy',          icon: Gamepad2,       tone: 'yellow',  category: 'mods' },
  'cei':                 { label: 'CEI',              icon: Wrench,         tone: 'yellow',  category: 'mods' },
  'careermp':            { label: 'CareerMP',         icon: Briefcase,      tone: 'yellow',  category: 'mods' },
  'career mp':           { label: 'CareerMP',         icon: Briefcase,      tone: 'yellow',  category: 'mods' },

  // ── Other ────────────────────────────────────────────────────────────
  'vanilla':             { label: 'Vanilla',          icon: Leaf,           tone: 'default', category: 'other' },
  'stock':               { label: 'Vanilla',          icon: Leaf,           tone: 'default', category: 'other' },
  'unmoderated':         { label: 'Unmoderated',      icon: ShieldOff,      tone: 'red',     category: 'other' },
  'moderated':           { label: 'Moderated',        icon: ShieldCheck,    tone: 'emerald', category: 'other' },
  'development':         { label: 'In Development',   icon: Hammer,         tone: 'default', category: 'other' },
  'dev':                 { label: 'In Development',   icon: Hammer,         tone: 'default', category: 'other' },
  'wip':                 { label: 'Work in Progress', icon: Hammer,         tone: 'default', category: 'other' },
  'work-in-progress':    { label: 'Work in Progress', icon: Hammer,         tone: 'default', category: 'other' },
  'work in progress':    { label: 'Work in Progress', icon: Hammer,         tone: 'default', category: 'other' },
  'beta':                { label: 'Beta',             icon: Hammer,         tone: 'default', category: 'other' },
  'testing':             { label: 'Testing',          icon: Hammer,         tone: 'default', category: 'other' },
  'test':                { label: 'Testing',          icon: Hammer,         tone: 'default', category: 'other' },
}

// ---------------------------------------------------------------------------
// Language detection
// ---------------------------------------------------------------------------

const LANGUAGES = new Set([
  'english', 'spanish', 'french', 'german', 'portuguese', 'russian',
  'chinese', 'japanese', 'korean', 'arabic', 'turkish', 'polish',
  'italian', 'dutch', 'swedish', 'norwegian', 'danish', 'finnish',
  'czech', 'hungarian', 'romanian', 'greek', 'thai', 'vietnamese',
  'indonesian', 'malay', 'hindi', 'filipino', 'hebrew', 'ukrainian',
  'persian', 'serbian', 'croatian', 'bulgarian', 'slovak', 'slovenian',
  'latvian', 'lithuanian', 'estonian',
  // ISO-639-1 codes
  'en', 'es', 'fr', 'de', 'pt', 'ru', 'zh', 'ja', 'ko', 'ar', 'tr',
  'pl', 'it', 'nl', 'sv', 'no', 'da', 'fi', 'cs', 'hu', 'ro', 'el',
])

// ---------------------------------------------------------------------------
// Category prefixes that should be stripped before matching
// ---------------------------------------------------------------------------

const CATEGORY_PREFIXES = [
  'gameplay', 'motorsports', 'motorsport', 'offroad', 'off-road',
  'surface', 'weather', 'gamemode', 'features', 'feature', 'mods',
  'mod', 'disclaimer', 'racing', 'race', 'language', 'lang', 'offroad',
]

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

function classifyTag(raw: string): RichTag | null {
  const trimmed = raw.trim()
  if (!trimmed) return null

  const normalized = trimmed.toLowerCase()

  // 1. Exact match
  const exact = TAGS[normalized]
  if (exact) {
    return { id: normalized, label: exact.label, icon: exact.icon, tone: exact.tone, category: exact.category }
  }

  // 2. Strip category prefix after colon  (e.g. "Racing:Rally" → "rally")
  let value = normalized
  const colonIdx = normalized.indexOf(':')
  if (colonIdx !== -1) {
    value = normalized.slice(colonIdx + 1).trim()
    const hit = TAGS[value]
    if (hit) {
      return { id: value, label: hit.label, icon: hit.icon, tone: hit.tone, category: hit.category }
    }
  }

  // 3. Strip known category prefixes without colon (e.g. "Gamemode Rally")
  for (const prefix of CATEGORY_PREFIXES) {
    if (value.startsWith(prefix + ' ')) {
      const stripped = value.slice(prefix.length + 1).trim()
      const hit = TAGS[stripped]
      if (hit) {
        return { id: stripped, label: hit.label, icon: hit.icon, tone: hit.tone, category: hit.category }
      }
    }
  }

  // 4. Language detection
  if (LANGUAGES.has(normalized) || LANGUAGES.has(value)) {
    const displayName = (colonIdx !== -1 ? trimmed.slice(colonIdx + 1).trim() : trimmed)
      .replace(/\b\w/g, (c) => c.toUpperCase())
    return { id: `lang-${value}`, label: displayName, icon: Globe, tone: 'default', category: 'language' }
  }

  // 5. Fuzzy prefix matching — "drifting" matches "drift", etc.
  if (value.length >= 4) {
    for (const [key, def] of Object.entries(TAGS)) {
      if (key.length < 4) continue
      if (value.startsWith(key) || key.startsWith(value)) {
        return { id: key, label: def.label, icon: def.icon, tone: def.tone, category: def.category }
      }
    }
  }

  // 6. Alpha-only exact match (ignore hyphens, spaces, special chars)
  const alphaOnly = value.replace(/[^a-z0-9]/g, '')
  if (alphaOnly.length >= 3) {
    for (const [key, def] of Object.entries(TAGS)) {
      if (key.replace(/[^a-z0-9]/g, '') === alphaOnly) {
        return { id: key, label: def.label, icon: def.icon, tone: def.tone, category: def.category }
      }
    }
  }

  // 7. Fallback – unknown tag with generic icon
  const displayLabel = (colonIdx !== -1
    ? trimmed.slice(colonIdx + 1).trim()
    : trimmed
  ).replace(/\b\w/g, (c) => c.toUpperCase())

  return {
    id: `unknown-${normalized}`,
    label: displayLabel,
    icon: Tag,
    tone: 'default',
    category: 'unknown',
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse a raw comma-separated tags string into an array of rich tags.
 * Deduplicates by resolved label (e.g. "Racing:Rally" and "Gamemode:Rally"
 * both resolve to a single "Rally" tag).
 */
export function parseServerTags(rawTags: string): RichTag[] {
  if (!rawTags || rawTags === 'offline') return []

  const parts = rawTags.split(',').map((s) => s.trim()).filter(Boolean)
  const seen = new Set<string>()
  const result: RichTag[] = []

  for (const part of parts) {
    const tag = classifyTag(part)
    if (!tag) continue
    const key = tag.label.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(tag)
  }

  return result
}
