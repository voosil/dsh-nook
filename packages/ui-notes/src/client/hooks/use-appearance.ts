import { useEffect, useState } from 'react'

export type Appearance = 'paper' | 'claude' | 'night' | 'memphis'
const key = 'nook.appearance'
function readAppearance(): Appearance {
  try {
    const saved = localStorage.getItem(key)
    return saved === 'claude' || saved === 'night' || saved === 'memphis' ? saved : 'paper'
  } catch {
    return 'paper'
  }
}

export function useAppearance() {
  const [appearance, setAppearance] = useState<Appearance>(readAppearance)
  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (event.key === key || event.key === null) setAppearance(readAppearance())
    }
    window.addEventListener('storage', changed)
    return () => window.removeEventListener('storage', changed)
  }, [])
  return [
    appearance,
    (next: Appearance) => {
      setAppearance(next)
      try {
        localStorage.setItem(key, next)
      } catch {
        // Restricted storage still permits an in-session appearance choice.
      }
    },
  ] as const
}
