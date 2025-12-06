import { useState, useEffect, useCallback, useRef } from 'react';
import { 
  getWeatherData, 
  geocodeZipCode, 
  aggregateWeatherData,
  type HourlyWeatherData,
  type GeocodingResult 
} from '../utils/weatherData';

export interface WeatherState {
  enabled: boolean;
  zipCode: string;
  location: GeocodingResult | null;
  hourlyData: HourlyWeatherData[];
  isLoading: boolean;
  error: string | null;
}

export interface AggregatedWeather {
  timestamp: number;
  temperature: number;
}

export function useWeather(startTimestamp: number | null, endTimestamp: number | null) {
  const [state, setState] = useState<WeatherState>({
    enabled: false,
    zipCode: '',
    location: null,
    hourlyData: [],
    isLoading: false,
    error: null,
  });

  // Track what date range we've fetched for
  const fetchedRangeRef = useRef<{ start: number; end: number; lat: number; lon: number } | null>(null);

  // Load saved location from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem('gb-weather-location');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setState(prev => ({
          ...prev,
          enabled: parsed.enabled ?? true,
          zipCode: parsed.zipCode || '',
          location: parsed.location || null,
        }));
      } catch { /* ignore */ }
    }
  }, []);

  // Fetch weather data when location and date range are available
  // Also refetch if date range changes significantly
  useEffect(() => {
    if (!state.location || !startTimestamp || !endTimestamp) {
      return;
    }

    const { latitude, longitude } = state.location;

    // Check if we already have data for this range and location
    const cached = fetchedRangeRef.current;
    if (cached && 
        cached.start === startTimestamp && 
        cached.end === endTimestamp &&
        cached.lat === latitude &&
        cached.lon === longitude) {
      return; // Already have this data
    }

    let cancelled = false;
    setState(prev => ({ ...prev, isLoading: true, error: null }));

    getWeatherData(latitude, longitude, startTimestamp, endTimestamp)
      .then(data => {
        if (!cancelled) {
          fetchedRangeRef.current = { 
            start: startTimestamp, 
            end: endTimestamp, 
            lat: latitude, 
            lon: longitude 
          };
          setState(prev => ({ ...prev, hourlyData: data, isLoading: false }));
        }
      })
      .catch(err => {
        if (!cancelled) {
          setState(prev => ({ 
            ...prev, 
            error: err.message || 'Failed to fetch weather data',
            isLoading: false,
            hourlyData: []
          }));
        }
      });

    return () => { cancelled = true; };
  }, [state.location, startTimestamp, endTimestamp]);

  const setZipCode = useCallback(async (zipCode: string) => {
    setState(prev => ({ ...prev, zipCode, isLoading: true, error: null }));

    if (!zipCode.trim()) {
      setState(prev => ({ 
        ...prev, 
        location: null, 
        hourlyData: [], 
        isLoading: false,
        enabled: false 
      }));
      fetchedRangeRef.current = null;
      localStorage.removeItem('gb-weather-location');
      return;
    }

    const result = await geocodeZipCode(zipCode);
    
    if (result) {
      // Clear fetched range so it will refetch with new location
      fetchedRangeRef.current = null;
      setState(prev => ({ 
        ...prev, 
        location: result, 
        enabled: true,
        isLoading: false,
        hourlyData: [] // Clear old data
      }));
      localStorage.setItem('gb-weather-location', JSON.stringify({ 
        zipCode, 
        location: result,
        enabled: true
      }));
    } else {
      setState(prev => ({ 
        ...prev, 
        error: 'Location not found. Try city name or different format.',
        isLoading: false 
      }));
    }
  }, []);

  const toggleEnabled = useCallback((enabled: boolean) => {
    setState(prev => {
      // Save preference to localStorage
      if (prev.location) {
        localStorage.setItem('gb-weather-location', JSON.stringify({ 
          zipCode: prev.zipCode, 
          location: prev.location,
          enabled
        }));
      }
      return { ...prev, enabled };
    });
  }, []);

  const clearLocation = useCallback(() => {
    fetchedRangeRef.current = null;
    setState(prev => ({
      ...prev,
      enabled: false,
      zipCode: '',
      location: null,
      hourlyData: [],
      error: null,
    }));
    localStorage.removeItem('gb-weather-location');
  }, []);

  // Get aggregated weather for charts
  const getAggregatedWeather = useCallback((
    resolution: 'hourly' | 'daily' | 'monthly'
  ): AggregatedWeather[] => {
    if (!state.hourlyData.length) return [];
    
    const aggregated = aggregateWeatherData(state.hourlyData, resolution);
    return Array.from(aggregated.entries())
      .map(([timestamp, temperature]) => ({ timestamp, temperature }))
      .sort((a, b) => a.timestamp - b.timestamp);
  }, [state.hourlyData]);

  // Create a map for quick lookups by timestamp
  const getTemperatureMap = useCallback((
    resolution: 'hourly' | 'daily' | 'monthly'
  ): Map<number, number> => {
    if (!state.hourlyData.length) return new Map();
    return aggregateWeatherData(state.hourlyData, resolution);
  }, [state.hourlyData]);

  return {
    ...state,
    setZipCode,
    toggleEnabled,
    clearLocation,
    getAggregatedWeather,
    getTemperatureMap,
  };
}