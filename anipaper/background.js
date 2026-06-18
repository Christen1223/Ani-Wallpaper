importScripts("constants.js", "storage.js", "wallpaper_logic.js");

const WALLPAPER_ALARM = "wallpaper-rotate";
let lastRunAt = 0;

async function scheduleWallpaperAlarm() {
  const settings = await getSettings();
  const intervalMinutes = Number(settings.intervalMinutes) || DEFAULT_INTERVAL_MINUTES;

  await chrome.alarms.clear(WALLPAPER_ALARM);
  chrome.alarms.create(WALLPAPER_ALARM, {
    delayInMinutes: intervalMinutes,
    periodInMinutes: intervalMinutes,
  });
}

async function runWallpaperUpdate(force = false) {
  const now = Date.now();
  if (!force && now - lastRunAt < 10000) return;
  lastRunAt = now;

  try {
    return await updateWallpaper();
  } catch (error) {
    console.error("Wallpaper update failed:", error);
    return null;
  }
}

async function runInitialIfEmpty() {
  const currentWallpaper = await getCurrentWallpaper();
  if (!currentWallpaper) {
    await runWallpaperUpdate();
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  await scheduleWallpaperAlarm();
  await runInitialIfEmpty();
});

chrome.runtime.onStartup.addListener(async () => {
  await scheduleWallpaperAlarm();
  await runInitialIfEmpty();
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== WALLPAPER_ALARM) return;
  await runWallpaperUpdate();
});

chrome.storage.onChanged.addListener(async (changes, areaName) => {
  if (areaName !== "local" || !changes[STORAGE_KEY_SETTINGS]) return;

  await scheduleWallpaperAlarm();
  await runInitialIfEmpty();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== "force-wallpaper-update") return;

  (async () => {
    const wallpaper = await runWallpaperUpdate(true);
    sendResponse({ ok: Boolean(wallpaper), wallpaper });
  })();

  return true;
});
