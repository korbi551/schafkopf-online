# Schafkopf mit Freunden

Schafkopf im Browser für bis zu 4 Leute. Freie Plätze übernehmen Bots. Dazu gibt es einen Trainer, Punktezählung und eine Abrechnung nach Tarif.

- Sauspiel, Wenz und Farbsolo, mit allen Regeln: Farbzwang, Trumpfzwang, Rufsau und Davonlaufen
- Tisch aufmachen, Link verschicken, mitspielen. Kein Login.
- Bots füllen freie Plätze. Ist jemand offline, kann der Gastgeber einen Bot einspringen lassen.
- Trainer, den der Gastgeber pro Tisch ein- oder ausschalten kann:
  - Beim Ansagen: Handstärke nach Punkten und eine Simulation mit Gewinnchance und Ertrag für jedes Spiel
  - Beim Ausspielen: Lage am Tisch, beste Karte per Monte-Carlo-Simulation und Feedback nach jedem Zug
- Abrechnung: Sauspiel 10 ct, Solo/Wenz 50 ct, Schneider/Schwarz je +10 ct, Laufende je +10 ct
- Chat, „Letzter Stich“ und Stichübersicht

Es gibt keine Abhängigkeiten: nur Node.js (ab Version 18), kein `npm install` nötig.

## Lokal starten

```bash
node server.js          # http://localhost:3000
PORT=8080 node server.js
```

## Deploy mit Coolify

1. In Coolify: **+ New → Application → Private Repository (GitHub App)** und dieses Repo auswählen. Branch: `main`.
2. Als **Build Pack** `Dockerfile` wählen. Coolify erkennt den Port 3000; sonst unter *Ports Exposes* `3000` eintragen.
3. Eine Domain eintragen, z. B. `https://schafkopf.deinedomain.de`, und **Deploy** klicken.
4. Health Check (optional): Pfad `/health`.

Die Live-Updates laufen über Server-Sent Events (`/api/events`). Dafür muss am Reverse Proxy nichts eingestellt werden.

**Wichtig:** Tische und Kontostände liegen nur im Arbeitsspeicher. Nach einem Neustart oder Redeploy sind laufende Tische weg. Leere Tische werden nach 12 Stunden automatisch aufgeräumt. Betreibe nur **eine** Instanz, also keine Replikas.

## Aufbau

| Datei | Inhalt |
|---|---|
| `engine.js` | Regeln, Bot-KI, Handbewertung, Trainer-Simulation, Abrechnung |
| `server.js` | HTTP-Server, Tische, Bots, Server-Sent Events, API |
| `public/index.html` | komplette Oberfläche (eine Datei) |
