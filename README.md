# GB Energy Meter :zap:
[![Version](https://img.shields.io/badge/version-3.1-emerald.svg)](https://github.com/jekrch/energy-meter/releases)
[![Test](https://github.com/jekrch/energy-meter/actions/workflows/test.yml/badge.svg)](https://github.com/jekrch/energy-meter/actions/workflows/test.yml)

A web application for visualizing and analyzing energy consumption data from Green Button XML and CSV files. Built with React, TypeScript, and Vite.

[gbmeter.com](https://gbmeter.com)

<img width="450" alt="image" src="https://github.com/user-attachments/assets/feb8093a-517b-4256-bf07-739b5246e213" />


## Features

### Importing Data

- **Green Button XML & CSV Support**: Import energy data from utility providers using the standard Green Button XML format, or from common CSV exports with auto-detected date/time, usage, and unit columns
- **Recent Files**: Previously loaded files are saved locally in your browser so you can reopen them in one click without re-importing
- **Merge Datasets**: Combine multiple saved files into a single continuous history, with automatic de-duplication of overlapping intervals, gap detection, and compatibility checks before merging
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
- **Weather Overlay**: Optionally overlay historical temperature data from Open-Meteo to correlate energy usage with weather patterns, with temperature range filtering to analyze consumption at specific temperatures

### Display & Storage

- **Flexible Units**: Switch between Wh, kWh, and MWh display units
- **Local Caching**: Weather data is cached in IndexedDB to minimize API requests

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

### Building for Production

To create a production build:

```bash
bun run build
```

## Data Privacy

All data processing happens locally in your browser. Energy data files are never uploaded to any server. Weather location preferences are stored in localStorage and weather data is cached in IndexedDB on your device.

## License

This project is licensed under the MIT License.
