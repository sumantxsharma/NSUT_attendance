import { createApp } from './app';

// Vercel serverless entry: the same Express app, exported as a request handler.
// Bundled by scripts/vercel-build.mjs; no listen(), no static files (Vercel's CDN serves the web app).
export default createApp();
