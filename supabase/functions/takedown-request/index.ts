import { takedownRequest } from "../_shared/handlers/takedown.ts";
import { serveHandler } from "../_shared/runtime.ts";

serveHandler(takedownRequest);
