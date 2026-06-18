const WEATHER_API_BASE = "https://api.open-meteo.com/v1/forecast";
const SERPAPI_BASE = "https://serpapi.com/search.json";

const MODE_WEATHER  = "weather";
const MODE_VIBE     = "vibe";
const MODE_PERSONAL = "personal";
const MODE_SEARCH    = "search";

const INTERVALS = [
    { label: "30 minutes", minutes: 30  },
    { label: "1 hour",     minutes: 60  },
    { label: "2 hours",    minutes: 120 },
];
const DEFAULT_INTERVAL_MINUTES = 30;

const STORAGE_KEY_SETTINGS  = "ww_settings";
const STORAGE_KEY_FOLDERS   = "ww_folders";
const STORAGE_KEY_WALLPAPER = "ww_current_wallpaper";

