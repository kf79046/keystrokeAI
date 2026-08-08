const DISABLED_VALUES = new Set(["0", "false", "off", "disabled", "no"]);

/** Server-only kill switch. It defaults on and never needs to enter the client bundle. */
export function isSettingsServerSyncEnabled(
  value = process.env.SETTINGS_SERVER_SYNC,
): boolean {
  if (value == null || value.trim() === "") return true;
  return !DISABLED_VALUES.has(value.trim().toLowerCase());
}
