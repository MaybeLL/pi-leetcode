export interface Problem {
    source: "demo" | "leetcode";
    id: string;
    slug: string;
    title: string;
    language: string;
    statement: string;
    template: string;
    questionId?: string;
    difficulty?: string;
    inputs?: string[];
    metadata?: string;
}
export interface Credentials { session: string; csrf: string }
export interface Account { username: string; slug: string }
export interface ProblemSummary { id: string; slug: string; title: string; difficulty: string; paid: boolean }
export type FailureKind = "auth" | "forbidden" | "throttled" | "network" | "protocol" | "platform";
export class PlatformError extends Error {
    constructor(readonly kind: FailureKind, message: string, readonly outcomeUnknown = false) { super(message); }
}
export interface JudgeResult {
    verdict: string;
    passed?: number;
    total?: number;
    output?: string;
    expected?: string;
    diagnostic?: string;
    runtime?: string;
    memory?: string;
    stdout?: string;
    failingInput?: string;
}

/** A backend returns a job ID before polling; it never silently replays a send. */
export interface JudgeBackend {
    readonly id: string;
    start(kind: "run" | "submit", problem: Problem, code: string, input: string, signal?: AbortSignal): Promise<string>;
    check(id: string, kind: "run" | "submit", signal?: AbortSignal): Promise<JudgeResult | undefined>;
}

export interface LeetCodeBackend extends JudgeBackend {
    account(): Promise<Account>;
    search(keyword?: string, difficulty?: string, skip?: number): Promise<{ items: ProblemSummary[]; total: number }>;
    problem(reference: string): Promise<Problem>;
}

export type BackendFactory = (credentials?: Credentials, backendId?: string) => LeetCodeBackend;
export const DIRECT_BACKEND_ID = "leetcode-cn-direct-v1";
export const SDK_BACKEND_ID = "leetcode-cn-sdk-v1";
