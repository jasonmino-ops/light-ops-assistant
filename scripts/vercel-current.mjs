import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const PROJECT = process.env.VERCEL_PROJECT || 'light-ops-assistant';

function parseVercelJson(stdout) {
  const jsonStart = stdout.indexOf('{');
  if (jsonStart === -1) {
    throw new Error('Vercel CLI did not return JSON output.');
  }
  return JSON.parse(stdout.slice(jsonStart));
}

function formatTime(value) {
  if (!value) return '-';
  return new Date(value).toISOString();
}

function shortSha(value) {
  return value ? value.slice(0, 7) : '-';
}

async function main() {
  const { stdout } = await execFileAsync(
    'vercel',
    ['ls', PROJECT, '--format=json'],
    {
      cwd: process.cwd(),
      maxBuffer: 1024 * 1024 * 20,
    },
  );

  const data = parseVercelJson(stdout);
  const production = (data.deployments || []).find(
    (deployment) => deployment.target === 'production',
  );

  if (!production) {
    console.log(`Vercel project: ${PROJECT}`);
    console.log('Production deployment: not found');
    process.exitCode = 1;
    return;
  }

  const commitSha = production.meta?.githubCommitSha || '';
  const commitMessage = production.meta?.githubCommitMessage || '-';
  const url = production.url?.startsWith('http')
    ? production.url
    : `https://${production.url}`;

  console.log(`Vercel project: ${PROJECT}`);
  console.log(`Production URL: ${url}`);
  console.log(`Production commit: ${shortSha(commitSha)}${commitSha ? ` (${commitSha})` : ''}`);
  console.log(`Deployment State: ${production.state || '-'}`);
  console.log(`Created Time: ${formatTime(production.createdAt)}`);
  console.log(`Commit Message: ${commitMessage}`);
}

main().catch((error) => {
  console.error('Failed to read Vercel production deployment.');
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
