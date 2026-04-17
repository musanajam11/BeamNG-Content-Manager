import { useState, useEffect } from 'react'

export function useLiveUptime(startedAt: number | null, isRunning: boolean): number {
  const [uptime, setUptime] = useState(() =>
    isRunning && startedAt ? Date.now() - startedAt : 0
  )

  useEffect(() => {
    if (!isRunning || !startedAt) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset timer
      setUptime(0)
      return
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial sync
    setUptime(Date.now() - startedAt)
    const id = setInterval(() => setUptime(Date.now() - startedAt), 1000)
    return () => clearInterval(id)
  }, [isRunning, startedAt])

  return uptime
}
