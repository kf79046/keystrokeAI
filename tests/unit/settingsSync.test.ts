import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  normalizePreferences,
  type PersistedPreferences,
} from "../../src/lib/settings/preferencesSchema";
import {
  SETTINGS_PENDING_WRITE_KEY,
  clearPendingSettingsWrite,
  parsePendingSettingsWrite,
  readPendingSettingsWrite,
  resolveInitialSettings,
  storePendingSettingsWrite,
  type SettingsTransport,
} from "../../src/lib/settings/settingsSync";
import { isSettingsServerSyncEnabled } from "../../src/lib/settings/serverSyncFlag";

function preferences(
  patch: Record<string, unknown> = {},
): PersistedPreferences {
  return normalizePreferences(patch);
}

function transport(overrides: Partial<SettingsTransport>): SettingsTransport {
  return {
    read: async () => ({ syncEnabled: true, preferences: null }),
    write: async (value) => ({ preferences: value, adopted: true }),
    ...overrides,
  };
}

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

describe("settings synchronization resolution", () => {
  it("parses the server sync kill switch conservatively", () => {
    assert.equal(isSettingsServerSyncEnabled(undefined), true);
    assert.equal(isSettingsServerSyncEnabled("1"), true);
    assert.equal(isSettingsServerSyncEnabled("false"), false);
    assert.equal(isSettingsServerSyncEnabled(" OFF "), false);
  });

  it("keeps guests/server-disabled sessions local-only", async () => {
    const local = preferences({ test: { include_numbers: true } });
    let writes = 0;
    const result = await resolveInitialSettings(local, transport({
      read: async () => ({ syncEnabled: false, preferences: null }),
      write: async (value) => {
        writes += 1;
        return { preferences: value, adopted: false };
      },
    }));

    assert.equal(result.status, "local-only");
    assert.equal(result.preferences.test.include_numbers, true);
    assert.equal(writes, 0);
  });

  it("uses valid remote preferences as authenticated source of truth", async () => {
    const local = preferences({ test: { include_numbers: false } });
    const remote = preferences({ test: { include_numbers: true } });
    const result = await resolveInitialSettings(local, transport({
      read: async () => ({ syncEnabled: true, preferences: remote }),
    }));

    assert.equal(result.preferences.test.include_numbers, true);
    assert.equal(result.adopted, false);
  });

  it("adopts local preferences only when the remote document is missing", async () => {
    const local = preferences({ test: { include_punctuation: true } });
    let adoption = false;
    const result = await resolveInitialSettings(local, transport({
      write: async (value, options) => {
        adoption = options.adoption;
        return { preferences: value, adopted: true };
      },
    }));

    assert.equal(adoption, true);
    assert.equal(result.adopted, true);
    assert.equal(result.preferences.test.include_punctuation, true);
  });

  it("accepts an existing remote record returned by an adoption race", async () => {
    const local = preferences({ test: { include_numbers: true } });
    const established = preferences({ test: { include_punctuation: true } });
    const result = await resolveInitialSettings(local, transport({
      write: async () => ({ preferences: established, adopted: false }),
    }));

    assert.equal(result.adopted, false);
    assert.equal(result.preferences.test.include_numbers, false);
    assert.equal(result.preferences.test.include_punctuation, true);
  });

  it("surfaces read and adoption failures without replacing local data", async () => {
    const local = preferences({ test: { include_numbers: true } });
    await assert.rejects(
      resolveInitialSettings(local, transport({
        read: async () => { throw new Error("firestore_down"); },
      })),
      /firestore_down/,
    );
    await assert.rejects(
      resolveInitialSettings(local, transport({
        write: async () => { throw new Error("adoption_failed"); },
      })),
      /adoption_failed/,
    );
    assert.equal(local.test.include_numbers, true);
  });

  it("checks the kill switch then retries a persisted failed write", async () => {
    const pending = {
      usernameLower: "alice",
      preferences: preferences({ test: { include_numbers: true } }),
      adoption: false,
      queuedAt: 10,
    };
    let reads = 0;
    let writes = 0;
    const result = await resolveInitialSettings(
      preferences(),
      transport({
        read: async () => {
          reads += 1;
          return { syncEnabled: true, preferences: preferences() };
        },
        write: async (value, options) => {
          writes += 1;
          assert.equal(options.adoption, false);
          return { preferences: value, adopted: false };
        },
      }),
      { pending },
    );

    assert.equal(reads, 1);
    assert.equal(writes, 1);
    assert.equal(result.preferences.test.include_numbers, true);
  });

  it("does not retry a pending write while server sync is disabled", async () => {
    const pending = {
      usernameLower: "alice",
      preferences: preferences({ test: { include_numbers: true } }),
      adoption: false,
      queuedAt: 10,
    };
    let writes = 0;
    const result = await resolveInitialSettings(
      preferences(),
      transport({
        read: async () => ({ syncEnabled: false, preferences: null }),
        write: async (value) => {
          writes += 1;
          return { preferences: value, adopted: false };
        },
      }),
      { pending },
    );

    assert.equal(result.status, "local-only");
    assert.equal(result.preferences.test.include_numbers, true);
    assert.equal(writes, 0);
  });

  it("persists pending writes per normalized identity and rejects malformed data", () => {
    const storage = memoryStorage();
    storePendingSettingsWrite(storage, {
      usernameLower: "alice",
      preferences: preferences({ test: { include_numbers: true } }),
      adoption: true,
      queuedAt: 20,
    });

    assert.equal(
      readPendingSettingsWrite(storage, "alice")?.preferences.test.include_numbers,
      true,
    );
    assert.equal(readPendingSettingsWrite(storage, "bob"), null);
    assert.equal(parsePendingSettingsWrite({ usernameLower: "alice" }, "alice"), null);
    clearPendingSettingsWrite(storage, "alice");
    assert.equal(storage.getItem(SETTINGS_PENDING_WRITE_KEY), null);
  });
});
