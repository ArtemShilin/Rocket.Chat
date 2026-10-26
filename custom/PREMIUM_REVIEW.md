# Постепенное развитие локальных возможностей

Проверка 26.10.2026 для установленного Rocket.Chat 8.9.0. Тарифные привязки
сверены с исходниками именно этой версии; актуальная документация может описывать
более новые версии. Реализация добавляет самостоятельные модули fork.

| Возможность | Проверка в 8.9.0 | Локальная реализация / следующий этап |
| --- | --- | --- |
| AI Search | `chat.rocket.rc-ai` | Поиск всей доступной истории, ответы и сводки, локальные модели, штатная ✦ |
| Device Management | `device-management`, `ee/server/api/sessions.ts` | «Мои устройства»; административный список, поиск, завершение отдельного входа и журнал действий |
| Canned responses | `canned-responses`, `ee/server/lib/canned-responses/index.ts` | Следующий кандидат: общие и личные шаблоны ответов, вставка в редактор, доступ по ролям |
| Message auditing | `auditing`, `ee/server/startup/audit.ts` | Отдельный будущий этап: сначала аудит административных действий; доступ к чужой переписке требует отдельного проекта прав и контроля |
| Detailed read receipts | `message-read-receipt`, `ee/server/api/chat.ts` | Будущий этап: точные события чтения и разрешения; время последней активности не будет выдаваться за подтверждение чтения |

Для каждого этапа: описать изменение перед внедрением, разработать отдельный
модуль, проверить права и реальные пользовательские сценарии на тестовом порту,
создать резервную копию, закрепить Docker-образ, проверить основной сервер и
сохранить исходники в GitHub. Статус платного add-on в штатных настройках может
сохраняться: доступность самостоятельного модуля проверяется его рабочим интерфейсом.

Источники: [Device Management](https://docs.rocket.chat/docs/device-management),
[Security overview](https://docs.rocket.chat/docs/security-overview),
[Canned responses](https://docs.rocket.chat/docs/omnichannel-conversations),
[Read receipts](https://docs.rocket.chat/docs/read-receipts),
[Audit security logs](https://docs.rocket.chat/v1/docs/audit-workspace-security-logs).
