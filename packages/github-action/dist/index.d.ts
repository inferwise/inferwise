import type { Provider } from "@inferwise/pricing-db";
export interface ScanResult {
    filePath: string;
    lineNumber: number;
    provider: Provider;
    model: string | null;
    systemPrompt: string | null;
    userPrompt: string | null;
    maxOutputTokens: number | null;
    isDynamic: boolean;
}
export interface FileCostEntry {
    model: string;
    monthlyCost: number;
}
export declare function inferProvider(modelId: string): Provider | null;
export declare function computeFileCosts(results: ScanResult[], volume: number): Map<string, FileCostEntry[]>;
export declare function buildMarkdownReport(baseCosts: Map<string, FileCostEntry[]>, headCosts: Map<string, FileCostEntry[]>, volume: number, baseRef: string, headRef: string): {
    report: string;
    netDelta: number;
};
