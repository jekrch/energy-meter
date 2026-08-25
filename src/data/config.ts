// OAuth client IDs are public by design — this is not a secret, and the app has
// no backend to keep one in. Override via VITE_GOOGLE_CLIENT_ID for a different
// deployment; the baked default is what ships, since `bun run deploy` publishes
// straight to gh-pages with no CI environment to populate.
export const GOOGLE_CLIENT_ID: string =
  import.meta.env.VITE_GOOGLE_CLIENT_ID ??
  '464661539531-03bfvo2fu4r516pjtma9riasfg8ok37d.apps.googleusercontent.com';

// The visible folder in My Drive that holds saved datasets. Visible rather than
// `appDataFolder` so the files can be seen, downloaded, and re-imported by hand
// — which is exactly what the existing export/import flow already does.
export const DRIVE_FOLDER_NAME = 'GB Energy Meter';
