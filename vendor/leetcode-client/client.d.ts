import { Got } from 'got';
import { z } from 'zod';

type ClientErrorKind = 'auth' | 'forbidden' | 'throttled' | 'network' | 'protocol' | 'platform' | 'cancelled';
/** No raw HTTP error/cause is retained: these may contain credential headers. */
declare class ClientError extends Error {
    readonly kind: ClientErrorKind;
    readonly outcomeUnknown: boolean;
    constructor(kind: ClientErrorKind, message: string, outcomeUnknown?: boolean);
}
interface JobOptions {
    signal?: AbortSignal;
}
interface RunRequest {
    titleSlug: string;
    code: string;
    lang: string;
    questionId: string;
    testcases: string;
}
type SubmitRequest = Omit<RunRequest, 'testcases'>;
interface Job {
    id: string;
    kind: 'run' | 'submit';
}
declare const JobResultSchema: z.ZodObject<{
    state: z.ZodEnum<{
        SUCCESS: "SUCCESS";
        FAILURE: "FAILURE";
    }>;
    status_code: z.ZodNumber;
    status_msg: z.ZodOptional<z.ZodString>;
    run_success: z.ZodOptional<z.ZodBoolean>;
    correct_answer: z.ZodOptional<z.ZodBoolean>;
    total_correct: z.ZodPipe<z.ZodOptional<z.ZodNullable<z.ZodNumber>>, z.ZodTransform<number | undefined, number | null | undefined>>;
    total_testcases: z.ZodPipe<z.ZodOptional<z.ZodNullable<z.ZodNumber>>, z.ZodTransform<number | undefined, number | null | undefined>>;
    status_runtime: z.ZodOptional<z.ZodString>;
    status_memory: z.ZodOptional<z.ZodString>;
    runtime_percentile: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    memory_percentile: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    code_answer: z.ZodOptional<z.ZodArray<z.ZodString>>;
    expected_code_answer: z.ZodOptional<z.ZodArray<z.ZodString>>;
    code_output: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>]>>;
    last_testcase_output: z.ZodOptional<z.ZodString>;
    expected_output: z.ZodOptional<z.ZodString>;
    std_output: z.ZodOptional<z.ZodString>;
    std_output_list: z.ZodOptional<z.ZodArray<z.ZodString>>;
    compile_error: z.ZodOptional<z.ZodString>;
    full_compile_error: z.ZodOptional<z.ZodString>;
    runtime_error: z.ZodOptional<z.ZodString>;
    full_runtime_error: z.ZodOptional<z.ZodString>;
    last_testcase: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
type JobResult = z.infer<typeof JobResultSchema>;
type JobStatus = {
    state: 'pending';
} | {
    state: 'complete';
    result: JobResult;
};
declare function clientError(error: unknown, mutation?: boolean): ClientError;

interface LeetCodeCredentials {
    csrfToken: string;
    session: string;
}
interface Problem {
    questionId: string;
    questionFrontendId: string;
    title: string;
    titleSlug: string;
    difficulty: 'Easy' | 'Medium' | 'Hard';
    isPaidOnly: boolean;
    acRate: number;
    topicTags: TopicTag[];
    status: 'ac' | 'notac' | null;
}
interface TopicTag {
    name: string;
    slug: string;
}
interface ProblemDetail extends Problem {
    content: string | null;
    codeSnippets: CodeSnippet[] | null;
    sampleTestCase: string;
    exampleTestcases: string;
    exampleTestcaseList?: string[];
    metaData?: string;
    hints: string[];
    companyTags: CompanyTag[] | null;
    stats: string;
}
interface CodeSnippet {
    lang: string;
    langSlug: string;
    code: string;
}
interface CompanyTag {
    name: string;
    slug: string;
}
interface DailyChallenge {
    date: string;
    link: string;
    question: Problem;
}
interface Contest {
    title: string;
    titleSlug: string;
    startTime: number;
    duration: number;
    originStartTime?: number | null;
    isVirtual?: boolean | null;
    containsPremium?: boolean | null;
}
interface ContestQuestion {
    questionId: string;
    questionFrontendId?: string;
    title: string;
    titleSlug: string;
    difficulty?: 'Easy' | 'Medium' | 'Hard' | null;
}
interface ContestDetail extends Contest {
    description?: string | null;
    questions: ContestQuestion[];
}
interface SubmissionResult {
    status_code: number;
    status_msg: string;
    state: string;
    run_success?: boolean;
    total_correct?: number;
    total_testcases?: number;
    status_runtime?: string;
    status_memory?: string;
    runtime_percentile?: number | null;
    memory_percentile?: number | null;
    code_output?: string;
    std_output?: string;
    expected_output?: string;
    compile_error?: string;
    runtime_error?: string;
    last_testcase?: string;
}
interface TestResult {
    status_code: number;
    status_msg: string;
    state: string;
    run_success?: boolean;
    code_answer?: string[];
    expected_code_answer?: string[];
    correct_answer?: boolean;
    std_output_list?: string[];
    compile_error?: string;
    runtime_error?: string;
}
interface Submission {
    id: string;
    statusDisplay: string;
    lang: string;
    runtime: string;
    timestamp: string;
    memory: string;
}
interface SubmissionDetails {
    code: string;
    runtime?: number | string | null;
    runtimeDisplay?: string | null;
    runtimePercentile?: number | null;
    memory?: number | string | null;
    memoryDisplay?: string | null;
    memoryPercentile?: number | null;
    statusDisplay?: string | null;
    lang?: {
        name: string;
    } | null;
}
interface ProblemListFilters {
    difficulty?: 'EASY' | 'MEDIUM' | 'HARD';
    status?: 'NOT_STARTED' | 'AC' | 'TRIED';
    tags?: string[];
    searchKeywords?: string;
    limit?: number;
    skip?: number;
}
type LeetCodeSite = 'leetcode.com' | 'leetcode.cn';

declare class LeetCodeClient {
    private client;
    private credentials;
    private site;
    private queries;
    constructor(site?: LeetCodeSite, transport?: Got);
    private createHttpClient;
    setSite(site: LeetCodeSite): void;
    getSite(): LeetCodeSite;
    setCredentials(credentials: LeetCodeCredentials): void;
    getCredentials(): LeetCodeCredentials | null;
    private resolveGraphQLEndpoints;
    private formatGraphQLError;
    private graphql;
    checkAuth(): Promise<{
        isSignedIn: boolean;
        username: string | null;
        userSlug?: string | null;
    }>;
    getProblems(filters?: ProblemListFilters): Promise<{
        total: number;
        problems: Problem[];
    }>;
    getProblem(titleSlug: string): Promise<ProblemDetail>;
    getProblemById(id: string): Promise<ProblemDetail>;
    getDailyChallenge(): Promise<DailyChallenge>;
    getContests(): Promise<Contest[]>;
    getContest(titleSlug: string): Promise<ContestDetail>;
    getRandomProblem(filters?: ProblemListFilters): Promise<string>;
    getUserProfile(username: string): Promise<{
        username: string;
        realName: string;
        ranking: number;
        acSubmissionNum: Array<{
            difficulty: string;
            count: number;
        }>;
        streak: number;
        totalActiveDays: number;
        submissionCalendar: string;
    }>;
    getSkillStats(username: string): Promise<{
        fundamental: Array<{
            tagName: string;
            tagSlug: string;
            problemsSolved: number;
        }>;
        intermediate: Array<{
            tagName: string;
            tagSlug: string;
            problemsSolved: number;
        }>;
        advanced: Array<{
            tagName: string;
            tagSlug: string;
            problemsSolved: number;
        }>;
    }>;
    getSubmissionList(slug: string, limit?: number, offset?: number): Promise<Submission[]>;
    getSubmissionDetails(submissionId: number): Promise<SubmissionDetails>;
    startRun(request: RunRequest, options?: JobOptions): Promise<Job>;
    startSubmit(request: SubmitRequest, options?: JobOptions): Promise<Job>;
    checkJob(job: Job, options?: JobOptions): Promise<JobStatus>;
    testSolution(titleSlug: string, code: string, lang: string, testcases: string, questionId: string): Promise<TestResult>;
    submitSolution(titleSlug: string, code: string, lang: string, questionId: string): Promise<SubmissionResult>;
    private pollSubmission;
}

export { ClientError, type ClientErrorKind, type Job, type JobOptions, type JobResult, type JobStatus, LeetCodeClient, type LeetCodeCredentials, type LeetCodeSite, type Problem, type ProblemDetail, type ProblemListFilters, type RunRequest, type SubmitRequest, clientError };
