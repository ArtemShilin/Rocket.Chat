# Локальные шаблоны ответов

Самостоятельный модуль для Rocket.Chat 8.9.0 поверх образа устройств и AI.
Штатные проверки лицензии не изменены. В исходниках 8.9.0 официальный модуль
подключается через `License.onLicense('canned-responses', ...)` в
`apps/meteor/ee/server/lib/canned-responses/index.ts`.
Официальный [API шаблонов](https://developer.rocket.chat/apidocs/get-a-canned-response)
отмечен Enterprise. Этот модуль использует отдельные коллекцию и маршруты.

## Возможности

- Страница `/local-canned-responses`: создание, изменение, удаление и поиск.
- Личные шаблоны видны и доступны для изменения только владельцу, включая
  запрет доступа других администраторов к ним через этот API.
- Общие шаблоны видны всем вошедшим пользователям; изменяет их только `admin`.
- Кнопка «Шаблоны» возле текстового редактора вставляет выбранный текст в
  текущий черновик с учётом выделения. Отправку выполняет пользователь.
- Названия уникальны внутри личного списка или общего списка. Проверка версий
  предотвращает перезапись параллельных изменений. Смена области существующего
  шаблона запрещена: нужно создать другой.
- Поиск буквальный, выдача по 50 записей. В API нет токенов или их хешей.

Права основаны на серверной роли `admin`; это собственная модель доступа,
не интеграция со штатными разрешениями Enterprise. Шаблоны отделов,
подстановка переменных, синхронизация штатных canned responses, `!shortcut`,
богатый редактор и Omnichannel не реализованы. Вставка пока поддерживает только
`textarea.js-input-message` и проверена с реальным интерфейсом 8.9.0.

## Проверки

```sh
node --test custom/canned-responses/test/*.test.cjs
node custom/canned-responses/test/browser.cjs
```

Первый набор вызывает настоящий HTTP middleware через потоки в памяти и
Mongo-адаптер: сокеты и Docker не требуются. Это не проверка реального MongoDB.
Браузерный сценарий использует Chrome/Playwright из локального стенда и
перехват запросов: создание, безопасное отображение текста, мобильная ширина,
вставка в черновик и смена аккаунта. Он не заменяет проверку Rocket.Chat.

## Сборка и проверка на сервере

```sh
DOCKER_BUILDKIT=0 ./deploy/local/manage.sh build-canned
```

Нужен существующий образ `rocketchat-local:8.9.0-workspace-v1`. При его отсутствии
сначала выполните `manage.sh build-workspace`. Сборка не меняет основной образ в `.env`.

Запустите образ на тестовом порту, используя существующую внутреннюю сеть:

```sh
PATH="$HOME/.local/bin:$PATH" docker --context colima-rocketchat run -d \
  --name rocketchat-canned-test --network rocketchat-local_default \
  -p 127.0.0.1:3001:3000 -e PORT=3000 -e ROOT_URL=http://localhost:3001 \
  -e 'MONGO_URL=mongodb://mongodb:27017/rocketchat?replicaSet=rs0' \
  -e TRANSPORTER=monolith+nats://nats:4222 \
  rocketchat-local:8.9.0-canned-v1
node custom/canned-responses/test/live.cjs
node custom/canned-responses/test/live-browser.cjs
```

Дождитесь готовности `/api/info` на порту 3001. Тест использует сохранённых
тестовых пользователей, создаёт уникальные шаблоны и удаляет их после проверки.
Тестовый контейнер подключён к существующей базе; исходные сообщения не меняет.
Обязательно вручную проверить кнопку у реального редактора, вставку без отправки,
сохранение черновика, смену комнаты и аккаунта. После проверки удалите только
контейнер `rocketchat-canned-test`, не тома базы.

Перед внедрением остановите основное приложение, выполните `manage.sh backup`,
проверьте архив и сохраните прежний `ROCKETCHAT_IMAGE`. Получите ID нового образа:

```sh
PATH="$HOME/.local/bin:$PATH" docker --context colima-rocketchat image inspect \
  rocketchat-local:8.9.0-canned-v1 --format '{{.Id}}'
```

Укажите полученный ID в приватном `deploy/local/.env`, выполните `manage.sh start`,
`manage.sh check`, `manage.sh browser-check`, затем
`CANNED_TEST_BASE=http://localhost:3000 node custom/canned-responses/test/live.cjs`.
Откат образа: вернуть прежний ID в `.env`, запустить `manage.sh start`.
Модуль добавляет только собственную коллекцию `rocketchat_local_canned_responses`
и уникальный индекс, не меняет схему существующих коллекций.

Текущий статус внедрения: [VALIDATION.md](VALIDATION.md).
