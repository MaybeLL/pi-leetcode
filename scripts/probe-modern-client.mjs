// Probe a separately built, pinned upstream API module, never its CLI entrypoint.
// No user credentials, workspace, keychain, or authenticated network calls are used.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

if (!process.argv[2]) throw new Error('Usage: node scripts/probe-modern-client.mjs /path/to/probe-dist/client.js [--live-cn]');
const { LeetCodeClient } = await import(pathToFileURL(resolve(process.argv[2])).href);
const report = { node: process.version, fixture: {}, publicReads: [] };
const client = new LeetCodeClient('leetcode.cn');
let resolveCheck;
const checkGate = new Promise(resolveResult => { resolveCheck = resolveResult; });
let enteredCheck;
const checking = new Promise(resolveResult => { enteredCheck = resolveResult; });
let sends = 0, settled = false;
// Instrument this instance's private HTTP transport solely for protocol observation.
// This is not a supported upstream SDK and is not used by the plugin backend.
client.client = {
    post(endpoint) {
        assert.equal(endpoint, 'problems/two-sum/submit/');
        sends++;
        return { json: async () => ({ submission_id: 123 }) };
    },
    get(endpoint) {
        assert.equal(endpoint, 'submissions/detail/123/check/');
        enteredCheck();
        return { json: () => checkGate };
    },
};
const submission = client.submitSolution('two-sum', 'fixture code', 'golang', '1');
submission.then(() => { settled = true; });
await checking;
report.fixture = { sends, returnsBeforeJudge: settled, note: 'Mock HTTP only; no real submission' };
assert.equal(settled, false);
resolveCheck({ state: 'SUCCESS', status_code: 10, status_msg: 'Accepted', run_success: true,
    total_correct: 1, total_testcases: 1, status_runtime: '0 ms', status_memory: '1 MB', runtime_percentile: null, memory_percentile: null });
const result = await submission;
report.fixture.resultContainsJobId = 'submission_id' in result;
assert.equal(report.fixture.resultContainsJobId, false);

if (process.argv.includes('--live-cn')) {
    const live = new LeetCodeClient('leetcode.cn');
    const problems = await live.getProblems({ searchKeywords: 'two sum', limit: 2, skip: 0 });
    report.publicReads.push({ operation: 'search', count: problems.problems.length, total: problems.total });
    for (const slug of ['two-sum', 'reverse-linked-list', 'maximum-depth-of-binary-tree', 'min-stack']) {
        const problem = await live.getProblem(slug);
        const go = problem.codeSnippets.find(snippet => snippet.langSlug === 'golang');
        assert.ok(go?.code); assert.ok(problem.content);
        report.publicReads.push({ slug, id: problem.questionFrontendId, hasGoTemplate: true, contentLength: problem.content.length });
    }
}
console.log(JSON.stringify(report, null, 2));
