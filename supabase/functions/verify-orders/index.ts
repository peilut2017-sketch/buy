import { verifyOrders } from "../_shared/handlers/verifyOrders.ts";
import { serveHandler } from "../_shared/runtime.ts";

serveHandler(verifyOrders);
