import path from 'path';
import { sleep } from './sleep.js';
import { spawnBackgroundChild } from './spawnBackgroundChild.js';
import { waitForLogFileUpdate } from "./waitForLogFileUpdate.js";

export async function spawnManagerProcess(detached = true) {
  const debug = true;
  
  debug && console.log('Starting manager at background and waiting for log update...');
  const script = path.resolve(
    deployRepositoryFolderPath,
    "index.js"
  );
  await Promise.all([
    waitForLogFileUpdate('manager'),
    spawnBackgroundChild(process.argv[0], [script, '--manager'], process.cwd(), detached),
  ]);
  debug && console.log('Log files updated and connection will be attempted');
  const list = await getLatestLogs('manager');
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
