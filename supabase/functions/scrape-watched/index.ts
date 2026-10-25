import { scrapeWatched } from "../_shared/handlers/scrapeWatched.ts";
import { serveHandler } from "../_shared/runtime.ts";

serveHandler(scrapeWatched);
