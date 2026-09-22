/**
 * Сборка браузерной платформы.
 *
 * Единственное место, где ядро связывается с конкретной средой выполнения.
 * Для Android и iOS появится `platform/capacitor/`, для macOS и Windows —
 * `platform/tauri/`; ядро и интерфейс останутся прежними.
 */

import { installPlatform, type Platform } from '../ports'
import { webBluetooth } from './bluetooth'
import { webCamera } from './camera'
import { webStorage } from './storage'
import { webFiles } from './files'
import { webBackup } from './backup'
import { webReminders } from './reminders'
import { webNav, installWebBack } from './nav'
import { webCloud } from './cloud'

export const webPlatform: Platform = {
  kind: 'web',
  cloud: webCloud,
  camera: webCamera,
  bluetooth: webBluetooth,
  storage: webStorage,
  files: webFiles,
  backup: webBackup,
  reminders: webReminders,
  nav: webNav,
}

export function installWebPlatform() {
  installPlatform(webPlatform)
  installWebBack()
}

export { useIndexedDbFactory } from './storage'
