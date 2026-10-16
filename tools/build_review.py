#!/usr/bin/env python3
"""Build review and remediation deliveries from their sources into the results hub."""

import argparse
import hashlib
import json
import re
import shutil
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
HUB = Path.home() / "Claude_Projects" / "Результаты"


def version_key(value: str) -> tuple[int, ...]:
    parts = [int(part) for part in value.split(".")]
    while len(parts) > 1 and parts[-1] == 0:
        parts.pop()
    return tuple(parts)


def contrast_ratio(foreground: str, background: str) -> float:
    def luminance(value: str) -> float:
        if not re.fullmatch(r"#[0-9A-Fa-f]{6}", value):
            raise ValueError(f"Expected opaque sRGB hex: {value}")
        channels = [int(value[i:i + 2], 16) / 255 for i in (1, 3, 5)]
        linear = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in channels]
        return sum(c * weight for c, weight in zip(linear, (0.2126, 0.7152, 0.0722)))
    low, high = sorted((luminance(foreground), luminance(background)))
    return (high + 0.05) / (low + 0.05)


def build_dark_bundle(content: str, folder: Path, version: str, date: str) -> tuple[str, list[str]]:
    config = json.loads((ROOT / "design-exploration/dark-themes.json").read_text())
    themes = config["themes"]
    checks = []
    for theme in themes:
        tokens = theme["tokens"]
        common = config["common"]
        def check(role: str, fg: str, bg: str, minimum: float) -> None:
            ratio = contrast_ratio(fg, bg)
            checks.append(dict(theme=theme["id"], role=role, foreground=fg, background=bg,
                               ratio=ratio, minimum=minimum, passed=ratio >= minimum))
        for surface in ("canvas", "surface", "raised", "selected", "highlight"):
            for role in ("text", "secondary", "accent"):
                check(f"{role}/{surface}", tokens[role], tokens[surface], 4.5)
            for role in ("focus", "controlBorder"):
                check(f"{role}/{surface}", tokens[role], tokens[surface], 3)
        for state in ("primary", "primaryHover", "primaryPressed"):
            check(f"onPrimary/{state}", tokens["onPrimary"], tokens[state], 4.5)
        check("disabledText/disabledSurface", tokens["disabledText"], tokens["disabledSurface"], 4.5)
        for status in ("success", "warning", "error", "info"):
            for background in (common[f"{status}Surface"], tokens["canvas"], tokens["surface"]):
                check(f"{status}Text/status-or-base", common[f"{status}Text"], background, 4.5)
        for series in ("chart1", "chart2", "chart3"):
            for surface in ("canvas", "surface", "raised"):
                check(f"{series}/{surface}", common[series], tokens[surface], 3)
    failures = [check for check in checks if not check["passed"]]
    if failures:
        raise ValueError(f"Dark token contrast failed: {json.dumps(failures, ensure_ascii=False)}")
    bundle_name = f"тёмные-концепции_v{version}_{date}"
    archived = []
    for previous in folder.glob("тёмные-концепции_v*"):
        if not previous.is_dir() or previous.name == bundle_name:
            continue
        match = re.fullmatch(r"тёмные-концепции_v([0-9.]+)_([0-9-]+)", previous.name)
        if not match or (version_key(match[1]), match[2]) >= (version_key(version), date):
            continue
        archive = folder / "_архив" / previous.name
        archive.parent.mkdir(parents=True, exist_ok=True)
        if archive.exists():
            raise FileExistsError(f"Archive already exists: {archive}")
        previous.rename(archive)
        archived.append(previous.name)
    bundle = folder / bundle_name
    bundle.mkdir(parents=True, exist_ok=True)
    for theme in themes:
        source = ROOT / theme["asset"]
        asset = bundle / source.name
        shutil.copyfile(source, asset)
        content = content.replace("{{DARK_" + theme["key"] + "}}", str(asset))
    for name in ("dark-themes.json", "dark-prompts.json", "dark-refinement-prompts.json"):
        shutil.copyfile(ROOT / "design-exploration" / name, bundle / name)
    audit = bundle / "contrast.json"
    audit.write_text(json.dumps(dict(scope="opaque token pairs only; not runtime or raster compliance",
                                    count=len(checks), checks=checks), ensure_ascii=False, indent=2) + "\n")
    token_rows = ["| Токен | A — дневник | B — ритм | C — ясно |", "|---|---|---|---|"]
    for role in themes[0]["tokens"]:
        token_rows.append("| " + role + " | " + " | ".join(theme["tokens"][role] for theme in themes) + " |")
    contrast_rows = ["| Концепт | Основной текст, минимум | Вторичный текст, минимум | Текст кнопки, минимум | Границы, минимум |",
                     "|---|---:|---:|---:|---:|"]
    for theme in themes:
        rows = [row for row in checks if row["theme"] == theme["id"]]
        minima = [min(row["ratio"] for row in rows if row["role"].startswith(prefix))
                  for prefix in ("text/", "secondary/", "onPrimary/", "controlBorder/")]
        contrast_rows.append("| " + theme["name"] + " | " + " | ".join(f"{value:.2f}:1" for value in minima) + " |")
    content = content.replace("{{TOKEN_TABLE}}", "\n".join(token_rows))
    content = content.replace("{{CONTRAST_TABLE}}", "\n".join(contrast_rows))
    content = content.replace("{{CONTRAST_COUNT}}", str(len(checks)))
    content = content.replace("{{TOKENS_PATH}}", str(bundle / "dark-themes.json"))
    content = content.replace("{{CONTRAST_PATH}}", str(audit))
    return content, archived


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--version", default="1")
    parser.add_argument("--date", default=datetime.now(ZoneInfo("Europe/Moscow")).date().isoformat())
    parser.add_argument("--output-root", type=Path, default=HUB)
    parser.add_argument("--no-index", action="store_true")
    parser.add_argument("--kind", choices=["review", "remediation", "settings", "ux", "evolution", "followup", "audience", "charts", "meals", "glucose", "numeric", "ux-pwa", "modern", "cloud-web", "course-repeat", "add-button", "course-medicine", "modern-controls", "critique", "ux-fix-plan", "three-designs-plan", "dark-design", "three-styles-implementation", "family-sync-session"], default="review")
    parser.add_argument("--apk", type=Path, help="Verified release APK to deliver with the remediation journal")
    parser.add_argument("--apk-metadata", type=Path, default=ROOT / "reviews/evidence/update/apk.json")
    args = parser.parse_args()
    if not re.fullmatch(r"\d+(?:\.\d+)*", args.version):
        parser.error("Version must contain numbers separated by dots")
    datetime.strptime(args.date, "%Y-%m-%d")
    metadata = None
    if args.apk:
        metadata = json.loads(args.apk_metadata.read_text())["current"]
        if hashlib.sha256(args.apk.read_bytes()).hexdigest() != metadata["sha256"]:
            raise ValueError("APK does not match verified release evidence")
        if not re.fullmatch(r"\d+\.\d+\.\d+", metadata["version"]):
            raise ValueError("Invalid APK version")

    if args.kind == "family-sync-session":
        source = ROOT / "reviews" / "family-sync-session.md"
        prefix = "семейный-обмен-подключения"
        title = "Семейный обмен — безопасность смены подключения"
        description = "поздние ответы, очередь записей, журнал обмена и выпуск 0.54.1"
    elif args.kind == "three-styles-implementation":
        source = ROOT / "reviews" / "three-styles-implementation.md"
        prefix = "три-оформления-реализация"
        title = "Три оформления — реализация и проверки"
        description = "Android и веб, сохранность дневника, регрессии, производительность и выпуск"
    elif args.kind == "dark-design":
        source = ROOT / "reviews" / "dark-design.md"
        prefix = "тёмные-концепции"
        title = "Тёмные темы трёх концепций"
        description = "мобильные и настольные рендеры, токены, состояния и расчёт контраста"
    elif args.kind == "three-designs-plan":
        source = ROOT / "reviews" / "three-designs-plan.md"
        prefix = "план-трёх-интерфейсов-sol"
        title = "План трёх интерфейсов для Sol"
        description = "общий CJM, три оформления, миграции, пакеты реализации, приёмка и выпуск"
    elif args.kind == "ux-fix-plan":
        source = ROOT / "reviews" / "ux-fix-plan.md"
        prefix = "план-исправлений-ux-ui"
        title = "План исправлений UX UI"
        description = "три пакета реализации, критерии приёмки и передача GPT-6 Luna с независимым ревью"
    elif args.kind == "critique":
        source = ROOT / "reviews" / "impeccable-critique.md"
        prefix = "критика-современного-интерфейса"
        title = "Критика современного интерфейса"
        description = "независимая оценка дизайна и детектор, приоритеты удобства и визуальной иерархии"
    elif args.kind == "modern-controls":
        source = ROOT / "reviews" / "modern-controls.md"
        prefix = "размеры-элементов-современного-интерфейса"
        title = "Размеры элементов современного интерфейса"
        description = "компактные настольные фильтры и кнопки с сохранением сенсорных областей и крупного текста"
    elif args.kind == "course-medicine":
        source = ROOT / "reviews" / "course-medicine.md"
        prefix = "поиск-и-добавление-препарата-в-курсе"
        title = "Поиск и добавление препарата в курсе"
        description = "поиск по домашней аптечке, добавление на месте и сохранность черновика курса"
    elif args.kind == "add-button":
        source = ROOT / "reviews" / "add-button.md"
        prefix = "кнопка-добавления-аптечки"
        title = "Кнопка добавления в Аптечке"
        description = "круглая форма и проверка сенсорной области нажатия"
    elif args.kind == "course-repeat":
        source = ROOT / "reviews" / "course-repeat.md"
        prefix = "повтор-курса"
        title = "Повтор курса и сохранение истории"
        description = "исправление срока, безопасный повтор и проверки расчётов после перерыва"
    elif args.kind == "cloud-web":
        source = ROOT / "reviews" / "cloud-web.md"
        prefix = "семейный-обмен-в-браузере"
        title = "Семейный обмен в браузере"
        description = "ограничение чтения Яндекс.Диска, защита пустого профиля и проверенный разовый перенос"
    elif args.kind == "modern":
        source = ROOT / "reviews" / "modern-interface.md"
        prefix = "современный-интерфейс"
        title = "Современный интерфейс"
        description = "третий стиль оформления, мобильная и настольная компоновка, проверка сохранности данных"
    elif args.kind == "ux-pwa":
        source = ROOT / "reviews" / "ux-modes-pwa.md"
        prefix = "ревью-интерфейса-и-план-pwa"
        title = "Ревью интерфейса и план PWA"
        description = "режимы оформления, доступность, семейные сценарии и развитие общего приложения для разных платформ"
    elif args.kind == "remediation":
        source = ROOT / "reviews" / "remediation.md"
        prefix = "исправления-полного-ревью"
        title = "Исправления полного ревью"
        description = "статус замечаний, проверки, телефон и оставшиеся ограничения"
    elif args.kind == "settings":
        source = ROOT / "reviews" / "settings-review.md"
        prefix = "ревью-настроек"
        title = "Ревью настроек"
        description = "текстовая нагрузка, понятность разделов, мобильные проверки и план упрощения"
    elif args.kind == "ux":
        source = ROOT / "reviews" / "ux-ui-improvements.md"
        prefix = "улучшения-ux-ui"
        title = "Улучшения UX UI"
        description = "упрощение настроек, критика, изолированные мобильные проверки и готовая сборка"
    elif args.kind == "evolution":
        source = ROOT / "reviews" / "medication-evolution.md"
        prefix = "курсы-таймеры-и-аптечка"
        title = "Курсы таймеры и аптечка"
        description = "этапы курса, тихие уведомления, единицы, общие остатки и проверки UX"
    elif args.kind == "followup":
        source = ROOT / "reviews" / "followup-review.md"
        prefix = "дополнительные-проверки"
        title = "Дополнительные проверки"
        description = "исправления семейного обмена и оставшиеся проверки реального использования"
    elif args.kind == "numeric":
        source = ROOT / "reviews" / "numeric-audit.md"
        prefix = "проверка-расчётов"
        title = "Проверка расчётов"
        description = "независимая сверка доз, общего запаса, статистики, календарных окон и отчётов"
    elif args.kind == "glucose":
        source = ROOT / "reviews" / "glucose-memo.md"
        prefix = "сахар-напоминания-и-памятка"
        title = "Сахар напоминания и памятка"
        description = "средние сахара, двухчасовой таймер, точная печатная и отправляемая памятка"
    elif args.kind == "meals":
        source = ROOT / "reviews" / "intake-meals.md"
        prefix = "приёмы-по-еде-и-таймеры"
        title = "Приёмы по еде и таймеры"
        description = "порядок групп, автоматические таймеры до еды, после еды и атомарная запись приёма"
    elif args.kind == "charts":
        source = ROOT / "reviews" / "charts-review.md"
        prefix = "графики-обзора"
        title = "Графики Обзора"
        description = "исправления шкал, дат, подписей и проверка узких экранов с крупным текстом"
    elif args.kind == "audience":
        source = ROOT / "reviews" / "reminder-audience.md"
        prefix = "выбор-напоминаний-семьи"
        title = "Выбор напоминаний семьи"
        description = "локальный выбор людей, отложенные уведомления, общие запасы и проверки"
    else:
        source = ROOT / "reviews" / "project-review.md"
        prefix = "ревью-cjm-ux-ui-кода"
        title = "Ревью CJM UX UI и кода"
        description = "пользовательские пути, проверенные замечания, телефон, навыки и модели, порядок исправлений"
    content = source.read_text(encoding="utf-8")
    folder = args.output_root / "дневник-здоровья"
    folder.mkdir(parents=True, exist_ok=True)
    archived = []
    if args.kind == "dark-design":
        content, archived = build_dark_bundle(content, folder, args.version, args.date)
    if args.kind in ("ux", "evolution", "ux-pwa", "modern", "cloud-web", "course-medicine", "modern-controls"):
        for token, evidence_path, asset_prefix in [
            ("CONTROLS_BEFORE", "modern-controls/before/1125-small-light-mouse-cabinet-viewport.png", "современные-кнопки-до"),
            ("CONTROLS_AFTER", "modern-controls/after/1125-small-light-mouse-cabinet-viewport.png", "современные-кнопки-после"),
            ("COURSE_SEARCH", "course-medicine/classic-normal-search.png", "поиск-препарата-в-курсе"),
            ("COURSE_DIALOG", "course-medicine/desktop-dialog.png", "новый-препарат-из-курса"),
            ("COURSE_SELECTED", "course-medicine/modern-xlarge-selected.png", "препарат-добавлен-в-курс"),
            ("CLOUD_WEB", "cloud-web/normal-light-family.png", "веб-подключение"),
            ("MODERN_LIGHT", "modern-interface/after/390-normal-light-0-viewport.png", "современный-светлый"),
            ("MODERN_DARK", "modern-interface/after/390-normal-dark-0-viewport.png", "современный-тёмный"),
            ("MODERN_DESKTOP", "modern-interface/after/1280-normal-light-0-viewport.png", "современный-компьютер"),
            ("MODERN_DISPLAY", "modern-interface/after/390-normal-light-6-viewport.png", "выбор-современного-режима"),
            ("MODE_COMFORT", "ux-modes/after/360-large-light-6-viewport.png", "режим-комфортный"),
            ("MODE_COMPACT", "ux-modes/after/360-normal-light-6-viewport.png", "режим-компактный"),
            ("UX_ROOT_LIGHT", "settings-ui/normal-light-root-family.png", "настройки-светлая-тема"),
            ("UX_ROOT_LARGE", "settings-ui/xlarge-dark-root-family.png", "настройки-крупный-текст"),
            ("UX_REMINDERS", "settings-ui/normal-light-reminders-both-on.png", "напоминания"),
            ("PHONE_ROOT_LIGHT", "settings-phone/normal-light-root-device.png", "телефон-настройки-светлая-тема"),
            ("PHONE_ROOT_LARGE", "settings-phone/xlarge-dark-root-device.png", "телефон-настройки-крупный-текст"),
            ("PHONE_REMINDERS", "settings-phone/xlarge-light-volume-controls-device.png", "телефон-напоминания"),
            ("PHONE_QUIET", "settings-phone/xlarge-light-quiet-warning-device.png", "телефон-тихий-режим"),
            ("COURSE_CARD", "evolution-phone/normal-light-card-device.png", "телефон-карточка-препарата"),
            ("TIMER_VIEW", "evolution-phone/normal-light-timers-device.png", "телефон-таймеры-еды"),
        ]:
            if "{{" + token + "}}" not in content:
                continue
            asset_name = f"{asset_prefix}_v{args.version}_{args.date}.png"
            for previous in folder.glob(f"{asset_prefix}_v*.png"):
                match = re.fullmatch(rf"{re.escape(asset_prefix)}_v(\d+(?:\.\d+)*)_(\d{{4}}-\d{{2}}-\d{{2}})\.png", previous.name)
                if not match or (version_key(match[1]), match[2]) >= (version_key(args.version), args.date):
                    continue
                archive = folder / "_архив" / previous.name
                archive.parent.mkdir(parents=True, exist_ok=True)
                if archive.exists():
                    if archive.read_bytes() != previous.read_bytes():
                        raise FileExistsError(f"Different archived image already exists: {archive}")
                    previous.unlink()  # The identical archived copy remains intact.
                else:
                    previous.rename(archive)
                archived.append(previous.name)
            asset = folder / asset_name
            shutil.copyfile(ROOT / "reviews" / "evidence" / evidence_path, asset)
            content = content.replace("{{" + token + "}}", str(asset))
    filename = f"{prefix}_v{args.version}_{args.date}.md"
    target = folder / filename
    pattern = re.compile(rf"{re.escape(prefix)}_v(\d+(?:\.\d+)*)_(\d{{4}}-\d{{2}}-\d{{2}})\.md")
    for previous in folder.glob(f"{prefix}_v*.md"):
        match = pattern.fullmatch(previous.name)
        if not match or previous == target:
            continue
        older = (version_key(match[1]), match[2]) < (version_key(args.version), args.date)
        if not older:
            continue
        archive = folder / "_архив" / previous.name
        archive.parent.mkdir(parents=True, exist_ok=True)
        if archive.exists():
            if archive.read_bytes() != previous.read_bytes():
                raise FileExistsError(f"Different archived delivery already exists: {archive}")
            previous.unlink()  # The identical archived copy remains intact.
        else:
            previous.rename(archive)
        archived.append(previous.name)
    if args.kind == "three-styles-implementation":
        bundle = folder / f"три-оформления_v{args.version}_{args.date}"
        bundle.mkdir(parents=True, exist_ok=True)
        evidence = ROOT / "reviews/evidence/three-styles"
        rows = ["\n## Итоговые экраны на искусственных данных\n", "| Оформление | Телефон: светлая | Телефон: тёмная | Компьютер: светлая | Компьютер: тёмная |", "|---|---|---|---|---|"]
        for style, label in (("journal", "Живой дневник"), ("rhythm", "Ритм"), ("clear", "Ясно")):
            links = []
            for desktop in (False, True):
                for theme in ("light", "dark"):
                    name = f"{style}-{theme}-normal-Сегодня.png"
                    source_image = evidence / ("desktop" if desktop else "") / name
                    target_image = bundle / (("desktop-" if desktop else "phone-") + name)
                    shutil.copyfile(source_image, target_image)
                    links.append(f"[Открыть]({target_image})")
            rows.append("| " + label + " | " + " | ".join(links) + " |")
        for name in ("screens.json", "slices.json", "flows.json", "numbers.json", "accessibility.json", "regressions.json", "performance-baseline.json", "performance-final.json", "apk.json", "phone-back.json", "phone-preferences.json", "published-web.json"):
            shutil.copyfile(evidence / name, bundle / name)
        content += "\n" + "\n".join(rows) + f"\n\n[Протокол выпуска]({bundle / 'apk.json'})\n"
    target.write_text(content.rstrip() + "\n", encoding="utf-8")

    apk_entry = None
    if args.apk:
        assert metadata is not None
        apk_name = f'дневник-здоровья_v{metadata["version"]}_{args.date}.apk'
        apk_pattern = re.compile(r"(?:dnevnik-zdorovya|дневник-здоровья)_v(\d+\.\d+\.\d+)_(\d{4}-\d{2}-\d{2})\.apk")
        for previous in folder.glob("*.apk"):
            match = apk_pattern.fullmatch(previous.name)
            if not match or previous.name == apk_name:
                continue
            if (version_key(match[1]), match[2]) >= (version_key(metadata["version"]), args.date):
                continue
            archive = folder / "_архив" / previous.name
            archive.parent.mkdir(parents=True, exist_ok=True)
            if archive.exists():
                if archive.read_bytes() != previous.read_bytes():
                    raise FileExistsError(f"Different archived APK already exists: {archive}")
                previous.unlink()  # The identical archived APK remains intact.
            else:
                previous.rename(archive)
            archived.append(previous.name)
        shutil.copyfile(args.apk, folder / apk_name)
        apk_entry = f'| Дневник здоровья | [APK Android](дневник-здоровья/{apk_name}) — проверенная подпись обновления | v{metadata["version"]} | {args.date} | APK |'
    # Keep links in all generated reports usable after asset archiving.
    for previous_report in [*folder.glob("*.md"), *(folder / "_архив").glob("*.md")]:
        old = previous_report.read_text(encoding="utf-8")
        repaired = old
        for old_name in archived:
            if old_name.endswith((".apk", ".png")) or old_name.startswith("тёмные-концепции_v"):
                repaired = repaired.replace(str(folder / old_name), str(folder / "_архив" / old_name))
        if repaired != old:
            previous_report.write_text(repaired, encoding="utf-8")

    if not args.no_index:
        index = args.output_root / "README.md"
        relative = f"дневник-здоровья/{filename}"
        entry = (
            f"| Дневник здоровья | [{title}]({relative}) — {description} "
            f"| v{args.version} | {args.date} | MD |"
        )
        current = index.read_text(encoding="utf-8") if index.exists() else (
            "# Результаты — индекс\n\n| Проект | Поставка | Версия | Дата | Формат |\n|---|---|---|---|---|\n"
        )
        for old_name in archived:
            current = current.replace(
                f"](дневник-здоровья/{old_name})",
                f"](дневник-здоровья/_архив/{old_name})",
            )
        lines = current.splitlines()
        for row in [entry] + ([apk_entry] if apk_entry else []):
            row_target = re.search(r'\]\(([^)]+)\)', row)[1]
            matching = next((i for i, line in enumerate(lines) if f"]({row_target})" in line), None)
            if matching is not None:
                lines[matching] = row
            else:
                table_start = next((i for i, line in enumerate(lines) if line.startswith("| Проект |")), None)
                if table_start is None:
                    lines.extend(["", "| Проект | Поставка | Версия | Дата | Формат |", "|---|---|---|---|---|", row])
                else:
                    lines.insert(table_start + 2, row)
        index.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")

    print(target)


if __name__ == "__main__":
    main()
