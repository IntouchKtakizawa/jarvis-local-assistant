const CONDITIONS = {
  0: ["Clear sky", "☀"],
  1: ["Mostly clear", "🌤"],
  2: ["Partly cloudy", "⛅"],
  3: ["Overcast", "☁"],
  45: ["Fog", "🌫"],
  48: ["Freezing fog", "🌫"],
  51: ["Light drizzle", "🌦"],
  53: ["Drizzle", "🌦"],
  55: ["Heavy drizzle", "🌧"],
  56: ["Freezing drizzle", "🌧"],
  57: ["Freezing drizzle", "🌧"],
  61: ["Light rain", "🌧"],
  63: ["Rain", "🌧"],
  65: ["Heavy rain", "🌧"],
  66: ["Freezing rain", "🌧"],
  67: ["Freezing rain", "🌧"],
  71: ["Light snow", "🌨"],
  73: ["Snow", "🌨"],
  75: ["Heavy snow", "🌨"],
  77: ["Snow grains", "🌨"],
  80: ["Light showers", "🌦"],
  81: ["Showers", "🌧"],
  82: ["Heavy showers", "🌧"],
  85: ["Snow showers", "🌨"],
  86: ["Heavy snow showers", "🌨"],
  95: ["Thunderstorm", "⛈"],
  96: ["Thunderstorm with hail", "⛈"],
  99: ["Thunderstorm with hail", "⛈"],
};
export function condition(code) {
  const [label, icon] = CONDITIONS[code] || ["Conditions unavailable", "◌"];
  return { label, icon };
}
const weatherWords =
  /\b(weather|forecast|temperature|temp|rain|raining|hot|cold|sunny|umbrella)\b/i;
function cityFrom(text) {
  let match = text.match(
    /\b(?:in|for|at)\s+([\p{L}][\p{L}\s.,'-]*?)(?=\s+(?:today|tomorrow|tonight|this|next|right now|please|and|with|over)\b|[?!]|$)/iu,
  );
  if (!match)
    match = text.match(
      /\b(?:weather|forecast|temperature|temp)\s+(?:in\s+)?([\p{L}][\p{L}\s.,'-]*?)(?=\s+(?:today|tomorrow|tonight|this|next|please)\b|[?!]|$)/iu,
    );
  const city = match?.[1]?.trim().replace(/[.,]+$/, "");
  if (
    !city ||
    /^(?:like|today|tomorrow|right now|this week|next week|is|will|be|now|here|me|my location|the next)/i.test(
      city,
    ) ||
    city.length > 90
  )
    return null;
  return city;
}
export function weatherQuery(messages, defaultCity = "Bangkok") {
  const text = messages.at(-1)?.content || "";
  if (
    /\b(?:explain|tell me about|what is|how does)\s+(?:the\s+)?(?:weather|rain|forecasting)\b/i.test(
      text,
    ) &&
    !/\b(?:today|tomorrow|tonight|in|for|at|now)\b/i.test(text)
  )
    return null;
  const recent = messages
    .slice(0, -1)
    .filter((m) => m.role === "user")
    .reverse()
    .find((m) => weatherWords.test(m.content));
  if (
    !weatherWords.test(text) &&
    !(
      recent &&
      /^(?:and\s+|what about\s+|how about\s+)?(?:tomorrow|today|tonight|this week|next week|the weekend)[?!.\s]*$/i.test(
        text.trim(),
      )
    )
  )
    return null;
  if (
    /\b(?:code|api|implement|build|write|design|poem|story)\b/i.test(text) &&
    !/^show\b/i.test(text)
  )
    return null;
  return {
    city: cityFrom(text) || cityFrom(recent?.content || "") || defaultCity,
    day: /\btomorrow\b/i.test(text) ? 1 : 0,
    fahrenheit: /\bfahrenheit\b|°f\b/i.test(text),
  };
}
const n = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
export class WeatherProvider {
  constructor({ fetcher = fetch, now = Date.now } = {}) {
    this.fetch = fetcher;
    this.now = now;
    this.cache = new Map();
  }
  async json(url, signal) {
    const r = await this.fetch(url, {
      signal,
      redirect: "error",
      headers: { Accept: "application/json" },
    });
    if (!r.ok) throw new Error(`Weather service unavailable (${r.status}).`);
    const data = await r.json();
    if (data.error)
      throw new Error("Weather service could not return a forecast.");
    return data;
  }
  async lookup(input, signal) {
    const key = input.city.toLowerCase() + ":" + input.fahrenheit;
    const cached = this.cache.get(key);
    if (cached && this.now() - cached.saved < 300000)
      return { ...cached.data, selectedDay: input.day };
    const bounded = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(12000)])
      : AbortSignal.timeout(12000);
    const geo = new URL("https://geocoding-api.open-meteo.com/v1/search");
    geo.search = new URLSearchParams({
      name: input.city.split(",")[0].trim(),
      count: "5",
      language: "en",
      format: "json",
    });
    const places = (await this.json(geo, bounded)).results || [];
    const qualifier = input.city
      .split(",")
      .slice(1)
      .join(",")
      .trim()
      .toLowerCase();
    const place = qualifier
      ? places.find((p) =>
          [p.country, p.admin1, p.country_code].some(
            (v) => v?.toLowerCase() === qualifier,
          ),
        )
      : places[0];
    if (
      !place ||
      !Number.isFinite(place.latitude) ||
      !Number.isFinite(place.longitude)
    )
      throw new Error(
        `I couldn’t find “${input.city}”. Try a city and country, such as Bangkok, Thailand.`,
      );
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.search = new URLSearchParams({
      latitude: String(place.latitude),
      longitude: String(place.longitude),
      timezone: "auto",
      forecast_days: "7",
      temperature_unit: input.fahrenheit ? "fahrenheit" : "celsius",
      current:
        "temperature_2m,apparent_temperature,relative_humidity_2m,is_day,weather_code,wind_speed_10m",
      hourly: "temperature_2m,precipitation_probability,weather_code",
      daily:
        "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset",
    });
    const raw = await this.json(url, bounded),
      c = raw.current,
      d = raw.daily,
      h = raw.hourly;
    if (
      !c?.time ||
      n(c.temperature_2m) === null ||
      !Array.isArray(d?.time) ||
      !d.time.length ||
      !Array.isArray(h?.time) ||
      !h.time.length
    )
      throw new Error("Weather data is incomplete. Please try again.");
    const daily = d.time.map((time, i) => ({
      time,
      high: n(d.temperature_2m_max?.[i]),
      low: n(d.temperature_2m_min?.[i]),
      rain: n(d.precipitation_probability_max?.[i]),
      ...condition(d.weather_code?.[i]),
    }));
    const hourly = h.time
      .map((time, i) => ({
        time,
        temp: n(h.temperature_2m?.[i]),
        rain: n(h.precipitation_probability?.[i]),
        ...condition(h.weather_code?.[i]),
      }))
      .filter((x) => x.temp !== null);
    const data = {
      location: {
        name: place.name,
        region: place.admin1,
        country: place.country,
        latitude: place.latitude,
        longitude: place.longitude,
      },
      timezone: raw.timezone,
      unit: input.fahrenheit ? "°F" : "°C",
      windUnit: raw.current_units?.wind_speed_10m || "km/h",
      current: {
        time: c.time,
        temp: c.temperature_2m,
        feels: n(c.apparent_temperature),
        humidity: n(c.relative_humidity_2m),
        wind: n(c.wind_speed_10m),
        isDay: Boolean(c.is_day),
        ...condition(c.weather_code),
        ...(!c.is_day && c.weather_code === 0 ? { icon: "☾" } : {}),
      },
      daily,
      hourly,
      selectedDay: input.day,
      retrievedAt: new Date(this.now()).toISOString(),
      source: "https://open-meteo.com/",
    };
    if (this.cache.size >= 30)
      this.cache.delete(this.cache.keys().next().value);
    this.cache.set(key, { saved: this.now(), data });
    return data;
  }
}
export function weatherSummary(w) {
  const round = (v) => (v === null ? "unavailable" : Math.round(v)),
    c = w.current,
    d = w.daily[w.selectedDay] || w.daily[0];
  if (w.selectedDay === 1)
    return `Tomorrow in ${w.location.name}: ${d.label.toLowerCase()}, with a high of ${round(d.high)}${w.unit} and a low of ${round(d.low)}${w.unit}.${d.rain === null ? "" : ` Rain chance: ${round(d.rain)}%.`} It’s currently ${round(c.temp)}${w.unit}.`;
  return `It’s ${round(c.temp)}${w.unit} in ${w.location.name} right now — ${c.label.toLowerCase()}.${c.feels === null ? "" : ` Feels like ${round(c.feels)}${w.unit}.`} Today’s high is ${round(d.high)}${w.unit}, with a low of ${round(d.low)}${w.unit}.${d.rain === null ? "" : ` Rain chance: ${round(d.rain)}%.`}`;
}
