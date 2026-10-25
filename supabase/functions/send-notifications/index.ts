import { sendNotifications } from "../_shared/handlers/notifications.ts";
import { serveHandler } from "../_shared/runtime.ts";

serveHandler(sendNotifications);
