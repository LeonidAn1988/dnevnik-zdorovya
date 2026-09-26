/**
 * Сборка платформы Android.
 *
 * Единственное место, где ядро связывается с нативной средой. Ядро и интерфейс
 * при этом те же самые, что в вебе, — различаются только реализации портов.
 */

import { installPlatform, type Platform, type StoragePort } from '../ports'
import { webStorage } from '../web/storage'
import { capacitorCamera } from './camera'
import { capacitorUpdate } from './update'
import { capacitorBluetooth } from './bluetooth'
import { capacitorFiles } from './files'
import { capacitorBackup } from './backup'
import { capacitorReminders } from './reminders'
import { capacitorNav, installBackButton } from './nav'
import { capacitorCloud } from './cloud'

/**
 * Хранилище берём браузерное: IndexedDB внутри WebView работает, и переписывать
 * рабочий, покрытый тестами код на SQLite ради одинакового результата незачем.
 *
 * Отличается один ответ. В браузере приложение просило не вытеснять свои данные,
 * потому что браузер вправе очистить хранилище сайта при нехватке места, а
 * Safari стирает его после недели без заходов. У приложения такого не бывает:
 * данные лежат в его приватном каталоге и живут, пока живёт само приложение.
 *
 * Это не значит «данные в безопасности». Они исчезают при «Очистить данные» в
 * настройках Android и при удалении приложения. Просто вопрос «не вытеснит ли
 * их система сама» здесь снят, и честный ответ на него — да, защищены.
 */
const capacitorStorage: StoragePort = {
  ...webStorage,
  async requestDurability() {
    return true
  },
}

export const capacitorPlatform: Platform = {
  kind: 'native',
  cloud: capacitorCloud,
  camera: capacitorCamera,
  update: capacitorUpdate,
  bluetooth: capacitorBluetooth,
  storage: capacitorStorage,
  files: capacitorFiles,
  backup: capacitorBackup,
  reminders: capacitorReminders,
  nav: capacitorNav,
}

export function installCapacitorPlatform() {
  installPlatform(capacitorPlatform)
  installBackButton()
}
