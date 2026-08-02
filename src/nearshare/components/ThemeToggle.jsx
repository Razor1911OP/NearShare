import React from 'react'
import useTheme from '../hooks/useTheme.js'

/** Header control that flips the app between dark and light. */
export default function ThemeToggle({ compact = false }) {
  const { theme, toggleTheme } = useTheme()
  const isDark = theme === 'dark'

  return (
    <button
      type="button"
      className={`ns-btn pewter${compact ? ' sm icon' : ' sm'}`}
      onClick={toggleTheme}
      title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      style={compact
        ? { minHeight: 'unset', width: 36, height: 36, padding: 0, borderRadius: 10 }
        : undefined}
    >
      <span aria-hidden="true" style={{ fontSize: '0.95rem', lineHeight: 1 }}>
        {isDark ? '☀️' : '🌙'}
      </span>
      {!compact && <span>{isDark ? 'Light' : 'Dark'}</span>}
    </button>
  )
}
