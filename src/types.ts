export type Config = {
    apiKey: string;
    checkIntervalSeconds: number;
    stateFile: string;
};

export type CloudflareError = {
    code: number;
    message: string;
};

export type CloudflareListResponse<T> = {
    success: boolean;
    errors: CloudflareError[];
    result: T[];
    result_info?: {
        page: number;
        per_page: number;
        total_pages: number;
        count: number;
        total_count: number;
    };
};

export type CloudflareItemResponse<T> = {
    success: boolean;
    errors: CloudflareError[];
    result: T;
};

export type CloudflareZone = {
    id: string;
    name: string;
};

export type CloudflareDnsRecord = {
    id: string;
    zone_id: string;
    zone_name: string;
    name: string;
    type: "A";
    content: string;
    ttl: number;
    proxied?: boolean;
};

export type ManagedRecord = {
    zoneId: string;
    zoneName: string;
    recordId: string;
    name: string;
};

export type State = {
    lastKnownIp: string | null;
    records: ManagedRecord[];
};

export type PublicIpResponse = {
    ip: string;
};
