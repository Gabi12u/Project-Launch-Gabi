import { useEffect, useRef, type JSX } from 'react'
import { promptToast, saveSettings, useStore } from '../lib/store'

/**
 * Introduces the "eigene Startseite" beta exactly once, the same way
 * ReportConsent asks about crash reporting: every outcome other than the
 * explicit "Ja" (the "Nein" button, the close button, or simply letting the
 * card time out) counts as declined, and is recorded immediately so the
 * question is never asked a second time. Settings keeps its own toggle for
 * anyone who wants to turn it on later without waiting for this to reappear.
 */
export function StartScreenPrompt(): JSX.Element | null {
  const { ready, settings } = useStore()
  const shown = useRef(false)

  useEffect(() => {
    // Waits for onboarding for the same reason ReportConsent does: a beta
    // toast is the wrong thing to see before the launcher itself makes sense.
    if (!ready || !settings.onboarded || settings.customStartScreen !== 'unset' || shown.current) {
      return
    }
    shown.current = true

    // Written as declined before the card even renders. "Ja" below is the
    // only path that ever overwrites this back to "on".
    void saveSettings({ customStartScreen: 'off' })

    promptToast(
      'info',
      'Neu: eigene Startseite (Beta)',
      'Tauscht den Hintergrund im Minecraft-Hauptmenü gegen einen von Launch Gabi. Noch in Arbeit, aber schon zum Testen freigegeben. Änderbar jederzeit unter Einstellungen, Darstellung.',
      [
        { label: 'Nein', onClick: () => {} },
        {
          label: 'Ja, testen',
          primary: true,
          onClick: () => void saveSettings({ customStartScreen: 'on' })
        }
      ]
    )
  }, [ready, settings.onboarded, settings.customStartScreen])

  return null
}
