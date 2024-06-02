import path from 'path';
import { deployRepositoryFolderPath, managerLog, managerPort } from '../../config.mjs';
import { sleep } from './sleep.mjs';
import { spawnBackgroundChild } from './spawnBackgroundChild.mjs';
import { waitForLogFileUpdate } from "./waitForLogFileUpdate.mjs";
import { getLatestLogs } from './getLatestLogs.mjs';

const debug = true;

export async function executeManagerAtBackground() {
  debug && console.log('Starting manager at background and waiting for log update...');
  const script = path.resolve(
    deployRepositoryFolderPath,
    "index.mjs"
  );
  await Promise.all([
    waitForLogFileUpdate(managerLog),
    spawnBackgroundChild(process.argv[0], [script, '--manager'], process.cwd(), true),
  ]);
  debug && console.log('Log files updated and connection will be attempted');
  const list = await getLatestLogs(managerLog);
  debug && console.log(`Last manager logs: ${JSON.stringify(list.slice(list.length - 2))}`);
  let success = false;
  for (let i = 0; i < 50; i++) {
    await sleep(100);
    try {
      const response = await fetch(
        `http://127.0.0.1:${managerPort}/`
      );
      const text = await response.text();
      if (response.ok && text.length) {
        success = true;
        break;
      }
    } catch (err) {
      // ignore
    }
  }
  if (!success) {
    throw new Error('Failed to execute manager at background');
  }
}
