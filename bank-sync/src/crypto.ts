/**
 * Plaid access tokens are stored encrypted (AES-GCM) in Workers KV, with a
 * key kept as a Worker secret. Reading KV alone doesn't reveal them.
 */

const enc = new TextEncoder();
const dec = new TextDecoder();

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function key(secretB64: string): Promise<CryptoKey> {
  const raw = unb64(secretB64);
  if (raw.length !== 32) throw new Error("TOKEN_KEY must be 32 random bytes, base64 encoded.");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encrypt(plain: string, secretB64: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(secretB64), enc.encode(plain)));
  return `${b64(iv)}.${b64(data)}`;
}

export async function decrypt(stored: string, secretB64: string): Promise<string> {
  const [iv, data] = stored.split(".");
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, await key(secretB64), unb64(data));
  return dec.decode(plain);
}
