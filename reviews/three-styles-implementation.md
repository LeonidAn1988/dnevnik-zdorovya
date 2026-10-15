# Реализация трёх оформлений

Начало: 16 октября 2026, ветка codex/three-interface-styles.
Исходный коммит: 9a944b2; версия приложения 0.53.10, Android versionCode 95.

## P0 — исходная точка

- typecheck и npm test: пройдены.
- npm run screens: 35/35 экранов, 0 переполнений, 0 недоступных экранов, 0 ошибок. Chromium требует запуска вне файловой песочницы.
- Исходный production JS: основной chunk 846.80 kB / gzip 250.93 kB; остальные chunks и CSS — в /private/tmp/omron-baseline-build.log.
- Сервер 5199 уже запущен из этого checkout; конкурирующий сервер не создавался.
- Подключён MNA-LX9, установлен дневник 0.53.10 (95). Проект «Семейный менеджер паролей» не активен. Настоящий дневник не используется для посева тестов.
- Уже существовавшие untracked .impeccable/, AGENTS.md, design-exploration/, reviews/, tools/build_review.py сохранены.

| Возможность | Экран/обработчики | Новая группа | Регрессии |
|---|---|---|---|
| Давление, история, BLE | Entry, Readings, Sync; handleImport | Дневник / Ещё | flow, numbers, review-native, update |
| Сахар и таймер 2 часа | Glucose, GlucoseTimer; glucoseTimers | Дневник / Сегодня | glucose, numeric |
| Приёмы, отмена и еда | Intake; handleMarkTaken, handleManualMealTimer | Сегодня | meals, daily-priorities, numeric |
| Запасы, курсы, покупка | Cabinet, MedicineCard/Form, RegimenForm, CourseMedicineDialog | Аптечка | cabinet, course-repeat, course-medicine |
| Анализы, результат, фото | Labs, ResultForm, onAddPhoto | Дневник | photos, review-photo-back, drafts |
| Отчёты и памятка | Report, Charts, Compare, Memo | Отчёты | charts, glucose-memo, numeric-report |
| Люди, обмен, копии | Settings, Family, People, useFamilySync/useBackup | Ещё | cloud, cloud-web, cjm-forms |
| Уведомления и обновление | NotificationCenter, useReminders/useUpdate | Ещё / общий баннер | reminders, update, tour |

Расчёты и единицы защищены существующими независимыми numeric-audit/evolution/DST наборами. Новые оформления не получают собственного расчётного ядра. Проверки R01–R21 — по плану v2; окончательные результаты записываются после реализации.

## Пакеты

| Пакет | Статус | Доказательство |
|---|---|---|
| P0 | Выполняется | Исходные проверки выше; профиль скорости снимается до включения новых стилей |
| P1 | Выполняется | Реестр стилей, нормализация и первый кадр |
| P2–P6 | Ожидают | — |
| P7 | Ожидает | — |
| P8 | Ожидает | — |
