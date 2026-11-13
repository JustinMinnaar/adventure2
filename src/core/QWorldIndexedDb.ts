const DB_NAME = 'adventure2_world_db';
const STORE_NAME = 'worlds';
const DEFAULT_KEY = 'active_world';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export class QWorldIndexedDb {
  public static async saveActiveWorld(json: string): Promise<void> {
    if (typeof indexedDB === 'undefined') return;
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(json, DEFAULT_KEY);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    });
  }

  public static async loadActiveWorld(): Promise<string | null> {
    if (typeof indexedDB === 'undefined') return null;
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(DEFAULT_KEY);
      req.onsuccess = () => {
        db.close();
        resolve((req.result as string | undefined) ?? null);
      };
      req.onerror = () => {
        db.close();
        reject(req.error);
      };
    });
  }
}
