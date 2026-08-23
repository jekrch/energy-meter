/// <reference types="bun-types" />
// Bun evaluates every test file against one shared module registry, and
// happy-dom's registrator throws if it is registered twice. Owning that call
// here means the first importer registers and every later importer reuses this
// module's cached evaluation - so it no longer matters which order bun happens
// to load the test files in, which varies between machines and CI.
import { GlobalRegistrator } from '@happy-dom/global-registrator';

if (typeof document === 'undefined') {
  GlobalRegistrator.register();
}
