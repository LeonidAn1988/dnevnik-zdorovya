package io.github.leonidan1988.omronbp;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        // Свои плагины регистрируются до создания моста, иначе к моменту
        // загрузки страницы их в нём не окажется.
        registerPlugin(SystemSettings.class);
        registerPlugin(BackupFile.class);
        registerPlugin(Updater.class);
        super.onCreate(savedInstanceState);
    }
}
