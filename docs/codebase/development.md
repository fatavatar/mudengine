# Development

Node is pinned by `.nvmrc`; run `nvm use` before any `npm` command.

## Running it

| Command | What it does |
|---|---|
| `npm run dev` | the desktop app with hot reload (`scripts/dev.mjs`) |
| `npm run build` | typecheck, then `electron-vite build` into `out/` |
| `npm run web` | the built client served over HTTP (`scripts/web.mjs`). `MUDENGINE_PORT`, `MUDENGINE_BIND`, `MUDENGINE_PASSWORD`, `MUDENGINE_HOME` configure it. Build first: a build under a running server leaves its windows grey until it restarts. |
| `npm run docker:build`, `docker:run` | the image, tagged from `package.json` (`scripts/docker.mjs`) |
| `npm run dist:linux` (and `:win`, `:mac`) | an installer, with `check:secrets` before and after |

## Checking it

| Command | What it does |
|---|---|
| `npm run typecheck` | both TypeScript projects: `tsconfig.node.json` (main, preload, shared) and `tsconfig.web.json` (renderer, shared) |
| `npm test` | the unit suite, `src/**/*.test.ts` |
| `npm run test:realm` | `src/**/*.realm.test.ts`: tests that need the shipped realm data |
| `npm run lint`, `npm run format` | prettier over `src/` (never over the YAML files, whose comments and layout are the user's), and typecheck |
| `npm run verify`, `npm run gate` | the gate (`scripts/gate.mjs`): runs each check whose inputs changed since it last passed, from `.gate/state.json`; `gate:all` runs everything |
| `npm run smoke`, `smoke:web` | the built app started and driven against a baseline |
| `npm run check:secrets` | looks for the profiles' passwords in the logs, captures and backups the client wrote, and in a package about to be built |

Tests sit beside the code in `__tests__/` directories. Most are pure: a
`SessionManager` is driven with scripted server text, and the MegaMUD port is
tested with a fixture session (`src/main/megamud/__tests__/fixture.ts`) whose
host records what it sent, showed and traced. A test that needs a temporary
home names a temporary directory; never point one at a real home.

## Replaying a capture

Every session writes a `.mudcap.jsonl` capture. `npm run replay` plays one
back through the client's own session, on a clock that jumps from one
recorded moment to the next, with the realm's bytes written back as they
arrived:

```
REPLAY_HOME=<a home> REPLAY_CAPTURE=<capture> REPLAY_FROM=HH:MM:SS REPLAY_TO=HH:MM:SS \
REPLAY_OUT=<report.txt> npm run replay
```

The home is copied (without its logs) into a scratch directory first, so
nothing lands on the real one. The report puts what the replayed engine did
(`step`, `doing`, `gates`, `replay>` for what it sent) beside what the live
engine recorded (`live-step`, `live-doing`, `recorded`). Times are UTC. Once
the replay sends something the recording did not, the realm's later lines
answered the recording's command, not the replay's, so read a replay up to
the first place the two part.

This is the main tool for engine bugs: find the moment in the capture, replay
a window around it, change the code, replay again.

## Scripts

`scripts/` also holds:

- **Data builds.** `build:world` (the shipped worlds from `mdb/*.zip`),
  `build:loops` (MegaMUD's recorded paths into `resources/loops/megamud.yaml`),
  `build:messages`, `sync:mme` (mudtool into `src/main/mme/vendor/`), and
  `gen-megamud-fields.mjs` (regenerates `SettingsFields.ts` from the MegaMUD
  schema; `SettingsFields.test.ts` fails if it was not rerun).
- **Analysis.** `capture:analyse`, `capture:corpus`, `check:reckoning`,
  `profile:ui`.
- **Probes** (`probe:*`, `check:live`): drive a real session against a test
  realm and report what the server sent. They dial `orohost:2427`, upstream's
  test realm, unless `MUDENGINE_PROBE_HOST` and `MUDENGINE_PROBE_PORT` name
  another (`scripts/lib/local-realm.mjs`). They build a `SessionManager`
  without the MegaMUD engine, so they test reading the realm, not playing it.

## Conventions

These keep this fork's changes mergeable with upstream:

- **Comments explain why**, with the evidence and its date ("Skinny's `ltch`
  read as somebody's deathtouch, 2026-10-21"). In this repository the
  comments are much of the documentation.
- **Every word shown** is a key in `locales/ui.en.yaml`, looked up by a
  literal `t()` key.
- **Every number that decides something** is a named constant, or a
  `tuning:` key in `internal.yaml`.
- **A setting whose meaning changes** gets a migration step
  (`config/Migration.ts`) and a notice saying what changed.
- **In the MegaMUD port**, nothing is named by its address: `probably…` for
  a guess, `unknown_<offset>` for not known. Deviations from the exe are
  marked with the date they were asked for.
- **Performance fixes move or cache work.** They never change what is
  computed.

## Common changes

**A new IPC call.** Add the channel to `Invoke` (or `Send`, `Push`) and the
method to `IpcApi` in `src/shared/ipc.ts`, named as the channel's key is;
handle it in `src/main/client.ts`. Both bridges are built from the channel
tables (`bridgeOver`), so neither needs touching, and the build fails where
a method and its channel are named differently.

**A new client setting.** Its type and default in `src/shared/config.ts`, its
coercion in `normalizeConfig`, its documented default in
`resources/config/default.yaml`, its load and save in
`config/SettingsEditor.ts`, its control in the Settings screen, its words in
`locales/ui.en.yaml`, and a migration if existing files need it stated.

**A new MegaMUD setting.** Add it to `src/shared/megamud/schema.ts` (section,
key, type, default from MegaMUD's loader), rerun `gen-megamud-fields.mjs`,
and place it on a tab in `settingsTabs.ts`.

**A new card.** Add it to `CARDS` in `hooks/useCardLayout.ts`, write the
component, add its case to `App.tsx`'s card switch, and its words.

**A change to the realm conversion.** Change `buildRealm.ts`, raise
`REALM_FORMAT` so every cached realm is converted again, and rebuild the
shipped worlds with `npm run build:world` if they are affected.

**A fix in the MegaMUD engine.** See [engine.md](engine.md), *Changing the
port*.

**A release.** Raise `version` in `package.json` (and `package-lock.json`) in
a pull request, merge it, then tag that commit and push the one tag:
`git tag v1.0.0 && git push origin v1.0.0`. Never `git push --tags`, which
would publish upstream's own tags. `.github/workflows/release.yml` checks the
tag against `package.json`, builds unsigned installers for Linux, Windows and
macOS, pushes `ghcr.io/fatavatar/mudengine:<version>` and `:latest`, and
publishes the release with install notes and the pull requests merged since
the last one. Run it by hand (Actions, *Release*, publish off) to build
everything without publishing.
