import {
  applicationSettingsDefaults,
  normalizePreferences,
  type PersistedPreferences,
} from "@/lib/settings/preferencesSchema";

export const SETTINGS_PENDING_WRITE_KEY = "bk:settings:pending:v1";
export const SETTINGS_OWNER_KEY = "bk:settings:owner:v1";

export type SettingsReadResult = {
  syncEnabled: boolean;
  preferences: PersistedPreferences | null;
  /** Set when the remote document declares a schema newer than this build. */
  unsupportedSchema?: boolean;
  remoteSchemaVersion?: number;
};

export type SettingsWriteResult = {
  preferences: PersistedPreferences;
  adopted: boolean;
};

export type SettingsTransport = {
  read: (signal?: AbortSignal) => Promise<SettingsReadResult>;
  write: (
    preferences: PersistedPreferences,
    options: { adoption: boolean; signal?: AbortSignal },
  ) => Promise<SettingsWriteResult>;
};

export type PendingSettingsWrite = {
  usernameLower: string;
  preferences: PersistedPreferences;
  adoption: boolean;
  queuedAt: number;
};

export type InitialSettingsResolution = {
  status: "ready" | "local-only" | "unsupported-remote";
  preferences: PersistedPreferences;
  syncEnabled: boolean;
  remoteResolved: boolean;
  adopted: boolean;
  /** True when the remote schema is newer than this build understands. */
  unsupportedSchema: boolean;
  remoteSchemaVersion?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Identity that currently owns the shared `bk:settings:v1` local cache, or null
 * when the cache belongs to a guest (no prior authenticated owner). Used to
 * prevent one authenticated user's cache from seeding another user's brand-new
 * remote document (cross-account preference leak).
 */
export function readSettingsOwner(
  storage: Pick<Storage, "getItem">,
): string | null {
  try {
    const raw = storage.getItem(SETTINGS_OWNER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    const owner = isRecord(parsed) ? parsed.usernameLower : null;
    return typeof owner === "string" && owner.length > 0 ? owner : null;
  } catch {
    return null;
  }
}

export function writeSettingsOwner(
  storage: Pick<Storage, "setItem" | "removeItem">,
  usernameLower: string | null,
) {
  try {
    if (usernameLower) {
      storage.setItem(SETTINGS_OWNER_KEY, JSON.stringify({ usernameLower }));
    } else {
      storage.removeItem(SETTINGS_OWNER_KEY);
    }
  } catch {
    // Ownership tracking is best-effort; the reset-on-transition path is the
    // durable isolation guarantee.
  }
}

/**
 * The local cache may seed a new remote document only when it belongs to a guest
 * (no prior authenticated owner) or already to this same user. A different
 * authenticated owner must never be adopted.
 */
export function isAdoptableLocalCache(
  owner: string | null,
  usernameLower: string,
): boolean {
  return owner === null || owner === usernameLower;
}

export function parsePendingSettingsWrite(
  raw: unknown,
  usernameLower: string,
): PendingSettingsWrite | null {
  if (!isRecord(raw) || raw.usernameLower !== usernameLower) return null;
  if (typeof raw.adoption !== "boolean") return null;
  return {
    usernameLower,
    preferences: normalizePreferences(raw.preferences),
    adoption: raw.adoption,
    queuedAt: Number.isFinite(Number(raw.queuedAt))
      ? Number(raw.queuedAt)
      : 0,
  };
}

export function readPendingSettingsWrite(
  storage: Pick<Storage, "getItem">,
  usernameLower: string,
): PendingSettingsWrite | null {
  try {
    const value = storage.getItem(SETTINGS_PENDING_WRITE_KEY);
    return value
      ? parsePendingSettingsWrite(JSON.parse(value), usernameLower)
      : null;
  } catch {
    return null;
  }
}

export function storePendingSettingsWrite(
  storage: Pick<Storage, "setItem">,
  pending: PendingSettingsWrite,
) {
  storage.setItem(SETTINGS_PENDING_WRITE_KEY, JSON.stringify({
    ...pending,
    preferences: normalizePreferences(pending.preferences),
  }));
}

export function clearPendingSettingsWrite(
  storage: Pick<Storage, "getItem" | "removeItem">,
  usernameLower: string,
) {
  try {
    const pending = readPendingSettingsWrite(storage, usernameLower);
    if (pending) storage.removeItem(SETTINGS_PENDING_WRITE_KEY);
  } catch {
    // localStorage failures must not affect application settings.
  }
}

/**
 * Remove any pending write regardless of owner. Used on logout / account
 * transition to leave a deterministic safe local state; a previous user's
 * failed write must never linger and be applied under a new identity.
 */
export function clearAllPendingSettingsWrites(
  storage: Pick<Storage, "removeItem">,
) {
  try {
    storage.removeItem(SETTINGS_PENDING_WRITE_KEY);
  } catch {
    // Best-effort; identity scoping already prevents cross-account application.
  }
}

export async function resolveInitialSettings(
  localPreferences: PersistedPreferences,
  transport: SettingsTransport,
  options: {
    pending?: PendingSettingsWrite | null;
    signal?: AbortSignal;
    /**
     * May the local cache seed a brand-new remote document? Defaults to true.
     * Set false when the local cache belongs to a different authenticated user
     * so the new user's empty remote is seeded from defaults, not a foreign
     * cache.
     */
    adoptable?: boolean;
    /** Preferences used to seed a new remote document when not adoptable. */
    adoptionPreferences?: PersistedPreferences;
  } = {},
): Promise<InitialSettingsResolution> {
  const local = normalizePreferences(localPreferences);
  const pending = options.pending ?? null;
  const adoptable = options.adoptable !== false;

  if (pending) {
    // Read first so the server-only kill switch can stop every Firestore write.
    // When enabled, the pending local write still wins over the returned remote
    // value because it represents a previously failed optimistic change.
    const remote = await transport.read(options.signal);
    if (!remote.syncEnabled) {
      return {
        status: "local-only",
        preferences: normalizePreferences(pending.preferences),
        syncEnabled: false,
        remoteResolved: false,
        adopted: false,
        unsupportedSchema: false,
      };
    }
    if (remote.unsupportedSchema) {
      // A newer server record must not be overwritten by this v1 build. Keep the
      // pending local value usable but suspend the write-back.
      return {
        status: "unsupported-remote",
        preferences: normalizePreferences(pending.preferences),
        syncEnabled: true,
        remoteResolved: true,
        adopted: false,
        unsupportedSchema: true,
        remoteSchemaVersion: remote.remoteSchemaVersion,
      };
    }
    const retried = await transport.write(pending.preferences, {
      adoption: pending.adoption,
      signal: options.signal,
    });
    return {
      status: "ready",
      preferences: normalizePreferences(retried.preferences),
      syncEnabled: true,
      remoteResolved: true,
      adopted: retried.adopted,
      unsupportedSchema: false,
    };
  }

  const remote = await transport.read(options.signal);
  if (!remote.syncEnabled) {
    return {
      status: "local-only",
      preferences: local,
      syncEnabled: false,
      remoteResolved: false,
      adopted: false,
      unsupportedSchema: false,
    };
  }

  if (remote.unsupportedSchema) {
    // Keep the app usable on safe local settings; never downgrade or overwrite
    // the newer remote record.
    return {
      status: "unsupported-remote",
      preferences: local,
      syncEnabled: true,
      remoteResolved: true,
      adopted: false,
      unsupportedSchema: true,
      remoteSchemaVersion: remote.remoteSchemaVersion,
    };
  }

  if (remote.preferences) {
    return {
      status: "ready",
      preferences: normalizePreferences(remote.preferences),
      syncEnabled: true,
      remoteResolved: true,
      adopted: false,
      unsupportedSchema: false,
    };
  }

  // No remote document: seed it once. A foreign local cache is never adopted;
  // the new user's document is seeded from defaults instead.
  const seed = adoptable
    ? local
    : normalizePreferences(options.adoptionPreferences ?? applicationSettingsDefaults());
  const adoption = await transport.write(seed, {
    adoption: true,
    signal: options.signal,
  });
  return {
    status: "ready",
    preferences: normalizePreferences(adoption.preferences),
    syncEnabled: true,
    remoteResolved: true,
    adopted: adoption.adopted,
    unsupportedSchema: false,
  };
}
