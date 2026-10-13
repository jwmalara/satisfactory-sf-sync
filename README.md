# Satisfactory save sync

Every hour a GitHub Action logs into the dedicated server over SFTP, grabs the newest `.sav`, and if it changed:

- writes a readable digest to `state/` (committed, so git history doubles as a timeline of the factory)
- uploads the raw save to the `latest` release, overwritten each time (keeps big binaries out of git history)

| File | What's in it |
|---|---|
| `state/summary.md` | Session, save time, game phase, milestones, alternates, MAM, machine counts by type and recipe, train stations, map markers |
| `state/machines.csv` | Every producer, extractor and generator: recipe (or resource node / fuel), clock %, somersloop boost, paused, position in metres |
| `state/crash_sites.csv` | Every crash site in the save, opened or not, with position |
| `state/map_markers.csv` | Map markers with positions |
| `state/source.json` | Which server file the digest came from, its size and timestamp |
| Release `latest` → `latest.sav` | The raw save, for anything the digest doesn't cover |

## Setup

1. Create a **public** GitHub repo and push these files.
2. Repo → Settings → Secrets and variables → Actions → add:
   - `SFTP_HOST`, `SFTP_PORT`, `SFTP_USER`, `SFTP_PASSWORD` — from the Indifferent Broccoli panel's SFTP section
   - `SAVE_DIR` *(optional)* — the SaveGames folder path. Leave it out the first time; the job searches for it and prints the path in the log, then you can pin it.
3. Actions tab → **Sync save** → **Run workflow** to test it. Check the log for `save folder:` and `downloaded ...`.

The job only commits when the server has written a new save, so idle days produce no commits. GitHub pauses scheduled workflows after 60 days without repo activity; re-enable from the Actions tab if that happens.

## Run locally

```
npm ci
SFTP_HOST=... SFTP_PORT=... SFTP_USER=... SFTP_PASSWORD=... node scripts/pull.mjs
node scripts/digest.mjs save/latest.sav
```
