// Test-only scaffolding, loaded unconditionally from main.jsx. This app has
// no backend — every e2e test that needs to set up state ahead of a UI flow
// (generate a share-link token, drive a device through Deployment without
// repeatedly fighting the React Flow canvas, read back a phase status) does
// it by reaching into these same api/ modules the real pages call. Against
// `vite dev` that worked via a raw `import('/src/api/...')` in the browser;
// against the production build (`vite preview`, used by the e2e suite
// specifically because the dev server's per-request overhead caused load-
// related flakiness — see playwright.config.js) those source paths don't
// exist, since everything is bundled. This module is the bundle-safe
// equivalent: a handful of already-public api/ functions, re-exported under
// one name so tests call `window.__rackiumTestApi.shareLink.generateShareLink(...)`
// instead. It changes no application behaviour — every function here is
// already exported and used by real pages.
import * as shareLink from './api/shareLink.js'
import * as deploymentDesign from './api/deploymentDesign.js'
import * as networkStore from './api/networkStore.js'
import * as buildings from './api/buildings.js'
import { resetDemoData } from './lib/persistentStore.js'

window.__rackiumTestApi = { shareLink, deploymentDesign, networkStore, buildings, resetDemoData }
