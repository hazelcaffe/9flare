import "dotenv/config";

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { parseConfig } from "./cfg.js";
import type { Config, ManagedRecord, State } from "./types.js";
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
 * Selects records once so unrelated records with coincidentally matching future IPs stay untouched.
 */
async function bootstrapManagedRecords(
    config: Config,
    currentIp: string,
): Promise<ManagedRecord[]> {
    const zones = await fetchAllZones(config);
    const managedRecords: ManagedRecord[] = [];

    for (const zone of zones) {
        const records = await fetchAllARecords(config, zone);
        const matchingRecords = records.filter((record) => record.content === currentIp);

        for (const record of matchingRecords) {
            managedRecords.push({
                zoneId: record.zone_id,
                zoneName: record.zone_name,
                recordId: record.id,
                name: record.name,
            });
        }
    }

    return managedRecords;
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

    if (state.records.length === 0) {
        const records = await bootstrapManagedRecords(config, currentIp);

        console.log(`Bootstrapped ${records.length} managed A record(s) for ${currentIp}.`);

        return {
            lastKnownIp: currentIp,
            records,
        };
    }

    if (state.lastKnownIp === currentIp) {
        console.log(`Public IPv4 unchanged: ${currentIp}.`);
        return state;
    }

    console.log(`Public IPv4 changed: ${state.lastKnownIp ?? "unknown"} -> ${currentIp}.`);

    const records = await updateRecords(config, state, currentIp);

    return {
        lastKnownIp: currentIp,
        records,
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
