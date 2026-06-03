# SwanSite: a public, always-updating Spotify stats dashboard

- Date: 2026-06-03
- Status: design approved in substance (name + palette locked), pending spec review
- Owner: Neil
- Live URL (target): https://neilp211.github.io/swansite

## 1. Goal

A public web page that shows Neil's Spotify listening stats in a data-dashboard
style. Only Neil authenticates (once); friends just open the URL and view the
cached data. The page updates itself on a schedule. It supports multiple time
windows (4 weeks, 6 months, 1 year) from the live API, plus a true "All-Time"
tier that unlocks from Neil's downloaded listening-history export.

Non-goal: this is NOT a multi-user app where each visitor logs in with their own
Spotify. It is Neil's data on a public page.

## 2. Verified API constraints (official 2026 Spotify docs)

These facts are load-bearing and were cross-checked against developer.spotify.com
and corroborating sources. They justify the design choices below.

Available (no Spotify Premium required to READ):
- Get User's Top Items: `GET /me/top/{type}` for `artists` and `tracks`.
  `time_range` is one of `short_term` (~4 weeks), `medium_term` (~6 months),
  `long_term` ("calculated from ~1 year of data", NOT lifetime). `limit` max 50,
  and you cannot page past the top 50 per window. Scope: `user-top-read`.
- Get Recently Played: `GET /me/player/recently-played`. Max 50 items per call,
  cursor pagination via mutually-exclusive `before`/`after` Unix-millisecond
  timestamps. The `before` cursor does not reliably reach older history, so the
  only way to build long-term history is to poll forward with `after` set to the
  newest timestamp already stored, and persist results yourself. Scope:
  `user-read-recently-played`. Tracks only (no podcast episodes).
- Get Currently Playing: `GET /me/player/currently-playing`. Returns HTTP 204
  (no body) when nothing is playing. Scope: `user-read-currently-playing`.
- Top artist objects include a `genres` array, which powers the genre breakdown.

Dead for any newly created app (deprecated 2024-11-27, confirmed still blocked in
2026; do NOT design around these):
- Audio Features (danceability, energy, valence, tempo) -> 403 for new apps.
- Audio Analysis -> blocked.
- Recommendations -> 404 for new apps.
- Related Artists, Featured Playlists, Category Playlists -> blocked.
- 30-second `preview_url` in multi-get responses -> null.
- `popularity` field is stripped for new (development-mode) apps, so no
  "mainstream score." Genres are still present.

Auth and quota (2026):
- Access tokens last exactly 1 hour (3600s); refresh on a schedule.
- Use the Authorization Code flow (server-side, client secret stored). It lets
  Neil authorize once and reuse one long-lived refresh token. Client Credentials
  cannot read user data; plain Authorization Code (not PKCE) is preferred here
  because it normally does NOT rotate the refresh token, so a static secret keeps
  working.
- Refresh tokens have no documented expiry but CAN occasionally rotate; the job
  must check for a returned `refresh_token` and surface an `invalid_grant` failure
  so Neil can re-authorize once.
- Development mode in 2026 requires the app owner to have Spotify Premium (Neil
  does) and caps the app at 5 authorized users. Since only Neil logs in, this is
  a non-issue and no extended-quota review is needed. Neil must be listed under
  the app dashboard "Users and Access" allowlist.

True all-time data:
- The live API cannot return lifetime history. Neil requests his "Extended
  streaming history" from the Spotify Account Privacy page (delivered as a .zip of
  JSON arrays, official ceiling "up to 30 days", usually 1 to 14 days in practice,
  covering the full life of the account).
- Each stream row has ~21 fields; the ones we use: `ts` (UTC end timestamp),
  `ms_played`, `master_metadata_track_name`, `master_metadata_album_artist_name`,
  `master_metadata_album_album_name`, `spotify_track_uri`, `reason_start`,
  `reason_end`, `shuffle`, `skipped`. Filenames are
  `Streaming_History_Audio_*.json` (newer) or `endsong_*.json` (older). The export
  also contains private fields (IP address, email); these are NEVER published.

## 3. Architecture (GitHub Pages + GitHub Actions)

```
                 one-time, local
   Neil ──▶ scripts/auth.mjs ──▶ REFRESH_TOKEN ──▶ GitHub repo secrets
                                                   (CLIENT_ID, CLIENT_SECRET,
                                                    REFRESH_TOKEN)
                 scheduled, in CI
   GitHub Action (cron ~every 3h)
     └─ scripts/fetch.mjs
          refresh 1h token ─▶ call Spotify ─▶ write public/data/*.json
          ─▶ git commit ─▶ build Vite ─▶ deploy to GitHub Pages

                 one-time / occasional, local
   Spotify export .zip ──▶ scripts/ingest-history.mjs ──▶ public/data/alltime.json
                                                          (commit, then deploy)

   Visitor ──▶ https://neilp211.github.io/swansite
                static React app fetches /swansite/data/*.json  (no secrets)
```

Key properties:
- The refresh token and client secret live ONLY in GitHub Actions secrets and the
  local machine. They are never shipped to the browser.
- The static site reads plain JSON. Anyone can view; nothing sensitive is exposed.
- The recently-played log is append-only, so the site slowly accumulates real
  listening history that the API alone will not return.

## 4. Repository layout

```
swansite/
  index.html
  vite.config.js            # base: '/swansite/'
  package.json
  src/
    main.jsx
    App.jsx
    lib/                     # data loaders, formatters, genre weighting
    components/
      RangeToggle.jsx
      NowChip.jsx
      TopTracks.jsx
      TopArtists.jsx
      GenreChart.jsx
      ListeningPulse.jsx     # hour x weekday heatmap + tracks/day trend
      RecentlyPlayed.jsx
      FunStats.jsx
      alltime/               # LifetimeTotals, TopByMinutes, YearChart,
                             # LifetimeHeatmap, BehaviorStats, LockedAllTime
  public/
    data/
      top.json
      recent.json
      now.json
      alltime.json           # optional; present only after ingest
  scripts/
    auth.mjs                 # one-time local: obtain refresh token
    fetch.mjs                # CI: refresh token, fetch, write data
    ingest-history.mjs       # local: aggregate export -> alltime.json
    lib/                     # shared pure functions (testable)
  test/                      # unit tests for genre weighting + aggregation
  .github/workflows/update.yml
  README.md
```

Data lives under `public/data/` so Vite copies it into the build and the cron
writes to the same path that the frontend fetches.

## 5. Data file schemas

`public/data/top.json`
```json
{
  "generated_at": "ISO-8601",
  "ranges": {
    "short_term":  { "tracks": [Track], "artists": [Artist] },
    "medium_term": { "tracks": [Track], "artists": [Artist] },
    "long_term":   { "tracks": [Track], "artists": [Artist] }
  },
  "genres": {
    "short_term":  [{ "genre": "indie pop", "weight": 0.32 }],
    "medium_term": [ ... ],
    "long_term":   [ ... ]
  }
}
```
- Track: `{ rank, name, artists:[name], album, image, uri, url, duration_ms }`
- Artist: `{ rank, name, image, genres:[string], uri, url }`
- Genre weight per range: sum over that range's artists of `(51 - rank)` for each
  genre the artist lists, normalized to a fraction. Keep the top ~12 genres.

`public/data/recent.json` (append-only)
```json
{
  "updated_at": "ISO-8601",
  "plays": [
    { "played_at": "ISO-8601", "name": "", "artists": ["",], "album": "",
      "image": "", "uri": "", "duration_ms": 0 }
  ]
}
```
- Deduped and sorted by `played_at`. `duration_ms` is the full track length, so
  any "minutes" derived from this log are approximate (true `ms_played` only comes
  from the export).

`public/data/now.json`
```json
{ "updated_at": "ISO-8601", "is_playing": false,
  "track": { "name":"", "artists":[""], "album":"", "image":"", "uri":"" },
  "played_at": "ISO-8601" }
```
- From currently-playing; on HTTP 204 fall back to the newest item in
  recent.json and label it "last spun."

`public/data/alltime.json` (optional, from export; aggregates only)
```json
{
  "generated_at": "ISO-8601",
  "since": "YYYY-MM-DD",
  "totals": { "minutes":0, "hours":0, "days":0, "streams":0,
              "distinct_tracks":0, "distinct_artists":0 },
  "top_tracks_by_minutes": [{ "name":"", "artist":"", "minutes":0, "plays":0 }],
  "top_tracks_by_plays":   [ ... ],
  "top_artists_by_minutes":[{ "name":"", "minutes":0, "plays":0 }],
  "top_albums_by_minutes": [{ "name":"", "artist":"", "minutes":0 }],
  "by_year":  [{ "year":2024, "minutes":0, "streams":0 }],
  "by_month": [{ "month":"2024-01", "minutes":0, "streams":0 }],
  "heatmap":  [{ "dow":0, "hour":0, "minutes":0 }],
  "behavior": { "skip_rate":0.0, "shuffle_rate":0.0,
                "reason_end": { "trackdone":0, "fwdbtn":0, "endplay":0 } },
  "firsts":   { "first_stream": { "ts":"ISO-8601", "name":"", "artist":"" } }
}
```
- No raw rows, no IP, no email: only aggregates safe to publish.

## 6. Auth (one-time, local)

`scripts/auth.mjs`:
1. Start a local server on `http://127.0.0.1:8888/callback` (Spotify loopback
   rules prefer `127.0.0.1` over `localhost`). This redirect URI must be added in
   the Spotify app dashboard.
2. Open the browser to the authorize URL with scopes
   `user-top-read user-read-recently-played user-read-currently-playing`.
3. Receive `?code`, exchange it at `https://accounts.spotify.com/api/token` with
   `Authorization: Basic base64(client_id:client_secret)` and
   `grant_type=authorization_code`.
4. Print the `refresh_token`. Neil pastes it plus `CLIENT_ID` and `CLIENT_SECRET`
   into GitHub repo secrets (`SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`,
   `SPOTIFY_REFRESH_TOKEN`).

Refresh (in `fetch.mjs`): POST to `/api/token` with `grant_type=refresh_token`,
Basic auth header. If the response includes a new `refresh_token`, log a clear
warning (plain Authorization Code normally will not). On `invalid_grant`, fail the
workflow loudly so Neil knows to re-run `auth.mjs`.

## 7. Data refresh + deploy (`.github/workflows/update.yml`)

One workflow to avoid the "a GITHUB_TOKEN push does not retrigger workflows"
gotcha:
- Triggers: `schedule` (cron `0 */3 * * *`, about every 3 hours),
  `push` to `main`, and `workflow_dispatch`.
- Permissions: `contents: write`, `pages: write`, `id-token: write`.
- Steps:
  1. checkout, setup-node, `npm ci`.
  2. `node scripts/fetch.mjs` (env from secrets). Writes `public/data/top.json`,
     merges new plays into `public/data/recent.json`, writes `public/data/now.json`.
  3. commit changed `public/data/*` if any (skip cleanly if no change).
  4. `npm run build`.
  5. upload-pages-artifact + deploy-pages.
- Concurrency group so overlapping runs do not collide.

Cadence note: every ~3h keeps us well under the 50-play recently-played cap
between runs. Scheduled Actions can be delayed under load; acceptable for a stats
site.

## 8. Offline history ingestion (`scripts/ingest-history.mjs`)

Run locally when the export arrives: `node scripts/ingest-history.mjs <path>`.
- Accept a path to the unzipped export folder (or the .zip).
- Parse all `Streaming_History_Audio_*.json` and/or `endsong_*.json` arrays.
- Use `ms_played`, `ts`, and `master_metadata_*` fields. Ignore rows with null
  track metadata (podcast/video). Treat very short `ms_played` plays per the
  behavior stats but still count them.
- Aggregate into `public/data/alltime.json` (schema above). Commit and deploy.
- Re-runnable when a fresher export arrives.

## 9. Dashboard (data-dashboard style, palette: dark + multi-color data viz)

Top bar: brand "SwanSite", range toggle `4 Weeks | 6 Months | 1 Year | All-Time`,
a "last updated" stamp, and a "last spun" chip.

Live sections (MVP, from the API):
- Top Tracks: ranked list, album art, up to 50, scrollable.
- Top Artists: ranked grid with images.
- Top Genres: bar or treemap from the artists' genres, each genre its own color.
- Listening Pulse: hour-of-day x weekday heatmap plus a tracks-per-day trend line,
  built from the accumulating recently-played log.
- Recently Played: live ticker of the latest plays with timestamps.
- Fun cards: genre-diversity count, "rising artists" (in the 4-week list but not
  the 1-year list), longest listening streak (once enough history accrues).

All-Time sections (unlock when `alltime.json` exists; otherwise a friendly
"request your export to unlock" card with instructions):
- Lifetime totals: hours/days listened, total streams, distinct tracks/artists,
  "listening since <date>".
- All-time top tracks/artists/albums by minutes and by plays.
- Minutes per year/month area chart (the "story of my listening").
- Lifetime hour x weekday heatmap.
- Behavior stats: skip rate, shuffle rate, how-songs-end breakdown.

Visual: dark base, vivid categorical palette where each genre/artist gets its own
color. Charts via Recharts; the heatmap is a simple CSS grid. Desktop-first but
must remain usable on phones (friends will open it on mobile).

Later / explicitly out of MVP scope:
- True real-time now-playing (needs a small serverless token endpoint, which
  breaks the pure-static model).
- Playlists overview.
- Shareable stat-card image export.

## 10. Privacy and safety

- Public repo and public site by design (friends must view it).
- Published: top tracks/artists/genres, aggregate stats, album/artist art, recent
  play log with timestamps, all-time aggregates.
- Never published: client secret, refresh token, raw export rows, IP addresses,
  email, account identifiers.
- `fetch.mjs` and `ingest-history.mjs` write only the safe fields defined in the
  schemas above.

## 11. Testing and verification

- Unit-test the pure functions: genre weighting (fetch lib) and export
  aggregation (ingest lib) with small fixtures.
- After each milestone, run `npm run build` and confirm a clean build, then load
  the built site locally and confirm the sections render from committed sample
  data. Report verified build status.

## 12. Risks and mitigations

- Refresh-token revocation -> workflow fails loudly; re-run `auth.mjs` and update
  the secret.
- More than 50 plays between cron runs -> rare at a 3h cadence; accept small gap.
- Refresh-token rotation -> use plain Authorization Code (rarely rotates); detect
  and warn if it happens.
- Scheduled Action delays -> acceptable for a stats dashboard.
- Spotify app setup -> register the `127.0.0.1:8888/callback` redirect URI and add
  Neil to the app's Users and Access allowlist.

## 13. Milestones (high level; detailed steps come from the implementation plan)

1. Vite + React scaffold, Spotify app registration, `auth.mjs`, obtain refresh
   token, store secrets.
2. `fetch.mjs` + data schemas + committed sample data.
3. `update.yml` workflow (fetch -> commit -> build -> deploy Pages).
4. Frontend live tier (toggle, top tracks/artists, genres, recently played, now
   chip).
5. Listening Pulse (heatmap + trend) from the accumulating log.
6. Fun stat cards.
7. `ingest-history.mjs` + all-time tier UI + locked state.
8. Polish: palette, responsiveness, README; share-card export deferred.
