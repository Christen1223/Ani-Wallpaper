const DEFAULT_SETTINGS = {
    modes:  [MODE_VIBE],
    intervalMinutes:    DEFAULT_INTERVAL_MINUTES,
    locationLabel:  "",
    latitude:   null,
    longitude:  null,
    activeFolderId: null,
    searchPrompt: "",
};

function createFolderRecord(name) {
  return {
    id: (globalThis.crypto && crypto.randomUUID) ? crypto.randomUUID() : `folder_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name,
    images: [],
    createdAt: Date.now(),
  };
}

async function getSettings() {
    return new Promise((resolve) => {
        chrome.storage.local.get(STORAGE_KEY_SETTINGS, (result) => {
            resolve({ ...DEFAULT_SETTINGS, ...(result[STORAGE_KEY_SETTINGS] || {}) });
        });
    })
}

async function saveSettings(partial) {
  const current = await getSettings();
  const updated = { ...current, ...partial };
  return new Promise((resolve) => {
    chrome.storage.local.set({ [STORAGE_KEY_SETTINGS]: updated }, resolve);
  });
}

async function getCurrentWallpaper() {
  return new Promise((resolve) => {
    chrome.storage.local.get(STORAGE_KEY_WALLPAPER, (result) => {
      resolve(result[STORAGE_KEY_WALLPAPER] || null);
    });
  });
}

async function saveCurrentWallpaper(wallpaperData) {
  // wallpaperData: { type: "url"|"dataUrl", value: string }
  return new Promise((resolve) => {
    chrome.storage.local.set({ [STORAGE_KEY_WALLPAPER]: wallpaperData }, resolve);
  });
}

async function getFolders() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(STORAGE_KEY_FOLDERS, (syncResult) => {
      const syncFolders = syncResult[STORAGE_KEY_FOLDERS];
      if (Array.isArray(syncFolders) && syncFolders.length) {
        resolve(syncFolders);
        return;
      }

      chrome.storage.local.get(STORAGE_KEY_FOLDERS, (localResult) => {
        const localFolders = localResult[STORAGE_KEY_FOLDERS] || [];

        if (Array.isArray(localFolders) && localFolders.length) {
          chrome.storage.sync.set({ [STORAGE_KEY_FOLDERS]: localFolders }, () => {
            resolve(localFolders);
          });
          return;
        }

        resolve([]);
      });
    });
  });
}

async function saveFolders(folders) {
  const safeFolders = Array.isArray(folders) ? folders : [];

  return new Promise((resolve) => {
    chrome.storage.sync.set({ [STORAGE_KEY_FOLDERS]: safeFolders }, () => {
      chrome.storage.local.set({ [STORAGE_KEY_FOLDERS]: safeFolders }, resolve);
    });
  });
}

async function createFolder(name) {
  const cleanName = String(name || "").trim();
  if (!cleanName) return null;

  const folders = await getFolders();
  const exists = folders.some((folder) => String(folder.name || "").toLowerCase() === cleanName.toLowerCase());
  if (exists) return null;

  const folder = createFolderRecord(cleanName);
  const updated = [folder, ...folders];
  await saveFolders(updated);
  return folder;
}

async function addImageToFolder(folderId, wallpaperEntry) {
  if (!folderId || !wallpaperEntry || !wallpaperEntry.value) return false;

  const folders = await getFolders();
  const index = folders.findIndex((folder) => folder.id === folderId);
  if (index < 0) return false;

  const folder = folders[index];
  const existing = Array.isArray(folder.images) ? folder.images : [];
  const duplicate = existing.some((img) => {
    if (typeof img === "string") return img === wallpaperEntry.value;
    return img && img.value === wallpaperEntry.value;
  });

  if (duplicate) return true;

  const nextImages = [...existing, { type: wallpaperEntry.type || "url", value: wallpaperEntry.value }];
  folders[index] = { ...folder, images: nextImages };
  await saveFolders(folders);
  return true;
}