// Test harness only: isolate the pinned upstream CLI without changing HOME.
const path = require('node:path');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const root = process.env.PI_LC_PROBE_CHECKOUT;
const data = process.env.PI_LC_PROBE_DATA;
const scenario = process.env.PI_LC_PROBE_SCENARIO;
if (!root || !data || !['help', 'error', 'fixture-run', 'fixture-submit', 'live-cn'].includes(scenario)) throw new Error('Invalid probe configuration');
const upstream = createRequire(path.join(root, 'package.json'));
const file = upstream('./lib/file.js');
file.userHomeDir = () => data;
const state = path.join(data, '.lc');
for (const app of ['leetcode', 'leetcode.cn']) fs.mkdirSync(path.join(state, app, 'cache'), { recursive: true });
fs.writeFileSync(path.join(state, 'config.json'), JSON.stringify({ color: { enable: false }, sys: { categories: ['algorithms'] }, network: { concurrency: 1, delay: 0 }, autologin: { enable: false } }));
fs.writeFileSync(path.join(state, 'plugins.json'), JSON.stringify({ 'leetcode.cn': scenario === 'live-cn', retry: false }));
const requestId = upstream.resolve('request');
const original = upstream('request');
const requests = [];
const audit = () => fs.writeFileSync(path.join(data, 'requests.json'), JSON.stringify(requests, null, 2));
process.on('exit', audit);
function fixture(url) {
    if (url.includes('/api/problems/')) return { user_name: 'fixture-user', category_slug: 'algorithms', stat_status_pairs: [{ status: null, paid_only: false, is_favor: false, difficulty: { level: 1 }, stat: { question_id: 1, frontend_question_id: 1, question__title: 'Two Sum', question__title_slug: 'two-sum', total_acs: 1, total_submitted: 2 } }] };
    if (url.endsWith('/graphql')) return { data: { question: { content: '<p>Fixture statement</p>', translatedContent: '', stats: '{"totalAccepted":"1","totalSubmission":"2"}', codeDefinition: '[{"value":"golang","defaultCode":"func twoSum() {}"}]', sampleTestCase: '[3,3]\n6', enableRunCode: true, metaData: '{}' } } };
    if (url.includes('/interpret_solution/')) return { interpret_id: 'fixture-run-actual', interpret_expected_id: 'fixture-run-expected' };
    if (url.includes('/submit/')) return { submission_id: 'fixture-submission-123' };
    if (url.includes('/check/')) return { state: 'SUCCESS', status_code: 10, run_success: true, status_runtime: '0 ms', total_correct: 1, total_testcases: 1, code_answer: ['[0,1]'], code_output: '[0,1]', expected_output: '[0,1]', judge_type: scenario === 'fixture-submit' ? 'large' : 'small' };
    if (url.includes('/submissions/detail/')) return '';
    throw new Error('Unexpected fixture request');
}
function intercepted(options, cb) {
    const opts = typeof options === 'string' ? { url: options } : options;
    const url = new URL(opts.url);
    const method = opts.method || (opts.body ? 'POST' : 'GET');
    requests.push({ method, url: url.origin + url.pathname });
    audit();
    if (scenario === 'live-cn') {
        if (!['leetcode-cn.com', 'leetcode.cn'].includes(url.hostname) || method !== 'GET' || !url.pathname.startsWith('/api/problems/')) {
            process.nextTick(() => cb(new Error('Probe permits only public catalog GET; authenticated operations are not tested')));
            return;
        }
        return original({ ...opts, timeout: 10000, followRedirect: true }, cb);
    }
    if (scenario === 'error' || scenario === 'help') {
        process.nextTick(() => cb(new Error('FIXTURE_NETWORK_FAILURE')));
        return;
    }
    process.nextTick(() => {
        const body = fixture(url.href);
        cb(null, { statusCode: 200 }, opts.json ? body : typeof body === 'string' ? body : JSON.stringify(body));
    });
}
intercepted.post = (opts, cb) => intercepted({ ...opts, method: 'POST' }, cb);
intercepted.get = (opts, cb) => intercepted(typeof opts === 'string' ? { url: opts, method: 'GET' } : { ...opts, method: 'GET' }, cb);
require.cache[requestId].exports = intercepted;
if (scenario.startsWith('fixture-')) {
    upstream('./lib/session.js').getUser = () => ({ name: 'fixture-user', paid: false, sessionId: 'fixture-only', sessionCSRF: 'fixture-only' });
    fs.writeFileSync(path.join(data, '1.two-sum.go'), '// @lc app=leetcode id=1 lang=golang\nfunc twoSum(nums []int, target int) []int { return []int{0,1} }\n');
}
