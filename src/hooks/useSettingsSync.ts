"use client";

import { useEffect } from "react";
import { create } from "zustand";

import { useAuthStore } from "@/store/auth";
import { useSettingsStore } from "@/store/settings";
import {
  normalizePreferences,
  serializePreferences,
  toPreferences,
  type PersistedPreferences,
} from "@/lib/settings/preferencesSchema";
import {
  clearPendingSettingsWrite,
  readPendingSettingsWrite,
  resolveInitialSettings,
  storePendingSettingsWrite,
  type SettingsReadResult,
  type SettingsTransport,
  type SettingsWriteResult,
} from "@/lib/settings/settingsSync";

export type SettingsSyncStatus =
  | "awaiting-auth"
  | "waiting-local"
  | "loading-remote"
  | "ready"
  | "local-only"
  | "syncing"
  | "unsynced";

type SettingsSyncState = {
  status: SettingsSyncStatus;
  usernameLower: string | null;
  error: string | null;
  lastSyncedAt: number | null;
};

export const useSettingsSyncStore = create<SettingsSyncState>(() => ({
  status: "awaiting-auth",
  usernameLower: null,
  error: null,
  lastSyncedAt: null,
}));

export function isSettingsHydrationSettled(status: SettingsSyncStatus): boolean {
  return status === "ready" || status === "local-only" || status === "unsynced";
}

const REQUEST_TIMEOUT_MS = 3500;
const WRITE_DEBOUNCE_MS = 650;

function setSyncState(patch: Partial<SettingsSyncState>) {
  useSettingsSyncStore.setState(patch);
}

async function responseJson(response: Response): Promise<Record<string, unknown>> {
  let body: Record<string, unknown> = {};
  try {
    body = await response.json() as Record<string, unknown>;
  } catch {
    // The status below remains the useful failure signal.
  }
  if (!response.ok) {
    const error = body.error as { code?: unknown; message?: unknown } | undefined;
    throw new Error(
      typeof error?.code === "string"
        ? error.code
        : `settings_http_${response.status}`,
    );
  }
  return body;
}

function createTransport(): SettingsTransport {
  return {
    read: async (signal): Promise<SettingsReadResult> => {
      const response = await fetch("/api/settings", {
        method: "GET",
        credentials: "include",
        cache: "no-store",
        signal,
      });
      const body = await responseJson(response);
      return {
        syncEnabled: body.syncEnabled !== false,
        preferences: body.preferences == null
          ? null
          : normalizePreferences(body.preferences),
      };
    },
    write: async (preferences, options): Promise<SettingsWriteResult> => {
      const response = await fetch("/api/settings", {
        method: "PUT",
        credentials: "include",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          preferences: normalizePreferences(preferences),
          adoption: options.adoption,
        }),
        signal: options.signal,
      });
      const body = await responseJson(response);
      return {
        preferences: normalizePreferences(body.preferences),
        adopted: body.adopted === true,
      };
    },
  };
}

function waitForLocalHydration(): Promise<void> {
  const persistence = useSettingsStore.persist;
  if (persistence.hasHydrated()) return Promise.resolve();
  return new Promise((resolve) => {
    const unsubscribe = persistence.onFinishHydration(() => {
      unsubscribe();
      resolve();
    });
  });
}

function dispatchSyncFailure(error: unknown) {
  try {
    window.dispatchEvent(new CustomEvent("bk:settings-sync-error", {
      detail: { message: error instanceof Error ? error.message : String(error) },
    }));
  } catch {
    // The observable Zustand state remains available when events are unavailable.
  }
}

export function useSettingsSync() {
  const authReady = useAuthStore((state) => state.ready);
  const username = useAuthStore((state) => state.user?.username ?? null);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let requestController: AbortController | null = null;
    let requestTimer: ReturnType<typeof setTimeout> | null = null;
    let applyingRemote = false;
    let requestInFlight = false;
    let remoteResolved = false;
    let serverSyncEnabled = true;
    let adoptionPending = false;
    let revision = 0;
    let baseline = "";
    let retryAfterFlight = false;
    const usernameLower = username?.trim().toLowerCase() || null;
    const transport = createTransport();

    const stopRequestTimer = () => {
      if (requestTimer) clearTimeout(requestTimer);
      requestTimer = null;
    };

    const beginRequest = () => {
      requestController?.abort();
      requestController = new AbortController();
      requestTimer = setTimeout(
        () => requestController?.abort(),
        REQUEST_TIMEOUT_MS,
      );
      return requestController.signal;
    };

    const applyServerPreferences = (preferences: PersistedPreferences) => {
      const normalized = normalizePreferences(preferences);
      baseline = serializePreferences(normalized);
      applyingRemote = true;
      useSettingsStore.getState().applyPreferences(normalized);
      applyingRemote = false;
    };

    const markUnsynced = (error: unknown) => {
      setSyncState({
        status: "unsynced",
        usernameLower,
        error: error instanceof Error ? error.message : String(error),
      });
      dispatchSyncFailure(error);
    };

    const persistPending = (
      preferences: PersistedPreferences,
      adoption: boolean,
    ) => {
      if (!usernameLower) return;
      try {
        storePendingSettingsWrite(localStorage, {
          usernameLower,
          preferences,
          adoption,
          queuedAt: Date.now(),
        });
      } catch {
        // Zustand's own local cache still preserves the value.
      }
    };

    const flush = async () => {
      if (cancelled || !usernameLower) return;
      if (requestInFlight) {
        retryAfterFlight = true;
        return;
      }

      if (!remoteResolved) {
        await initializeRemote();
        return;
      }

      const preferences = toPreferences(useSettingsStore.getState());
      const serialized = serializePreferences(preferences);
      if (serialized === baseline) return;
      const sentRevision = revision;
      requestInFlight = true;
      setSyncState({ status: "syncing", usernameLower, error: null });
      persistPending(preferences, adoptionPending);
      try {
        const result = await transport.write(preferences, {
          adoption: adoptionPending,
          signal: beginRequest(),
        });
        stopRequestTimer();
        if (cancelled) return;
        adoptionPending = false;
        remoteResolved = true;
        const current = toPreferences(useSettingsStore.getState());
        const currentSerialized = serializePreferences(current);
        if (revision === sentRevision && currentSerialized === serialized) {
          applyServerPreferences(result.preferences);
          try { clearPendingSettingsWrite(localStorage, usernameLower); } catch {}
          setSyncState({
            status: "ready",
            usernameLower,
            error: null,
            lastSyncedAt: Date.now(),
          });
        } else {
          baseline = serializePreferences(result.preferences);
          persistPending(current, false);
          retryAfterFlight = true;
        }
      } catch (error) {
        stopRequestTimer();
        markUnsynced(error);
      } finally {
        requestInFlight = false;
      }

      if (retryAfterFlight && !cancelled) {
        retryAfterFlight = false;
        void flush();
      }
    };

    const scheduleFlush = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => void flush(), WRITE_DEBOUNCE_MS);
    };

    const initializeRemote = async () => {
      if (cancelled || !usernameLower || requestInFlight) return;
      requestInFlight = true;
      const startRevision = revision;
      const local = toPreferences(useSettingsStore.getState());
      const pending = (() => {
        try { return readPendingSettingsWrite(localStorage, usernameLower); }
        catch { return null; }
      })();
      if (pending) {
        applyingRemote = true;
        useSettingsStore.getState().applyPreferences(pending.preferences);
        applyingRemote = false;
        adoptionPending = pending.adoption;
      }
      setSyncState({ status: "loading-remote", usernameLower, error: null });
      try {
        const resolution = await resolveInitialSettings(
          pending?.preferences ?? local,
          transport,
          { pending, signal: beginRequest() },
        );
        stopRequestTimer();
        if (cancelled) return;
        if (!resolution.syncEnabled) {
          serverSyncEnabled = false;
          baseline = serializePreferences(toPreferences(useSettingsStore.getState()));
          setSyncState({
            status: "local-only",
            usernameLower,
            error: null,
          });
          return;
        }

        remoteResolved = resolution.remoteResolved;
        adoptionPending = false;
        if (revision === startRevision) {
          applyServerPreferences(resolution.preferences);
          try { clearPendingSettingsWrite(localStorage, usernameLower); } catch {}
        } else {
          baseline = serializePreferences(resolution.preferences);
          persistPending(toPreferences(useSettingsStore.getState()), false);
          retryAfterFlight = true;
        }
        setSyncState({
          status: "ready",
          usernameLower,
          error: null,
          lastSyncedAt: Date.now(),
        });
      } catch (error) {
        stopRequestTimer();
        adoptionPending = pending?.adoption ?? false;
        remoteResolved = Boolean(pending);
        markUnsynced(error);
      } finally {
        requestInFlight = false;
      }

      if (retryAfterFlight && !cancelled) {
        retryAfterFlight = false;
        void flush();
      }
    };

    if (!authReady) {
      setSyncState({
        status: "awaiting-auth",
        usernameLower: null,
        error: null,
      });
      return;
    }

    setSyncState({
      status: "waiting-local",
      usernameLower,
      error: null,
    });

    void waitForLocalHydration().then(() => {
      if (cancelled) return;
      baseline = serializePreferences(toPreferences(useSettingsStore.getState()));
      if (!usernameLower) {
        setSyncState({
          status: "local-only",
          usernameLower: null,
          error: null,
        });
        return;
      }

      unsubscribe = useSettingsStore.subscribe((state) => {
        if (applyingRemote) return;
        const serialized = serializePreferences(toPreferences(state));
        if (serialized === baseline) return;
        if (!serverSyncEnabled) {
          baseline = serialized;
          return;
        }
        revision += 1;
        if (remoteResolved) {
          persistPending(toPreferences(state), adoptionPending);
        }
        scheduleFlush();
      });
      void initializeRemote();
    });

    return () => {
      cancelled = true;
      unsubscribe?.();
      if (debounceTimer) clearTimeout(debounceTimer);
      stopRequestTimer();
      requestController?.abort();
    };
  }, [authReady, username]);
}
