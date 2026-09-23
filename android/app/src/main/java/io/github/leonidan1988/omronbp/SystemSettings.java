package io.github.leonidan1988.omronbp;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.provider.Settings;
import android.webkit.WebView;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Переходы на системные экраны, которых нет в готовых плагинах.
 *
 * Звук и громкость уведомления на Android 8 и новее принадлежат не приложению,
 * а каналу уведомлений, и меняются только в настройках системы. Приложение
 * вправе туда привести, но не вправе менять за человека — поэтому здесь ровно
 * переходы, без единой записи в настройки.
 *
 * Второй экран — энергосбережение. Huawei, Xiaomi и Samsung усыпляют фоновые
 * приложения, и напоминание о лекарстве не приходит вовсе. Это главная причина
 * молчащих будильников на Android, и человеку нужен путь к тому переключателю,
 * а не совет «поищите в настройках».
 */
@CapacitorPlugin(name = "SystemSettings")
public class SystemSettings extends Plugin {

    /**
     * Экран одного канала уведомлений: мелодия, громкость, вибрация, важность.
     *
     * Идёт цепочкой, а не одним намерением. `ACTION_CHANNEL_NOTIFICATION_SETTINGS`
     * поддерживают не все прошивки: на части EMUI и HarmonyOS он либо не
     * разрешается вовсе, либо уводит в общий экран настроек. Раньше приложение
     * отправляло его вслепую и считало успехом сам факт, что `startActivity` не
     * бросил исключение, — человек оказывался не там, а приложение рапортовало,
     * что всё хорошо. Теперь каждый шаг сперва проверяется у системы, а наружу
     * уходит имя экрана, который действительно открылся.
     */
    @PluginMethod
    public void openChannel(PluginCall call) {
        String channelId = call.getString("channelId");
        if (channelId == null) {
            call.reject("не указан канал");
            return;
        }
        String pkg = getContext().getPackageName();
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            // До Android 8 каналов не существует, и звук задаётся самим
            // уведомлением. Отдельного экрана нет — ведём в общие настройки.
            open(call, notificationsStep(pkg), detailsStep(pkg));
            return;
        }
        Intent channel = new Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS)
                .putExtra(Settings.EXTRA_APP_PACKAGE, pkg)
                .putExtra(Settings.EXTRA_CHANNEL_ID, channelId);
        open(call, new Step(channel, "channel"), notificationsStep(pkg), detailsStep(pkg));
    }

    private Step notificationsStep(String pkg) {
        Intent intent = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, pkg)
                : new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
                        .setData(Uri.parse("package:" + pkg));
        return new Step(intent, "app-notifications");
    }

    private Step detailsStep(String pkg) {
        return new Step(
                new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).setData(Uri.parse("package:" + pkg)),
                "app-details");
    }

    /** Одно звено цепочки: куда идём и как назвать это интерфейсу. */
    private static final class Step {
        final Intent intent;
        final String name;

        Step(Intent intent, String name) {
            this.intent = intent;
            this.name = name;
        }
    }

    /**
     * Пройти цепочку до первого экрана, который система согласна открыть.
     *
     * Отсутствие экрана — не ошибка, а факт о телефоне, поэтому здесь `resolve`
     * с `opened: false`, а не `reject`. Интерфейс по имени экрана скажет
     * человеку, что он увидит и где искать громкость.
     */
    private void open(PluginCall call, Step... steps) {
        PackageManager packages = getContext().getPackageManager();
        for (Step step : steps) {
            // `queryIntentActivities`, а не `resolveActivity`: второй на части
            // прошивок отдаёт заглушку «выберите приложение» и врёт, что экран
            // есть. Пустой список — честный ответ.
            if (packages.queryIntentActivities(step.intent, PackageManager.MATCH_DEFAULT_ONLY).isEmpty()) continue;
            try {
                Activity activity = getActivity();
                if (activity != null) {
                    // От активности, а не от контекста приложения: тогда
                    // системная «Назад» возвращает человека в дневник, а не
                    // выбрасывает его на рабочий стол.
                    activity.startActivity(step.intent);
                } else {
                    getContext().startActivity(step.intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
                }
                JSObject result = new JSObject();
                result.put("opened", true);
                result.put("screen", step.name);
                call.resolve(result);
                return;
            } catch (Exception ignored) {
                // Система сказала, что экран есть, а открыть не дала. Идём дальше.
            }
        }
        JSObject result = new JSObject();
        result.put("opened", false);
        result.put("screen", "none");
        call.resolve(result);
    }

    /** Все уведомления приложения — запасной путь, если канал ещё не создан. */
    @PluginMethod
    public void openAppNotifications(PluginCall call) {
        Intent intent;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            intent = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                    .putExtra(Settings.EXTRA_APP_PACKAGE, getContext().getPackageName());
        } else {
            intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
                    .setData(Uri.parse("package:" + getContext().getPackageName()));
        }
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        start(intent, call);
    }

    /**
     * Стоит ли на приложении ограничение энергосбережения.
     *
     * Читаем, а не меняем: снять ограничение вправе только человек. Нужно ровно
     * для того, чтобы не пугать предупреждением того, у кого всё в порядке —
     * предупреждение, которое висит всегда, перестают читать.
     *
     * Ответ неполный, и это надо помнить. Android отвечает про свой список
     * исключений, а у Huawei, Xiaomi и Samsung поверх него есть собственное
     * управление запуском приложений, о котором система ничего не сообщает.
     * Поэтому `false` здесь значит «системных ограничений нет», а не
     * «напоминания точно придут».
     */
    @PluginMethod
    public void isBatteryRestricted(PluginCall call) {
        JSObject result = new JSObject();
        try {
            PowerManager power = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
            boolean свободно = power != null
                    && power.isIgnoringBatteryOptimizations(getContext().getPackageName());
            result.put("restricted", !свободно);
        } catch (Exception error) {
            // Прошивка могла не ответить. Молчим, а не пугаем: интерфейс на
            // `null` просто не показывает предупреждение.
            result.put("restricted", null);
        }
        call.resolve(result);
    }

    /**
     * Создать канал напоминаний своими руками.
     *
     * Плагин уведомлений канал создать умеет, но не умеет главного —
     * `setBypassDnd`. В режиме «Не беспокоить» напоминание приходит молча, а
     * беззвучное напоминание о лекарстве равно отсутствующему: телефон лежит
     * экраном вниз, и человек про таблетку не узнаёт.
     *
     * Обход тихого режима система отдаёт только приложениям, которым человек
     * выдал доступ к политике уведомлений. Не выдал — канал создаётся обычным,
     * и приложение об этом честно пишет, а не делает вид, что всё в порядке.
     *
     * Звук задаётся с `USAGE_ALARM`: напоминание о лекарстве ближе к будильнику,
     * чем к письму, и громкостью должно идти по той же шкале.
     */
    @PluginMethod
    public void createMedsChannel(PluginCall call) {
        String id = call.getString("id");
        String sound = call.getString("sound");
        // Имя канала видно человеку в системных настройках. У всех четырёх
        // мелодий оно было одинаковое — «Приём лекарств», — и, добравшись до
        // списка каналов, человек правил громкость не у того.
        String title = call.getString("title");
        if (id == null) {
            call.reject("не указан канал");
            return;
        }
        JSObject result = new JSObject();
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            // До Android 8 каналов нет: звук задаёт само уведомление.
            result.put("bypassDnd", false);
            call.resolve(result);
            return;
        }
        try {
            NotificationManager manager =
                    (NotificationManager) getContext().getSystemService(Context.NOTIFICATION_SERVICE);
            if (manager == null) {
                call.reject("система не отдала менеджер уведомлений");
                return;
            }

            NotificationChannel channel = new NotificationChannel(
                    id,
                    title == null || title.isEmpty() ? "Приём лекарств" : title,
                    NotificationManager.IMPORTANCE_HIGH);
            channel.setDescription("Напоминания принять препарат по расписанию");
            channel.enableVibration(true);
            channel.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);

            if (sound != null && !sound.isEmpty()) {
                Uri uri = Uri.parse("android.resource://" + getContext().getPackageName() + "/raw/" + sound);
                channel.setSound(uri, new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ALARM)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build());
            }

            boolean allowed = manager.isNotificationPolicyAccessGranted();
            if (allowed) channel.setBypassDnd(true);

            manager.createNotificationChannel(channel);
            result.put("bypassDnd", allowed);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("не удалось создать канал", error);
        }
    }

    /** Выдан ли доступ к политике уведомлений — без него тихий режим не обойти. */
    @PluginMethod
    public void canBypassDoNotDisturb(PluginCall call) {
        JSObject result = new JSObject();
        try {
            NotificationManager manager =
                    (NotificationManager) getContext().getSystemService(Context.NOTIFICATION_SERVICE);
            result.put("allowed", manager != null
                    && Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
                    && manager.isNotificationPolicyAccessGranted());
        } catch (Exception error) {
            result.put("allowed", false);
        }
        call.resolve(result);
    }

    /** Экран, где этот доступ выдаётся. */
    @PluginMethod
    public void openDoNotDisturbAccess(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
            openAppNotifications(call);
            return;
        }
        start(new Intent(Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK), call);
    }

    /**
     * Системная печать текущей страницы — она же «Сохранить в PDF».
     *
     * `window.print()` внутри WebView не делает ничего: диалога печати у него
     * нет. Между тем отчёт врачу — то, ради чего дневник и ведут, и кнопка,
     * которая молча ничего не делает, здесь хуже отсутствующей.
     *
     * Android умеет напечатать содержимое WebView штатно, и в системном
     * диалоге среди принтеров есть «Сохранить в PDF» — то самое, что нужно,
     * чтобы отправить отчёт файлом.
     *
     * Печать обязана запускаться из главного потока: WebView из другого потока
     * трогать нельзя.
     */
    @PluginMethod
    public void printPage(PluginCall call) {
        String jobName = call.getString("jobName", "Отчёт");
        getActivity().runOnUiThread(() -> {
            try {
                WebView webView = getBridge().getWebView();
                PrintManager manager = (PrintManager) getContext().getSystemService(Context.PRINT_SERVICE);
                if (webView == null || manager == null) {
                    call.reject("печать недоступна на этом устройстве");
                    return;
                }
                PrintDocumentAdapter adapter = webView.createPrintDocumentAdapter(jobName);
                manager.print(jobName, adapter, new PrintAttributes.Builder().build());
                JSObject result = new JSObject();
                result.put("started", true);
                call.resolve(result);
            } catch (Exception error) {
                call.reject("не удалось открыть печать", error);
            }
        });
    }

    /**
     * Включён ли сейчас режим «Не беспокоить».
     *
     * В этом режиме уведомление приходит молча — приложение об этом узнать
     * обязано, потому что беззвучное напоминание о лекарстве равно
     * отсутствующему. Разрешения не требует: читаем состояние, не меняем его.
     */
    @PluginMethod
    public void isDoNotDisturbOn(PluginCall call) {
        JSObject result = new JSObject();
        try {
            NotificationManager manager =
                    (NotificationManager) getContext().getSystemService(Context.NOTIFICATION_SERVICE);
            int фильтр = manager == null
                    ? NotificationManager.INTERRUPTION_FILTER_ALL
                    : manager.getCurrentInterruptionFilter();
            result.put("on", фильтр != NotificationManager.INTERRUPTION_FILTER_ALL
                    && фильтр != NotificationManager.INTERRUPTION_FILTER_UNKNOWN);
        } catch (Exception error) {
            result.put("on", null);
        }
        call.resolve(result);
    }

    /**
     * Системный список «Батарея — приложения без ограничений».
     *
     * Отдельно от настроек приложения: здесь человек сразу видит нужный
     * переключатель, а не ищет его среди прочего. Разрешения не требует —
     * в отличие от прямого запроса на исключение, который магазины отдают
     * закрытым списком категорий.
     */
    @PluginMethod
    public void openBatteryOptimization(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        start(intent, call);
    }

    /**
     * Настройки приложения: оттуда человек доходит до «Батарея» и снимает
     * ограничения. Прямого экрана энергосбережения у производителей нет —
     * у каждого он свой и по имени не вызывается.
     */
    @PluginMethod
    public void openAppDetails(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
                .setData(Uri.parse("package:" + getContext().getPackageName()))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        start(intent, call);
    }

    /**
     * Одиночный экран — через ту же проверку, что и цепочка.
     *
     * Экран может отсутствовать на нестандартной прошивке, и тогда наружу
     * уходит честное `opened: false`, а не молчаливое «получилось»: интерфейс
     * скажет «откройте настройки сами», вместо того чтобы сделать вид, что
     * перешёл.
     */
    private void start(Intent intent, PluginCall call) {
        open(call, new Step(intent, "screen"));
    }
    /**
     * Открыть ссылку за пределами приложения — и пусть систему решает, чем.
     *
     * Раньше здесь адрес принудительно отдавался браузеру: один раз при
     * проверке ссылка на поиск ушла в установленное приложение аптеки, и оно
     * открылось на своей главной, потеряв запрос. Вывод оказался поспешным.
     * Проверка 6 сентября 2026 на четырёх случаях — Аптека.ру и Здравсити, с
     * холодного старта и с уже запущенного, — показала, что оба приложения
     * запрос понимают и открывают нужный поиск.
     *
     * А приложение аптеки для человека лучше браузера: там он уже вошёл, там
     * его корзина и адрес доставки. Поэтому решает система: стоит приложение
     * сети — откроется оно, нет — браузер.
     */
    @PluginMethod
    public void openLink(PluginCall call) {
        String url = call.getString("url");
        if (url == null) {
            call.reject("нет адреса");
            return;
        }
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url))
                    .addCategory(Intent.CATEGORY_BROWSABLE)
                    .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception error) {
            call.reject("не удалось открыть ссылку", error);
        }
    }
}
