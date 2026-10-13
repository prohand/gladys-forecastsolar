# Forecast.Solar

Diese Integration zeigt in Gladys die **Ertragsprognose** Ihrer Solarmodule
an, berechnet vom kostenlosen Dienst [Forecast.Solar](https://forecast.solar)
auf Grundlage der Wettervorhersage.

Erfordert **Gladys 5.1.0** oder neuer.

## Häuser

Der Standort stammt aus den **in Gladys eingerichteten Häusern**
(**Einstellungen > Zuhause**): Bei der Installation bittet Gladys Sie, den
Zugriff auf den Standort der Häuser zu erlauben.

- Jedes Haus **mit Standort** erscheint als Gerät im Tab **Entdecken**.
- Fügen Sie **nur** die Häuser hinzu, die Solarmodule haben: Nur diese werden
  abgefragt (keine verschwendete Anfrage).
- Ein Haus ohne Standort erscheint nicht: Legen Sie seinen Standort in Gladys
  fest und starten Sie dann erneut eine Suche.

## Was Sie erhalten

Für jedes hinzugefügte Haus ein Gerät **Solar forecast** mit 4 Sensoren:

| Sensor                           | Einheit | Inhalt                                   |
| -------------------------------- | ------- | ---------------------------------------- |
| Estimated power now              | W       | Geschätzte Leistung im Moment            |
| Estimated energy today           | kWh     | Geschätzte Produktion für den ganzen Tag |
| Estimated energy remaining today | kWh     | Geschätzte Produktion bis Tagesende      |
| Estimated energy tomorrow        | kWh     | Geschätzte Produktion für morgen         |

Es handelt sich um **Prognosen**, nicht um Messwerte: Sie werden in der
Energieüberwachung von Gladys nicht berücksichtigt.

## Konfiguration

1. Öffnen Sie den Tab **Konfiguration** der Integration.
2. Beschreiben Sie Ihre Module:
   - **Neigung**: 0° = flach, 90° = senkrecht (auf einem Dach oft 30 bis 35°);
   - **Ausrichtung**: 0° = Süden, -90° = Osten, 90° = Westen, 180° = Norden;
   - **Spitzenleistung** in Wp, ganze Zahl (z. B. 3000 für 3 kWp; steht in Ihrem Vertrag oder auf dem Wechselrichter).
3. Der **API-Schlüssel** ist optional: Lassen Sie ihn für den kostenlosen
   Tarif leer.
4. Speichern Sie und fügen Sie dann das Gerät Ihres Hauses über den Tab
   **Entdecken** hinzu.

Diese Einstellungen gelten für alle hinzugefügten Häuser.

Die Schaltfläche **Prognose jetzt aktualisieren** lädt die Prognose sofort
herunter und zeigt eine Zusammenfassung für heute und morgen an.

## Dashboard-Widgets

| Widget                    | Inhalt                                                                   |
| ------------------------- | ------------------------------------------------------------------------ |
| **Solarprognose**         | Aktuelle Leistung, Energie heute / Rest / morgen, Leistungskurve, Spitze |
| **Bester Solar-Zeitraum** | Bester Zeitpunkt für ein Gerät mit N Stunden Laufzeit, heute und morgen  |

Wählen Sie im Widget das Gerät (das Haus) und für den besten Zeitraum die
Laufzeit des Geräts (Waschmaschine 2 h, Geschirrspüler 3 h…).

## Szenen

### Auslöser

| Auslöser                   | Wann                                                    |
| -------------------------- | ------------------------------------------------------- |
| Solarprognose aktualisiert | Jedes Mal, wenn eine neue Prognose heruntergeladen wird |
| Beginn der Solarproduktion | Geschätzter Produktionsbeginn (Sonnenaufgang)           |
| Spitze der Solarproduktion | Geschätzte Produktionsspitze des Tages                  |
| Ende der Solarproduktion   | Geschätztes Produktionsende (Sonnenuntergang)           |

Optionaler Filter auf das Haus (leer = alle). Für die folgenden Aktionen
verfügbare Variablen: Haus, aktuelle Leistung, Energie heute, Rest, morgen,
Spitzenleistung und Uhrzeit der Spitze.

Für einen **Schwellenwert** („wenn morgen > 10 kWh“) verwenden Sie den
Standardauslöser „Änderung von Gerätestatus“ von Gladys auf dem Sensor
„Estimated energy tomorrow“.

### Aktionen

| Aktion                               | Parameter        | Ergebnisse                                                 |
| ------------------------------------ | ---------------- | ---------------------------------------------------------- |
| Solarprognose lesen                  | Haus             | Leistung, Energie heute / Rest / morgen, Spitze            |
| Solarproduktion der nächsten Stunden | Haus, Stunden    | Energie (kWh), durchschnittliche und maximale Leistung (W) |
| Besten Solar-Zeitraum finden         | Haus, Dauer, Tag | gefunden, Start- / Endzeit, Energie, Minuten bis zum Start |

Beispiel: jeden Morgen um 8 Uhr „Besten Solar-Zeitraum finden“ (2 h, heute),
dann „Minuten bis zum Start“ abwarten und die Waschmaschine starten.

## Funktionsweise

- Die Prognose wird standardmäßig alle 60 Minuten heruntergeladen (15 bis
  1440 Minuten), pro hinzugefügtem Haus.
- Der kostenlose Tarif erlaubt **12 Anfragen pro Stunde** und IP-Adresse, für
  alle Ihre Häuser zusammen. Bei mehreren Häusern wird das Intervall
  automatisch verlängert, sodass sie nie mehr als 10 Anfragen pro Stunde
  stellen (3 Häuser: höchstens alle 20 Minuten, 4 oder 5 Häuser: alle
  30 Minuten, 6 bis 10 Häuser: jede Stunde); das konfigurierte Intervall
  bleibt das Minimum.
- Bei einem Fehler versucht es die Integration 15 Minuten später erneut und
  behält die letzte bekannte Prognose. Ist das Limit erreicht, wartet sie bis
  zu der von Forecast.Solar genannten Uhrzeit, bevor sie eine neue Anfrage
  stellt.
- Die Schaltfläche **Prognose jetzt aktualisieren** lädt die Prognose erneut
  herunter, es sei denn, sie wurde vor weniger als 5 Minuten heruntergeladen.
- Zwischen zwei Downloads werden die Werte alle 5 Minuten neu berechnet (die
  Leistung folgt dem Sonnenverlauf) und veröffentlicht, wenn sie sich ändern,
  mindestens aber alle 30 Minuten, um den Verlauf klein zu halten.
- Nach dem letzten Punkt der Prognose (Sonnenuntergang morgen) wird die
  geschätzte Leistung nicht mehr veröffentlicht, wenn keine neue Prognose
  heruntergeladen werden konnte: Sie ist unbekannt, nicht 0 W.
- Die Häuser werden bei jedem Start, bei jeder Suche und jede Stunde neu
  gelesen (nach einem Fehler eine Minute später).
- Eine Modulfläche pro Haus. Geben Sie bei einer Ost-/West-Anlage die
  Ausrichtung und die Spitzenleistung der Hauptfläche ein.

## Fehlerbehebung

- **„Konfiguration unvollständig oder ungültig“**: Ein Pflichtfeld ist leer
  oder außerhalb des zulässigen Bereichs (der Feldname wird angegeben).
- **„Kein Haus mit Standort“**: Legen Sie den Standort eines Hauses unter
  **Einstellungen > Zuhause** fest.
- **„Anfragelimit von Forecast.Solar erreicht“**: zu viele Anfragen von Ihrer
  IP-Adresse (vielleicht nutzt ein anderes Tool ebenfalls Forecast.Solar).
  Erhöhen Sie das Aktualisierungsintervall.
- Für Details lesen Sie die Protokolle der Integration in Gladys (oder
  `docker logs` auf dem Host) mit `LOG_LEVEL=debug`. Die Koordinaten Ihrer
  Häuser und Ihr API-Schlüssel werden in den protokollierten Anfragen maskiert
  (`***`).
