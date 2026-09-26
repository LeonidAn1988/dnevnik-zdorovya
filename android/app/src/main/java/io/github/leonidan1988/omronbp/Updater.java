package io.github.leonidan1988.omronbp;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;

/**
 * Установка обновления из самого приложения.
 *
 * Приложение раздаётся файлом, магазина нет, и до сих пор обновиться можно было
 * только получив APK от владельца и поставив его руками. На семье из нескольких
 * телефонов это значит, что часть из них вечно на старой версии — а старая
 * версия ломает семейный обмен и молчит об этом.
 *
 * Здесь ровно три действия, и ни одного своего решения: спросить, разрешена ли
 * установка; отвести на экран, где это разрешают; показать скачанный файл
 * системному установщику. Дальше окно показывает система, и согласие даёт
 * человек.
 *
 * **Подпись проверяет система, а не мы.** Файл, подписанный не тем ключом, на
 * место дневника не встанет — установщик откажет. Это единственная защита,
 * которая здесь нужна, и единственная, которой можно доверять: своя проверка в
 * приложении, которое само же и обновляется, ничего не стоит.
 *
 * **Про магазин.** Право `REQUEST_INSTALL_PACKAGES` Google Play выдаёт неохотно:
 * только магазинам и обоснованным самообновляющимся приложениям, и через
 * отдельную форму. Пока приложение раздаётся файлом, это ничего не стоит; при
 * выходе в Play этот плагин, скорее всего, придётся убирать вместе с правом.
 * Записано здесь, чтобы не выяснилось в последний момент.
 */
@CapacitorPlugin(name = "Updater")
public class Updater extends Plugin {

    /** Разрешена ли установка приложений из этого источника. */
    @PluginMethod
    public void canInstall(PluginCall call) {
        JSObject result = new JSObject();
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            // До Android 8 разрешение было одно на весь телефон, а не на
            // приложение, и спросить о нём из приложения нельзя. Считаем, что
            // можно: если нет, установщик скажет это сам и понятнее нас.
            result.put("allowed", true);
        } else {
            result.put("allowed", getContext().getPackageManager().canRequestPackageInstalls());
        }
        call.resolve(result);
    }

    /**
     * Экран, где человек разрешает установку из этого приложения.
     *
     * Проверяем намерение до запуска, как и все прочие системные экраны: на
     * нестандартной прошивке его может не быть, и тогда честнее сказать
     * «не открылось», чем сделать вид, что перешли.
     */
    @PluginMethod
    public void openInstallSettings(PluginCall call) {
        JSObject result = new JSObject();
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            result.put("opened", false);
            call.resolve(result);
            return;
        }
        Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES)
                .setData(Uri.parse("package:" + getContext().getPackageName()));
        PackageManager packages = getContext().getPackageManager();
        if (packages.queryIntentActivities(intent, PackageManager.MATCH_DEFAULT_ONLY).isEmpty()) {
            result.put("opened", false);
            call.resolve(result);
            return;
        }
        try {
            Activity activity = getActivity();
            if (activity != null) {
                activity.startActivity(intent);
            } else {
                getContext().startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            }
            result.put("opened", true);
        } catch (Exception ignored) {
            result.put("opened", false);
        }
        call.resolve(result);
    }

    /** Показать скачанный файл системному установщику. */
    @PluginMethod
    public void install(PluginCall call) {
        String path = call.getString("path");
        if (path == null || path.isEmpty()) {
            call.reject("не указан файл");
            return;
        }
        // Плагин файлов отдаёт путь то голым, то адресом `file://` — зависит от
        // версии. Приводим к одному виду здесь, а не у вызывающего: там об этом
        // различии знать незачем.
        File file = new File(path.startsWith("file://") ? Uri.parse(path).getPath() : path);
        if (!file.exists()) {
            call.reject("файла нет: " + file.getAbsolutePath());
            return;
        }
        try {
            Uri uri = FileProvider.getUriForFile(
                    getContext(), getContext().getPackageName() + ".fileprovider", file);
            Intent intent = new Intent(Intent.ACTION_VIEW)
                    .setDataAndType(uri, "application/vnd.android.package-archive")
                    // Без этого флага установщик получает адрес, читать который
                    // ему нечем: `FileProvider` закрыт для всех, кому права не
                    // выданы явно.
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception error) {
            call.reject("не открылся установщик", error);
        }
    }
}
