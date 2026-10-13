// Download the newest .sav from the dedicated server over SFTP.
// Env: SFTP_HOST, SFTP_PORT, SFTP_USER, SFTP_PASSWORD, optional SAVE_DIR.
// Writes save/latest.sav and state/source.json; sets changed=true|false for GitHub Actions.
import fs from 'node:fs';
import SftpClient from 'ssh2-sftp-client';

const { SFTP_HOST, SFTP_PORT = '22', SFTP_USER, SFTP_PASSWORD, SAVE_DIR, GITHUB_OUTPUT } = process.env;
const output = (k, v) => GITHUB_OUTPUT && fs.appendFileSync(GITHUB_OUTPUT, `${k}=${v}\n`);
const SKIP = new Set(['Content', 'Binaries', 'Engine', 'Plugins', 'steamapps', 'Logs', 'Crashes', 'linux64', 'Mods', 'Config']);

const sftp = new SftpClient();
await sftp.connect({ host: SFTP_HOST, port: Number(SFTP_PORT), username: SFTP_USER, password: SFTP_PASSWORD, readyTimeout: 30000 });

// Breadth-first search for a SaveGames folder when SAVE_DIR isn't set.
async function findSaveGames() {
  let queue = [await sftp.cwd()];
  for (let depth = 0; depth < 8 && queue.length; depth++) {
    const next = [];
    for (const dir of queue) {
      let entries;
      try { entries = await sftp.list(dir); } catch { continue; }
      for (const e of entries) {
        if (e.type !== 'd' || (e.name.startsWith('.') && e.name !== '.config') || SKIP.has(e.name)) continue;
        const path = `${dir === '/' ? '' : dir}/${e.name}`;
        if (e.name === 'SaveGames') return path;
        next.push(path);
      }
    }
    queue = next;
  }
  throw new Error('No SaveGames folder found - set the SAVE_DIR secret.');
}

async function listSaves(dir) {
  const out = [];
  for (const e of await sftp.list(dir)) {
    const path = `${dir}/${e.name}`;
    if (e.type === 'd') out.push(...await listSaves(path));
    // ServerSettings.<port>.sav holds the server's passwords - never touch it.
    else if (e.name.endsWith('.sav') && !e.name.startsWith('ServerSettings')) out.push({ path, name: e.name, size: e.size, mtime: e.modifyTime });
  }
  return out;
}

try {
  const dir = SAVE_DIR || await findSaveGames();
  console.log(`save folder: ${dir}`);
  const saves = await listSaves(dir);
  if (!saves.length) throw new Error(`No .sav files under ${dir}`);
  const newest = saves.sort((a, b) => b.mtime - a.mtime)[0];
  const source = { file: newest.path, size: newest.size, modified: new Date(newest.mtime).toISOString() };

  const prev = fs.existsSync('state/source.json') ? JSON.parse(fs.readFileSync('state/source.json', 'utf8')) : {};
  if (prev.file === source.file && prev.modified === source.modified && prev.size === source.size) {
    console.log(`unchanged: ${newest.name}`);
    output('changed', 'false');
  } else {
    fs.mkdirSync('save', { recursive: true });
    fs.mkdirSync('state', { recursive: true });
    await sftp.fastGet(newest.path, 'save/latest.sav');
    fs.writeFileSync('state/source.json', JSON.stringify(source, null, 2) + '\n');
    console.log(`downloaded ${newest.name} (${(newest.size / 1e6).toFixed(1)} MB, ${source.modified})`);
    output('changed', 'true');
    output('save_name', newest.name);
  }
} finally {
  await sftp.end();
}
