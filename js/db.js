// MBBS Attendance Tracker - Native IndexedDB Data Access Layer
// 100% offline local persistence with zero cloud dependency

const DB_NAME = 'mbbs_attendance_db';
const DB_VERSION = 1;

let dbInstance = null;

export const DBService = {
  async getDB() {
    if (dbInstance) return dbInstance;
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // 1. Subjects store
        if (!db.objectStoreNames.contains('subjects')) {
          db.createObjectStore('subjects', { keyPath: 'id' });
        }

        // 2. Timetable Versions store
        if (!db.objectStoreNames.contains('timetable_versions')) {
          db.createObjectStore('timetable_versions', { keyPath: 'id' });
        }

        // 3. Posting Rotations store
        if (!db.objectStoreNames.contains('posting_rotations')) {
          db.createObjectStore('posting_rotations', { keyPath: 'id' });
        }

        // 4. Ground Truth Sessions store
        if (!db.objectStoreNames.contains('sessions')) {
          const sessionStore = db.createObjectStore('sessions', { keyPath: 'id' });
          sessionStore.createIndex('date', 'date', { unique: false });
          sessionStore.createIndex('subjectId', 'subjectId', { unique: false });
          sessionStore.createIndex('postingRotationId', 'postingRotationId', { unique: false });
        }

        // 5. Date Overrides (Holidays, swaps)
        if (!db.objectStoreNames.contains('date_overrides')) {
          db.createObjectStore('date_overrides', { keyPath: 'date' });
        }

        // 6. App Settings (Theme, thresholds, safety buffer)
        if (!db.objectStoreNames.contains('app_settings')) {
          db.createObjectStore('app_settings', { keyPath: 'key' });
        }
      };

      request.onsuccess = (event) => {
        dbInstance = event.target.result;
        // Request persistent storage if supported
        if (navigator.storage && navigator.storage.persist) {
          navigator.storage.persist().catch(() => {});
        }
        resolve(dbInstance);
      };

      request.onerror = (event) => {
        console.error('IndexedDB error:', event.target.error);
        reject(event.target.error);
      };
    });
  },

  // Generic Helpers
  async getAll(storeName) {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  },

  async getById(storeName, id) {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  },

  async put(storeName, item) {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const req = store.put(item);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },

  async putBatch(storeName, items) {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      items.forEach((item) => store.put(item));
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  },

  async delete(storeName, id) {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const req = store.delete(id);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  },

  async clearStore(storeName) {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const req = store.clear();
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  },

  // Subjects
  async getSubjects() {
    const list = await this.getAll('subjects');
    return list.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
  },

  async saveSubject(subject) {
    if (!subject.id) {
      subject.id = 'subj_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
    }
    await this.put('subjects', subject);
    return subject;
  },

  async deleteSubject(id) {
    return this.delete('subjects', id);
  },

  // Sessions
  async getAllSessions() {
    return this.getAll('sessions');
  },

  async getSessionsForDate(dateStr) {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('sessions', 'readonly');
      const store = tx.objectStore('sessions');
      const index = store.index('date');
      const req = index.getAll(dateStr);
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  },

  async saveSession(session) {
    session.updatedAt = new Date().toISOString();
    return this.put('sessions', session);
  },

  async saveSessionsBatch(sessions) {
    const now = new Date().toISOString();
    sessions.forEach(s => s.updatedAt = now);
    return this.putBatch('sessions', sessions);
  },

  // Timetable
  async getTimetableVersions() {
    const versions = await this.getAll('timetable_versions');
    return versions.sort((a, b) => a.effectiveStartDate.localeCompare(b.effectiveStartDate));
  },

  async saveTimetableVersion(version) {
    if (!version.id) {
      version.id = 'tt_' + Date.now();
    }
    return this.put('timetable_versions', version);
  },

  async deleteTimetableVersion(id) {
    return this.delete('timetable_versions', id);
  },

  // Posting Rotations
  async getPostingRotations() {
    const list = await this.getAll('posting_rotations');
    return list.sort((a, b) => a.startDate.localeCompare(b.startDate));
  },

  async savePostingRotation(rotation) {
    if (!rotation.id) {
      rotation.id = 'rot_' + Date.now();
    }
    return this.put('posting_rotations', rotation);
  },

  async deletePostingRotation(id) {
    return this.delete('posting_rotations', id);
  },

  // Date Overrides
  async getDateOverrides() {
    return this.getAll('date_overrides');
  },

  async getDateOverride(dateStr) {
    return this.getById('date_overrides', dateStr);
  },

  async saveDateOverride(override) {
    return this.put('date_overrides', override);
  },

  // Settings
  async getSetting(key, defaultValue = null) {
    const record = await this.getById('app_settings', key);
    return record ? record.value : defaultValue;
  },

  async saveSetting(key, value) {
    return this.put('app_settings', { key, value, updatedAt: new Date().toISOString() });
  },

  // Full Export ("Back Up My Data")
  async exportFullBackup() {
    const backup = {
      app: 'MBBS Attendance Tracker',
      version: '1.0.0',
      exportDate: new Date().toISOString(),
      data: {
        subjects: await this.getAll('subjects'),
        timetable_versions: await this.getAll('timetable_versions'),
        posting_rotations: await this.getAll('posting_rotations'),
        sessions: await this.getAll('sessions'),
        date_overrides: await this.getAll('date_overrides'),
        app_settings: await this.getAll('app_settings')
      }
    };
    return backup;
  },

  // Validated Import ("Restore Backup")
  async validateBackupFile(backup) {
    if (!backup || typeof backup !== 'object') {
      throw new Error('Invalid backup file: not a JSON object.');
    }
    if (!backup.data || typeof backup.data !== 'object') {
      throw new Error('Invalid backup file: missing "data" container.');
    }
    const requiredStores = ['subjects', 'timetable_versions', 'posting_rotations', 'sessions'];
    for (const store of requiredStores) {
      if (!Array.isArray(backup.data[store])) {
        throw new Error(`Corrupted backup file: store "${store}" is missing or invalid.`);
      }
    }
    return {
      isValid: true,
      summary: {
        exportDate: backup.exportDate || 'Unknown',
        subjectCount: backup.data.subjects.length,
        sessionCount: backup.data.sessions.length,
        timetableCount: backup.data.timetable_versions.length,
        rotationCount: backup.data.posting_rotations.length
      }
    };
  },

  async restoreFullBackup(backup) {
    await this.validateBackupFile(backup);
    const stores = ['subjects', 'timetable_versions', 'posting_rotations', 'sessions', 'date_overrides', 'app_settings'];
    
    // Clear and restore atomically
    for (const store of stores) {
      await this.clearStore(store);
      if (backup.data[store] && backup.data[store].length > 0) {
        await this.putBatch(store, backup.data[store]);
      }
    }
    await this.saveSetting('lastBackupRestored', new Date().toISOString());
    return true;
  },

  /**
   * Safely and atomically clears the 5 operational data stores:
   * (sessions, date_overrides, subjects, posting_rotations, timetable_versions)
   * within a single readwrite transaction.
   * Strictly preserves app_settings (theme, thresholds, safety buffer, etc.).
   * Never calls indexedDB.deleteDatabase() or alters the database schema.
   */
  async resetApplicationData({ preserveSettings = true } = {}) {
    const db = await this.getDB();
    const storesToClear = [
      'sessions',
      'date_overrides',
      'subjects',
      'posting_rotations',
      'timetable_versions'
    ];

    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(storesToClear, 'readwrite');

        tx.onerror = (event) => {
          console.error('Reset transaction failed:', tx.error || event.target?.error);
          reject(tx.error || new Error('Reset transaction aborted'));
        };

        tx.oncomplete = () => {
          resolve(true);
        };

        for (const storeName of storesToClear) {
          const store = tx.objectStore(storeName);
          store.clear();
        }
      } catch (err) {
        reject(err);
      }
    });
  },

  // Reset/Clear for acceptance testing
  async clearAllData() {
    const stores = ['subjects', 'timetable_versions', 'posting_rotations', 'sessions', 'date_overrides', 'app_settings'];
    for (const store of stores) {
      await this.clearStore(store);
    }
    return true;
  }
};
