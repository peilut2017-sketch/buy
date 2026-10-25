import { deleteMyAccount } from "../_shared/handlers/account.ts";
import { serveHandler } from "../_shared/runtime.ts";

serveHandler(deleteMyAccount);
