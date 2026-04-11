// Generates synthetic Green Button XML fixtures that exercise the block
// picker. Run with: bun fixtures/generate.ts
//
// Produces:
//   fixtures/sample-single-block.xml        — plain consumption, no picker
//   fixtures/sample-solar-net-metered.xml   — delivered + received (picker)
//   fixtures/sample-hourly-plus-daily.xml   — hourly + overlapping daily summary (picker)
//
// Each IntervalReading uses raw Wh for <value> and 1/100000 of a dollar for
// <cost>, matching standard ESPI conventions and the app's existing parser
// expectations (powerOfTenMultiplier=0, UOM=72/Wh).

import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

// 2025-01-01 00:00:00 UTC
const START_TS = 1735689600;
const DAYS = 7;
const HOUR = 3600;
const DAY = 86400;
const RATE_MICRO_PER_WH = 14; // ≈ $0.14/kWh in micro-dollars-per-Wh

interface Reading {
  start: number;
  duration: number;
  value: number;
  cost: number;
}

const rand = (() => {
  let s = 42;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
})();

/** Hourly consumption profile (Wh) with a morning + evening peak. */
const consumptionHour = (hour: number): number => {
  const base = 300;
  const morning = Math.exp(-Math.pow(hour - 7.5, 2) / 2) * 450;
  const evening = Math.exp(-Math.pow(hour - 19, 2) / 3) * 900;
  return Math.round(base + morning + evening + (rand() - 0.5) * 80);
};

/** Hourly solar generation profile (Wh) — only daylight, bell-shaped. */
const generationHour = (hour: number): number => {
  if (hour < 6 || hour > 19) return 0;
  const peak = Math.exp(-Math.pow(hour - 12.5, 2) / 6) * 2200;
  return Math.max(0, Math.round(peak + (rand() - 0.5) * 100));
};

const costOf = (wh: number): number => Math.round(wh * RATE_MICRO_PER_WH);

const generateHourly = (fn: (h: number) => number): Reading[] => {
  const out: Reading[] = [];
  for (let d = 0; d < DAYS; d++) {
    for (let h = 0; h < 24; h++) {
      const value = fn(h);
      out.push({
        start: START_TS + d * DAY + h * HOUR,
        duration: HOUR,
        value,
        cost: costOf(value),
      });
    }
  }
  return out;
};

const summarizeDaily = (hourly: Reading[]): Reading[] => {
  const out: Reading[] = [];
  for (let d = 0; d < DAYS; d++) {
    const slice = hourly.slice(d * 24, (d + 1) * 24);
    const value = slice.reduce((a, r) => a + r.value, 0);
    const cost = slice.reduce((a, r) => a + r.cost, 0);
    out.push({ start: START_TS + d * DAY, duration: DAY, value, cost });
  }
  return out;
};

// --- XML emission helpers ---

const readingTypeEntry = (
  id: number,
  flowDirection: number,
  intervalLength: number
): string => `  <entry>
    <id>urn:uuid:readingtype-${id}</id>
    <link rel="self" href="/espi/1_1/resource/ReadingType/${id}"/>
    <link rel="up" href="/espi/1_1/resource/ReadingType"/>
    <title>Energy Reading Type</title>
    <content>
      <ReadingType xmlns="http://naesb.org/espi">
        <accumulationBehaviour>4</accumulationBehaviour>
        <commodity>1</commodity>
        <dataQualifier>12</dataQualifier>
        <flowDirection>${flowDirection}</flowDirection>
        <intervalLength>${intervalLength}</intervalLength>
        <kind>12</kind>
        <phase>769</phase>
        <powerOfTenMultiplier>0</powerOfTenMultiplier>
        <timeAttribute>0</timeAttribute>
        <uom>72</uom>
      </ReadingType>
    </content>
  </entry>`;

const intervalBlockEntry = (
  blockId: number,
  readingTypeId: number,
  readings: Reading[]
): string => {
  const spanStart = readings[0].start;
  const spanDuration = readings[readings.length - 1].start + readings[readings.length - 1].duration - spanStart;
  const body = readings
    .map(
      (r) => `          <IntervalReading>
            <timePeriod>
              <duration>${r.duration}</duration>
              <start>${r.start}</start>
            </timePeriod>
            <value>${r.value}</value>
            <cost>${r.cost}</cost>
          </IntervalReading>`
    )
    .join('\n');

  return `  <entry>
    <id>urn:uuid:intervalblock-${blockId}</id>
    <link rel="self" href="/espi/1_1/resource/RetailCustomer/1/UsagePoint/1/MeterReading/${readingTypeId}/IntervalBlock/${blockId}"/>
    <link rel="up" href="/espi/1_1/resource/RetailCustomer/1/UsagePoint/1/MeterReading/${readingTypeId}/IntervalBlock"/>
    <link rel="related" href="/espi/1_1/resource/ReadingType/${readingTypeId}"/>
    <title>Interval Block</title>
    <content>
      <IntervalBlock xmlns="http://naesb.org/espi">
        <interval>
          <duration>${spanDuration}</duration>
          <start>${spanStart}</start>
        </interval>
${body}
      </IntervalBlock>
    </content>
  </entry>`;
};

const wrapFeed = (title: string, entries: string[]): string => `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <id>urn:uuid:feed-${Date.now()}</id>
  <title>${title}</title>
  <updated>2025-01-08T00:00:00Z</updated>
${entries.join('\n')}
</feed>
`;

// --- Fixtures ---

const writeFixture = (name: string, xml: string) => {
  const path = join(HERE, name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, xml);
  console.log(`wrote ${name} (${xml.length.toLocaleString()} bytes)`);
};

// 1. Single block — baseline, should NOT trigger the picker.
{
  const consumption = generateHourly(consumptionHour);
  const xml = wrapFeed('Single Block — Consumption Only', [
    readingTypeEntry(1, 1, HOUR),
    intervalBlockEntry(1, 1, consumption),
  ]);
  writeFixture('sample-single-block.xml', xml);
  const totalKwh = consumption.reduce((a, r) => a + r.value, 0) / 1000;
  const totalCost = consumption.reduce((a, r) => a + r.cost, 0) / 100000;
  console.log(`  total: ${totalKwh.toFixed(1)} kWh, $${totalCost.toFixed(2)}`);
}

// 2. Solar net-metered — delivered + received. Picker should appear.
//    Naively summing both would inflate totals.
{
  const delivered = generateHourly(consumptionHour);
  const received = generateHourly(generationHour);
  const xml = wrapFeed('Solar Net-Metered — Delivered + Received', [
    readingTypeEntry(1, 1, HOUR),   // forward / delivered
    readingTypeEntry(19, 19, HOUR), // reverse / received
    intervalBlockEntry(1, 1, delivered),
    intervalBlockEntry(19, 19, received),
  ]);
  writeFixture('sample-solar-net-metered.xml', xml);
  const delK = delivered.reduce((a, r) => a + r.value, 0) / 1000;
  const recK = received.reduce((a, r) => a + r.value, 0) / 1000;
  console.log(`  delivered: ${delK.toFixed(1)} kWh`);
  console.log(`  received:  ${recK.toFixed(1)} kWh`);
  console.log(`  if summed (bug): ${(delK + recK).toFixed(1)} kWh`);
}

// 3. Hourly + overlapping daily summary. Picker should appear.
//    Naively summing both would ~2x the real usage.
{
  const hourly = generateHourly(consumptionHour);
  const daily = summarizeDaily(hourly);
  const xml = wrapFeed('Hourly + Daily Summary (Overlapping)', [
    readingTypeEntry(1, 1, HOUR),
    readingTypeEntry(2, 1, DAY),
    intervalBlockEntry(1, 1, hourly),
    intervalBlockEntry(2, 2, daily),
  ]);
  writeFixture('sample-hourly-plus-daily.xml', xml);
  const hK = hourly.reduce((a, r) => a + r.value, 0) / 1000;
  console.log(`  hourly total:  ${hK.toFixed(1)} kWh (168 readings)`);
  console.log(`  daily total:   ${hK.toFixed(1)} kWh (7 readings, same data)`);
  console.log(`  if summed (bug): ${(hK * 2).toFixed(1)} kWh`);
}
