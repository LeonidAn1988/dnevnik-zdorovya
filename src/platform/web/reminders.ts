/**
 * Напоминаний в браузере нет — и притворяться нечем.
 *
 * Web Notifications показывают уведомление только пока страница открыта, а
 * Notification Triggers, единственный API с расписанием, из Chrome убрали и не
 * вернули. Всё, что можно честно сделать в вебе, приложение уже делает:
 * отдаёт расписание в календарь телефона.
 *
 * Порт возвращает `isSupported() === false`, и интерфейс на этом основании
 * показывает выгрузку в календарь вместо настройки напоминаний. Молча
 * принимать вызовы и ничего не делать нельзя: человек решит, что напоминания
 * поставлены, и пропустит приём.
 */

import type { RemindersPort } from '../ports'

const НЕТ = 'В браузере напоминания по расписанию невозможны — расписание выгружается в календарь телефона'

export const webReminders: RemindersPort = {
  isSupported: () => false,
  permission: async () => 'denied',
  requestPermission: async () => 'denied',
  sounds: () => [],
  preview: async () => false,
  schedule: async () => {
    throw new Error(НЕТ)
  },
  cancelAll: async () => undefined,
  health: async () => ({ scheduled: 0, until: null, channelOff: false }),
  // Подписываться не на что: уведомлений нет, значит и нажимать нечего.
  onAction: () => () => undefined,
  exactTiming: async () => null,
  requestExactTiming: async () => null,
  isQuietModeOn: async () => null,
  canBypassQuietMode: async () => null,
  requestQuietModeBypass: async () => false,
  isBatteryRestricted: async () => null,
  openSoundSettings: async () => 'none' as const,
  // В браузере уведомлений нет вовсе, значит и звонить нечем: остановка —
  // пустышка, чтобы вызывающему не приходилось проверять на `null`.
  previewLoop: async () => async () => undefined,
  openBatterySettings: async () => false,
}
