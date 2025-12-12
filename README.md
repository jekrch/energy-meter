# GB Energy Meter :zap:
[![Test](https://github.com/jekrch/energy-meter/actions/workflows/test.yml/badge.svg)](https://github.com/jekrch/energy-meter/actions/workflows/test.yml)

A web application for visualizing and analyzing energy consumption data from Green Button XML files. Built with React, TypeScript, and Vite.

[gbmeter.com](https://gbmeter.com)

<img width="450" alt="image" src="https://github.com/user-attachments/assets/3bdce2a0-e506-49a9-abe1-2bd064c4a9dd" />

## Features

- **Green Button XML Support** — Import energy data from utility providers using the standard Green Button format
- **Interactive Charts** — Visualize consumption with zoomable, responsive area charts
- **Multi-Resolution Views** — View data at raw, hourly, daily, or weekly aggregations
- **Analysis Dashboard** — Analyze patterns by hour, day of week, or month with timeline and average views
- **Cost Tracking** — Toggle between energy usage and cost metrics with automatic rate calculations
- **Weather Overlay** — Optionally overlay historical temperature data from Open-Meteo to correlate energy usage with weather patterns, with temperature range filtering to analyze consumption at specific temperatures
- **Flexible Units** — Switch between Wh, kWh, and MWh display units
- **Data Table** — Browse raw readings with pagination
- **Local Caching** — Weather data is cached in IndexedDB to minimize API requests
- **Demo Data** — Try the app with realistic sample data spanning 2 years

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
