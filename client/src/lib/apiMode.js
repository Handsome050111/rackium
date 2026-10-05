// "mock" (default) keeps the prototype's in-browser data and the demo sign-in.
// "real" routes sign-in, sign-up, password reset and invitations to the API.
// Set with VITE_API_MODE in client/.env.local. Only auth uses the API in M1.
export const API_MODE = import.meta.env.VITE_API_MODE === 'real' ? 'real' : 'mock'
