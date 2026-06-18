// Generates synthetic Green Button XML fixtures that exercise the block
// picker. Run with: bun fixtures/generate.ts
//
// Produces:
//   fixtures/sample-single-block.xml        — plain consumption, no picker
//   fixtures/sample-solar-net-metered.xml   — delivered + received (picker)
//   fixtures/sample-hourly-plus-daily.xml   — hourly + overlapping daily summary (picker)
//   fixtures/sample-noninterval-register-reads.xml
//       — hourly delta usage split across per-day blocks (powerOfTenMultiplier
//         = -3) PLUS cumulative daily register reads (accumulationBehaviour=1,
//         duration 0). Exercises block-merging and cumulative-read filtering.
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

interface ReadingTypeOpts {
  accumulationBehaviour?: number;
  powerOfTenMultiplier?: number;
  title?: string;
}

const readingTypeEntry = (
  id: number | string,
  flowDirection: number,
  intervalLength: number,
  opts: ReadingTypeOpts = {}
): string => {
  const {
    accumulationBehaviour = 4,
    powerOfTenMultiplier = 0,
    title = 'Energy Reading Type',
  } = opts;
  return `  <entry>
    <id>urn:uuid:readingtype-${id}</id>
    <link rel="self" href="/espi/1_1/resource/ReadingType/${id}"/>
    <link rel="up" href="/espi/1_1/resource/ReadingType"/>
    <title>${title}</title>
    <content>
      <ReadingType xmlns="http://naesb.org/espi">
        <accumulationBehaviour>${accumulationBehaviour}</accumulationBehaviour>
        <commodity>1</commodity>
        <dataQualifier>12</dataQualifier>
        <flowDirection>${flowDirection}</flowDirection>
        <intervalLength>${intervalLength}</intervalLength>
        <kind>12</kind>
        <phase>769</phase>
        <powerOfTenMultiplier>${powerOfTenMultiplier}</powerOfTenMultiplier>
        <timeAttribute>0</timeAttribute>
        <uom>72</uom>
      </ReadingType>
    </content>
  </entry>`;
};

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

// Like perBlockEntries, but mirrors exports that DON'T emit a rel="related"
// link to the ReadingType — the block is tied to its ReadingType only through
// the shared MeterReading/<resourceId> path segment. `resourceId` is a string
// id (e.g. "S01207200100460") that also appears in the ReadingType self href.
const perBlockEntriesByPath = (
  startBlockId: number,
  resourceId: string,
  readings: Reading[],
  perBlock: number
): string[] => {
  const SUB = '00000000-0000-0000-0000-000000000001';
  const UP = '00000000-0000-0000-0000-0000000000a0';
  const out: string[] = [];
  let blockId = startBlockId;
  for (let i = 0; i < readings.length; i += perBlock) {
    const slice = readings.slice(i, i + perBlock);
    const spanStart = slice[0].start;
    const spanDuration = slice[slice.length - 1].start + slice[slice.length - 1].duration - spanStart;
    const body = slice
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
    const base = `/espi/1_1/resource/Subscription/${SUB}/UsagePoint/${UP}/MeterReading/${resourceId}/IntervalBlock`;
    out.push(`  <entry>
    <id>urn:uuid:intervalblock-${resourceId}-${blockId}</id>
    <link rel="self" href="${base}/${String(blockId).padStart(6, '0')}"/>
    <link rel="up" href="${base}"/>
    <title>Meter Data</title>
    <content>
      <IntervalBlock xmlns="http://naesb.org/espi">
        <interval>
          <duration>${spanDuration}</duration>
          <start>${spanStart}</start>
        </interval>
${body}
      </IntervalBlock>
    </content>
  </entry>`);
    blockId++;
  }
  return out;
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

// 4. Non-interval export: hourly delta usage (scaled, split per day) + daily
//    cumulative register reads. Mirrors a real utility "NonInterval" file that
//    bundles the meter's running odometer alongside actual usage. The register
//    reads must NOT be charted as consumption.
{
  const NI_DAYS = 5;
  const POT = -3;            // ReadingType powerOfTenMultiplier
  const SCALE = 1000;        // raw <value> = Wh × 10^-POT
  const REGISTER_BASE_WH = 79_000_000; // ~79 MWh lifetime meter total

  // Hourly delta usage, stored as raw values that scale back to Wh.
  const delta: Reading[] = [];
  for (let d = 0; d < NI_DAYS; d++) {
    for (let h = 0; h < 24; h++) {
      const wh = consumptionHour(h);
      delta.push({
        start: START_TS + d * DAY + h * HOUR,
        duration: HOUR,
        value: wh * SCALE,
        cost: costOf(wh),
      });
    }
  }

  // Daily cumulative register reads: a rising odometer total, duration 0.
  const register: Reading[] = [];
  let cumWh = REGISTER_BASE_WH;
  for (let d = 0; d < NI_DAYS; d++) {
    const dayWh = delta
      .slice(d * 24, (d + 1) * 24)
      .reduce((a, r) => a + r.value / SCALE, 0);
    cumWh += dayWh;
    register.push({
      start: START_TS + (d + 1) * DAY, // snapshot at end of day
      duration: 0,
      value: Math.round(cumWh * SCALE),
      cost: 0,
    });
  }

  // Realistic ESPI resource ids. The block→ReadingType link exists ONLY via
  // the shared MeterReading/<id> path (no rel="related"), exactly like the
  // real-world "NonInterval" export this fixture is modelled on.
  const RID_INTERVAL = 'S01207200100460';
  const RID_REGISTER = 'S0120720010011440';
  const xml = wrapFeed('Non-Interval — Hourly Usage + Cumulative Register Reads', [
    readingTypeEntry(RID_INTERVAL, 1, HOUR, {
      accumulationBehaviour: 4, // deltaData → real usage
      powerOfTenMultiplier: POT,
      title: 'KWH Interval Data',
    }),
    readingTypeEntry(RID_REGISTER, 1, DAY, {
      accumulationBehaviour: 1, // bulkQuantity → cumulative register reads
      powerOfTenMultiplier: POT,
      title: 'Daily KWH Reads',
    }),
    ...perBlockEntriesByPath(1, RID_INTERVAL, delta, 24),     // one block per day
    ...perBlockEntriesByPath(100, RID_REGISTER, register, 1), // one block per register read
  ]);
  writeFixture('sample-noninterval-register-reads.xml', xml);
  const usageKwh = delta.reduce((a, r) => a + r.value / SCALE, 0) / 1000;
  console.log(`  hourly usage: ${usageKwh.toFixed(1)} kWh (${delta.length} readings, ${NI_DAYS} blocks)`);
  console.log(`  register reads: ${register.length} cumulative snapshots (dropped as usage)`);
  console.log(`  final odometer: ${(register[register.length - 1].value / SCALE / 1000).toFixed(1)} kWh`);
}
