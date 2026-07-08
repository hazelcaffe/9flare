import type { Config } from "./types.js";

export const cloudflareApiBaseUrl = "https://api.cloudflare.com/client/v4";
export const publicIpUrl = "https://api.ipify.org?format=json";

const defaultCheckIntervalSeconds = 300;
const minimumCheckIntervalSeconds = 60;
const defaultStateFile = ".9flare-state.json";

/**
 * Reads runtime settings from the environment after dotenv has populated process.env.
 */
export function parseConfig(): Config {
    const apiKey = process.env.CF_API_KEY;

    if (!apiKey) {
        throw new Error("Missing CF_API_KEY. Add it to your environment or .env file.");
    }

    const configuredInterval = process.env.CHECK_INTERVAL_SECONDS;
    const parsedInterval = configuredInterval
        ? Number.parseInt(configuredInterval, 10)
        : defaultCheckIntervalSeconds;

    // Cloudflare can tolerate more than this, but DDNS should avoid noisy polling by default.
    if (!Number.isFinite(parsedInterval) || parsedInterval < minimumCheckIntervalSeconds) {
        throw new Error(
            `CHECK_INTERVAL_SECONDS must be at least ${minimumCheckIntervalSeconds} seconds.`,
        );
    }

    return {
        apiKey,
        checkIntervalSeconds: parsedInterval,
        stateFile: process.env.STATE_FILE ?? defaultStateFile,
    };
}
