import "dotenv/config";

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { parseConfig } from "./cfg.js";
import type { Config, DiscoveryResult, ManagedRecord, State } from "./types.js";
import {
    fetchAllARecords,
    fetchAllZones,
    fetchCurrentIp,
    fetchManagedRecord,
    readState,
    sleep,
    updateManagedRecord,
    writeState,
} from "./utils.js";

/**
 * Rebuilds managed state from Cloudflare so deleted or manually changed records opt out safely.
 */
async function discoverManagedRecords(
    config: Config,
    expectedIp: string,
    existingRecords: ManagedRecord[],
): Promise<DiscoveryResult> {
    const zones = await fetchAllZones(config);
    const existingRecordIds = new Set(existingRecords.map((record) => record.recordId));
    const managedRecords: ManagedRecord[] = [];
    let addedCount = 0;

    for (const zone of zones) {
        const records = await fetchAllARecords(config, zone);
        const matchingRecords = records.filter((record) => record.content === expectedIp);

        for (const record of matchingRecords) {
            if (!existingRecordIds.has(record.id)) {
                addedCount += 1;
                console.log(`Discovered ${record.name}.`);
            }

            managedRecords.push({
                zoneId: record.zone_id,
                zoneName: record.zone_name,
                recordId: record.id,
                name: record.name,
            });
        }
    }

    return {
        addedCount,
        records: managedRecords,
        removedCount: existingRecords.length + addedCount - managedRecords.length,
    };
}

/**
 * Refreshes only the persisted record IDs because names/IPs alone are not stable ownership signals.
 */
async function updateRecords(
    config: Config,
    state: State,
    newIp: string,
): Promise<ManagedRecord[]> {
    const updatedRecords: ManagedRecord[] = [];

    for (const record of state.records) {
        const currentRecord = await fetchManagedRecord(config, record);

        if (currentRecord.content === newIp) {
            console.log(`${record.name} already points to ${newIp}.`);
        } else {
            const updatedRecord = await updateManagedRecord(config, record, currentRecord, newIp);
            console.log(
                `${updatedRecord.name}: ${currentRecord.content} -> ${updatedRecord.content}`,
            );
        }

        updatedRecords.push(record);
    }

    return updatedRecords;
}

async function runCycle(config: Config, state: State): Promise<State> {
    const currentIp = await fetchCurrentIp();
    const discoveryIp = state.lastKnownIp ?? currentIp;
    const discovery = await discoverManagedRecords(config, discoveryIp, state.records);
    const records = discovery.records;

    if (state.records.length === 0 && records.length > 0) {
        console.log(`Bootstrapped ${records.length} managed A record(s) for ${currentIp}.`);
    } else {
        if (discovery.addedCount > 0) {
            console.log(`Discovered ${discovery.addedCount} new managed A record(s).`);
        }

        if (discovery.removedCount > 0) {
            console.log(`Removed ${discovery.removedCount} unmanaged A record(s) from state.`);
        }
    }

    if (state.lastKnownIp === null) {
        return {
            lastKnownIp: currentIp,
            records,
        };
    }

    if (state.lastKnownIp === currentIp) {
        console.log(`Public IPv4 unchanged: ${currentIp}.`);
        return {
            lastKnownIp: currentIp,
            records,
        };
    }

    console.log(`Public IPv4 changed: ${state.lastKnownIp ?? "unknown"} -> ${currentIp}.`);

    const updatedRecords = await updateRecords(config, { ...state, records }, currentIp);

    return {
        lastKnownIp: currentIp,
        records: updatedRecords,
    };
}

async function main(): Promise<void> {
    const config = parseConfig();
    let state = await readState(config.stateFile);

    console.log(`9flare starting from ${dirname(fileURLToPath(import.meta.url))}.`);
    console.log(`Check interval: ${config.checkIntervalSeconds} seconds.`);
    console.log(`State file: ${config.stateFile}.`);

    while (true) {
        try {
            state = await runCycle(config, state);
            await writeState(config.stateFile, state);
        } catch (err) {
            console.error(err instanceof Error ? err.message : err);
        }

        await sleep(config.checkIntervalSeconds * 1000);
    }
}

await main();
