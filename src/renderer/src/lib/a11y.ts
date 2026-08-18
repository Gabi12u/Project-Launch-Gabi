import type { KeyboardEvent } from 'react'

/**
 * Makes a non-button element behave like a button for keyboard users.
 *
 * Several surfaces use a whole card as one big click target — a search result,
 * a news item, a screenshot thumbnail. Rendered as a bare `<div onClick>` those
 * are invisible to Tab and do nothing on Enter, so the feature they expose is
 * mouse-only. A real `<button>` would be the better element, but these cards
 * already contain their own buttons, and nesting one button inside another is
 * invalid HTML that browsers resolve unpredictably.
 *
 * Space is prevented from scrolling the page, which is what it would otherwise
 * do while the focus sits on a non-button.
 */
export function clickable(onActivate: () => void): {
  role: 'button'
  tabIndex: 0
  onClick: () => void
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void
} {
  return {
    role: 'button',
    tabIndex: 0,
    onClick: onActivate,
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      // Ignore keys bubbling up from a real control inside the card, otherwise
      // pressing Enter in a nested button would fire both actions.
      if (event.target !== event.currentTarget) return
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        onActivate()
      }
    }
  }
}
