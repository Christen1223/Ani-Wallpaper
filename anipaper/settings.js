let settings = null;
let folders = [];
let locationSearchTimer = null;
let locationSearchBound = false;

function buildIntervalDropdown() {
    const selection = document.getElementById("interval-select");
    INTERVALS.forEach(({ label, minutes }) => {
        const option = document.createElement("option");
        option.value = minutes;
        option.textContent = label;
        if (minutes === settings.intervalMinutes) option.selected = true;
        selection.appendChild(option);
    })
}

function renderModeToggles() {
  document.querySelectorAll(".toggle-btn").forEach((checkbox) => {
    // If the checkbox's mode is in the settings array, check it. Otherwise, uncheck it.
    checkbox.checked = settings.modes.includes(checkbox.dataset.mode);
  });
}

function renderPersonalFolderDropdown() {
    const select = document.getElementById("personal-folder-select");
    if (!select) return;

    select.innerHTML = "";

    const defaultOption = document.createElement("option");
    defaultOption.value = "";
    defaultOption.textContent = folders.length ? "Select a folder..." : "No folders available";
    select.appendChild(defaultOption);

    folders.forEach((folder) => {
        const option = document.createElement("option");
        option.value = folder.id;
        option.textContent = folder.name;
        select.appendChild(option);
    });

    select.value = settings.activeFolderId || "";
    select.disabled = folders.length === 0;
}

function renderConditionalSections() {
    const modes = settings.modes;

    const showLocation = modes.includes(MODE_WEATHER);
    document.getElementById("location-section").style.display = showLocation ? "flex" : "none";

    if (showLocation && settings.locationLabel) {
        document.getElementById("location-input").value = settings.locationLabel;
    }

    const showFolders = modes.includes(MODE_PERSONAL);
    document.getElementById("folders-section").style.display = showFolders ? "block" : "none";

    renderPersonalFolderDropdown();

    const activeFolderNameElement = document.getElementById("active-folder-name");
    if (activeFolderNameElement) {
        const activeFolder = folders.find((folder) => folder.id === settings.activeFolderId);
        activeFolderNameElement.textContent = activeFolder
            ? `✅ Active: ${activeFolder.name}`
            : "✅ Active: None";
    }

    const showSearch = modes.includes(MODE_SEARCH);
    document.getElementById("search-section").style.display = showSearch ? "block" : "none";

    if (showSearch) {
        const searchInput = document.getElementById("search-input");
        if (searchInput && typeof settings.searchPrompt === "string") {
            searchInput.value = settings.searchPrompt;
        }
    }
}

function bindEvents() {
    document.querySelectorAll(".toggle-btn").forEach((btn) => {
        btn.addEventListener("change", async () => {
            const mode = btn.dataset.mode;
            if (!mode) return;

            if (btn.checked) {
                if (!settings.modes.includes(mode)) settings.modes.push(mode);
            }
            else {
                settings.modes = settings.modes.filter((m) => m !== mode);
            }
            await saveSettings({ modes: settings.modes });
            renderConditionalSections();
        });
    });

    const intervalSelect = document.getElementById("interval-select");
    if (intervalSelect) {
        intervalSelect.addEventListener("change", async () => {
            const minutes = Number(intervalSelect.value);
            if (!Number.isFinite(minutes) || minutes <= 0) return;

            settings.intervalMinutes = minutes;
            await saveSettings({ intervalMinutes: minutes });
        });
    }

    const searchInput = document.getElementById("search-input");
    if (searchInput) {
        searchInput.addEventListener("change", async () => {
            const prompt = searchInput.value.trim();
            settings.searchPrompt = prompt;
            await saveSettings({ searchPrompt: prompt });
        });
    }

    const personalFolderSelect = document.getElementById("personal-folder-select");
    if (personalFolderSelect) {
        personalFolderSelect.addEventListener("change", async () => {
            const selectedFolderId = personalFolderSelect.value || null;
            settings.activeFolderId = selectedFolderId;

            const modes = Array.isArray(settings.modes) ? [...settings.modes] : [];
            if (selectedFolderId && !modes.includes(MODE_PERSONAL)) {
                modes.push(MODE_PERSONAL);
            }
            settings.modes = modes;

            await saveSettings({
                activeFolderId: selectedFolderId,
                modes,
            });
            renderModeToggles();
            renderConditionalSections();
        });
    }
}

function bindStorageListeners() {
    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== "local" && areaName !== "sync") return;

        if (areaName === "local" && changes[STORAGE_KEY_SETTINGS]?.newValue) {
            settings = { ...settings, ...changes[STORAGE_KEY_SETTINGS].newValue };
            renderModeToggles();
            renderConditionalSections();
        }

        if (changes[STORAGE_KEY_FOLDERS]?.newValue) {
            folders = Array.isArray(changes[STORAGE_KEY_FOLDERS].newValue)
                ? changes[STORAGE_KEY_FOLDERS].newValue
                : folders;
            renderConditionalSections();
        }
    });
}

function formatSearchResultLocation(result = {}) {
    const city = result.name || "";
    const region = result.admin1 || result.admin2 || "";
    const country = result.country || "";

    return [city, region, country].filter(Boolean).join(", ") || "Unknown Location";
}

function clearLocationSuggestions() {
    const suggestionsList = document.getElementById("location-suggestions");
    if (!suggestionsList) return;

    suggestionsList.innerHTML = "";
}

function renderLocationSuggestions(results = []) {
    const suggestionsList = document.getElementById("location-suggestions");
    if (!suggestionsList) return;

    suggestionsList.innerHTML = "";

    results.forEach((result) => {
        const item = document.createElement("li");
        item.className = "location-suggestion";
        item.textContent = formatSearchResultLocation(result);
        item.addEventListener("mousedown", async (event) => {
            event.preventDefault();

            const formattedLocation = formatSearchResultLocation(result);
            const latitude = result.latitude;
            const longitude = result.longitude;

            document.getElementById("location-input").value = formattedLocation;
            settings.latitude = latitude;
            settings.longitude = longitude;
            settings.locationLabel = formattedLocation;

            await saveSettings({
                latitude,
                longitude,
                locationLabel: formattedLocation,
            });

            clearLocationSuggestions();
            document.getElementById("detect-status").textContent = `✅ Selected: ${formattedLocation}`;
        });

        suggestionsList.appendChild(item);
    });
}

async function searchLocationSuggestions(query) {
    const trimmedQuery = query.trim();
    if (trimmedQuery.length < 2) {
        clearLocationSuggestions();
        return;
    }

    try {
        const params = new URLSearchParams({
            name: trimmedQuery,
            count: "5",
            language: "en",
            format: "json",
        });

        const response = await fetch(`https://geocoding-api.open-meteo.com/v1/search?${params}`);
        const data = await response.json();
        renderLocationSuggestions(data.results || []);
    }
    catch (error) {
        console.error("Error searching locations:", error);
        clearLocationSuggestions();
    }
}

function bindLocationSearch() {
    if (locationSearchBound) return;

    const locationInput = document.getElementById("location-input");
    if (!locationInput) return;

    locationSearchBound = true;

    locationInput.addEventListener("input", () => {
        const query = locationInput.value;

        window.clearTimeout(locationSearchTimer);
        locationSearchTimer = window.setTimeout(() => {
            searchLocationSuggestions(query);
        }, 300);
    });

    locationInput.addEventListener("focus", () => {
        if (locationInput.value.trim().length >= 2) {
            searchLocationSuggestions(locationInput.value);
        }
    });
}

function formatDetectedLocation(address = {}) {
    const city = address.city || address.town || address.village || address.hamlet || address.suburb || "";
    const region = address.state || address.province || address.region || address.county || "";
    const country = address.country || "";

    return [city, region, country].filter(Boolean).join(", ") || "Unknown Location";
}

function locationButtonOnClick() {
    const detectLocationBtn = document.getElementById('detect-location-btn');
    const locationInput = document.getElementById('location-input');
    const detectStatus = document.getElementById('detect-status');

    if (detectLocationBtn.dataset.bound === "true") return;
    detectLocationBtn.dataset.bound = "true";

    detectLocationBtn.addEventListener('click', () => {
        if (!navigator.geolocation) {
            detectStatus.textContent = "❌ Geolocation is not supported by your browser.";
            return;
        }

        detectStatus.textContent = "📍 Detecting location...";
        detectLocationBtn.disabled = true;

        navigator.geolocation.getCurrentPosition(
            async (position) => {
                const latitude = position.coords.latitude;
                const longitude = position.coords.longitude;

                try {
                    const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&zoom=10&addressdetails=1`);
                    const data = await response.json();

                    const formattedLocation = formatDetectedLocation(data.address);

                    locationInput.value = formattedLocation;
                    settings.latitude = latitude;
                    settings.longitude = longitude;
                    settings.locationLabel = formattedLocation;
                    await saveSettings({
                        latitude,
                        longitude,
                        locationLabel: formattedLocation,
                    });

                    locationInput.dispatchEvent(new Event('input'));

                    detectStatus.textContent = `✅ Found: ${formattedLocation}`;
                }
                catch (error) {
                    console.error("Error fetching city name:", error);
                    locationInput.value = `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
                    detectStatus.textContent = "⚠️ Couldn't resolve city name. Used coordinates.";
                }
                finally {
                    detectLocationBtn.disabled = false;
                }
            },
            (error) => {
                detectLocationBtn.disabled = false;
                switch(error.code) {
                    case error.PERMISSION_DENIED:
                        detectStatus.textContent = "❌ Permission denied. Please allow location access.";
                        break;
                    case error.POSITION_UNAVAILABLE:
                        detectStatus.textContent = "❌ Location information is unavailable.";
                        break;
                    case error.TIMEOUT:
                        detectStatus.textContent = "❌ Location request timed out.";
                        break;
                    default:
                        detectStatus.textContent = "❌ An unknown error occurred.";
                        break;
                }
            },
            {
                enableHighAccuracy: true,
                timeout: 5000,
                maximumAge: 0
            }
        );
    });
}

document.addEventListener("DOMContentLoaded", async () => {
    [settings, folders] = await Promise.all([getSettings(), getFolders()]);

    buildIntervalDropdown();
    renderModeToggles();
    bindLocationSearch();
    locationButtonOnClick();
    renderConditionalSections();
    bindEvents();
    bindStorageListeners();
})