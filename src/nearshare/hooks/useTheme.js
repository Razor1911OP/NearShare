import { useCallback, useEffect, useState } from 'react'

const KEY = 'nearshare:theme'

function readInitial() {
  if (typeof window === 'undefined') return 'dark'
  try {
    const saved = window.localStorage.getItem(KEY)
    if (saved === 'light' || saved === 'dark') return saved
  } catch (_) { /* ignore */ }
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

/**
 * Light/dark theme controller.
 * Writes `data-ns-theme` on <html>, which the token overrides in index.css key off.
 */
export default function useTheme() {
  const [theme, setTheme] = useState('dark')

  // Resolve after mount so SSR/hydration stay in sync.
  useEffect(() => { setTheme(readInitial()) }, [])

  useEffect(() => {
    if (typeof document === 'undefined') return
    document.documentElement.setAttribute('data-ns-theme', theme)
    document.documentElement.style.colorScheme = theme
    try { window.localStorage.setItem(KEY, theme) } catch (_) { /* ignore */ }
  }, [theme])

  const toggleTheme = useCallback(() => {
    setTheme(t => (t === 'dark' ? 'light' : 'dark'))
  }, [])

  return { theme, toggleTheme }
}
