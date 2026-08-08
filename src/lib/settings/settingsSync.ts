import {
  normalizePreferences,
  type PersistedPreferences,
} from "@/lib/settings/preferencesSchema";

export const SETTINGS_PENDING_WRITE_KEY = "bk:settings:pending:v1";

export type SettingsReadResult = {
  syncEnabled: boolean;
  preferences: PersistedPreferences | null;
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
  status: "ready" | "local-only";
  preferences: PersistedPreferences;
  syncEnabled: boolean;
  remoteResolved: boolean;
  adopted: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

export async function resolveInitialSettings(
  localPreferences: PersistedPreferences,
  transport: SettingsTransport,
  options: {
    pending?: PendingSettingsWrite | null;
    signal?: AbortSignal;
  } = {},
): Promise<InitialSettingsResolution> {
  const local = normalizePreferences(localPreferences);
  const pending = options.pending ?? null;

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
    };
  }

  if (remote.preferences) {
    return {
      status: "ready",
      preferences: normalizePreferences(remote.preferences),
      syncEnabled: true,
      remoteResolved: true,
      adopted: false,
    };
  }

  const adoption = await transport.write(local, {
    adoption: true,
    signal: options.signal,
  });
  return {
    status: "ready",
    preferences: normalizePreferences(adoption.preferences),
    syncEnabled: true,
    remoteResolved: true,
    adopted: adoption.adopted,
  };
}
