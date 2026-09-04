# Telegram-бот «Брокер ГРАНИ»

Cloudflare Worker принимает webhook Telegram и показывает меню прямо в чате.

## Настройки Cloudflare

Cloudflare автоматически обнаруживает конфигурацию в корне репозитория.

Runtime secrets:

- `BOT_TOKEN` — токен из BotFather;
- `WEBHOOK_SECRET` — случайная строка для проверки запросов Telegram;
- `SETUP_KEY` — временная случайная строка для запуска настройки webhook.

Runtime variables:

- `CONTACT_URL` — публичная ссылка менеджера, например `https://t.me/username`;
- `DONATE_URL` — публичная ссылка для поддержки проекта.

После первого развёртывания откройте:

`https://<worker>.workers.dev/setup/<SETUP_KEY>`

После успешного ответа `ok: true` удалите секрет `SETUP_KEY` в Cloudflare.
