import { defaultSettings } from "./defaults";
import type { Settings } from "./types";

/**
 * Settings to save when restoring a backup. Anything the backup doesn't have
 * (older backups predate accounts; no backup carries API keys) keeps its
 * current value instead of being reset to a default.
 */
export function restoredSettings(backup: Partial<Settings>, current: Settings): Settings {
  return {
    ...defaultSettings(),
    ...backup,
    accounts: backup.accounts ?? current.accounts,
    anthropicKey: backup.anthropicKey || current.anthropicKey,
    twelveDataKey: backup.twelveDataKey || current.twelveDataKey
  };
}

/**
 * Splits writes into batches Firestore accepts: at most `maxOps` writes and
 * about `maxBytes` of data each (a batch is limited to 500 writes and 10 MB;
 * wishlist photos can be a few hundred KB apiece).
 */
export function chunkWrites<T extends { data?: object }>(ops: T[], maxOps = 400, maxBytes = 4_000_000): T[][] {
  const out: T[][] = [];
  let cur: T[] = [];
  let bytes = 0;
  for (const op of ops) {
    const size = op.data ? JSON.stringify(op.data).length : 0;
    if (cur.length && (cur.length >= maxOps || bytes + size > maxBytes)) {
      out.push(cur);
      cur = [];
      bytes = 0;
    }
    cur.push(op);
    bytes += size;
  }
  if (cur.length) out.push(cur);
  return out;
}
