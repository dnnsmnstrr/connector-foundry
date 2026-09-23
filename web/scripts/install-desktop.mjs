#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { lstat, mkdir, mkdtemp, realpath, rename, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const web = fileURLToPath(new URL('../', import.meta.url));
const appName = 'Connector Foundry.app';
const bundleId = 'com.connectorfoundry.desktop';

function run(command, args, options = {}) {
  return execFileSync(command, args, { encoding: 'utf8', ...options });
}
async function exists(file) {
  try { await lstat(file); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
async function validate(appPath) {
  const stat = await lstat(appPath);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Expected an app directory, not a symlink: ${appPath}`);
  const id = run('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleIdentifier', path.join(appPath, 'Contents/Info.plist')]).trim();
  if (id !== bundleId) throw new Error(`Refusing to replace or install an unrelated app: ${appPath}`);
}
function runningAppProcesses(target) {
  const executable = path.join(target, 'Contents/MacOS/Connector Foundry');
  const frameworks = path.join(target, 'Contents/Frameworks') + path.sep;
  return run('/bin/ps', ['-axo', 'pid=,comm=']).split('\n').flatMap((line) => {
    const match = line.match(/^\s*(\d+)\s+(.+)$/);
    if (!match) return [];
    let command = match[2];
    // macOS can report /tmp for the main executable but /private/tmp for
    // its helpers. Resolve aliases so both refer to the same installed app.
    if (path.isAbsolute(command)) {
      try { command = realpathSync(command); }
      catch { /* A process may exit or its executable may disappear mid-scan. */ }
    }
    // Match executable paths, not names or command-line arguments. Other
    // Electron apps and copies installed elsewhere must remain untouched.
    return command === executable || command.startsWith(frameworks) ? [Number(match[1])] : [];
  });
}
function signalProcesses(pids, signal) {
  for (const pid of pids) {
    try { process.kill(pid, signal); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
}
async function ensureAppStopped(target, force) {
  if (runningAppProcesses(target).length === 0) return;
  if (!force) throw new Error('Quit Connector Foundry first, or use --force to terminate it. Forced termination can discard unsaved changes.');
  console.log('Stopping the installed Connector Foundry app (--force); unsaved changes may be lost.');
  // Re-read the process list before each signal, including escalation, to
  // avoid using stale PIDs from before the build/copy or an earlier poll.
  for (const [signal, timeout] of [['SIGTERM', 3000], ['SIGKILL', 2000]]) {
    signalProcesses(runningAppProcesses(target), signal);
    const deadline = Date.now() + timeout;
    do {
      if (runningAppProcesses(target).length === 0) return;
      await delay(100);
    } while (Date.now() < deadline);
  }
  throw new Error('Connector Foundry did not stop. The installed app has not been replaced.');
}

async function main() {
  let build = true;
  let launch = false;
  let force = false;
  let destination;
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--no-build') build = false;
    else if (args[i] === '--open') launch = true;
    else if (args[i] === '--force') force = true;
    else if (args[i] === '--destination' && args[i + 1] && !args[i + 1].startsWith('--')) destination = path.resolve(args[++i]);
    else if (args[i] === '--help') {
      console.log('Usage: npm run desktop:install -- [--no-build] [--open] [--force] [--destination DIRECTORY]\n\nBuilds and installs the native app. Updates an existing /Applications copy;\notherwise installs in ~/Applications without sudo. Quit the installed app first.\n--no-build uses the existing release bundle for this machine’s architecture.\n--open launches the installed app after a successful update.\n--force terminates the installed app before replacement (SIGTERM, then SIGKILL if needed). Unsaved changes may be lost.');
      return;
    } else throw new Error(`Unknown or incomplete option: ${args[i]}`);
  }
  if (process.platform !== 'darwin') throw new Error('This installer requires macOS.');
  if (!['arm64', 'x64'].includes(process.arch)) throw new Error(`Unsupported architecture: ${process.arch}`);
  destination ??= await exists(path.join('/Applications', appName)) ? '/Applications' : path.join(os.homedir(), 'Applications');
  await mkdir(destination, { recursive: true });
  destination = await realpath(destination);
  const target = path.join(destination, appName);
  if (await exists(target)) await validate(target);
  if (!force) await ensureAppStopped(target, false);

  if (build) {
    console.log('Building Connector Foundry…');
    if (process.env.npm_execpath) run(process.execPath, [process.env.npm_execpath, 'run', 'desktop:pack'], { cwd: web, stdio: 'inherit' });
    else run('npm', ['run', 'desktop:pack'], { cwd: web, stdio: 'inherit' });
  }
  const source = path.join(web, 'release', process.arch === 'arm64' ? 'mac-arm64' : 'mac', appName);
  if (!await exists(source)) throw new Error(`No built app at ${source}. Run npm run desktop:pack first.`);
  if (await realpath(source) === target) throw new Error('The install destination must be outside the build output.');
  await validate(source);
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', source]);
  const architectures = run('/usr/bin/lipo', ['-archs', path.join(source, 'Contents/MacOS/Connector Foundry')]).trim().split(/\s+/);
  if (!architectures.includes(process.arch === 'arm64' ? 'arm64' : 'x86_64')) throw new Error('The built app does not support this machine’s architecture.');

  // Stage on the same volume so the final rename is atomic. Keep the old app
  // until the complete copy has passed signature validation, and roll back if
  // replacing it fails. Never touch the user’s Application Support directory.
  const staging = await mkdtemp(path.join(destination, '.connector-foundry-install-'));
  const stagedApp = path.join(staging, appName);
  const previous = path.join(staging, 'previous.app');
  let backedUp = false;
  let installed = false;
  try {
    console.log(`Installing into ${target}…`);
    run('/usr/bin/ditto', [source, stagedApp]);
    run('/usr/bin/codesign', ['--verify', '--deep', '--strict', stagedApp]);
    if (await exists(target)) {
      await validate(target);
    }
    // With --force, only interrupt the app once its replacement is ready.
    await ensureAppStopped(target, force);
    if (await exists(target)) {
      await rename(target, previous);
      backedUp = true;
    }
    await rename(stagedApp, target);
    installed = true;
  } catch (error) {
    if (backedUp && !installed) {
      try { await rename(previous, target); backedUp = false; }
      catch { throw new Error(`Install failed. Your previous app is preserved at ${previous}. Original error: ${error.message}`); }
    }
    throw error;
  } finally {
    // Retain the backup if restoration itself failed.
    if (installed || !backedUp) await rm(staging, { recursive: true, force: true });
  }
  console.log(`Installed: ${target}`);
  if (launch) run('/usr/bin/open', [target]);
}

main().catch((error) => {
  console.error(`Installation failed: ${error.message}`);
  if (['EACCES', 'EPERM'].includes(error.code)) console.error('Choose a writable folder with --destination "$HOME/Applications".');
  process.exitCode = 1;
});
