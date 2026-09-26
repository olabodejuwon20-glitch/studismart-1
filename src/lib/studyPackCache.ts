// IndexedDB-backed cache for study packs and questions.
// Provides much larger storage capacity than localStorage (~50MB+ vs ~5MB).
// Data is user-scoped and tagged with a timestamp for expiry.

const DB_NAME = "studymind-offline-v1";
const DB_VERSION = 1;
const STORE_PACKS = "study_packs";
const STORE_QUESTIONS = "questions";
const STORE_DASHBOARD = "dashboard";
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_PACKS)) {
        db.createObjectStore(STORE_PACKS, { keyPath: "cacheKey" });
      }
      if (!db.objectStoreNames.contains(STORE_QUESTIONS)) {
        db.createObjectStore(STORE_QUESTIONS, { keyPath: "cacheKey" });
      }
      if (!db.objectStoreNames.contains(STORE_DASHBOARD)) {
        db.createObjectStore(STORE_DASHBOARD, { keyPath: "cacheKey" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet<T>(store: string, key: string): Promise<T | null> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(store, "readonly");
      const req = tx.objectStore(store).get(key);
      req.onsuccess = () => {
        const record = req.result as { cacheKey: string; data: T; cachedAt: number } | undefined;
        if (!record) return resolve(null);
        if (Date.now() - record.cachedAt > MAX_AGE_MS) return resolve(null);
        resolve(record.data);
      };
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

async function idbSet(store: string, key: string, data: unknown): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(store, "readwrite");
      tx.objectStore(store).put({ cacheKey: key, data, cachedAt: Date.now() });
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    /* quota / unavailable — silent */
  }
}

async function idbDelete(store: string, key: string): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(store, "readwrite");
      tx.objectStore(store).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch { /* noop */ }
}

async function idbGetAllKeys(store: string): Promise<string[]> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(store, "readonly");
      const req = tx.objectStore(store).getAllKeys();
      req.onsuccess = () => resolve(req.result as string[]);
      req.onerror = () => resolve([]);
    });
  } catch {
    return [];
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────

export type CachedStudyPack = {
  id: string;
  title: string;
  summary: string | null;
  topics: { name: string }[];
  material_id: string | null;
  created_at: string;
  questionCount: number;
};

export type CachedQuestion = {
  id: string;
  topic: string | null;
  question: string;
  options: string[];
  correct_index: number;
  explanation: string | null;
};

/** Save a full study pack (pack + question count) to IndexedDB. */
export async function savePackOffline(
  userId: string,
  pack: CachedStudyPack
): Promise<void> {
  const key = `${userId}:pack:${pack.id}`;
  await idbSet(STORE_PACKS, key, pack);

  // Also maintain an index of all pack IDs for this user
  const indexKey = `${userId}:pack-index`;
  const existing = (await idbGet<string[]>(STORE_PACKS, indexKey)) ?? [];
  if (!existing.includes(pack.id)) {
    await idbSet(STORE_PACKS, indexKey, [...existing, pack.id]);
  }
}

/** Load a single study pack from IndexedDB. Returns null if not cached. */
export async function getPackOffline(
  userId: string,
  packId: string
): Promise<CachedStudyPack | null> {
  return idbGet<CachedStudyPack>(STORE_PACKS, `${userId}:pack:${packId}`);
}

/** Get all pack IDs available offline for a user. */
export async function getOfflinePackIds(userId: string): Promise<string[]> {
  return (await idbGet<string[]>(STORE_PACKS, `${userId}:pack-index`)) ?? [];
}

/** Get count of study packs cached offline for a user. */
export async function getOfflinePackCount(userId: string): Promise<number> {
  const ids = await getOfflinePackIds(userId);
  return ids.length;
}

/** Save questions for a study pack to IndexedDB. */
export async function saveQuestionsOffline(
  userId: string,
  packId: string,
  questions: CachedQuestion[]
): Promise<void> {
  const key = `${userId}:questions:${packId}`;
  await idbSet(STORE_QUESTIONS, key, questions);
}

/** Load questions for a study pack from IndexedDB. */
export async function getQuestionsOffline(
  userId: string,
  packId: string
): Promise<CachedQuestion[] | null> {
  return idbGet<CachedQuestion[]>(STORE_QUESTIONS, `${userId}:questions:${packId}`);
}

/** Save dashboard data (recent packs list) for fast offline load. */
export async function saveDashboardOffline(userId: string, data: unknown): Promise<void> {
  await idbSet(STORE_DASHBOARD, `${userId}:dashboard`, data);
}

/** Load dashboard data from IndexedDB. */
export async function getDashboardOffline<T>(userId: string): Promise<T | null> {
  return idbGet<T>(STORE_DASHBOARD, `${userId}:dashboard`);
}

/** Remove a specific pack and its questions from offline cache. */
export async function removePackOffline(userId: string, packId: string): Promise<void> {
  await idbDelete(STORE_PACKS, `${userId}:pack:${packId}`);
  await idbDelete(STORE_QUESTIONS, `${userId}:questions:${packId}`);
  const indexKey = `${userId}:pack-index`;
  const existing = (await idbGet<string[]>(STORE_PACKS, indexKey)) ?? [];
  await idbSet(STORE_PACKS, indexKey, existing.filter((id) => id !== packId));
}

/** Clear all offline data for a user (on logout). */
export async function clearOfflineDataForUser(userId: string): Promise<void> {
  const packIds = await getOfflinePackIds(userId);
  for (const id of packIds) {
    await idbDelete(STORE_PACKS, `${userId}:pack:${id}`);
    await idbDelete(STORE_QUESTIONS, `${userId}:questions:${id}`);
  }
  await idbDelete(STORE_PACKS, `${userId}:pack-index`);
  await idbDelete(STORE_DASHBOARD, `${userId}:dashboard`);
}
