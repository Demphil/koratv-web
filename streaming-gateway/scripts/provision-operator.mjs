import { randomBytes } from 'node:crypto';
import { writeFile, mkdir, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { hashOperatorPassword } from '../operator-auth.js';

const password = randomBytes(24).toString('base64url');
const hash = await hashOperatorPassword(password);
execFileSync('gh', ['secret', 'set', 'BROADCAST_ADMIN_PASSWORD_HASH', '--repo', 'Demphil/koratv-web'], { input: hash, stdio: ['pipe', 'pipe', 'pipe'] });
const dir = join(homedir(), '.codex', 'private-access');
await mkdir(dir, { recursive: true, mode: 0o700 });
const path = join(dir, `koratv-operator-${Date.now()}.txt`);
await writeFile(path, `URL: https://stream-api.koratv.click/api/operator/console\nUsername: admin\nPassword: ${password}\n`, { mode: 0o600 });
await chmod(path, 0o600);
console.log(JSON.stringify({ credentialFile: path, hashSecretConfigured: true }));
