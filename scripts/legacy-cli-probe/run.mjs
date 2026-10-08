import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const checkout = process.argv[2] && resolve(process.argv[2]);
if (!checkout) throw new Error('Usage: node scripts/legacy-cli-probe/run.mjs /path/to/pinned-cli [--live-cn]');
const pkg = JSON.parse(await readFile(join(checkout, 'package.json'), 'utf8'));
if (pkg.name !== 'leetcode-cli' || pkg.version !== '2.6.2') throw new Error('Expected the pinned skygragon CLI 2.6.2 checkout');
const directory = await mkdtemp(join(tmpdir(), 'pi-lc-probe-results-'));
const preload = fileURLToPath(new URL('./preload.cjs', import.meta.url));
const scenarios = ['help', 'error', 'fixture-run', 'fixture-submit', ...(process.argv.includes('--live-cn') ? ['live-cn'] : [])];
const reports = [];
for (const scenario of scenarios) {
    const data = await mkdtemp(join(directory, `${scenario}-`));
    const args = scenario === 'help' ? ['submit', '--help'] : scenario === 'fixture-run' ? ['test', join(data, '1.two-sum.go'), '--json'] : scenario === 'fixture-submit' ? ['submit', join(data, '1.two-sum.go'), '--json'] : ['list'];
    const report = await new Promise((resolveResult, reject) => {
        // Allowlist environment: no user auth or proxy credentials inherited.
        const child = spawn(process.execPath, ['--require', preload, join(checkout, 'bin/leetcode'), ...args], {
            cwd: data,
            env: { PATH: process.env.PATH, TERM: 'dumb', NO_COLOR: '1', PI_LC_PROBE_CHECKOUT: checkout, PI_LC_PROBE_DATA: data, PI_LC_PROBE_SCENARIO: scenario },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdout = '', stderr = '', timeout = false;
        const timer = setTimeout(() => { timeout = true; child.kill('SIGKILL'); }, 20000);
        child.stdout.on('data', chunk => { stdout = (stdout + chunk).slice(0, 20000); });
        child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(0, 20000); });
        child.on('error', error => { clearTimeout(timer); reject(error); });
        child.on('close', (code, signal) => {
            clearTimeout(timer);
            let jsonOutput = false;
            try { JSON.parse(stdout); jsonOutput = true; } catch {}
            resolveResult({ scenario, args, code, signal, timeout, jsonOutput, stdout, stderr });
        });
    });
    let requests = [];
    try { requests = JSON.parse(await readFile(join(data, 'requests.json'), 'utf8')); } catch {}
    reports.push({ ...report, requests });
}
await writeFile(join(directory, 'report.json'), JSON.stringify({ node: process.version, cliVersion: pkg.version, reports }, null, 2));
console.log(JSON.stringify({ directory, node: process.version, reports }, null, 2));
