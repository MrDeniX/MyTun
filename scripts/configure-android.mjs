import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const rootDir = path.resolve(import.meta.dirname, '..');
const androidDir = path.join(rootDir, 'android');
const resDir = path.join(androidDir, 'app', 'src', 'main', 'res');
const manifestPath = path.join(androidDir, 'app', 'src', 'main', 'AndroidManifest.xml');
const stylesPath = path.join(resDir, 'values', 'styles.xml');
const icon512 = path.join(rootDir, 'public', 'pwa-512x512.png');
const icon192 = path.join(rootDir, 'public', 'pwa-192x192.png');

function run(cmd) {
  console.log(`\n> ${cmd}`);
  execSync(cmd, { cwd: rootDir, stdio: 'inherit' });
}

if (!fs.existsSync(path.join(rootDir, 'dist', 'index.html'))) {
  console.log('dist/ не найден — запускаем сборку веб-приложения...');
  run('npm run build');
}

if (!fs.existsSync(androidDir)) {
  console.log('Создаём нативный Android-проект через Capacitor...');
  run('npx cap add android');
}

console.log('Синхронизируем dist/ с Android-проектом...');
run('npx cap sync android');

// 1. Патчим AndroidManifest.xml для доступа к микрофону в WebView
if (fs.existsSync(manifestPath)) {
  let manifest = fs.readFileSync(manifestPath, 'utf8');
  const requiredEntries = [
    '<uses-permission android:name="android.permission.RECORD_AUDIO" />',
    '<uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />',
    '<uses-feature android:name="android.hardware.microphone" android:required="false" />',
  ];

  const missing = requiredEntries.filter((entry) => !manifest.includes(entry));
  if (missing.length > 0) {
    manifest = manifest.replace(
      '</manifest>',
      `    ${missing.join('\n    ')}\n</manifest>`
    );
    fs.writeFileSync(manifestPath, manifest, 'utf8');
    console.log('Добавлены права на микрофон в AndroidManifest.xml');
  }
}

// 2. Патчим тему Android под OLED-чёрный #0A0A0A (статус-бар и навигация)
if (fs.existsSync(stylesPath)) {
  let styles = fs.readFileSync(stylesPath, 'utf8');
  if (!styles.includes('android:statusBarColor')) {
    const darkItems = [
      '        <item name="android:windowBackground">#0A0A0A</item>',
      '        <item name="android:statusBarColor">#0A0A0A</item>',
      '        <item name="android:navigationBarColor">#0A0A0A</item>',
      '        <item name="android:windowLightStatusBar">false</item>',
    ].join('\n');

    styles = styles.replace(
      /(<style name="AppTheme\.NoActionBar"[^>]*>)/,
      `$1\n${darkItems}`
    );
    styles = styles.replace(
      '<item name="android:background">@drawable/splash</item>',
      '<item name="android:background">#0A0A0A</item>\n        <item name="android:statusBarColor">#0A0A0A</item>\n        <item name="android:navigationBarColor">#0A0A0A</item>'
    );
    fs.writeFileSync(stylesPath, styles, 'utf8');
    console.log('Применена тёмная OLED-тема системных панелей в styles.xml');
  }
}

// 3. Копируем фирменную иконку TONE.01 в Android mipmap-ресурсы
if (fs.existsSync(icon512) && fs.existsSync(resDir)) {
  const mipmapDirs = [
    'mipmap-mdpi',
    'mipmap-hdpi',
    'mipmap-xhdpi',
    'mipmap-xxhdpi',
    'mipmap-xxxhdpi',
  ];

  for (const dir of mipmapDirs) {
    const targetDir = path.join(resDir, dir);
    if (!fs.existsSync(targetDir)) continue;
    const srcIcon = dir === 'mipmap-mdpi' || dir === 'mipmap-hdpi' ? icon192 : icon512;
    if (fs.existsSync(srcIcon)) {
      fs.copyFileSync(srcIcon, path.join(targetDir, 'ic_launcher.png'));
      fs.copyFileSync(srcIcon, path.join(targetDir, 'ic_launcher_round.png'));
      fs.copyFileSync(srcIcon, path.join(targetDir, 'ic_launcher_foreground.png'));
    }
  }

  const bgPath = path.join(resDir, 'values', 'ic_launcher_background.xml');
  if (fs.existsSync(bgPath)) {
    fs.writeFileSync(
      bgPath,
      `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#0A0A0A</color>\n</resources>\n`,
      'utf8'
    );
  }
  console.log('Установлена иконка TONE.01 для Android APK');
}

console.log('\nГотово! Android-проект настроен. Для сборки APK откройте его в Android Studio (npm run android:open) или выполните ./gradlew assembleDebug внутри папки android/.');
