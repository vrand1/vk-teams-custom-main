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

## Сборка установщика (опционально)

```bash
npm install --save-dev electron-builder
```

Добавьте в `package.json` секцию `build` и команду `dist` — см. [electron-builder](https://www.electron.build/).

Иконку и имя приложения задайте в `build.win` / `build.mac`.

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
