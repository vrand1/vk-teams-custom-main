# Свой десктоп-клиент (форк-оболочка)

Это **не** исходники VK WorkSpace. Это тонкая оболочка на **Electron**, которая:

1. Открывает `https://myteam.mail.ru/webim/` (или ваш URL через `VK_WORKSPACE_URL`)
2. Подгружает расширение из родительской папки (`../manifest.json`)

Так вы получаете отдельное `.exe`-подобное окно **со своей фичей**, без патча официального клиента VK.

## Требования

- [Node.js](https://nodejs.org/) 18+ (LTS)
- Windows / macOS / Linux

## Запуск

```bash
cd electron-shell
npm install
npm start
```

Другой URL (on-prem):

```bash
# PowerShell
$env:VK_WORKSPACE_URL="https://webim.teams.example.com/"
npm start
```

## Проверка

1. Войдите в аккаунт (если в Network был `login?code` **заблокировано** — перезапустите `npm start` после обновления `main.js`).
2. Откройте чат → **Ctrl+Shift+I** → Console.
3. Должно быть: `[VK Teams Custom Reactions] Extension loaded!`
4. На сообщении — иконка кастомных реакций.

### В консоли `[shell] Extension NOT loaded`

Electron на вашей сборке не подхватил API расширений. Используйте Chrome:

```powershell
cd ..\scripts
.\launch-workspace-app.ps1 -SharedProfile
```

(один раз: `chrome://extensions` → загрузить папку репозитория → **Активировать** в попапе).

## Сборка .exe (готовый продукт для коллег)

Один раз на машине разработчика (нужен [Node.js](https://nodejs.org/) 18+):

```powershell
cd electron-shell
npm install
npm run dist
```

В папке `electron-shell\dist\` появятся:

| Файл | Назначение |
|------|------------|
| `VK-Teams-Custom-1.0.0-portable.exe` | Один файл — запустил и работает, без установки |
| `VK-Teams-Custom-1.0.0-setup.exe` | Установщик (ярлык, папка в Program Files) |
| `win-unpacked\` | Распакованная версия для отладки |

**Перед сборкой** (по желанию) положите в корень репозитория `connection.defaults.json` с вашим RAPI и AIMSID-шаблоном — он попадёт внутрь exe. Иначе подставится `connection.defaults.example.json`.

Коллегам Node.js не нужен: отдаёте portable или setup.

Другой URL мессенджера при запуске (on-prem):

```powershell
$env:VK_WORKSPACE_URL="https://webim.teams.example.com/"
.\dist\VK-Teams-Custom-1.0.0-portable.exe
```

Если сборка падает на `Cannot create symbolic link` — в `package.json` уже отключена подпись (`signAndEditExecutable: false`). При других ошибках запустите PowerShell **от администратора** или включите «Режим разработчика» в Windows.

Иконку приложения (256×256) можно положить в `electron-shell\build\icon.png` и добавить в `package.json` → `build.win.icon`.

## Ограничения

- Поддерживается **часть** Chrome Extensions API (см. [Electron Extensions](https://www.electronjs.org/docs/latest/api/extensions)).
- Запись звонков, часть AI и popup могут вести себя иначе, чем в Chrome — тестируйте.
- Обновления VK WorkSpace UI могут сломать селекторы в `content.js` — правки там же.

## Связь с вариантом A (`scripts/launch-workspace-app.bat`)

| | Лаунчер Chrome | Electron shell |
|--|----------------|----------------|
| Установка | Только Chrome | Node + `npm install` |
| Расширение | `--load-extension` | `loadExtension()` |
| Отдельный профиль | Да (нужна активация в попапе) | Свой профиль Electron |
| Свой бренд / exe | Нет | Да (через electron-builder) |

Подробнее: [FORK.md](../FORK.md)
