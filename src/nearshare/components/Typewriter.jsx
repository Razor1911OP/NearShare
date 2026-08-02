import { useEffect, useState } from 'react'

/**
 * Types a list of phrases out character by character, pauses, deletes, then
 * moves to the next one. Respects prefers-reduced-motion by rendering the
 * first phrase statically.
 */
export default function Typewriter({
  phrases = [],
  typeSpeed = 55,
  deleteSpeed = 28,
  holdMs = 2200,
  className = '',
  style,
}) {
  const list = phrases.length ? phrases : ['']
  const [index, setIndex] = useState(0)
  const [text, setText] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [reduced, setReduced] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    if (mq?.matches) setReduced(true)
  }, [])

  useEffect(() => {
    if (reduced) return undefined
    const full = list[index % list.length]

    if (!deleting && text === full) {
      const t = setTimeout(() => setDeleting(true), holdMs)
      return () => clearTimeout(t)
    }

    if (deleting && text === '') {
      setDeleting(false)
      setIndex((i) => (i + 1) % list.length)
      return undefined
    }

    const next = deleting ? full.slice(0, text.length - 1) : full.slice(0, text.length + 1)
    const t = setTimeout(() => setText(next), deleting ? deleteSpeed : typeSpeed)
    return () => clearTimeout(t)
  }, [text, deleting, index, reduced, list, typeSpeed, deleteSpeed, holdMs])

  if (reduced) {
    return <span className={className} style={style}>{list[0]}</span>
  }

  return (
    <span className={className} style={style}>
      {text}
      <span className="ns-caret" aria-hidden="true" />
    </span>
  )
}
