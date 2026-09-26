/**
 * Обновление в браузере: обновляться нечему.
 *
 * Страница и так всегда свежая — её отдаёт сервер, а служебный работник
 * обновляет кэш в фоне. Скачивать APK в браузере бессмысленно: поставить его
 * оттуда всё равно некуда.
 */

import type { UpdatePort } from '../ports'

export const webUpdate: UpdatePort = {
  canSelfUpdate: () => false,
  canInstall: async () => false,
  requestInstall: async () => false,
  async download() {
    throw new Error('в браузере обновление не скачивается')
  },
  async install() {
    throw new Error('в браузере обновление не ставится')
  },
}
