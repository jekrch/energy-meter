/// <reference lib="webworker" />
// Off-main-thread ranking computation. computeRankings allocates a Date per
// reading and sorts the buckets, which can block the UI for a noticeable beat
// on large datasets. Running it here keeps the Insights modal responsive (the
// user can switch tabs while rankings compute).
import { computeRankings, type RankGranularity, type RankMetric, type RankingEntry } from './rankings';
import type { DataPoint } from '../types';
import type { HourlyWeatherData } from './weatherData';

// The dataset is sent once (and again only when it changes) so repeated
// granularity/metric switches don't re-clone the whole array across the wire.
type DataMessage = { kind: 'data'; data: DataPoint[]; weather: HourlyWeatherData[] };
type ComputeMessage = {
  kind: 'compute';
  id: number;
  granularity: RankGranularity;
  metric: RankMetric;
  limit: number;
};
export type RankingsRequest = DataMessage | ComputeMessage;
export type RankingsResponse = { id: number; rankings: RankingEntry[] };

let currentData: DataPoint[] = [];
let currentWeather: HourlyWeatherData[] = [];

self.onmessage = (e: MessageEvent<RankingsRequest>) => {
  const msg = e.data;
  if (msg.kind === 'data') {
    currentData = msg.data;
    currentWeather = msg.weather;
    return;
  }
  const rankings = computeRankings(currentData, currentWeather, msg.granularity, msg.metric, msg.limit);
  const response: RankingsResponse = { id: msg.id, rankings };
  self.postMessage(response);
};
