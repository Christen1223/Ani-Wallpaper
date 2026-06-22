async function fetchWeatherConditions(latitude, longitude) {
    try {
        const weatherURL = `${WEATHER_API_BASE}?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,weather_code`;
        const response = await fetch(weatherURL);
        const weatherData = await response.json();
        const weatherCode = weatherData?.current?.weather_code ?? -1;
        const temperature = weatherData?.current?.temperature_2m ?? 100;
        return [weatherCodeToCondition(weatherCode), Math.round(temperature)];
    }
    catch {
        return ["default", null];
    }
}

function weatherCodeToCondition(weatherCode) {
    if (weatherCode == 0)  return "sunny"
    if ([1, 2, 3].includes(weatherCode))   return "cloudy";
    if ([45, 48].includes(weatherCode))    return "foggy";
    if ([51, 53, 55, 61, 63, 65, 80, 81, 82].includes(weatherCode))    return "rainy";
    if ([71, 73, 75, 77, 85, 86].includes(weatherCode))    return "snowy";
    if ([95, 96, 99].includes(weatherCode))    return "stormy";
    return "chill";
}

function getSeason(temp, latitude) {
    const date = new Date();
    const month = date.getMonth();
    
    let season = 
        month >= 2 && month <= 4 ? "spring" :
        month >= 5 && month <= 7 ? "summer" :
        month >= 8 && month <= 10 ? "autumn" :
        "winter";

    if (latitude < 0) {
        if (season === "spring") {season = "autumn"}
        else if (season === "summer") {season = "winter";}
        else if (season === "autumn") {season = "spring";}
        else {season = "summer";}
    }

    if (temp >= 23 && temp <= 50) {season = "summer";}
    if (temp <= 0) {season = "winter";}

    return season;
}

function buildWeatherQuery(weather, timeOfDay, season) {
    if (timeOfDay === "night") {
        let nightWeather = weather;
        if (weather === "sunny" || weather === "cloudy") {
            nightWeather = "chill";
        }
        return `anime ${nightWeather} ${season} ${timeOfDay} wallpaper`;
    }
    else {
        if (timeOfDay === "sunset" && (weather === "sunny" || weather === "cloudy")) {
            return `anime ${season} ${timeOfDay} wallpaper`;
        }
        return `anime ${weather} ${season} ${timeOfDay} wallpaper`;
    }
}

async function searchImgs(searchQuery) {
    try {
        const params = new URLSearchParams({ q: searchQuery });
        const response = await fetch(`${IMAGE_SEARCH_PROXY_BASE}?${params}`);
        const data = await response.json();
        const imgs = Array.isArray(data.images)
            ? data.images.map((url) => ({ original: url }))
            : (data.images_results || []);
        const urls = [];

        for (const img of imgs) {
            const width = img.original_width;
            const height = img.original_height;

            if (width && height) {
                if (width < 1280 || height < 720) continue;
                if (width < height) continue;
            }

            if (img.original) {
                urls.push(img.original);
            }
        }
        if (!urls.length) return [];
        return urls;
    }
    catch {
        return [];
    }
}

async function fetchAndPickImg(searchQuery) {
    const urls = await searchImgs(searchQuery);
    if (!urls.length) return null;
    return await pickValidImg(urls);
}

async function pickValidImg(urls) {
    const shuffled = [...urls].sort(() => Math.random() - 0.5);

    for (const url of shuffled) {
        if (!url.startsWith("https://")) continue;
        const valid = await validateImgUrl(url);
        if (valid) return { type: "url", value: url };
    }

  return null;
}

async function validateImgUrl(url) {
    if (typeof Image === "undefined") {
        try {
            const response = await fetch(url, { method: "HEAD" });
            if (response.ok) return true;

            const fallbackResponse = await fetch(url);
            return fallbackResponse.ok;
        }
        catch {
            return false;
        }
    }

    return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload  = () => resolve(true);
        img.onerror = () => resolve(false);
        setTimeout(() => resolve(false), 5000);
        img.src = url;
    });
}

async function selectWeatherWallpaper(settings) {
    if (!settings.latitude || !settings.longitude) {
        return selectVibeyWallpaper();
    }

    const weatherConditions = await fetchWeatherConditions(settings.latitude, settings.longitude);
    const weather = weatherConditions[0];

    if (weather === "default") {
        return selectVibeyWallpaper();
    }
    else {
        const now = new Date();
        const hours = now.getHours();
        let timeOfDay = "";

        if (hours >= 5 && hours < 17) {timeOfDay = "day";}
        else if (hours >= 17 && hours < 20) {timeOfDay = "sunset";}
        else {timeOfDay = "night";}

        const temperature = weatherConditions[1] ?? 20;
        const season = getSeason(temperature, settings.latitude);
        const weatherSearchQuery = buildWeatherQuery(weather, timeOfDay, season);
        return await fetchAndPickImg(weatherSearchQuery);
    }
}

async function selectVibeyWallpaper() {
    const vibePrompt = "chill anime wallpaper";
    return await fetchAndPickImg(vibePrompt);
}

async function selectSearchWallpaper(searchPrompt = "anime wallpaper") {
    if (searchPrompt === "") {
        return await selectVibeyWallpaper();
    }
    return await fetchAndPickImg(searchPrompt);
}

function selectPersonalWallpaper(settings, folders) {
    if (!Array.isArray(folders) || !folders.length) return null;

    let folder = folders.find((f) => f.id === settings.activeFolderId);
    if (!folder || !Array.isArray(folder.images) || !folder.images.length) {
        folder = folders.find((f) => Array.isArray(f.images) && f.images.length);
    }
    if (!folder) return null;

    const randomImage = folder.images[Math.floor(Math.random() * folder.images.length)];
    if (!randomImage) return null;

    if (typeof randomImage === "string") {
        const isDataUrl = randomImage.startsWith("data:");
        return { type: isDataUrl ? "dataUrl" : "url", value: randomImage };
    }

    if (typeof randomImage === "object") {
        if (randomImage.value) return { type: randomImage.type || "url", value: randomImage.value };
        if (randomImage.url) return { type: "url", value: randomImage.url };
        if (randomImage.dataUrl) return { type: "dataUrl", value: randomImage.dataUrl };
    }

    return null;
}

async function selectWallpaper(settings, folders) {
    const modes = settings.modes || [MODE_VIBE];

    if (modes.length === 1) {
        return await selectByMode(modes[0], settings, folders);
    }

    const usableModes = modes.filter(mode => {
        if (mode === MODE_PERSONAL) {
            const folder = folders.find(f => f.id === settings.activeFolderId);
            return folder && folder.images.length > 0;
        }
        return true;
    });

    if (!usableModes.length) {
        return await selectVibeyWallpaper();
    }

    const chosen = usableModes[Math.floor(Math.random() * usableModes.length)];
    return await selectByMode(chosen, settings, folders);
}

async function selectByMode(mode, settings, folders) {
    switch (mode) {
        case MODE_WEATHER:  return await selectWeatherWallpaper(settings);
        case MODE_VIBE:     return await selectVibeyWallpaper();
        case MODE_PERSONAL: return selectPersonalWallpaper(settings, folders);
        case MODE_SEARCH:   return await selectSearchWallpaper(settings.searchPrompt || "anime wallpaper");
        default:            return await selectWeatherWallpaper(settings);
    }
}

async function updateWallpaper() {
    const [settings, folders] = await Promise.all([getSettings(), getFolders()]);
    const wallpaper = await selectWallpaper(settings, folders);
    if (!wallpaper) return null;
    await saveCurrentWallpaper(wallpaper);
    return wallpaper;
}

