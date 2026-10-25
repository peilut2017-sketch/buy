import { browser } from "wxt/browser";

export async function getLocal<T>(key: string): Promise<T | null> {
  const got = await browser.storage.local.get(key);
  return (got[key] as T | undefined) ?? null;
}

export async function setLocal(key: string, value: unknown): Promise<void> {
  await browser.storage.local.set({ [key]: value });
}

export async function getSession<T>(key: string): Promise<T | null> {
  const got = await browser.storage.session.get(key);
  return (got[key] as T | undefined) ?? null;
}

export async function setSession(key: string, value: unknown): Promise<void> {
  await browser.storage.session.set({ [key]: value });
}

export async function removeSession(key: string): Promise<void> {
  await browser.storage.session.remove(key);
}
