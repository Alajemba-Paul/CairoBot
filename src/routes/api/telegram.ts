import { createFileRoute } from "@tanstack/react-router";
import { handleUpdate, type TelegramUpdate } from "@/adapters/telegram";
import { BOT_TOKEN, TELEGRAM_BOT, TELEGRAM_WEBHOOK_SECRET } from "@/config";
import { PUBLIC_TELEGRAM_BOT } from "@/core/constants";

export const Route = createFileRoute("/api/telegram")({
  server: {
    handlers: {
      GET: async () =>
        Response.json({
          ok: true,
          bot: TELEGRAM_BOT || PUBLIC_TELEGRAM_BOT,
          webhook: true,
        }),
      POST: async ({ request }) => {
        if (!BOT_TOKEN && !process.env.BOT_TOKEN) {
          return Response.json({ ok: false, error: "BOT_TOKEN unset" }, { status: 503 });
        }
        const secret = TELEGRAM_WEBHOOK_SECRET || process.env.TELEGRAM_WEBHOOK_SECRET;
        if (secret) {
          const got = request.headers.get("x-telegram-bot-api-secret-token");
          if (got !== secret) {
            return new Response("forbidden", { status: 403 });
          }
        }
        const update = (await request.json()) as TelegramUpdate;
        await handleUpdate(update);
        return Response.json({ ok: true });
      },
    },
  },
});
