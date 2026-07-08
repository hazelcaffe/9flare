import { readFile, rename, writeFile } from "node:fs/promises";
import { isIPv4 } from "node:net";

import { cloudflareApiBaseUrl, publicIpUrl } from "./cfg.js";
import type {
    CloudflareDnsRecord,
    CloudflareError,
    CloudflareItemResponse,
    CloudflareListResponse,
    CloudflareZone,
    Config,
    ManagedRecord,
    PublicIpResponse,
    State,
} from "./types.js";

export function sleep(milliseconds: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, milliseconds);
    });
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
    return typeof value === "string";
}

/**
 * Loads persisted record selection so restarts do not accidentally manage unrelated DNS records.
 */
export async function readState(stateFile: string): Promise<State> {
    try {
        const rawState = await readFile(stateFile, "utf8");
        const parsedState: unknown = JSON.parse(rawState);

        if (!isValidState(parsedState)) {
            throw new Error(`State file ${stateFile} is invalid.`);
        }

        return parsedState;
    } catch (err) {
        if (isNodeError(err) && err.code === "ENOENT") {
            return {
                lastKnownIp: null,
                records: [],
            };
        }

        throw err;
    }
}

/**
 * Writes state atomically enough for normal service restarts and simple process managers.
 */
export async function writeState(stateFile: string, state: State): Promise<void> {
    const temporaryStateFile = `${stateFile}.tmp`;
    await writeFile(temporaryStateFile, `${JSON.stringify(state, null, 4)}\n`, "utf8");
    await rename(temporaryStateFile, stateFile);
}

function isValidState(value: unknown): value is State {
    if (!isRecord(value)) {
        return false;
    }

    const lastKnownIp = value.lastKnownIp;
    const records = value.records;

    if (!(lastKnownIp === null || isString(lastKnownIp)) || !Array.isArray(records)) {
        return false;
    }

    return records.every(isManagedRecord);
}

function isManagedRecord(value: unknown): value is ManagedRecord {
    return (
        isRecord(value) &&
        isString(value.zoneId) &&
        isString(value.zoneName) &&
        isString(value.recordId) &&
        isString(value.name)
    );
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
    return error instanceof Error && "code" in error;
}

async function cloudflareFetch<T>(config: Config, path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${cloudflareApiBaseUrl}${path}`, {
        ...init,
        headers: {
            Authorization: `Bearer ${config.apiKey}`,
            "Content-Type": "application/json",
            ...init?.headers,
        },
    });

    const responseBody: unknown = await response.json();

    if (!response.ok) {
        throw new Error(`Cloudflare API request failed: ${response.status} ${response.statusText}`);
    }

    if (!isCloudflareResponse(responseBody)) {
        throw new Error("Cloudflare API returned an unexpected response.");
    }

    if (!responseBody.success) {
        throw new Error(`Cloudflare API error: ${formatCloudflareErrors(responseBody.errors)}`);
    }

    return responseBody as T;
}

function isCloudflareResponse(
    value: unknown,
): value is { success: boolean; errors: CloudflareError[] } {
    return isRecord(value) && typeof value.success === "boolean" && Array.isArray(value.errors);
}

function formatCloudflareErrors(errors: CloudflareError[]): string {
    if (errors.length === 0) {
        return "unknown error";
    }

    return errors.map((error) => `${error.code}: ${error.message}`).join(", ");
}

/**
 * Fetches the address Cloudflare should publish for this host's managed A records.
 */
export async function fetchCurrentIp(): Promise<string> {
    const response = await fetch(publicIpUrl);

    if (!response.ok) {
        throw new Error(`Failed to fetch public IPv4: ${response.status} ${response.statusText}`);
    }

    const responseBody: unknown = await response.json();

    if (!isPublicIpResponse(responseBody)) {
        throw new Error("Public IPv4 service returned an unexpected response.");
    }

    return responseBody.ip;
}

function isPublicIpResponse(value: unknown): value is PublicIpResponse {
    return isRecord(value) && isString(value.ip) && isIPv4(value.ip);
}

export async function fetchAllZones(config: Config): Promise<CloudflareZone[]> {
    const zones: CloudflareZone[] = [];
    let page = 1;

    while (true) {
        const response = await cloudflareFetch<CloudflareListResponse<CloudflareZone>>(
            config,
            `/zones?per_page=50&page=${page}`,
        );

        zones.push(...response.result);

        if (!response.result_info || page >= response.result_info.total_pages) {
            return zones;
        }

        page += 1;
    }
}

export async function fetchAllARecords(
    config: Config,
    zone: CloudflareZone,
): Promise<CloudflareDnsRecord[]> {
    const records: CloudflareDnsRecord[] = [];
    let page = 1;

    while (true) {
        const response = await cloudflareFetch<CloudflareListResponse<CloudflareDnsRecord>>(
            config,
            `/zones/${zone.id}/dns_records?type=A&per_page=100&page=${page}`,
        );

        records.push(...response.result);

        if (!response.result_info || page >= response.result_info.total_pages) {
            return records;
        }

        page += 1;
    }
}

export async function fetchManagedRecord(
    config: Config,
    record: ManagedRecord,
): Promise<CloudflareDnsRecord> {
    const response = await cloudflareFetch<CloudflareItemResponse<CloudflareDnsRecord>>(
        config,
        `/zones/${record.zoneId}/dns_records/${record.recordId}`,
    );

    return response.result;
}

/**
 * PATCH preserves Cloudflare-side metadata better than replacing records wholesale.
 */
export async function updateManagedRecord(
    config: Config,
    record: ManagedRecord,
    currentRecord: CloudflareDnsRecord,
    newIp: string,
): Promise<CloudflareDnsRecord> {
    const response = await cloudflareFetch<CloudflareItemResponse<CloudflareDnsRecord>>(
        config,
        `/zones/${record.zoneId}/dns_records/${record.recordId}`,
        {
            body: JSON.stringify({
                content: newIp,
                name: currentRecord.name,
                proxied: currentRecord.proxied,
                ttl: currentRecord.ttl,
                type: "A",
            }),
            method: "PATCH",
        },
    );

    return response.result;
}
