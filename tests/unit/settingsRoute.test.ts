import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NextRequest } from "next/server";

import { createSettingsRouteHandlers } from "../../src/app/api/settings/route";
import { normalizePreferences } from "../../src/lib/settings/preferencesSchema";

type FakeOptions = {
  initial?: Record<string, unknown> | null;
  failRead?: boolean;
  failWrite?: boolean;
};

function fakeFirestore(options: FakeOptions = {}) {
  let value = options.initial ?? null;
  let collectionName = "";
  let documentId = "";
  let writes = 0;

  const snapshot = () => ({
    exists: value !== null,
    data: () => value ?? undefined,
  });
  const reference = {
    get: async () => {
      if (options.failRead) throw new Error("read_failed");
      return snapshot();
    },
    set: async (next: Record<string, unknown>) => {
      if (options.failWrite) throw new Error("write_failed");
      writes += 1;
      value = next;
    },
  };
  const db = {
    collection: (name: string) => {
      collectionName = name;
      return {
        doc: (id: string) => {
          documentId = id;
          return reference;
        },
      };
    },
    runTransaction: async (
      callback: (transaction: {
        get: (ref: unknown) => Promise<ReturnType<typeof snapshot>>;
        set: (
          ref: unknown,
          next: Record<string, unknown>,
          options: { merge: boolean },
        ) => void;
      }) => Promise<unknown>,
    ) => callback({
      get: async () => {
        if (options.failRead) throw new Error("read_failed");
        return snapshot();
      },
      set: (_ref, next) => {
        if (options.failWrite) throw new Error("write_failed");
        writes += 1;
        value = next;
      },
    }),
  };

  return {
    db,
    inspect: () => ({ value, collectionName, documentId, writes }),
  };
}

function request(method: "GET" | "PUT", body?: unknown) {
  return new NextRequest("http://localhost/api/settings", {
    method,
    ...(body === undefined
      ? {}
      : {
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
}

function handlers(options: {
  username?: string | null;
  db?: ReturnType<typeof fakeFirestore>;
  enabled?: boolean;
} = {}) {
  const database = options.db ?? fakeFirestore();
  return {
    database,
    routes: createSettingsRouteHandlers({
      resolveUsername: async () => options.username ?? null,
      getDb: () => database.db as never,
      timestamp: () => "server-time",
      syncEnabled: () => options.enabled ?? true,
    }),
  };
}

describe("settings API route", () => {
  it("returns null for a guest GET and rejects a guest PUT without Firestore", async () => {
    const { routes, database } = handlers();
    const getResponse = await routes.GET(request("GET"));
    const putResponse = await routes.PUT(request("PUT", { preferences: {} }));

    assert.equal(getResponse.status, 200);
    assert.deepEqual(await getResponse.json(), {
      ok: true,
      syncEnabled: true,
      preferences: null,
    });
    assert.equal(putResponse.status, 401);
    assert.equal(database.inspect().writes, 0);
  });

  it("returns null for an authenticated user with no document", async () => {
    const { routes, database } = handlers({ username: "  Alice  " });
    const response = await routes.GET(request("GET"));

    assert.equal(response.status, 200);
    assert.equal((await response.json()).preferences, null);
    assert.equal(database.inspect().collectionName, "user_settings_v1");
    assert.equal(database.inspect().documentId, "alice");
  });

  it("normalizes complete, partial, and malformed remote documents", async () => {
    const database = fakeFirestore({
      initial: {
        schemaVersion: 99,
        test: {
          defaultLength: 30,
          include_numbers: true,
          include_punctuation: "broken",
        },
        futureField: true,
      },
    });
    const { routes } = handlers({ username: "Alice", db: database });
    const response = await routes.GET(request("GET"));
    const body = await response.json();

    assert.equal(body.preferences.schemaVersion, 1);
    assert.equal(body.preferences.test.defaultLength, 30);
    assert.equal(body.preferences.test.include_numbers, true);
    assert.equal(body.preferences.test.include_punctuation, false);
    assert.equal("futureField" in body.preferences, false);
  });

  it("persists a normalized partial update under only the session identity", async () => {
    const database = fakeFirestore();
    const { routes } = handlers({ username: " ALIce ", db: database });
    const response = await routes.PUT(request("PUT", {
      username: "mallory",
      preferences: {
        usernameLower: "mallory",
        test: {
          include_numbers: true,
          defaultLength: 999,
        },
      },
    }));
    const body = await response.json();
    const stored = database.inspect().value as Record<string, unknown>;

    assert.equal(response.status, 200);
    assert.equal(database.inspect().documentId, "alice");
    assert.equal(stored.usernameLower, "alice");
    assert.equal((stored.test as Record<string, unknown>).include_numbers, true);
    assert.equal((stored.test as Record<string, unknown>).defaultLength, 15);
    assert.equal(body.preferences.test.include_numbers, true);
  });

  it("adopts local preferences once without overwriting an existing record", async () => {
    const established = normalizePreferences({
      test: { include_punctuation: true },
    });
    const database = fakeFirestore({ initial: established });
    const { routes } = handlers({ username: "alice", db: database });
    const response = await routes.PUT(request("PUT", {
      adoption: true,
      preferences: { test: { include_numbers: true } },
    }));
    const body = await response.json();

    assert.equal(body.adopted, false);
    assert.equal(body.preferences.test.include_punctuation, true);
    assert.equal(body.preferences.test.include_numbers, false);
    assert.equal(database.inspect().writes, 0);
  });

  it("creates an adoption document with explicit metadata when absent", async () => {
    const database = fakeFirestore();
    const { routes } = handlers({ username: "alice", db: database });
    const response = await routes.PUT(request("PUT", {
      adoption: true,
      preferences: { test: { include_numbers: true } },
    }));
    const body = await response.json();
    const stored = database.inspect().value as Record<string, unknown>;

    assert.equal(body.adopted, true);
    assert.equal(database.inspect().writes, 1);
    assert.equal(stored.adoptedFromLocalAt, "server-time");
    assert.equal(stored.updatedAt, "server-time");
  });

  it("rejects invalid bodies", async () => {
    const { routes } = handlers({ username: "alice" });
    const response = await routes.PUT(request("PUT", { preferences: "bad" }));

    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, "invalid_preferences");
  });

  it("returns stable errors for Firestore read and write failures", async () => {
    const readFailure = handlers({
      username: "alice",
      db: fakeFirestore({ failRead: true }),
    });
    const writeFailure = handlers({
      username: "alice",
      db: fakeFirestore({ failWrite: true }),
    });
    const readResponse = await readFailure.routes.GET(request("GET"));
    const writeResponse = await writeFailure.routes.PUT(request("PUT", {
      preferences: {},
    }));

    assert.equal(readResponse.status, 503);
    assert.equal((await readResponse.json()).error.code, "settings_read_failed");
    assert.equal(writeResponse.status, 503);
    assert.equal((await writeResponse.json()).error.code, "settings_write_failed");
  });

  it("disables reads and writes without touching Firestore", async () => {
    const database = fakeFirestore();
    const { routes } = handlers({
      username: "alice",
      db: database,
      enabled: false,
    });
    const getResponse = await routes.GET(request("GET"));
    const putResponse = await routes.PUT(request("PUT", { preferences: {} }));

    assert.equal((await getResponse.json()).syncEnabled, false);
    assert.equal(putResponse.status, 503);
    assert.equal((await putResponse.json()).error.code, "settings_sync_disabled");
    assert.equal(database.inspect().collectionName, "");
    assert.equal(database.inspect().writes, 0);
  });
});
