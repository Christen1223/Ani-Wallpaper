async function loadWallpaper() {
    const wallpaper = await getCurrentWallpaper();
    const background = document.getElementById("wallpaper-bg");

    if (!wallpaper) {
        const defaultWallpaper = await selectVibeyWallpaper();
        if (!defaultWallpaper) return;
            background.style.backgroundImage = `url("${defaultWallpaper.value}")`;
            return;
    }
    if (wallpaper.type === "url") {
        background.style.backgroundImage = `url("${wallpaper.value}")`;
    }
    else if (wallpaper.type === "dataUrl") {
        background.style.backgroundImage = `url("${wallpaper.value}")`;
    }
}

let foldersOverlayMode = "manage";
let folderDetailId = null;
let folderImageContext = { folderId: null, imageIndex: -1 };

function normalizeWallpaperEntry(entry) {
  if (!entry) return null;
  if (typeof entry === "string") {
    return { type: entry.startsWith("data:") ? "dataUrl" : "url", value: entry };
  }
  if (entry.value) return { type: entry.type || "url", value: entry.value };
  if (entry.url) return { type: "url", value: entry.url };
  if (entry.dataUrl) return { type: "dataUrl", value: entry.dataUrl };
  return null;
}

function updateClock() {
    const now = new Date();

    const timeElement = document.getElementById("time-display");
    const dateElement = document.getElementById("date-display");

    const hours = now.getHours();
    const minutes = String(now.getMinutes()).padStart(2, "0");
    const amOrPm = hours >= 12 ? "PM" : "AM";
    const hour12Clock = hours % 12 || 12;

    timeElement.textContent = `${hour12Clock}:${minutes} ${amOrPm}`;

    dateElement.textContent = now.toLocaleDateString("en-US", {
        weekday: "long",
        month:   "long",
        day:     "numeric",
    });
}

async function loadWeatherLabel() {
    const settings = await getSettings();
    const weatherDisplay = document.getElementById("weather-display");
    if (!settings.latitude || !settings.longitude) {
      weatherDisplay.textContent = "";
      return;
    }

  const weatherConditions = await fetchWeatherConditions(settings.latitude, settings.longitude);
    const weather = String(weatherConditions[0]).charAt(0).toUpperCase() + String(weatherConditions[0]).slice(1);
    const temperature = weatherConditions[1];
    const unit = "°C";

    const label = settings.locationLabel
      ? `${settings.locationLabel} · ${weather} · ${temperature}${unit}`
      : `${weather} · ${temperature}${unit}`;
    
      weatherDisplay.textContent = label;
}

async function refreshWallpaperNow() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "force-wallpaper-update" }, async (response) => {
      if (chrome.runtime.lastError || !response?.ok) {
        resolve(false);
        return;
      }

      await loadWallpaper();
      await loadWeatherLabel();
      resolve(true);
    });
  });
}

function setFoldersStatus(message = "") {
  const status = document.getElementById("folders-status");
  if (!status) return;
  status.textContent = message;
}

function setFolderDetailStatus(message = "") {
  const status = document.getElementById("folder-detail-status");
  if (!status) return;
  status.textContent = message;
}

function isFoldersOverlayOpen() {
  return !document.getElementById("folders-overlay").classList.contains("hidden");
}

function showFoldersOverlay(mode = "manage") {
  foldersOverlayMode = mode;
  document.getElementById("folders-overlay").classList.remove("hidden");
  renderFoldersGallery();

  if (mode === "pick-current-wallpaper") {
    setFoldersStatus("Select a folder to add the current wallpaper.");
  } else {
    setFoldersStatus("");
  }
}

function hideFoldersOverlay() {
  document.getElementById("folders-overlay").classList.add("hidden");
  foldersOverlayMode = "manage";
  setFoldersStatus("");
}

function showFolderDetailOverlay(folderId) {
  folderDetailId = folderId;
  hideFoldersOverlay();
  document.getElementById("folder-detail-overlay").classList.remove("hidden");
  renderFolderDetailGallery();
}

function hideFolderDetailOverlay() {
  document.getElementById("folder-detail-overlay").classList.add("hidden");
  hideFolderImageContextMenu();
  folderDetailId = null;
  setFolderDetailStatus("");
}

function showFolderImageContextMenu(x, y, folderId, imageIndex) {
  const menu = document.getElementById("folder-image-context-menu");
  if (!menu) return;

  folderImageContext = { folderId, imageIndex };
  menu.style.position = "fixed";
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  menu.classList.remove("hidden");

  const rect = menu.getBoundingClientRect();
  const clampedX = Math.min(x, window.innerWidth - rect.width - 8);
  const clampedY = Math.min(y, window.innerHeight - rect.height - 8);
  menu.style.left = `${Math.max(8, clampedX)}px`;
  menu.style.top = `${Math.max(8, clampedY)}px`;
}

function hideFolderImageContextMenu() {
  const menu = document.getElementById("folder-image-context-menu");
  if (!menu) return;
  menu.classList.add("hidden");
}

async function pickDestinationFolder(currentFolderId, actionLabel) {
  const folders = await getFolders();
  const options = folders.filter((f) => f.id !== currentFolderId);
  if (!options.length) {
    setFolderDetailStatus("⚠️ No other folders available.");
    return null;
  }

  const listing = options.map((f, i) => `${i + 1}. ${f.name}`).join("\n");
  const picked = window.prompt(`Choose destination folder to ${actionLabel}:\n${listing}\n\nEnter number:`);
  if (!picked) return null;

  const index = Number(picked) - 1;
  if (!Number.isInteger(index) || index < 0 || index >= options.length) {
    setFolderDetailStatus("⚠️ Invalid folder selection.");
    return null;
  }

  return options[index].id;
}

async function removeImageFromFolder(folderId, imageIndex) {
  const folders = await getFolders();
  const folderIndex = folders.findIndex((f) => f.id === folderId);
  if (folderIndex < 0) return false;

  const folder = folders[folderIndex];
  const images = Array.isArray(folder.images) ? [...folder.images] : [];
  if (imageIndex < 0 || imageIndex >= images.length) return false;

  images.splice(imageIndex, 1);
  folders[folderIndex] = { ...folder, images };
  await saveFolders(folders);
  return true;
}

async function copyImageToFolder(sourceFolderId, imageIndex, targetFolderId) {
  const folders = await getFolders();
  const source = folders.find((f) => f.id === sourceFolderId);
  if (!source) return false;

  const sourceImages = Array.isArray(source.images) ? source.images : [];
  if (imageIndex < 0 || imageIndex >= sourceImages.length) return false;

  const entry = normalizeWallpaperEntry(sourceImages[imageIndex]);
  if (!entry || !entry.value) return false;

  return await addImageToFolder(targetFolderId, entry);
}

async function moveImageToFolder(sourceFolderId, imageIndex, targetFolderId) {
  const copied = await copyImageToFolder(sourceFolderId, imageIndex, targetFolderId);
  if (!copied) return false;

  return await removeImageFromFolder(sourceFolderId, imageIndex);
}

async function setFolderImageAsActiveWallpaper(folderId, imageIndex) {
  const folders = await getFolders();
  const folder = folders.find((f) => f.id === folderId);
  if (!folder) return false;

  const images = Array.isArray(folder.images) ? folder.images : [];
  if (imageIndex < 0 || imageIndex >= images.length) return false;

  const entry = normalizeWallpaperEntry(images[imageIndex]);
  if (!entry || !entry.value) return false;

  await saveCurrentWallpaper(entry);
  await loadWallpaper();
  return true;
}

async function renderFolderDetailGallery() {
  const gallery = document.getElementById("folder-images-gallery");
  const title = document.getElementById("folder-detail-title");
  if (!gallery || !folderDetailId) return;

  const folders = await getFolders();
  const folder = folders.find((f) => f.id === folderDetailId);
  if (!folder) {
    hideFolderDetailOverlay();
    return;
  }

  title.textContent = folder.name || "Folder";
  const images = Array.isArray(folder.images) ? folder.images : [];

  if (!images.length) {
    gallery.innerHTML = `<div class="folder-card"><div class="folder-name">No images in this folder</div></div>`;
    return;
  }

  const cards = images.map((rawEntry, index) => {
    const entry = normalizeWallpaperEntry(rawEntry);
    const value = entry?.value || "";

    const card = document.createElement("div");
    card.className = "folder-image-card";

    const img = document.createElement("img");
    img.className = "folder-image-thumb";
    img.src = value;
    img.alt = `Folder image ${index + 1}`;

    const caption = document.createElement("div");
    caption.className = "folder-image-caption";
    if (!value) {
      caption.textContent = "Image";
    } else {
      try {
        caption.textContent = new URL(value, window.location.href).hostname || "Image";
      }
      catch {
        caption.textContent = "Image";
      }
    }

    card.appendChild(img);
    card.appendChild(caption);

    card.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      showFolderImageContextMenu(event.clientX, event.clientY, folder.id, index);
    });

    return card;
  });

  gallery.replaceChildren(...cards);
}

async function setActiveFolder(folderId) {
  const settings = await getSettings();
  const modes = Array.isArray(settings.modes) ? [...settings.modes] : [];
  if (!modes.includes(MODE_PERSONAL)) {
    modes.push(MODE_PERSONAL);
  }

  await saveSettings({ activeFolderId: folderId, modes });
  setFoldersStatus("✅ Active folder set and Personal mode enabled.");
  await renderFoldersGallery();
}

async function addCurrentWallpaperToFolder(folderId) {
  const currentWallpaper = await getCurrentWallpaper();
  if (!currentWallpaper || !currentWallpaper.value) {
    setFoldersStatus("⚠️ No wallpaper available to save yet.");
    return;
  }

  if (currentWallpaper.type === "dataUrl") {
    setFoldersStatus("⚠️ This wallpaper can't be saved to cloud folders (data URL). Use URL-based wallpapers.");
    return;
  }

  const ok = await addImageToFolder(folderId, currentWallpaper);
  if (!ok) {
    setFoldersStatus("❌ Could not add wallpaper to folder.");
    return;
  }

  setFoldersStatus("✅ Wallpaper added to folder.");
  await renderFoldersGallery();
}

async function addImageUrlToFolder(folderId) {
  const url = window.prompt("Paste image URL to add:");
  if (!url) return;

  const clean = url.trim();
  if (!clean.startsWith("http://") && !clean.startsWith("https://")) {
    setFoldersStatus("⚠️ Please enter a valid http(s) image URL.");
    return;
  }

  const ok = await addImageToFolder(folderId, { type: "url", value: clean });
  if (!ok) {
    setFoldersStatus("❌ Could not add image URL to folder.");
    return;
  }

  setFoldersStatus("✅ Image URL added to folder.");
  await renderFoldersGallery();
}

async function renderFoldersGallery() {
  const gallery = document.getElementById("folders-gallery");
  const searchInput = document.getElementById("folder-search-input");
  const cardTemplate = document.getElementById("folder-card-template");
  const emptyTemplate = document.getElementById("folder-empty-template");
  if (!gallery) return;

  const settings = await getSettings();
  const folders = await getFolders();
  const query = (searchInput?.value || "").trim().toLowerCase();

  const filtered = folders.filter((folder) => {
    if (!query) return true;
    return String(folder.name || "").toLowerCase().includes(query);
  });

  if (!filtered.length) {
    if (!emptyTemplate) {
      gallery.innerHTML = "";
      return;
    }
    gallery.replaceChildren(emptyTemplate.content.cloneNode(true));
    return;
  }

  if (!cardTemplate) {
    gallery.innerHTML = "";
    return;
  }

  const cards = filtered.map((folder) => {
    const fragment = cardTemplate.content.cloneNode(true);
    const card = fragment.querySelector(".folder-card");
    const title = fragment.querySelector(".folder-name");
    const meta = fragment.querySelector(".folder-meta");
    const primary = fragment.querySelector(".folder-primary-btn");
    const secondary = fragment.querySelector(".folder-secondary-btn");

    const imageCount = Array.isArray(folder.images) ? folder.images.length : 0;
    const name = String(folder.name || "Untitled");

    if (card && settings.activeFolderId === folder.id) {
      card.classList.add("active");
    }

    if (card) {
      card.addEventListener("dblclick", () => {
        showFolderDetailOverlay(folder.id);
      });
    }

    if (title) title.textContent = name;
    if (meta) meta.textContent = `${imageCount} image${imageCount === 1 ? "" : "s"}`;

    if (primary) {
      primary.textContent = foldersOverlayMode === "pick-current-wallpaper" ? "Add current" : "Set active";
      primary.addEventListener("click", async () => {
        if (foldersOverlayMode === "pick-current-wallpaper") {
          await addCurrentWallpaperToFolder(folder.id);
          return;
        }

        await setActiveFolder(folder.id);
      });
    }

    if (secondary) {
      if (foldersOverlayMode === "manage") {
        secondary.classList.remove("hidden");
        secondary.addEventListener("click", async () => {
          await addImageUrlToFolder(folder.id);
        });
      } else {
        secondary.classList.add("hidden");
      }
    }

    return fragment;
  });

  gallery.replaceChildren(...cards);
}

async function handleCreateFolder() {
  const name = window.prompt("Folder name:");
  if (!name) return;

  const folder = await createFolder(name);
  if (!folder) {
    setFoldersStatus("⚠️ Folder name is empty or already exists.");
    return;
  }

  setFoldersStatus(`✅ Created folder: ${folder.name}`);
  await renderFoldersGallery();
}

function bindWallpaperStorageListener() {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;
    if (!changes[STORAGE_KEY_WALLPAPER]) return;

    loadWallpaper();
    loadWeatherLabel();
  });
}

function bindSettingsStorageListener() {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;
    if (!changes[STORAGE_KEY_SETTINGS]) return;

    loadWeatherLabel();
  });
}

function bindFoldersStorageListener() {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" && areaName !== "sync") return;
    if (!changes[STORAGE_KEY_FOLDERS]) return;

    if (isFoldersOverlayOpen()) {
      renderFoldersGallery();
    }

    const detailOverlay = document.getElementById("folder-detail-overlay");
    if (detailOverlay && !detailOverlay.classList.contains("hidden")) {
      renderFolderDetailGallery();
    }
  });
}

async function canCloseSettingsOverlay() {
  const settings = await getSettings();
  const weatherModeEnabled = (settings.modes || []).includes(MODE_WEATHER);
  const hasLocation = Number.isFinite(settings.latitude) && Number.isFinite(settings.longitude);

  if (!weatherModeEnabled || hasLocation) return true;

  const detectStatus = document.getElementById("detect-status");
  if (detectStatus) {
    detectStatus.textContent = "⚠️ Please select a location when Weather mode is enabled.";
  }

  const locationInput = document.getElementById("location-input");
  if (locationInput) {
    locationInput.focus();
  }

  return false;
}

async function tryCloseSettingsOverlay() {
  const canClose = await canCloseSettingsOverlay();
  if (!canClose) return;

  document.getElementById("settings-overlay").classList.add("hidden");
}

function hideWallpaperContextMenu() {
  const menu = document.getElementById("wallpaper-context-menu");
  if (!menu) return;
  menu.classList.add("hidden");
}

function showWallpaperContextMenu(x, y) {
  const menu = document.getElementById("wallpaper-context-menu");
  if (!menu) return;

  menu.style.position = "fixed";
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  menu.classList.remove("hidden");

  const menuRect = menu.getBoundingClientRect();
  const clampedX = Math.min(x, window.innerWidth - menuRect.width - 8);
  const clampedY = Math.min(y, window.innerHeight - menuRect.height - 8);
  menu.style.left = `${Math.max(8, clampedX)}px`;
  menu.style.top = `${Math.max(8, clampedY)}px`;
}

document.getElementById("settings-btn").addEventListener("click", () => {
  document.getElementById("settings-overlay").classList.remove("hidden");
});

document.getElementById("folders-btn").addEventListener("click", async () => {
  showFoldersOverlay("manage");
});

document.getElementById("close-settings-btn").addEventListener("click", async () => {
  await tryCloseSettingsOverlay();
});

document.getElementById("close-folders-btn").addEventListener("click", () => {
  hideFoldersOverlay();
});

document.getElementById("close-folder-detail-btn").addEventListener("click", () => {
  hideFolderDetailOverlay();
  showFoldersOverlay("manage");
});

document.getElementById("create-folder-top-btn").addEventListener("click", async () => {
  await handleCreateFolder();
});

document.getElementById("context-change-wallpaper-btn").addEventListener("click", async () => {
  hideWallpaperContextMenu();
  await refreshWallpaperNow();
});

document.getElementById("context-add-folder-btn").addEventListener("click", () => {
  hideWallpaperContextMenu();
  showFoldersOverlay("pick-current-wallpaper");
});

document.getElementById("wallpaper-context-menu").addEventListener("contextmenu", (e) => {
  e.preventDefault();
});

document.getElementById("folder-image-context-menu").addEventListener("contextmenu", (e) => {
  e.preventDefault();
});

document.getElementById("img-action-delete-btn").addEventListener("click", async () => {
  const { folderId, imageIndex } = folderImageContext;
  hideFolderImageContextMenu();
  const ok = await removeImageFromFolder(folderId, imageIndex);
  setFolderDetailStatus(ok ? "✅ Image removed." : "❌ Failed to remove image.");
  await renderFolderDetailGallery();
  await renderFoldersGallery();
});

document.getElementById("img-action-copy-btn").addEventListener("click", async () => {
  const { folderId, imageIndex } = folderImageContext;
  hideFolderImageContextMenu();
  const destinationId = await pickDestinationFolder(folderId, "copy");
  if (!destinationId) return;

  const ok = await copyImageToFolder(folderId, imageIndex, destinationId);
  setFolderDetailStatus(ok ? "✅ Image copied." : "❌ Failed to copy image.");
  await renderFolderDetailGallery();
  await renderFoldersGallery();
});

document.getElementById("img-action-move-btn").addEventListener("click", async () => {
  const { folderId, imageIndex } = folderImageContext;
  hideFolderImageContextMenu();
  const destinationId = await pickDestinationFolder(folderId, "move");
  if (!destinationId) return;

  const ok = await moveImageToFolder(folderId, imageIndex, destinationId);
  setFolderDetailStatus(ok ? "✅ Image moved." : "❌ Failed to move image.");
  await renderFolderDetailGallery();
  await renderFoldersGallery();
});

document.getElementById("img-action-set-active-btn").addEventListener("click", async () => {
  const { folderId, imageIndex } = folderImageContext;
  hideFolderImageContextMenu();
  const ok = await setFolderImageAsActiveWallpaper(folderId, imageIndex);
  setFolderDetailStatus(ok ? "✅ Active wallpaper updated." : "❌ Failed to set active wallpaper.");
});

document.getElementById("folder-search-input").addEventListener("input", () => {
  renderFoldersGallery();
});

// Close on backdrop click
document.getElementById("settings-overlay").addEventListener("click", async (e) => {
  if (e.target === document.getElementById("settings-overlay")) {
    await tryCloseSettingsOverlay();
  }
});

document.getElementById("folders-overlay").addEventListener("click", (e) => {
  if (e.target === document.getElementById("folders-overlay")) {
    hideFoldersOverlay();
  }
});

document.getElementById("folder-detail-overlay").addEventListener("click", (e) => {
  if (e.target === document.getElementById("folder-detail-overlay")) {
    hideFolderDetailOverlay();
    showFoldersOverlay("manage");
  }
});

document.getElementById("wallpaper-bg").addEventListener("contextmenu", (e) => {
  e.preventDefault();
  showWallpaperContextMenu(e.clientX, e.clientY);
});

document.addEventListener("click", (e) => {
  const menu = document.getElementById("wallpaper-context-menu");
  if (!menu || menu.classList.contains("hidden")) return;
  if (!menu.contains(e.target)) {
    hideWallpaperContextMenu();
  }

  const folderImageMenu = document.getElementById("folder-image-context-menu");
  if (folderImageMenu && !folderImageMenu.classList.contains("hidden") && !folderImageMenu.contains(e.target)) {
    hideFolderImageContextMenu();
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    hideWallpaperContextMenu();
    hideFolderImageContextMenu();

    if (!document.getElementById("folder-detail-overlay").classList.contains("hidden")) {
      hideFolderDetailOverlay();
      showFoldersOverlay("manage");
    }
  }
});

loadWallpaper();
bindWallpaperStorageListener();
bindSettingsStorageListener();
bindFoldersStorageListener();
updateClock();
setInterval(updateClock, 1000);
loadWeatherLabel();