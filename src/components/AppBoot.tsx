"use client";
import { useEffect, useRef } from "react";
import { useAuthStore } from "@/store/auth";
import { useAppearance } from "@/hooks/useAppearance";
import { useStatsStore } from "@/stores/useStatsStore";
import { bootSync } from "@/lib/sync";
import { useSettingsSync } from "@/hooks/useSettingsSync";

export default function AppBoot() {
  const ran = useRef(false);
  useAppearance();
  useSettingsSync();
  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    try {
      const { ready, hydrateFromMe } = useAuthStore.getState();
      if (!ready) hydrateFromMe().catch(() => {});
    } catch {}
    try { bootSync(); } catch {}
  }, []);

  // Hydrate stats store when user identity changes (guest vs authed).
  // Keyed by username (not the numeric DB id) since that id is only unique
  // within one database instance/environment and gets reused (1, 2, 3...)
  // across fresh local DBs — keying local history by it risks one account's
  // cached runs bleeding into an unrelated account that happens to land on
  // the same id.
  const username = useAuthStore(s => s.user?.username);
  useEffect(() => {
    const id = username ? username.trim().toLowerCase() : "guest";
    try { useStatsStore.getState().hydrate(id); } catch {}
  }, [username]);
  return null;
}


