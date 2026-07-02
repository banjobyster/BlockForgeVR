# BlockForge VR

![Vibe Coded](https://img.shields.io/badge/Vibe%20Coded-AI%20Assisted-blueviolet)

A voxel sandbox game for Meta Quest 3 (PCVR over Link) — and it also runs flat on your desktop.

> **Note:** This project was "vibe coded" — built collaboratively with an AI coding assistant (Claude). Review the code with that in mind before relying on it for anything critical.

## Play in VR (Quest 3 + Link cable)

1. Plug your Quest 3 into the PC and activate **Link** (put on the headset → accept "Enable Link", or start it from the Quick Settings menu). The **Meta Quest Link** desktop app must be running.
2. On the PC, double-click **`PLAY.bat`** in this folder. The game opens in your browser.
3. Put the headset on. You'll see your desktop inside Link (or use Virtual Desktop view) — click the big green **Enter VR** button on the game page. You're in.

That's it. No installs, no builds. Everything runs from this folder, fully offline.

> If the button says "VR not detected": make sure the Meta Quest Link app is running and the headset is connected, then reload the page (F5).

## Controls

### VR
| Input | Action |
|---|---|
| Left stick | Move (head-relative) |
| Right stick ← / → | Snap turn (45°) |
| **Trigger** (hold, either hand) | Mine the block you're pointing at |
| **Grip** (either hand) | Place the selected block |
| A | Jump (hold to swim up / fly up) |
| B / Y | Next / previous block |
| X | Toggle fly mode |
| Right stick ↓ | Descend (fly mode) |

### Desktop
WASD + mouse (click to capture), left-click hold to mine, right-click to place, scroll or 1–9 to pick a block, Space to jump/swim/fly up, Shift to fly down, F to toggle fly, Esc for menu.

## The game

- Infinite procedural world: forests, plains, mountains with snowcaps, oceans, beaches, flowers, wandering sheep.
- 12 placeable blocks including **glowstone** (real dynamic light at night) and **glass**.
- Full day/night cycle (~10 min) with sunrise, sunset, stars and drifting clouds.
- Mining with crack stages, controller haptics, and positional sound effects.
- Your world **auto-saves in the browser** — blocks, position, time of day. "New world" / "Reset this world" buttons are on the title screen.
- Comfort: movement vignette (toggleable), snap turn (or smooth), no artificial pitch/roll, blackout when your head is inside geometry.

## Files

- `PLAY.bat` — one-click launcher (starts a tiny local server, opens the browser)
- `server.ps1` — dependency-free static file server (PowerShell, port 8787)
- `index.html` / `game.js` — the whole game
- `three.module.js` — Three.js r160, vendored so no internet is needed

## Troubleshooting

- **Black screen in headset after Enter VR**: take the headset off and on, or end the session and click Enter VR again.
- **Port conflict**: if something else uses port 8787, close it — or edit the port in `server.ps1` and `PLAY.bat`.
- **Performance**: lower "Render distance" on the title screen to *Short*.
- Save data lives in the browser you play in (localStorage), so keep using the same browser to keep your builds.
