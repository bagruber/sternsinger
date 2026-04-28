# Gebäude-Marker

Mobile Web-App zum Markieren und Kommentieren von Gebäuden auf einer Karte.

---

## Features

- 🖌️ **Malen** – Gebäude per Fingerwisch einfärben
- 🧹 **Löschen** – Markierungen entfernen
- ☝️ **Einzeln** – Einzelnes Gebäude toggeln
- ↩️ **Undo** – Letzte Aktion rückgängig machen
- 💬 **Kommentar** – Long-Press auf Gebäude für Kommentar
- 👥 **Gruppen** – Mehrere Nutzergruppen, jede mit eigenen Markierungen

---

## Schnellstart

### 1. Supabase einrichten

1. Konto anlegen auf [supabase.com](https://supabase.com) (kostenlos)
2. Neues Projekt erstellen
3. Im Dashboard → **SQL Editor** → Inhalt von `supabase_schema.sql` einfügen und ausführen
4. Unter **Project Settings → API** die Werte kopieren:
   - `Project URL` → `SUPABASE_URL`
   - `anon public key` → `SUPABASE_ANON_KEY`

### 2. API-Keys eintragen

In `js/api.js` die Platzhalter ersetzen:

```js
const SUPABASE_URL = "https://DEIN-PROJEKT.supabase.co";
const SUPABASE_ANON_KEY = "DEIN_ANON_KEY";
```

### 3. GitHub Pages deployen

```bash
# Neues GitHub Repository erstellen (z.B. "gebaude-marker")
# Alle Dateien hochladen

# Dann: Settings → Pages → Source: "main" branch / root
# Die App ist dann unter https://DEIN-USERNAME.github.io/gebaude-marker erreichbar
```

---

## Bedienung

| Geste | Funktion |
|-------|----------|
| 1 Finger ziehen | Malen / Löschen (je nach Modus) |
| 2 Finger | Karte navigieren |
| Long Press | Kommentar öffnen |
| Zoom < 17 | Malen deaktiviert |

---

## Projektstruktur

```
/
├── index.html              # Haupt-HTML
├── css/
│   └── style.css           # App-Styles
├── js/
│   ├── app.js              # Haupt-Logik (Karte, Touch, State)
│   └── api.js              # Supabase API Client
├── data/
│   └── buildings.geojson   # Mock-Gebäude (20 Gebäude, Regensburg-Bereich)
└── supabase_schema.sql     # Datenbank-Schema (einmalig ausführen)
```

---

## Nächste Schritte

- [ ] Echte Gebäudedaten: Bayern Hausumringe oder OpenStreetMap Overpass API
- [ ] Magic Link Auth (Supabase Auth) statt localStorage-Gruppen-ID
- [ ] Realtime-Sync via Supabase Channels (mehrere Nutzer gleichzeitig)
- [ ] Multi-Gruppen Overlay (alle Gruppen gleichzeitig anzeigen)
- [ ] Export als GeoJSON mit Annotationen

---

## Technologie

- **Frontend**: Vanilla JS (ES Modules), Leaflet
- **Backend**: Supabase (PostgreSQL + REST API)
- **Hosting**: GitHub Pages
