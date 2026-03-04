/**
 * Centralized app config for environment-based URLs.
 * Use APP_BASE_URL for all external links (emails, SMS, redirects) to the frontend app.
 *
 * development:  APP_BASE_URL=http://localhost:3000
 * production:   APP_BASE_URL=https://sahaya.pariskq.in
 */
const APP_BASE_URL = (process.env.APP_BASE_URL || "http://localhost:3000").replace(/\/$/, "");

export { APP_BASE_URL };
