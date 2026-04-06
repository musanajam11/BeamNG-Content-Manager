import { useState, useEffect } from 'react'

export function useLiveUptime(startedAt: number | null, isRunning: boolean): number {
  const [uptime, setUptime] = useState(() =>
    isRunning && startedAt ? Date.now() - startedAt : 0
  )

  useEffect(() => {
    if (!isRunning || !startedAt) {
      setUptime(0)
      return
    }
    setUptime(Date.now() - startedAt)
    const id = setInterval(() => setUptime(Date.now() - startedAt), 1000)
    return () => clearInterval(id)
  }, [isRunning, startedAt])

  return uptime
}
