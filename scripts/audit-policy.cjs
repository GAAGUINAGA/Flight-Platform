/* global __dirname, console, process */
const { execFileSync } = require('node:child_process');
const { join } = require('node:path');

const advisoryIds = (via) => (Array.isArray(via) ? via : [via]).flatMap((entry) => {
  if (typeof entry === 'string') return entry.match(/GHSA-[\w-]+/gi) ?? [];
  if (!entry || typeof entry !== 'object') return [];
  return [entry.url, entry.name, entry.title].flatMap((value) => typeof value === 'string' ? value.match(/GHSA-[\w-]+/gi) ?? [] : []);
}).map((id) => id.toUpperCase());

function evaluateAudit(report) {
  const violations = [];
  for (const [name, vulnerability] of Object.entries(report.vulnerabilities ?? {})) {
    const severity = vulnerability.severity;
    if (severity !== 'high' && severity !== 'critical') continue;
    const ids = advisoryIds(vulnerability.via);
    violations.push(`${name}: ${ids.join(', ') || 'advisory unavailable'} (${severity})`);
  }
  return violations;
}

function parseAuditOutput(output) {
  try {
    return JSON.parse(output);
  } catch {
    throw new Error('npm audit did not produce a valid JSON report');
  }
}

function readAuditReport(execute = execFileSync) {
  const root = join(__dirname, '..');
  const npmCli = process.env.npm_execpath;
  const command = npmCli ? process.execPath : 'npm';
  const args = npmCli ? [npmCli, 'audit', '--json'] : ['audit', '--json'];
  const options = { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] };
  try {
    return parseAuditOutput(execute(command, args, options));
  } catch (error) {
    if (error && error.status === 1 && typeof error.stdout === 'string') return parseAuditOutput(error.stdout);
    throw new Error('npm audit did not produce a valid JSON report');
  }
}

function main() {
  let report;
  try { report = readAuditReport(); } catch (error) { console.error(error.message); process.exitCode = 1; return; }
  const violations = evaluateAudit(report);
  if (violations.length) { console.error(`npm audit policy failed:\n${violations.map((line) => `- ${line}`).join('\n')}`); process.exitCode = 1; return; }
  console.log('npm audit policy passed: no high or critical vulnerabilities');
}

if (require.main === module) main();
module.exports = { evaluateAudit, readAuditReport };
