// "mock" (default) keeps the prototype's in-browser data and the demo sign-in.
// "real" routes sign-in, sign-up, password reset and invitations to the API.
// Set with VITE_API_MODE in client/.env.local. A release build (`npm run
// build:release`, vite --mode release) is real whatever the environment says:
// the constant lets the bundler drop the mock code (scripts/assert-release.mjs).
export const API_MODE = import.meta.env.MODE === 'release' || import.meta.env.VITE_API_MODE === 'real' ? 'real' : 'mock'
