# Neon Militia

A 2D jetpack deathmatch shooter in the spirit of Mini Militia — fly on a
limited-fuel jetpack, fight over an arena full of weapon crates, and try to
hit the score limit first. Six heroes, each with their own stat line, signature
sidearm and active ability.

Runs in the browser. Everything is drawn with Canvas paths and every sound is
synthesised with the Web Audio API, so there are no image or audio assets. The
multiplayer server has no npm dependencies.

## Play

```sh
node server/server.js      # or: npm start
```

Then open <http://localhost:8080>. That one command serves the game *and* hosts
online matches.

Single player also works from any static file server (`python3 -m http.server`
and friends). Opening `index.html` straight off disk does **not** work — the
game is ES modules, which browsers refuse to load over `file://`.

## Controls

| | |
|---|---|
| `A` / `D` | Move |
| `W` / `Space` | Jetpack — hold to fly |
| `S` | Drop through a platform |
| Mouse | Aim |
| Left click | Fire |
| Right click / `F` | Melee |
| `G` | Grenade |
| `Q` / `Shift` | Hero ability |
| `R` | Reload · `E` Swap weapon |
| `Tab` | Scoreboard · `Esc` Pause · `M` Mute |

**Touch**: left half of the screen is a move stick (push up to fly, down to drop
through), right half is an aim stick that fires past halfway, with action
buttons up the right edge. **Gamepad**: left stick moves, right stick aims and
fires, `A`/LT is the jetpack, `Y` the ability.

Three things are worth knowing before your first match:

- **Fuel is the real resource.** It drains while you thrust and only refills
  once you stop. Fly in bursts.
- **Recoil moves you.** Every shot pushes you backwards, which is a movement
  tool in the air — a shotgun blast is a decent emergency dodge.
- **Your sidearm never runs out of reserve ammo.** Primary weapons come from
  crates and are dropped once they are dry, so you always have something.

## The roster

| Hero | Ability (`Q`) | Plays like |
|---|---|---|
| **NOVA** · Neon Ninja | **Phase Dash** — blink along your aim, untouchable mid-blink | Fast and fragile |
| **TITAN** · Bulwark Mech | **Aegis Shield** — frontal barrier that eats incoming fire | Slow, armoured, heavy hitter |
| **EMBER** · Rogue Pilot | **Afterburn** — unlimited thrust and a burning contrail | Lives in the air |
| **KAGE** · Cyber Samurai | **Iaido Slash** — a lunging cut that deflects bullets | Closes distance, melee focused |
| **VEX** · Void Hacker | **Ghost Protocol** — cloak and move faster; firing breaks it | Ambusher |
| **BOLT** · Storm Runner | **Overcharge** — double fire rate, rounds chain lightning | Sustained damage |

Eleven weapons (SMG, assault rifle, shotgun, LMG, railgun, RPG, ion lance, plus
four hero sidearms), grenades and melee. Three arenas: **Skyfall Foundry**
(industrial, three tiers), **Orbital Yard** (open and vertical) and
**Undercity** (close quarters).

## Online multiplayer

Start the server, then everyone opens it and picks **Online Multiplayer**. On
the same machine the default `ws://localhost:8080` works as-is; over a LAN,
players enter the host's address (`ws://192.168.x.x:8080`). The **room** field
splits players into separate matches on one server.

### How authority is split

This matters if you plan to extend it:

- **Each client simulates its own fighter and its own bullets.** Movement feels
  immediate because it is never waiting on the network.
- **Remote fighters are rendered 100 ms in the past** and interpolated between
  snapshots, which hides ordinary jitter.
- **Hits are resolved by the shooter**, reported to the server, clamped there
  against the weapon's real damage, and applied by the *victim's* client — which
  is the only party that knows its own shields and invulnerability frames. The
  victim then republishes its health.
- **The server alone owns** scores, the kill feed, pickup ownership and respawn
  timers, the match clock and map rotation.

The honest caveat: this is a friendly-game trust model, not an anti-cheat one.
The server validates damage magnitude, message rate and field types, but a
modified client can still lie about its own position and health. That is a
deliberate trade for responsiveness and simplicity; making it cheat-resistant
would mean running the full simulation server-side and reconciling inputs.

## Layout

```
index.html  styles.css      shell and menus
src/core/   config, math, input (keyboard/touch/gamepad), audio
src/game/   the simulation — characters, weapons, maps, physics, world, ai
src/render/ camera, procedural character art, world renderer, HUD
src/net/    multiplayer client
src/ui/     menu screens
server/     static + WebSocket server, and a dependency-free RFC 6455 codec
test/       headless tests
```

The simulation never touches the DOM, so it runs under plain Node — which is
how the tests drive whole bot matches without a browser.

## Tests

```sh
npm test
```

Covers arena geometry (no spawn buried in a wall, no gap in the border), full
60-second bot matches on every map checked for NaNs, stuck fighters and
projectile leaks, every weapon and every ability exercised, the local/online
authority split, and the WebSocket codec against the RFC 6455 handshake vector.

## Extending it

- **A new hero**: add an entry to `src/game/characters.js`, give it a `style`,
  and draw that style's silhouette pieces in `drawStyleTorso` / `drawStyleHead`
  in `src/render/heroart.js`. Abilities are handled in `Fighter._ability`.
- **A new weapon**: add it to `src/game/weapons.js` and a shape to `drawWeapon`.
  Set `slot: 'primary'` to make it appear in crates.
- **A new arena**: add a rect-based definition to `src/game/maps.js`. The tests
  will tell you if a spawn or pickup ended up inside geometry.
- **Balance**: almost every feel-related number lives in `src/core/config.js`.

## Licence

MIT.
