# GB Energy Meter :zap:
[![Version](https://img.shields.io/badge/version-4-emerald.svg)](https://github.com/jekrch/energy-meter/releases)
[![Test](https://github.com/jekrch/energy-meter/actions/workflows/test.yml/badge.svg)](https://github.com/jekrch/energy-meter/actions/workflows/test.yml)

A web application for visualizing and analyzing energy consumption data from Green Button XML and CSV files. Built with React, TypeScript, and Vite.

[gbmeter.com](https://gbmeter.com)

<img width="450" alt="image" src="https://github.com/user-attachments/assets/feb8093a-517b-4256-bf07-739b5246e213" />


## Features

### Importing Data

- **Green Button XML & CSV Support**: Import energy data from utility providers using the standard Green Button XML format, or from common CSV exports with auto-detected date/time, usage, and unit columns
- **Recent Files**: Previously loaded files are saved locally in your browser so you can reopen them in one click without re-importing
- **Rename Datasets**: Click a dataset's name in the list to retitle it — a utility export called `xcel_15min_2026.xml` becomes "Home electricity". Renaming leaves the readings and rate periods untouched, and a Drive dataset is renamed everywhere it matters, including the file in your Drive folder
- **Merge Datasets**: Combine multiple saved files into a single continuous history, with automatic de-duplication of overlapping intervals, gap detection, and compatibility checks before merging
- **Add a File to a Saved Dataset**: Every row in the datasets list has an "add a file" action — pick this month's export and its readings go straight into that dataset, written back over it in place, in this browser or in Drive, wherever it already lives. No separate entry to merge afterwards. Picking a file while a dataset is open asks the same question — add it, or open it on its own
- **Google Drive Sync** (optional): Sign in with Google to keep datasets in a plainly visible `GB Energy Meter` folder in your own Drive. While you're signed in, files you open are saved there automatically instead of filling the five local slots — reopen them from any browser or device, and merge next month's file straight onto a saved cloud dataset, writing the result back in place. A dataset saved while signed out can be moved up to Drive from the list, and local and Drive datasets are listed side by side and can be merged with each other
- **Export Data**: Export readings to CSV or JSON with selectable columns and optional grouping (hourly, daily, weekly, monthly). A re-loadable JSON option saves a lossless copy of the loaded data (preserving exact timestamps, energy, and cost) that can be re-imported later and is typically much smaller than the original Green Button XML
- **Demo Data**: Try the app with realistic sample data spanning 2 years

### Visualization & Analysis

- **Interactive Charts**: Visualize consumption with zoomable, responsive area charts
- **Multi-Resolution Views**: View data at raw, hourly, daily, or weekly aggregations
- **Peak Demand Metrics**: Toggle to instantaneous demand (kW) derived from each reading's interval to identify peak load periods
- **Analysis Dashboard**: Analyze patterns by hour, day of week, or month with timeline and average views
- **Guided Insights**: Explore common questions about your usage (peak hours, overnight baseline, seasonal trends) with one-click presets that automatically configure filters and views
- **Top Rankings**: Rank your highest periods by cost, energy, peak demand, or hottest/coldest temperature across hours, days, weeks, or months, then jump straight to any period in the charts
- **Data Table**: Browse raw readings with pagination

### Cost & Weather

- **Cost Tracking**: Toggle between energy usage and cost metrics with automatic rate calculations
- **Rate Changes**: Automatically detect rate changes from the cost/usage ratio over the selected range, with a rate-over-time chart, per-period rate breakdown, and hints for time-of-use or seasonal pricing
- **Peak Rate Periods**: Enter your utility's time-of-use schedule (multiple tiers, weekday scoping, seasonal hours, and observed holidays) and see it as shaded bands behind the chart. Analysis bars split by rate period, and a summary card totals energy, cost, share of usage, and the highest demand (kW) interval for each period. Schedules can be exported as JSON to reload or share
- **Weather Overlay**: Optionally overlay historical temperature data from Open-Meteo to correlate energy usage with weather patterns, with temperature range filtering to analyze consumption at specific temperatures

### Display & Storage

- **Flexible Units**: Switch between Wh, kWh, and MWh display units
- **Local Caching**: Weather data is cached in IndexedDB to minimize API requests, and Drive datasets are cached by their Drive `modifiedTime` so reopening one costs no network request

## Tech Stack

- **Runtime/Manager:** Bun
- **Framework:** React
- **Language:** TypeScript
- **Build Tool:** Vite
- **Styling:** Tailwind CSS
- **Charts:** Recharts
- **Weather Data:** Open-Meteo API (free, non-commercial)

## Getting Started

### Prerequisites

Ensure you have [Bun](https://bun.sh/) installed on your machine.

### Installation

1. Clone the repository:

   ```bash
   git clone https://github.com/jekrch/energy-meter.git
   cd energy-meter
   ```

2. Install dependencies:

   ```bash
   bun install
   ```

### Usage

To start the development server:

```bash
bun run dev
```

Open your browser and navigate to the local URL provided in the terminal (usually `http://localhost:5173`).

To exercise Drive sync against your own Google OAuth client, set
`VITE_GOOGLE_CLIENT_ID` and register the app's URL under **both** *Authorized
JavaScript origins* and *Authorized redirect URIs* on that client
(`http://localhost:5173` and `http://localhost:5173/` respectively). The
redirect URI is what touch devices come back to: they sign in by leaving the tab
rather than through a popup, because a popup on a phone is a second tab the user
has to navigate back from by hand.

### Building for Production

To create a production build:

```bash
bun run build
```

## Data Privacy

All data processing happens locally in your browser. Energy data files are never uploaded to any server. Weather location preferences are stored in localStorage and weather data is cached in IndexedDB on your device.

### Google Drive sync

Drive sync is optional and off until you sign in. There is no backend: this app
is static files served from a CDN.

- **One permission.** Sign-in requests a single scope,
  [`drive.file`](https://developers.google.com/workspace/drive/api/guides/api-specific-auth),
  which grants access *only* to files this app itself creates. It cannot see,
  read, or list anything else in your Drive: including files you upload into
  its own folder by hand.
- **Your Drive, your files.** Datasets are written to a normal, visible folder
  named `GB Energy Meter` in My Drive, as ordinary gzipped JSON. You can open,
  download, move, or delete them yourself at any time, and removing one from the
  app moves it to your Drive trash rather than erasing it.
- **The token stays in the browser.** Google returns the access token directly
  to the page; it is held in `sessionStorage` for that tab only, sent nowhere
  but Google's own API, and discarded when you sign out or close the tab.
- **Signing in is the consent.** While you are signed in, a file you open is
  saved to your Drive folder instead of the browser's local history: keeping
  datasets there is the point of connecting an account. Signed out, no Google
  service is contacted at all and imports stay in this browser. You can delete
  a dataset from Drive at any time, from the app or from Drive itself.
- **No analytics on your data.** The app collects nothing about you or your
  readings.

## License

This project is licensed under the MIT License.
