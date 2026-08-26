/**
 * What changed in each version, written for the people who use the launcher.
 *
 * This is the public record: it stays in the app, it is not deleted when a
 * version gets old, and every release adds an entry at the top. Entries are
 * written in plain language rather than in commit-speak, because the audience
 * is the community and not the person who wrote the code.
 *
 * Keep `version` in step with package.json, and add the new entry before
 * tagging a release, not after.
 */

export type ChangeKind = 'new' | 'improved' | 'fixed'

export interface ChangeEntry {
  kind: ChangeKind
  text: string
}

export interface ChangelogRelease {
  version: string
  /** ISO date, the day the release was published. */
  date: string
  /** One line summing the release up, shown under the version number. */
  headline: string
  changes: ChangeEntry[]
}

export const CHANGE_KIND_LABEL: Record<ChangeKind, string> = {
  new: 'Neu',
  improved: 'Besser',
  fixed: 'Behoben'
}

export const CHANGELOG: ChangelogRelease[] = [
  {
    version: '1.0.12',
    date: '2026-08-26',
    headline: 'Aufnehmen im Spiel und diese Seite hier.',
    changes: [
      {
        kind: 'new',
        text: 'Aufnahmen: eine Taste im Spiel startet und stoppt die Aufnahme. Die fertigen Videos landen bei der Instanz im Reiter Aufnahmen, zusammen mit den Screenshots.'
      },
      {
        kind: 'new',
        text: 'Diese Seite. Nach jedem Update steht hier, was sich geändert hat, und es bleibt stehen. Alte Einträge werden nicht gelöscht.'
      },
      {
        kind: 'new',
        text: 'Nach einem Update meldet sich der Launcher unten rechts mit der neuen Versionsnummer. Ein Klick darauf führt direkt hierher.'
      },
      {
        kind: 'new',
        text: 'Einstellungen für die Aufnahme: Taste, Qualität, Ton und eine Höchstdauer, damit eine vergessene Aufnahme nicht die Festplatte füllt.'
      },
      {
        kind: 'improved',
        text: 'Der Reiter Screenshots heißt jetzt Aufnahmen und zeigt Bilder und Videos nebeneinander.'
      }
    ]
  },
  {
    version: '1.0.11',
    date: '2026-08-25',
    headline: 'Vierundzwanzig Fehler aus zwei Prüfrunden behoben.',
    changes: [
      {
        kind: 'fixed',
        text: 'Ein ungültiger Wert in den Einstellungen konnte alle automatischen Sicherungen einer Instanz auf einmal löschen.'
      },
      {
        kind: 'fixed',
        text: 'Eine einzige beschädigte Instanzdatei ließ die gesamte Instanzliste verschwinden statt nur sich selbst.'
      },
      {
        kind: 'fixed',
        text: 'Wer die automatische Installation von Updates ausgeschaltet hatte, bekam sie trotzdem, und zwar unsichtbar beim Beenden. Installiert wird jetzt nur noch sichtbar.'
      },
      {
        kind: 'fixed',
        text: 'Der Beenden-Knopf konnte nach einem Neustart des Launchers hängen bleiben, obwohl das Spiel längst zu war.'
      },
      {
        kind: 'fixed',
        text: 'Ein Kontowechsel direkt nach dem Entfernen eines Kontos konnte dazu führen, dass gar kein Konto mehr ausgewählt war.'
      },
      {
        kind: 'fixed',
        text: 'Beim Start über eine Verknüpfung ging die Anzeige verloren, wenn der Launcher noch am Hochfahren war.'
      },
      {
        kind: 'fixed',
        text: 'Die automatische Mod-Reparatur und ein gleichzeitiger Spielstart konnten sich in die Quere kommen.'
      },
      {
        kind: 'improved',
        text: 'Fehlgeschlagene Anmeldungen stehen jetzt im Protokoll, vorher verschwanden sie spurlos.'
      },
      {
        kind: 'improved',
        text: 'Fehlt beim Start eine Bibliothek, wird sie beim Namen genannt statt nur gezählt.'
      },
      {
        kind: 'new',
        text: 'Die Würfel im Hintergrund bewegen sich wieder, ohne die Rechenlast von früher.'
      }
    ]
  },
  {
    version: '1.0.10',
    date: '2026-08-24',
    headline: 'Siebzehn Funde rund um die Mod-Verwaltung.',
    changes: [
      {
        kind: 'fixed',
        text: 'Mehrere Fehler beim Installieren, Aktualisieren und Entfernen von Mods, gefunden in einer eigenen Prüfrunde.'
      }
    ]
  },
  {
    version: '1.0.9',
    date: '2026-08-24',
    headline: 'Absturz beim Start behoben, Rechtsklick für Mods.',
    changes: [
      {
        kind: 'fixed',
        text: 'Manche Instanzen stürzten beim Start ab, weil eine Bibliothek fälschlich aus dem Klassenpfad flog. Das betraf vor allem neuere Minecraft-Versionen.'
      },
      {
        kind: 'new',
        text: 'Mods lassen sich mit der rechten Maustaste verwalten: Version wechseln, aktualisieren, aus- und einschalten, Projektseite öffnen.'
      },
      {
        kind: 'improved',
        text: 'Solange das Spiel läuft, sind Änderungen an den Mods gesperrt statt stillschweigend wirkungslos.'
      }
    ]
  },
  {
    version: '1.0.8',
    date: '2026-08-23',
    headline: 'Skin wird wieder angezeigt.',
    changes: [
      {
        kind: 'fixed',
        text: 'Der eigene Skin blieb bei manchen Konten leer, weil die Adresse von der Sicherheitsrichtlinie blockiert wurde.'
      },
      {
        kind: 'fixed',
        text: 'Fertige Vorgänge wurden kurz als fehlgeschlagen angezeigt, obwohl sie geklappt hatten.'
      }
    ]
  }
]

/** The entry for a given version, if there is one. */
export function changelogFor(version: string): ChangelogRelease | undefined {
  return CHANGELOG.find((entry) => entry.version === version)
}
