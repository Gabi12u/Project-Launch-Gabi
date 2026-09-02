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
    version: '1.0.16',
    date: '2026-09-02',
    headline: 'Ein entfernter Mod bleibt jetzt auch entfernt.',
    changes: [
      {
        kind: 'fixed',
        text: 'Der Launcher konnte beim Starten von Minecraft komplett schwarz werden und ließ sich danach nicht mehr bedienen. Grund war ein Absturz oder Hänger der Programmoberfläche selbst, von dem sich der Launcher bisher nicht erholte. Er lädt sich jetzt von selbst neu, sobald das erkannt wird.'
      },
      {
        kind: 'fixed',
        text: 'Ein entfernter Mod konnte von selbst wieder in der Liste auftauchen, wenn das Entfernen mit einem gleichzeitigen Abgleich der Mod-Liste zusammenfiel, etwa durch das Öffnen der Instanzseite direkt danach.'
      },
      {
        kind: 'new',
        text: 'Die Reparaturfunktion entfernt jetzt doppelt installierte Mods, die aus dem alten Fehler oben stammen können, und zeigt an, wie viele Mods dabei als veraltet erkannt wurden.'
      },
      {
        kind: 'new',
        text: 'Bevor eine Instanz mit veralteten Mods startet, fragt der Launcher jetzt nach: sofort aktualisieren oder mit den bisherigen Versionen weiterspielen.'
      },
      {
        kind: 'new',
        text: 'Das Aktualisieren eines einzelnen Mods fragt jetzt vorher nach, statt sofort loszulegen.'
      }
    ]
  },
  {
    version: '1.0.15',
    date: '2026-09-02',
    headline: 'Eigene Startseite im Minecraft-Menü, als Beta-Funktion.',
    changes: [
      {
        kind: 'new',
        text: 'Eigene Startseite (Beta): tauscht den Hintergrund im Minecraft-Hauptmenü gegen einen von Launch Gabi, über ein Ressourcenpaket, ohne das Spiel selbst zu verändern. Funktioniert mit jeder Minecraft-Version und egal ob Vanilla oder mit Mods. Einschaltbar unter Einstellungen, Darstellung, oder direkt über den Hinweis beim ersten Start nach diesem Update.'
      }
    ]
  },
  {
    version: '1.0.14',
    date: '2026-09-01',
    headline: 'Doppelte Mods, Einfrieren und mehrere Risiken beim Wiederherstellen behoben.',
    changes: [
      {
        kind: 'new',
        text: 'Eine öffentliche Statusseite unter status.launchgabi.com zeigt die aktuelle Version, Downloadzahlen und bekannte, noch offene Probleme.'
      },
      {
        kind: 'fixed',
        text: 'Mods konnten beim Aktualisieren doppelt in der Liste erscheinen, weil ein kurzes Zeitfenster die neue Datei für einen unbekannten zweiten Mod hielt.'
      },
      {
        kind: 'fixed',
        text: 'Der Launcher konnte komplett einfrieren, weil mehrere Vorgänge Ordner blockierend durchsuchten, etwa die Speicherplatzanzeige nach jeder Sitzung und das Aufräumen bei jedem Start.'
      },
      {
        kind: 'fixed',
        text: 'Wiederherstellen einer Sicherung konnte im ungünstigsten Fall Daten endgültig verlieren und dabei trotzdem Erfolg melden. Unmittelbar davor wird weiterhin automatisch eine vollständige Sicherung des Vorzustands angelegt.'
      },
      {
        kind: 'fixed',
        text: 'Eine Instanz konnte nach einem sehr frühen Fehler beim Starten dauerhaft blockiert bleiben: nicht mehr startbar, nicht reparierbar, Mods nicht mehr änderbar, bis zum Neustart des Launchers.'
      },
      {
        kind: 'fixed',
        text: 'Löschen, Starten, Reparieren und Wiederherstellen derselben Instanz konnten sich gegenseitig in die Quere kommen, wenn zwei davon gleichzeitig liefen.'
      },
      {
        kind: 'fixed',
        text: 'Die Reparaturfunktion konnte einen währenddessen frisch installierten Mod wieder verwerfen.'
      },
      {
        kind: 'fixed',
        text: 'Eine laufende Aufnahme konnte beim Beenden des Launchers oder bei voller Festplatte am Ende abgeschnitten werden oder hängen bleiben.'
      },
      {
        kind: 'fixed',
        text: 'Der Hinweis auf ein fertiges Update ließ sich leicht verpassen, weil er nur einmal für wenige Sekunden erschien. Ein Punkt in der Seitenleiste bleibt jetzt stehen, bis neu gestartet wird.'
      },
      {
        kind: 'fixed',
        text: 'Eine Anmeldung konnte nach dem Ändern oder Zurücksetzen der Anwendungs-ID in den Einstellungen dauerhaft mit Fehler 400 scheitern, weil die Erneuerung an das falsche Microsoft-System ging.'
      },
      {
        kind: 'fixed',
        text: 'Ein eigener Befehl vor dem Spielstart konnte die Instanz für immer blockieren, wenn er selbst hängen blieb.'
      },
      {
        kind: 'fixed',
        text: 'Verknüpfungen beim Import eines fremden Ordners wurden ohne Prüfung übernommen, auch wenn sie aus dem Ordner hinauszeigten.'
      },
      {
        kind: 'improved',
        text: 'Fehlermeldungen bei der Anmeldung nennen jetzt öfter den tatsächlichen Grund von Microsoft statt nur eine Fehlernummer.'
      },
      {
        kind: 'improved',
        text: 'Fehlerberichte entfernen jetzt zuverlässiger persönliche Daten, darunter IP-Adressen und Namen mit Umlauten.'
      }
    ]
  },
  {
    version: '1.0.13',
    date: '2026-08-26',
    headline: 'Fehler melden sich jetzt selbst, und Aufnahmen ruckeln weniger.',
    changes: [
      {
        kind: 'new',
        text: 'Fehlerberichte: geht etwas schief, wird der Fehler festgehalten und auf Wunsch an die Entwicklung geschickt. Gefragt wird einmal, entschieden wird von dir, abschaltbar unter Einstellungen, Fehlerberichte.'
      },
      {
        kind: 'new',
        text: 'Jeder Bericht liegt auch bei dir auf der Platte. Du kannst nachlesen, was drinsteht, ihn kopieren oder alles löschen.'
      },
      {
        kind: 'improved',
        text: 'Name, UUID, Zugangsdaten und dein Windows-Benutzername werden vorher entfernt, auch aus Dateipfaden. Eine IP-Adresse wird nicht gespeichert.'
      },
      {
        kind: 'fixed',
        text: 'Aufnahmen ruckelten. Das Launcher-Fenster wurde vom System gedrosselt, während es hinter dem Spiel lag, also genau während jeder Aufnahme.'
      },
      {
        kind: 'improved',
        text: 'Aufnahmen laufen mit 30 Bildern statt 60 und in einem sparsameren Verfahren. Wer die Leistung hat, stellt in den Einstellungen auf Scharf.'
      }
    ]
  },
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
