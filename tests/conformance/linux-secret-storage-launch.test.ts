import assert from "node:assert/strict";
import { test } from "node:test";
import { linuxSecretStorageSwitches } from "../../src/main/linux-secret-storage-launch.ts";

test("Linux sessions outside KDE select the Secret Service backend", () => {
  assert.deepEqual(linuxSecretStorageSwitches({ platform: "linux", desktop: "Hyprland", argv: [] }), [
    ["password-store", "gnome-libsecret"],
  ]);
  assert.deepEqual(linuxSecretStorageSwitches({ platform: "linux", argv: [] }), [
    ["password-store", "gnome-libsecret"],
  ]);
});

test("KDE sessions keep Electron's KWallet selection", () => {
  assert.deepEqual(linuxSecretStorageSwitches({ platform: "linux", desktop: "KDE:Plasma", argv: [] }), []);
  assert.deepEqual(linuxSecretStorageSwitches({ platform: "linux", desktop: "kde6", argv: [] }), []);
});

test("an explicit password-store switch and non-Linux platforms are preserved", () => {
  assert.deepEqual(
    linuxSecretStorageSwitches({
      platform: "linux",
      desktop: "Hyprland",
      argv: ["genex", "--password-store", "kwallet5"],
    }),
    [],
  );
  assert.deepEqual(linuxSecretStorageSwitches({ platform: "darwin", desktop: "Hyprland", argv: [] }), []);
});
