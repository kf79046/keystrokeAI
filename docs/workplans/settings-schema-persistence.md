# Workplan — Settings Schema and Persistence

**Branch:** `feat/settings-schema-persistence`
**Phase:** 3 (per [docs/BLAZEKEY_AGENT_CURSOR_CONTEXT.md](../BLAZEKEY_AGENT_CURSOR_CONTEXT.md), section "PHASE 3")
**Status:** Approved plan — ready to implement
**Depends on:** Phase 2 (`fix/adaptive-config-core` + `fix/adaptive-config-runtime`, both merged to `main`)

This branch creates a reliable, versioned settings model and explicitly chooses its
persistence boundary. It does **not** redesign the settings UI (that is Phase 4,
`feat/settings-ui-redesign`) and does **not** expose any new setting.

---

## 1. Objective and non-goals

### Objective

1. Define one canonical, versioned, serializable **preference schema** with a single
   defaults source and safe normalization for unknown/invalid values.
2. Choose and document the **persistence owner** and **identity key** with repository
   evidence.
3. Persist preferences for authenticated users through an additive, reversible,
   server-mediated boundary, keeping guests on local-only storage.
4. Establish an explicit **precedence order** from defaults to effective preferences.
5. Cover reads, writes, migration, and fallback with automated tests.

### Non-goals (explicitly out of scope)

- No settings UI/drawer redesign (Phase 4).
- No new user-facing settings; only persist controls that already work.
- No capitalization, Blaze generation, or audio settings (not implemented today).
- No destructive migration; no change to `users` account columns.
- No change to PartyKit, multiplayer, runs, totals, or leaderboard behavior.
- No change to the Phase 2 generation pipeline or `TestGenerationConfig` contract.

---

## 2. Verified current state (evidence)

### 2.1 Where settings live today

- [src/store/settings.ts](../../src/store/settings.ts) defines `useSettingsStore`
  via Zustand `persist`, key `bk:settings:v1`, `version: 1`, with a shallow-merge
  `migrate`. Groups: `commands`, `test`, `ai`, `fx`, `focus`, `appearance`,
  `privacy`. It is **browser-local only** — not persisted to Postgres or Firestore.
- The `test` group already sources its defaults from the Phase 2 canonical config:
  `APPLICATION_TEST_CONFIG` in
  [src/lib/prompt/testGenerationConfig.ts](../../src/lib/prompt/testGenerationConfig.ts).
- Legacy last-test migration already exists in
  [src/stores/useLastTestStore.ts](../../src/stores/useLastTestStore.ts)
  (`parseLastTestConfigInput` handles snake_case / `count` / `duration` shapes and
  validates via `normalizeTestGenerationConfig`). This is the migration pattern to
  mirror.

### 2.2 Split data model (do not assume Postgres)

Per [docs/current-architecture.md](../current-architecture.md):

- **Postgres** owns username/password accounts and JWT sessions. Only the `users`
  table exists ([backend/models.py](../../backend/models.py); single migration
  [backend/alembic/versions/0001_initial_users_table.py](../../backend/alembic/versions/0001_initial_users_table.py)).
- **Firestore** owns per-user product/game data (`runs_v1`, `user_totals_v1`,
  `users`, projections), written server-side through Next.js route handlers.
- **PartyKit** owns live room state.
- **Zustand/localStorage** owns browser settings.

### 2.3 Identity is the app username, not the Firebase UID

- [src/lib/appSession.ts](../../src/lib/appSession.ts) `getCurrentAppUsername(req)`
  resolves identity from the `ks_session` JWT cookie via `/api/auth/me`. Its
  docstring states this is the **single source of truth** for "who is this user"
  across user-data API routes; Firebase UID is a legacy parallel identity.
- [src/app/api/runs/route.ts](../../src/app/api/runs/route.ts) confirms the
  established pattern: resolve `appUsername`, key Firestore docs by `usernameLower`,
  write via the Admin SDK ([src/lib/firebaseAdmin.ts](../../src/lib/firebaseAdmin.ts)
  `getAdminDb`).
- Backend session is a JWT cookie (`ks_session`) parsed in
  [backend/auth.py](../../backend/auth.py) (`/auth/me`).

### 2.4 Server-write / rules pattern

- [firestore.rules](../../firestore.rules): user-data collections written by the
  server are locked to `allow write: if false` (client cannot write). Some collections
  allow owner read via `request.auth.uid`, but because app identity is the Postgres
  username (not a Firebase Auth uid), the reliable path for username-keyed data is
  **API-mediated read/write via Admin SDK** (as `parties_v1` does with
  `allow read, write: if false`).
- Single-document reads keyed by doc id need **no composite index**
  ([firestore.indexes.json](../../firestore.indexes.json)).

### 2.5 Client auth signal for sync

- [src/hooks/useAuth.tsx](../../src/hooks/useAuth.tsx) exposes `user`, `loading`,
  and `hydrateFromMe` from `useAuthStore`. This is the trigger source for hydrating
  and syncing server preferences.

---

## 3. Decision — persistence owner and identity key

**Decision: Firestore collection `user_settings_v1`, one document per user keyed by
`usernameLower`, read and written only through Next.js Admin-SDK route handlers.**

### Rationale (evidence-based)

- User preferences are **per-user product data**, matching the class of data Firestore
  already owns (runs/totals/stats), not account credentials.
- The established, proven identity bridge for that data is `getCurrentAppUsername` →
  `usernameLower` ([src/app/api/runs/route.ts](../../src/app/api/runs/route.ts)). Reusing
  it avoids inventing a second identity path and satisfies the roadmap requirement to
  bridge authenticated users, Firebase compatibility, and guests.
- **Additive and reversible:** a new collection + one rules block. No Postgres schema
  migration, no change to the `users` table, no Alembic revision required.
- Mirrors an existing server-mediated boundary (`getAdminDb`, `serverTs`), minimizing
  new surface area and risk.

### Rejected alternative — Postgres `user_settings` table

A JSONB `preferences` column FK'd to `users.id`, exposed via new FastAPI `/settings`
GET/PUT and a Next.js proxy. Rejected for this phase because it requires a new Alembic
migration, new FastAPI endpoints, and a second serialization contract, for data that is
not account-critical. It remains a valid future option; the schema defined here is
storage-agnostic, so the owner can be swapped later without changing the client schema.

### Identity / guest bridge

- **Authenticated user:** `usernameLower` (from `getCurrentAppUsername`). Server is the
  source of truth.
- **Guest / anonymous:** no server document; localStorage remains authoritative
  (current behavior preserved).
- **Firebase compatibility:** not used as the settings key; identity flows exclusively
  through the app-session username, consistent with `appSession.ts`.

---

## 4. Canonical preference schema

Add [src/lib/settings/preferencesSchema.ts](../../src/lib/settings/preferencesSchema.ts)
as the single serializable, versioned contract. It is the **persistable slice** of the
existing settings store (data groups only — never the Zustand action functions).

```ts
export const PREFERENCES_SCHEMA_VERSION = 1; // storage schema, independent of bk:settings persist version

// Serializable subset of SettingsState (data groups only)
export type PersistedPreferences = {
  schemaVersion: number;
  commands: SettingsState["commands"];
  test: SettingsState["test"];
  ai: SettingsState["ai"];
  fx: SettingsState["fx"];
  focus: SettingsState["focus"];
  appearance: SettingsState["appearance"];
  privacy: SettingsState["privacy"];
};
```

Requirements:

- **Single defaults source:** derive defaults from the existing `DEFAULTS` in
  [src/store/settings.ts](../../src/store/settings.ts) (which already sources `test`
  defaults from `APPLICATION_TEST_CONFIG`). Do not duplicate default literals.
- `normalizePreferences(raw: unknown): PersistedPreferences` — reuse the existing
  per-field validators already present in the store's `import()` path (mode, length,
  wordSet, boolean flags, repeat 1–5, `autoPeekDelayMs` bounds). Unknown or invalid
  values fall back to the corresponding default; unknown keys are dropped. Must never
  throw on bad input.
- `toPreferences(state: SettingsState): PersistedPreferences` — extract the data slice.
- `applyPreferences(prefs: PersistedPreferences)` — apply onto the store without
  clobbering action members.
- `migratePreferences(raw, fromVersion): PersistedPreferences` — additive migration; on
  unknown/newer version, normalize-with-defaults rather than fail.

> The roadmap's flat `UserTypingPreferences` sketch is treated as a **future
> typed view** for the Phase 4 UI, not the storage shape. Persisting the existing
> serializable object avoids a lossy remap and keeps one defaults source.

---

## 5. Precedence model

```text
Application defaults (DEFAULTS / APPLICATION_TEST_CONFIG)
        ↓
Stored user preferences (server for authenticated, localStorage for guests)
        ↓
Current session overrides (filter chips / in-session changes — unchanged behavior)
        ↓
normalizePreferences() validation
        ↓
Effective preferences → generator & renderer (existing Phase 2 pipeline)
```

Rules:

- On boot: local `bk:settings:v1` hydrates immediately (fast paint, unchanged).
- When authenticated: server preferences are fetched and, if present, become the source
  of truth (hydrate store + refresh local cache).
- Session overrides (e.g. filter chips) continue to work exactly as in Phase 2 and are
  not written to global defaults.
- After the active test initializes, preference changes do not mutate the active prompt
  (Phase 2 snapshot behavior preserved).

---

## 6. Sync behavior, migration, optimistic UI, rollback

### 6.1 First-login adoption (one-time)

On login, if the server has **no** `user_settings_v1` document for the user, seed it once
from the current local preferences (adoption), then treat the server as source of truth.
If a server document exists, it hydrates the store and overwrites the local cache.

### 6.2 Existing-user migration

- Existing local `bk:settings:v1` is retained as the local cache. Bump the store persist
  `version` to `2` with an additive `migrate` that fills any missing group from `DEFAULTS`
  (superset merge; no data loss).
- Server documents carry `schemaVersion`; `migratePreferences` upgrades older documents
  additively. Unknown fields are ignored; missing fields use defaults.

### 6.3 Optimistic UI + rollback

- Writes are optimistic: update the store/local immediately, then debounce a PUT to the
  server (≈500–800 ms).
- On PUT failure: keep the local value (app stays functional), surface a non-blocking
  "settings not synced" state, and retry on next change or next auth refresh. No user data
  is lost; local remains authoritative until a successful sync.
- A feature flag (`SETTINGS_SERVER_SYNC`, env/constant, default on) disables all server
  sync and reverts to local-only behavior without code changes elsewhere.

---

## 7. Implementation steps (file by file)

1. **Schema module** — add
   [src/lib/settings/preferencesSchema.ts](../../src/lib/settings/preferencesSchema.ts):
   types, `PREFERENCES_SCHEMA_VERSION`, `normalizePreferences`, `toPreferences`,
   `applyPreferences`, `migratePreferences`. Reuse existing validators; extract shared
   validators from the store `import()` path so there is one validation source.

2. **Settings store** — [src/store/settings.ts](../../src/store/settings.ts): bump persist
   `version` to `2` with additive `migrate`; add an internal `applyPreferences` action (or
   reuse `import`) that sets data groups without touching functions. No behavior change for
   guests.

3. **Server routes** — add
   [src/app/api/settings/route.ts](../../src/app/api/settings/route.ts) with
   `runtime = "nodejs"`, `dynamic = "force-dynamic"`:
   - `GET`: resolve identity via `getCurrentAppUsername`; return the
     `user_settings_v1/{usernameLower}` document (normalized) or `{ preferences: null }`
     for guests / no-doc.
   - `PUT`: resolve identity; `normalizePreferences(body)`; write
     `user_settings_v1/{usernameLower}` via `getAdminDb()` with `serverTs()` metadata
     (`updatedAt`, `schemaVersion`). Reject unauthenticated writes with 401. Never persist
     for guests.

4. **Client sync hook** — add
   [src/hooks/useSettingsSync.ts](../../src/hooks/useSettingsSync.ts): on `useAuth().user`
   becoming present, `GET /api/settings` → `applyPreferences`; subscribe to store changes
   and debounce `PUT` when authenticated and the flag is on. Handle first-login adoption
   and failure rollback. Mount it once high in the tree (e.g.
   [src/components/AppBoot.tsx](../../src/components/AppBoot.tsx)).

5. **Firestore rules** — [firestore.rules](../../firestore.rules): add a server-mediated
   block:
   ```
   match /user_settings_v1/{docId} {
     allow read, write: if false; // read/write via Admin SDK route handlers only
   }
   ```
   No new index required ([firestore.indexes.json](../../firestore.indexes.json) unchanged —
   single-doc reads by id).

6. **No UI changes** — the existing drawer keeps working; it now benefits from server
   hydration transparently.

---

## 8. Test plan

Run with the repo conventions (`tsx --test` for unit; Playwright for e2e).

### Unit — [tests/unit/preferencesSchema.test.ts](../../tests/unit/preferencesSchema.test.ts)

- `normalizePreferences` fills defaults for missing groups.
- Invalid values (bad mode, out-of-range length/repeat, non-boolean flags, bad wordSet,
  out-of-bounds `autoPeekDelayMs`) fall back to defaults and never throw.
- Unknown keys are dropped; unknown/newer `schemaVersion` normalizes safely.
- `toPreferences` never includes function members.
- `applyPreferences(toPreferences(state))` round-trips the data slice.

### Route — [tests/unit/settingsRoute.test.ts](../../tests/unit/settingsRoute.test.ts)

- Import `GET`/`PUT`; mock `getCurrentAppUsername` and `getAdminDb`.
- Guest `GET` → `{ preferences: null }`; guest `PUT` → 401, no write.
- Authenticated `PUT` normalizes then writes `user_settings_v1/{usernameLower}`.
- First-login `GET` with no doc returns null; adoption path seeds once.
- Malformed body is normalized (no 500).

### E2E — [tests/e2e/settings-persistence.spec.ts](../../tests/e2e/settings-persistence.spec.ts)

- With a deterministic mocked auth + `/api/settings` fixture: change a setting, reload,
  assert it persists via server hydration (not just localStorage).
- Guest flow: setting persists locally and no server write is attempted.

### Existing regression

- `npm run test:adaptive`, `npm run test:unit`, `npm run test:e2e`,
  `npm run type-check`, `npm run lint`, `npm run build`. Report pre-existing baseline
  failures separately (type-check/lint baselines are known-red per current-architecture).

---

## 9. Acceptance checklist (maps to roadmap Phase 3)

- [ ] Persistence owner + identity key documented with repository evidence (§2–§3).
- [ ] Migration is additive and reversible (§6.2).
- [ ] Defaults defined in one place (`DEFAULTS` / `APPLICATION_TEST_CONFIG`) (§4).
- [ ] Invalid stored data falls back safely (`normalizePreferences`) (§4, §8).
- [ ] Existing users supported (local cache retained + additive migrate) (§6.2).
- [ ] Setting writes and reads tested (§8).
- [ ] No settings UI redesign in this branch (§1 non-goals).
- [ ] No destructive migration (§1, §6.2).

---

## 10. Rollback

- **Feature flag:** set `SETTINGS_SERVER_SYNC` off → app reverts to local-only settings;
  server documents are ignored but not deleted.
- **Rules/collection:** remove the `user_settings_v1` rules block and, if desired, delete
  the collection. No account or game data is affected.
- **Store:** the persist `version` bump is additive; reverting the code leaves
  `bk:settings:v1` readable by the prior version (superset merge).
- **No Postgres/Alembic change to revert** (Firestore-owner decision).

---

## 11. Risks

| Risk | Severity | Mitigation |
| --- | --- | --- |
| Server hydration overwrites a just-changed local value | Medium | Debounced writes + last-write-wins on `updatedAt`; hydrate only on auth transition, not on every focus |
| First-login adoption clobbers server prefs from a shared device | Medium | Adoption only when server doc is absent; otherwise server wins |
| Identity mismatch (username vs Firebase uid) | Medium | Reuse `getCurrentAppUsername` exclusively; server-mediated rules deny direct client access |
| Optimistic write fails silently | Low | Non-blocking unsynced state + retry; local stays authoritative |
| Scope creep into UI or new settings | Medium | Persist only existing working settings; UI is Phase 4 |
| Persist `version` bump migration edge cases | Low | Additive superset merge from `DEFAULTS`; unit-tested |

---

## 12. Commands

```text
npm run test:adaptive
npm run test:unit
npm run test:e2e
npm run type-check
npm run lint
npm run build
```

Use the safe build environment already required by the repo:
`NEXT_PUBLIC_API_URL=https://api.blazekeyapp.com`. No secrets in commands, output, or
commits.

---

## 13. Recommended next branch

`feat/settings-ui-redesign` (Phase 4) — redesign the gear/settings experience on top of
this reliable schema and persistence boundary.
