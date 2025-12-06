// Weather data utilities with IndexedDB caching and Open-Meteo integration

export interface HourlyWeatherData {
  timestamp: number;  // Unix seconds
  temperature: number;  // Celsius
}

export interface WeatherDataRange {
  id?: number;
  latitude: number;
  longitude: number;
  startDate: string;  // YYYY-MM-DD
  endDate: string;    // YYYY-MM-DD
  hourlyData: HourlyWeatherData[];
  fetchedAt: number;  // When this was cached
}

export interface GeocodingResult {
  latitude: number;
  longitude: number;
  name: string;
  admin1?: string;  // State/province
  country: string;
}

const DB_NAME = 'gb-energy-weather';
const DB_VERSION = 2; // Bump version to recreate store with new schema
const STORE_NAME = 'weather-cache';

// --- IndexedDB Helpers ---

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      
      // Delete old store if it exists (schema change)
      if (db.objectStoreNames.contains(STORE_NAME)) {
        db.deleteObjectStore(STORE_NAME);
      }
      
      // Create store with composite key instead of auto-increment
      // This way we can use put() to upsert without unique index conflicts
      const store = db.createObjectStore(STORE_NAME, { 
        keyPath: ['latitude', 'longitude', 'startDate', 'endDate'] 
      });
      // Index for location-based queries (no longer needs to be unique)
      store.createIndex('location', ['latitude', 'longitude'], { unique: false });
    };
  });
}

async function getCachedWeather(
  lat: number, 
  lon: number, 
  startDate: string, 
  endDate: string
): Promise<WeatherDataRange | null> {
  const db = await openDB();
  
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    
    // Round coords to 2 decimal places for matching
    const roundedLat = Math.round(lat * 100) / 100;
    const roundedLon = Math.round(lon * 100) / 100;
    
    // Use the composite key directly
    const request = store.get([roundedLat, roundedLon, startDate, endDate]);
    
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

async function cacheWeatherData(data: WeatherDataRange): Promise<void> {
  const db = await openDB();
  
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    
    // Round coords for consistent caching
    const toCache = {
      latitude: Math.round(data.latitude * 100) / 100,
      longitude: Math.round(data.longitude * 100) / 100,
      startDate: data.startDate,
      endDate: data.endDate,
      hourlyData: data.hourlyData,
      fetchedAt: data.fetchedAt,
    };
    
    // put() will insert or update based on the composite key
    const request = store.put(toCache);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

// Find any cached data that overlaps with our date range
async function findOverlappingCache(
  lat: number,
  lon: number,
  startDate: string,
  endDate: string
): Promise<WeatherDataRange[]> {
  const db = await openDB();
  const roundedLat = Math.round(lat * 100) / 100;
  const roundedLon = Math.round(lon * 100) / 100;
  
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const index = store.index('location');
    
    const request = index.getAll([roundedLat, roundedLon]);
    
    request.onsuccess = () => {
      const results = request.result as WeatherDataRange[];
      // Filter to those that overlap with our range
      const overlapping = results.filter(r => 
        r.startDate <= endDate && r.endDate >= startDate
      );
      resolve(overlapping);
    };
    request.onerror = () => reject(request.error);
  });
}

// --- Open-Meteo API ---

export async function geocodeZipCode(zipCode: string): Promise<GeocodingResult | null> {
  // Use Open-Meteo's geocoding API with the zip code
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(zipCode)}&count=5&language=en&format=json`;
  
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error('Geocoding failed');
    
    const data = await response.json();
    
    if (!data.results?.length) {
      // Try with "USA" appended for US zip codes
      if (/^\d{5}$/.test(zipCode)) {
        const usUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${zipCode}%20USA&count=5&language=en&format=json`;
        const usResponse = await fetch(usUrl);
        const usData = await usResponse.json();
        if (usData.results?.length) {
          const r = usData.results[0];
          return { latitude: r.latitude, longitude: r.longitude, name: r.name, admin1: r.admin1, country: r.country };
        }
      }
      return null;
    }
    
    const r = data.results[0];
    return { latitude: r.latitude, longitude: r.longitude, name: r.name, admin1: r.admin1, country: r.country };
  } catch (err) {
    console.error('Geocoding error:', err);
    return null;
  }
}

// Open-Meteo archive API constraints
const ARCHIVE_MIN_DATE = '1940-01-01';

function getArchiveMaxDate(daysOffset: number = 1): string {
  const now = new Date();
  now.setDate(now.getDate() - daysOffset);
  return now.toISOString().split('T')[0];
}

function clampDateRange(startDate: string, endDate: string, maxDate: string): { start: string; end: string; wasClamped: boolean } {
  let wasClamped = false;
  
  let clampedStart = startDate;
  let clampedEnd = endDate;
  
  // Clamp start date
  if (startDate < ARCHIVE_MIN_DATE) {
    clampedStart = ARCHIVE_MIN_DATE;
    wasClamped = true;
  }
  
  // Clamp end date
  if (endDate > maxDate) {
    clampedEnd = maxDate;
    wasClamped = true;
  }
  
  // If start is after end after clamping, we have no valid range
  if (clampedStart > clampedEnd) {
    throw new Error('Requested date range is outside available weather data (1940 to ~yesterday)');
  }
  
  return { start: clampedStart, end: clampedEnd, wasClamped };
}

async function fetchWeatherFromAPI(
  lat: number,
  lon: number,
  startDate: string,
  endDate: string
): Promise<HourlyWeatherData[]> {
  // Try with progressively more conservative date clamping
  const daysToTry = [1, 2, 3, 5];
  let lastError: Error | null = null;
  
  for (const daysOffset of daysToTry) {
    const maxDate = getArchiveMaxDate(daysOffset);
    
    try {
      const { start, end, wasClamped } = clampDateRange(startDate, endDate, maxDate);
      
      if (wasClamped) {
        console.log(`Weather date range clamped to ${start} - ${end} (max date: ${maxDate})`);
      }
      
      const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=${start}&end_date=${end}&hourly=temperature_2m&timezone=auto`;
      
      const response = await fetch(url);
      const data = await response.json();
      
      // Check for API error response
      if (data.error) {
        const reason = data.reason || 'Unknown error';
        // If it's a date range error, try next offset
        if (reason.includes('end_date') && reason.includes('out of allowed range')) {
          console.log(`Weather API date ${end} not available yet, trying ${daysOffset + 1} days back...`);
          lastError = new Error(reason);
          continue;
        }
        throw new Error(reason);
      }
      
      if (!response.ok) {
        throw new Error(`Weather API error: ${response.status}`);
      }
      
      if (!data.hourly?.time || !data.hourly?.temperature_2m) {
        throw new Error('Invalid weather data response');
      }
      
      const hourlyData: HourlyWeatherData[] = [];
      for (let i = 0; i < data.hourly.time.length; i++) {
        const timestamp = new Date(data.hourly.time[i]).getTime() / 1000;
        const temperature = data.hourly.temperature_2m[i];
        if (temperature !== null) {
          hourlyData.push({ timestamp, temperature });
        }
      }
      
      return hourlyData;
      
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      // Only continue retrying for date range errors
      if (!lastError.message.includes('out of allowed range')) {
        throw lastError;
      }
    }
  }
  
  // All retries failed
  throw lastError || new Error('Failed to fetch weather data');
}

// --- Main Export Function ---

export async function getWeatherData(
  lat: number,
  lon: number,
  startTimestamp: number,
  endTimestamp: number
): Promise<HourlyWeatherData[]> {
  // Convert timestamps to date strings
  const startDate = new Date(startTimestamp * 1000).toISOString().split('T')[0];
  const endDate = new Date(endTimestamp * 1000).toISOString().split('T')[0];
  
  // For caching, we use the raw dates (the fetch function handles clamping)
  // But we should check cache with a reasonable max date
  const maxDateForCache = getArchiveMaxDate(1);
  const clampedEndForCache = endDate > maxDateForCache ? maxDateForCache : endDate;
  const clampedStartForCache = startDate < ARCHIVE_MIN_DATE ? ARCHIVE_MIN_DATE : startDate;
  
  // Check for exact cache hit first
  const exactCache = await getCachedWeather(lat, lon, clampedStartForCache, clampedEndForCache);
  if (exactCache) {
    console.log('Weather cache hit (exact)');
    return exactCache.hourlyData;
  }
  
  // Check for overlapping cached data
  const overlapping = await findOverlappingCache(lat, lon, clampedStartForCache, clampedEndForCache);
  
  if (overlapping.length > 0) {
    // See if we have complete coverage
    const allData = overlapping.flatMap(r => r.hourlyData).sort((a, b) => a.timestamp - b.timestamp);
    const firstTs = allData[0]?.timestamp;
    const lastTs = allData[allData.length - 1]?.timestamp;
    
    const requestStart = new Date(clampedStartForCache).getTime() / 1000;
    const requestEnd = new Date(clampedEndForCache + 'T23:59:59').getTime() / 1000;
    
    if (firstTs && lastTs && firstTs <= requestStart && lastTs >= requestEnd) {
      console.log('Weather cache hit (from overlapping ranges)');
      // Filter to just our range and dedupe
      const filtered = allData.filter(d => d.timestamp >= requestStart && d.timestamp <= requestEnd);
      const deduped = Array.from(new Map(filtered.map(d => [d.timestamp, d])).values());
      return deduped;
    }
  }
  
  // Fetch from API (it handles date clamping and retries internally)
  console.log(`Fetching weather data from Open-Meteo (${startDate} to ${endDate})...`);
  const hourlyData = await fetchWeatherFromAPI(lat, lon, startDate, endDate);
  
  // Cache the result with the actual date range we got
  if (hourlyData.length > 0) {
    const actualStart = new Date(hourlyData[0].timestamp * 1000).toISOString().split('T')[0];
    const actualEnd = new Date(hourlyData[hourlyData.length - 1].timestamp * 1000).toISOString().split('T')[0];
    
    await cacheWeatherData({
      latitude: lat,
      longitude: lon,
      startDate: actualStart,
      endDate: actualEnd,
      hourlyData,
      fetchedAt: Date.now(),
    });
  }
  
  return hourlyData;
}

// Aggregate hourly weather to different resolutions
export function aggregateWeatherData(
  hourlyData: HourlyWeatherData[],
  resolution: 'hourly' | 'daily' | 'monthly'
): Map<number, number> {
  const aggregated = new Map<number, { sum: number; count: number }>();
  
  for (const point of hourlyData) {
    const date = new Date(point.timestamp * 1000);
    let bucketTs: number;
    
    if (resolution === 'hourly') {
      bucketTs = point.timestamp;
    } else if (resolution === 'daily') {
      bucketTs = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime() / 1000;
    } else {
      bucketTs = new Date(date.getFullYear(), date.getMonth(), 1).getTime() / 1000;
    }
    
    const existing = aggregated.get(bucketTs);
    if (existing) {
      existing.sum += point.temperature;
      existing.count++;
    } else {
      aggregated.set(bucketTs, { sum: point.temperature, count: 1 });
    }
  }
  
  // Convert to averages
  const result = new Map<number, number>();
  for (const [ts, data] of aggregated) {
    result.set(ts, data.sum / data.count);
  }
  
  return result;
}

// Clear all cached weather data
export async function clearWeatherCache(): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.clear();
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}