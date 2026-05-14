/**
 * Watch `postman/api_bloxfi.postman_collection.json` and push updates to Postman via the Collections API.
 *
 * Credentials are intentionally NOT read from the project `.env` (keeps secrets out of the repo).
 *
 * Provide `POSTMAN_API_KEY` and `POSTMAN_COLLECTION_UID` via either:
 *   1. Your shell (e.g. `export …` in ~/.zshrc), or
 *   2. A file outside this repo, loaded in this order:
 *      - Path in `BLOXFI_POSTMAN_ENV` (optional; `~` is expanded), or if unset:
 *      - `$XDG_CONFIG_HOME/bloxfi/postman-sync.env`, or `~/.config/bloxfi/postman-sync.env`
 *
 * File format is standard dotenv, e.g.:
 *   POSTMAN_API_KEY=PMAK-…
 *   POSTMAN_COLLECTION_UID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
 *
 * API key: https://web.postman.co/settings/me/api-keys
 * Collection UID: UUID in the Postman app URL when the collection is open.
 *
 * Run from repo root:
 *   npm run postman:watch-sync
 *
 * One-shot push:
 *   npm run postman:watch-sync -- --once
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const COLLECTION_REL = path.join('postman', 'api_bloxfi.postman_collection.json');
const collectionPath = path.resolve(__dirname, '..', COLLECTION_REL);
const DEBOUNCE_MS = 900;

function expandHome(p) {
  if (typeof p !== 'string') return p;
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  if (p === '~') return os.homedir();
  return p;
}

/** Loads optional user-owned env file; never loads `<repo>/.env`. */
function loadDecoupledPostmanEnv() {
  const explicit = process.env.BLOXFI_POSTMAN_ENV;
  const configRoot = process.env.XDG_CONFIG_HOME
    ? path.join(process.env.XDG_CONFIG_HOME, 'bloxfi')
    : path.join(os.homedir(), '.config', 'bloxfi');
  const defaultPath = path.join(configRoot, 'postman-sync.env');
  const credPath = explicit ? expandHome(explicit) : defaultPath;

  if (!fs.existsSync(credPath)) {
    if (explicit) {
      console.error(`[postman-sync] BLOXFI_POSTMAN_ENV file not found: ${credPath}`);
    }
    return null;
  }

  require('dotenv').config({ path: credPath, override: false });
  return credPath;
}

function getPostmanCreds() {
  return {
    apiKey: process.env.POSTMAN_API_KEY,
    collectionUid: process.env.POSTMAN_COLLECTION_UID,
  };
}

async function pushCollection() {
  const { apiKey, collectionUid } = getPostmanCreds();
  if (!apiKey || !collectionUid) {
    console.error(
      '[postman-sync] Missing POSTMAN_API_KEY or POSTMAN_COLLECTION_UID. Set them in your shell or in ~/.config/bloxfi/postman-sync.env (see script header).',
    );
    return;
  }

  let collection;
  try {
    const raw = fs.readFileSync(collectionPath, 'utf8');
    collection = JSON.parse(raw);
  } catch (e) {
    console.error('[postman-sync] Could not read/parse collection file (save may be incomplete):', e.message);
    return;
  }

  if (!collection.info) {
    console.error('[postman-sync] Invalid collection: missing info');
    return;
  }

  if (!collection.info._postman_id) {
    collection.info._postman_id = collectionUid;
  }

  const res = await fetch(`https://api.getpostman.com/collections/${collectionUid}`, {
    method: 'PUT',
    headers: {
      'X-Api-Key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ collection }),
  });

  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }

  if (!res.ok) {
    console.error('[postman-sync] Push failed', res.status, body);
    return;
  }

  const name = body?.collection?.name ?? collection.info.name;
  console.log(`[postman-sync] OK — updated "${name}" (${new Date().toISOString()})`);
}

function main() {
  const once = process.argv.includes('--once');

  if (!fs.existsSync(collectionPath)) {
    console.error('Collection file not found:', collectionPath);
    process.exit(1);
  }

  const loadedFrom = loadDecoupledPostmanEnv();
  if (loadedFrom) {
    console.log(`[postman-sync] Loaded env from ${loadedFrom} (shell vars still override if set).`);
  }

  const { apiKey, collectionUid } = getPostmanCreds();
  if (!apiKey || !collectionUid) {
    console.error(
      'Missing POSTMAN_API_KEY or POSTMAN_COLLECTION_UID after loading decoupled config.\n' +
        '  Create ~/.config/bloxfi/postman-sync.env or set BLOXFI_POSTMAN_ENV to another path.\n' +
        '  Or export both variables in your shell.',
    );
    process.exit(1);
  }

  if (once) {
    pushCollection().catch((e) => {
      console.error(e);
      process.exit(1);
    });
    return;
  }

  let timer;
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      pushCollection().catch((e) => console.error('[postman-sync]', e));
    }, DEBOUNCE_MS);
  };

  fs.watch(collectionPath, { persistent: true }, (eventType) => {
    if (eventType === 'change') {
      schedule();
    }
  });

  console.log(`Watching ${path.relative(process.cwd(), collectionPath)} → Postman (debounce ${DEBOUNCE_MS}ms). Ctrl+C to stop.`);
}

main();
