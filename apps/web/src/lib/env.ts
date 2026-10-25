export const BACKEND = { url: __SB_URL__, anonKey: __SB_ANON_KEY__ };
export const BACKEND_CONFIGURED = BACKEND.url !== "" && BACKEND.anonKey !== "";
/** Empty until the extension is published. The install button is hidden then, never pointed at a made-up address. */
export const EXTENSION_STORE_URL = __SB_STORE_URL__;
