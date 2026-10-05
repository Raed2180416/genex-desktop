type ChromiumSwitch = readonly [name: string, value: string];

const PASSWORD_STORE_SWITCH = "--password-store";
const KWALLET_DESKTOPS = new Set(["kde", "kde4", "kde5", "kde6", "plasma"]);

function usesKWallet(desktop: string | undefined): boolean {
  return desktop?.split(":").some((name) => KWALLET_DESKTOPS.has(name.trim().toLowerCase())) ?? false;
}

function hasPasswordStoreOverride(argv: readonly string[]): boolean {
  return argv.some((arg) => arg === PASSWORD_STORE_SWITCH || arg.startsWith(`${PASSWORD_STORE_SWITCH}=`));
}

/** Selects Secret Service on Linux unless KDE or an explicit password-store choice applies. */
export function linuxSecretStorageSwitches(launch: {
  platform: NodeJS.Platform;
  desktop?: string;
  argv: readonly string[];
}): readonly ChromiumSwitch[] {
  if (launch.platform !== "linux" || hasPasswordStoreOverride(launch.argv) || usesKWallet(launch.desktop)) return [];
  return [["password-store", "gnome-libsecret"]];
}
