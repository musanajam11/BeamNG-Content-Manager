import { useState, useEffect, useMemo } from 'react'
import {
  Users,
  UserPlus,
  Search,
  RefreshCw,
  WifiOff,
  Handshake,
  Lock,
  Construction
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useFriendsStore } from '../stores/useFriendsStore'
import { useServerStore } from '../stores/useServerStore'
import { FriendCard } from '../components/friends/FriendCard'
import { FriendSuggestions } from '../components/friends/FriendSuggestions'
import { AddFriendModal } from '../components/friends/AddFriendModal'

type Tab = 'all' | 'online' | 'offline' | 'suggestions' | 'beammp-requests'

export function FriendsPage(): React.JSX.Element {
  const { t } = useTranslation()
  const {
    friends,
    onlineStatus,
    suggestions,
    loading,
    searchQuery,
    loadFriends,
    addFriend,
    removeFriend,
    loadSessions,
    refreshOnlineStatus,
    computeSuggestions,
    setSearchQuery
  } = useFriendsStore()

  const servers = useServerStore((s) => s.servers)
  const [showAddModal, setShowAddModal] = useState(false)
  const [activeTab, setActiveTab] = useState<Tab>('all')
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null)

  useEffect(() => {
    loadFriends()
    loadSessions()
  }, [])

  useEffect(() => {
    if (servers.length > 0 && friends.length > 0) {
      refreshOnlineStatus(servers)
    }
  }, [servers, friends])

  useEffect(() => {
    computeSuggestions()
  }, [friends])

  const existingIds = useMemo(() => new Set(friends.map((f) => f.id.toLowerCase())), [friends])

  const onlineCount = useMemo(
    () => [...onlineStatus.values()].filter((s) => s.online).length,
    [onlineStatus]
  )

  const displayedFriends = useMemo(() => {
    let list = [...friends]
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      list = list.filter(
        (f) =>
          f.displayName.toLowerCase().includes(q) ||
          f.id.toLowerCase().includes(q) ||
          f.notes?.toLowerCase().includes(q)
      )
    }
    if (activeTab === 'online') {
      list = list.filter((f) => onlineStatus.get(f.id)?.online)
    } else if (activeTab === 'offline') {
      list = list.filter((f) => !onlineStatus.get(f.id)?.online)
    }
    list.sort((a, b) => {
      const aOnline = onlineStatus.get(a.id)?.online ? 1 : 0
      const bOnline = onlineStatus.get(b.id)?.online ? 1 : 0
      if (aOnline !== bOnline) return bOnline - aOnline
      return a.displayName.localeCompare(b.displayName)
    })
    return list
  }, [friends, searchQuery, activeTab, onlineStatus])

  const handleRemove = (id: string): void => {
    if (confirmRemove === id) {
      removeFriend(id)
      setConfirmRemove(null)
    } else {
      setConfirmRemove(id)
      setTimeout(() => setConfirmRemove(null), 3000)
    }
  }

  const handleAddSuggestion = async (name: string): Promise<void> => {
    await addFriend(name, name)
  }

  const handleJoinServer = async (ident: string): Promise<void> => {
    const [ip, portStr] = ident.split(':')
    if (!ip || !portStr) return
    try {
      await window.api.joinServer(ip, parseInt(portStr, 10))
    } catch (err) {
      console.error('Failed to join server:', err)
    }
  }

  const tabs: Array<{ id: Tab; label: string; count?: number }> = [
    { id: 'all', label: t('friends.tabAll'), count: friends.length },
    { id: 'online', label: t('friends.tabOnline'), count: onlineCount },
    { id: 'offline', label: t('friends.tabOffline'), count: friends.length - onlineCount },
    { id: 'suggestions', label: t('friends.tabSuggestions'), count: suggestions.length },
    { id: 'beammp-requests', label: t('friends.tabBeamMPRequests') }
  ]

  return (
    <div className="flex-1 flex flex-col gap-4 h-full">
      {/* Header */}
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <Users size={20} className="text-[var(--color-accent)]" />
          <h1 className="text-xl font-bold text-[var(--color-text-primary)]">{t('friends.title')}</h1>
          {friends.length > 0 && (
            <span className="text-xs text-[var(--color-text-muted)]">
              {t('friends.countSummary', { online: onlineCount, total: friends.length })}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { loadFriends(); loadSessions() }}
            className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
            title={t('common.refresh')}
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--color-accent)] text-white text-xs font-medium hover:brightness-110 transition-all"
          >
            <UserPlus size={14} />
            {t('friends.title')}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 shrink-0 border-b border-[var(--color-border)] pb-2">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              activeTab === tab.id
                ? 'bg-[var(--color-accent-subtle)] text-[var(--color-accent-text-muted)] border border-[var(--color-accent-25)]'
                : 'text-slate-400 hover:text-white hover:bg-white/8'
            }`}
          >
            {tab.label}
            {tab.count !== undefined && (
              <span className="ml-1.5 text-[10px] opacity-60">({tab.count})</span>
            )}
          </button>
        ))}
      </div>

      {/* Search */}
      {activeTab !== 'suggestions' && activeTab !== 'beammp-requests' && (
        <div className="relative shrink-0">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('friends.searchFriends')}
            className="w-full pr-3 py-2 rounded-lg bg-black/20 border border-[var(--color-border)] text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent)]"
            style={{ paddingLeft: 36 }}
          />
        </div>
      )}

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {activeTab === 'beammp-requests' ? (
          <BeamMPRequestsStub />
        ) : activeTab === 'suggestions' ? (
          <SuggestionsView suggestions={suggestions} onAdd={handleAddSuggestion} />
        ) : friends.length === 0 ? (
          <EmptyState onAdd={() => setShowAddModal(true)} />
        ) : displayedFriends.length === 0 ? (
          <NoResults activeTab={activeTab} />
        ) : (
          <div className="space-y-2">
            {displayedFriends.map((friend) => (
              <FriendCard
                key={friend.id}
                friend={friend}
                status={onlineStatus.get(friend.id)}
                onRemove={handleRemove}
                onJoinServer={handleJoinServer}
              />
            ))}
          </div>
        )}
      </div>

      {confirmRemove && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-400">
          {t('friends.removeConfirmToast')}
        </div>
      )}

      <AddFriendModal
        open={showAddModal}
        onClose={() => setShowAddModal(false)}
        onAdd={(name) => addFriend(name, name)}
        existingIds={existingIds}
      />
    </div>
  )
}

/* ── Sub-components ── */

function BeamMPRequestsStub(): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col items-center justify-center gap-5 py-16 text-center">
      <div className="relative">
        <Handshake size={56} className="text-[var(--color-accent)] opacity-30" />
        <Lock size={20} className="absolute -bottom-1 -right-1 text-slate-500" />
      </div>
      <div className="space-y-2 max-w-sm">
        <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
          {t('friends.beammpRequestsTitle')}
        </h2>
        <p className="text-sm text-[var(--color-text-muted)] leading-relaxed">
          {t('friends.beammpRequestsDescription')}
        </p>
      </div>
      <div className="grid gap-3 max-w-sm w-full text-left">
        <div className="flex items-start gap-3 p-3 rounded-lg bg-white/5 border border-[var(--color-border)]">
          <Handshake size={16} className="text-[var(--color-accent)] mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium text-[var(--color-text-primary)]">
              {t('friends.featureSendReceive')}
            </p>
            <p className="text-xs text-[var(--color-text-muted)]">
              {t('friends.featureMutualAcceptance')}
            </p>
          </div>
        </div>
        <div className="flex items-start gap-3 p-3 rounded-lg bg-white/5 border border-[var(--color-border)]">
          <Construction size={16} className="text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium text-[var(--color-text-primary)]">
              {t('friends.featureBackendSupport')}
            </p>
            <p className="text-xs text-[var(--color-text-muted)]">
              {t('friends.featureWaitingBackend')}
            </p>
          </div>
        </div>
      </div>
      <div className="mt-1 px-4 py-2 rounded-full bg-slate-500/10 border border-slate-500/20">
        <span className="text-xs font-medium text-slate-400">{t('friends.pendingBackendSupport')}</span>
      </div>
    </div>
  )
}

function SuggestionsView({ suggestions, onAdd }: { suggestions: Array<{ name: string; seenCount: number; lastSeen: number }>; onAdd: (name: string) => void }): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="space-y-4">
      <FriendSuggestions suggestions={suggestions} onAdd={onAdd} />
      {suggestions.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
          <Users size={40} className="text-slate-600" />
          <p className="text-sm text-[var(--color-text-muted)]">
            {t('friends.noSuggestionsYet')}
          </p>
        </div>
      )}
    </div>
  )
}

function EmptyState({ onAdd }: { onAdd: () => void }): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
      <Users size={48} className="text-slate-600" />
      <div className="space-y-1">
        <p className="text-sm font-medium text-[var(--color-text-primary)]">{t('friends.noFriendsYet')}</p>
        <p className="text-xs text-[var(--color-text-muted)]">
          {t('friends.addFriendsDescription')}
        </p>
      </div>
      <button
        onClick={onAdd}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--color-accent)] text-white text-xs font-medium hover:brightness-110 transition-all"
      >
        <UserPlus size={14} />
        {t('friends.addFirstFriend')}
      </button>
    </div>
  )
}

function NoResults({ activeTab }: { activeTab: string }): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
      {activeTab === 'online' ? (
        <WifiOff size={40} className="text-slate-600" />
      ) : (
        <Search size={40} className="text-slate-600" />
      )}
      <p className="text-sm text-[var(--color-text-muted)]">
        {activeTab === 'online'
          ? t('friends.noOnlineFriends')
          : activeTab === 'offline'
            ? t('friends.allFriendsOnline')
            : t('friends.noSearchResults')}
      </p>
    </div>
  )
}
