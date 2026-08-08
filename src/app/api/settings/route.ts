import { NextRequest, NextResponse } from "next/server";
import type { Firestore } from "firebase-admin/firestore";

import {
  getCurrentAppUsername,
  usernameLowerOf,
} from "@/lib/appSession";
import { getAdminDb, serverTs } from "@/lib/firebaseAdmin";
import {
  normalizePreferences,
  type PersistedPreferences,
} from "@/lib/settings/preferencesSchema";
import { isSettingsServerSyncEnabled } from "@/lib/settings/serverSyncFlag";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "default-no-store";

const COLLECTION = "user_settings_v1";

type RouteDependencies = {
  resolveUsername: (request: NextRequest) => Promise<string | null>;
  getDb: () => Firestore;
  timestamp: () => unknown;
  syncEnabled: () => boolean;
};

type SettingsWriteBody = {
  preferences?: unknown;
  adoption?: unknown;
};

const DEFAULT_DEPENDENCIES: RouteDependencies = {
  resolveUsername: getCurrentAppUsername,
  getDb: getAdminDb,
  timestamp: serverTs,
  syncEnabled: isSettingsServerSyncEnabled,
};

function response(
  body: unknown,
  status = 200,
) {
  return NextResponse.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

function errorResponse(code: string, message: string, status: number) {
  return response({ ok: false, error: { code, message } }, status);
}

function documentData(
  preferences: PersistedPreferences,
  usernameLower: string,
  timestamp: unknown,
  adoption: boolean,
) {
  return {
    ...preferences,
    usernameLower,
    updatedAt: timestamp,
    ...(adoption ? { adoptedFromLocalAt: timestamp } : {}),
  };
}

export function createSettingsRouteHandlers(
  dependencies: RouteDependencies = DEFAULT_DEPENDENCIES,
) {
  async function GET(request: NextRequest) {
    if (!dependencies.syncEnabled()) {
      return response({ ok: true, syncEnabled: false, preferences: null });
    }

    const username = await dependencies.resolveUsername(request);
    const usernameLower = usernameLowerOf(username);
    if (!usernameLower) {
      return response({ ok: true, syncEnabled: true, preferences: null });
    }

    try {
      const snapshot = await dependencies.getDb()
        .collection(COLLECTION)
        .doc(usernameLower)
        .get();
      return response({
        ok: true,
        syncEnabled: true,
        preferences: snapshot.exists
          ? normalizePreferences(snapshot.data())
          : null,
      });
    } catch (error) {
      console.error("[/api/settings] read failed", {
        name: (error as Error)?.name,
        message: (error as Error)?.message,
      });
      return errorResponse(
        "settings_read_failed",
        "Settings are temporarily unavailable.",
        503,
      );
    }
  }

  async function PUT(request: NextRequest) {
    if (!dependencies.syncEnabled()) {
      return errorResponse(
        "settings_sync_disabled",
        "Server settings sync is disabled.",
        503,
      );
    }

    const username = await dependencies.resolveUsername(request);
    const usernameLower = usernameLowerOf(username);
    if (!usernameLower) {
      return errorResponse("unauthorized", "Authentication is required.", 401);
    }

    let body: SettingsWriteBody;
    try {
      body = await request.json() as SettingsWriteBody;
    } catch {
      return errorResponse("invalid_json", "A JSON request body is required.", 400);
    }

    if (
      typeof body !== "object" ||
      body === null ||
      typeof body.preferences !== "object" ||
      body.preferences === null ||
      Array.isArray(body.preferences) ||
      (body.adoption !== undefined && typeof body.adoption !== "boolean")
    ) {
      return errorResponse(
        "invalid_preferences",
        "preferences must be an object and adoption must be a boolean.",
        400,
      );
    }

    const preferences = normalizePreferences(body.preferences);
    const adoption = body.adoption === true;
    const db = dependencies.getDb();
    const reference = db.collection(COLLECTION).doc(usernameLower);

    try {
      if (adoption) {
        const result = await db.runTransaction(async (transaction) => {
          const existing = await transaction.get(reference);
          if (existing.exists) {
            return {
              preferences: normalizePreferences(existing.data()),
              adopted: false,
            };
          }

          const timestamp = dependencies.timestamp();
          transaction.set(
            reference,
            documentData(preferences, usernameLower, timestamp, true),
            { merge: false },
          );
          return { preferences, adopted: true };
        });
        return response({
          ok: true,
          syncEnabled: true,
          preferences: result.preferences,
          adopted: result.adopted,
        });
      }

      await reference.set(
        documentData(
          preferences,
          usernameLower,
          dependencies.timestamp(),
          false,
        ),
        { merge: true },
      );
      return response({
        ok: true,
        syncEnabled: true,
        preferences,
        adopted: false,
      });
    } catch (error) {
      console.error("[/api/settings] write failed", {
        name: (error as Error)?.name,
        message: (error as Error)?.message,
      });
      return errorResponse(
        "settings_write_failed",
        "Settings could not be synchronized.",
        503,
      );
    }
  }

  return { GET, PUT };
}

const handlers = createSettingsRouteHandlers();
export const GET = handlers.GET;
export const PUT = handlers.PUT;
