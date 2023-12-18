// Node Deployment Script

// - Handles the CI/CD process for self-hosted node projects.

// This is an interactive script that setups a git repository on a server with automatic deployment.

// When changes are submited to the repository a git hook schedules the asyncronous deployment.
// The deployment is processed in steps that can be configured depending on the project.

const process = require('process');
const cp = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

const args = process.argv.slice(2).filter(a => a !== '--verbose');
const isVerbose = args.length + 2 !== process.argv.length;
const isScheduler = args[0] === '--scheduler' && args.length === 3;
const isManager = args[0] === '--manager' && args.length === 2;
const isProcessor = args[0] === '--processor' && args.length === 2;
const isSetup = args.length === 0 || args.length === 1;

/**
 * Object to persistent log
 */
const c = {
  logFilePath: path.resolve(process.cwd(), 'node-deployment.log'),
  lastFailFilePath: null,
  prefix: isScheduler ? ' [sc]' : isManager ? ' [ma]' : isProcessor ? ' [pr]' : ' [se]',
  log: (...args) => {
    const begining = `[${new Date().toISOString()}]${c.prefix} `;
    const parts = args.map(
      arg => arg instanceof Error ?
        arg.stack :
        typeof arg === 'string' ?
          arg.split('\n').map(line => begining + line).join('\n') :
          arg.toString()
    );
    const message = `${prefix}${parts.join(' ')}\n`;
    if (process.stdout && process.stdout.write) {
      process.stdout.write(message);
    }
    const logFilePath = c.logFilePath;
    if (!logFilePath) {
      return;
    }
    fs.promises.appendFile(logFilePath).catch((err) => {
      if (c.lastFailFilePath && logFilePath === c.lastFailFilePath) {
        return;
      }
      c.lastFailFilePath = logFilePath;
      console.log(`Failed while storing logs at "${logFilePath}": ${err.message}`);
    });
  },
  vlog: (...args) => isVerbose ? c.log('[verbose]', ...args) : null,
}

/*c.log = (...args) => {
  const begining = `[${new Date().toISOString()}]${c.prefix} `;
  const parts = args.map(
    arg => arg instanceof Error ?
      arg.stack :
      typeof arg === 'string' ?
        arg.split('\n').map(line => begining + line).join('\n') :
        arg.toString()
  );
  const message = `${prefix}${parts.join(' ')}\n`;
  if (process.stdout && process.stdout.write) {
    process.stdout.write(message);
  }
  const logFilePath = c.logFilePath;
  if (!logFilePath) {
    return;
  }
  fs.promises.appendFile(logFilePath).catch((err) => {
    if (c.lastFailFilePath && logFilePath === c.lastFailFilePath) {
      return;
    }
    c.lastFailFilePath = logFilePath;
    console.log(`Failed while storing logs at "${logFilePath}": ${err.message}`);
  });
}*/

if (isSetup) {
  executeProgramAs(nodeDeploymentSetup, 'Setup');
} else if (isManager) {
  executeProgramAs(nodeDeploymentManager, 'Instance Manager');
} else if (isProcessor) {
  executeProgramAs(nodeDeploymentProcessor, 'Deployment Processor');
} else if (isScheduler) {
  executeProgramAs(nodeDeploymentPostUpdate, 'Post Update');
} else {
  c.log(`Fatal error: Unhandled arguments supplied to node deployment script: ${args.length}`);
  process.exit(1);
}

async function nodeDeploymentManager() {
  const projectPath = path.resolve(args[1]);
  const config = await getProjectConfig(projectPath);
  if (!config) {
    throw new Error(`Could not load project configuration file for "${projectPath}"`);
  }
  if (config.logFilePath) {
    c.logFilePath = config.logFilePath;
  }
  c.log(`Instance manager started for "${projectPath}"`);

  c.log('');
  c.log('Initializing deployment processor from instance manager');

  await new Promise((resolve, reject) => {
    const processor = cp.spawn('node', ['./deployment/node-deployment.js', '--processor', projectPath], {
      cwd: projectPath,
      stdio: 'ignore'
    });
    processor.on('spawn', () => {
      c.log(`Deployment processor started`);
      resolve(processor);
    });
    processor.on('error', (err) => {
      c.log(`Deployment processor failed to start: ${err.message}`);
      reject(err);
    });
    processor.on('exit', (code) => {
      c.log(`Deployment processor exited with code ${code}`);
    });
  });

  c.log('');

  const instanceFilePath = path.resolve(projectPath, 'deployment', 'instance-path.txt');
  let instancePath = await asyncTryCatchNull(fs.promises.readFile(instanceFilePath, 'utf-8'));
  let instance;

  async function executeInstanceRestart(targetInstancePath) {
    const id = path.basename(targetInstancePath);
    c.log(`Processing ${instance ? 'restart' : 'start'} of instance for "${id}"`);
    const instanceBeingReplaced = instancePath;
    if (instance) {
      instance.kill();
      for (let i = 0; i < 20; i++) {
        if (!instance) {
          break;
        }
        await new Promise(resolve => setTimeout(resolve, i === 0 ? 100 : i === 1 ? 200 : 300));
      }
    }
    if (instance) {
      c.log(`Could not stop instance process running at "${instanceBeingReplaced}"`);
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
    if (instanceBeingReplaced !== instancePath) {
      c.log(`Aborting request for "${id}" because a newer request was received (${process.basename(instancePath)})`);
      return;
    }
    instancePath = targetInstancePath;
    instance = cp.spawn('npm', ['run', 'start'], {
      cwd: instancePath,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    instance.on('error', (err) => {
      console.log(`Instance from "${id}" failed to start: ${err.message}`);
      instance = null;
    });
    instance.on('exit', (code) => {
      console.log(`Instance from "${id}" exited with code ${JSON.stringify(code)}`);
      instance = null;
    });
    instance.on('spawn', () => {
      console.log(`Instance from "${id}" spawned`);
    });
    await fs.promises.writeFile(instanceFilePath, targetInstancePath, 'utf-8');
  }

  async function processRestartRequest(data) {
    if (!data || !data.repositoryPath) {
      throw new Error('Invalid input');
    }

    executeInstanceRestart(data.repositoryPath).catch((err) => {
      const id = path.basename(data.repositoryPath);
      c.log(`Instance restart for "${id}" failed: ${err.stack}`);
    });
  }

  c.log('');
  c.log(`Initializing instance manager server at http://localhost:${config.instanceManagerPort}/`);

  try {
    await new Promise((resolve, reject) => {
      const server = http.createServer(
        processHttpServerRequest.bind(
          null,
          'Instance Manager',
          processRestartRequest
        )
      );
      server.on('listening', () => resolve());
      server.on('error', reject);
      server.listen(config.instanceManagerPort);
    });
  } catch (err) {
    c.log(`Could not start instance manager server at tcp port ${config.instanceManagerPort}: ${err.message}`);
    process.exit(4);
  }

  c.log('');

  const pidFilePath = path.resolve(projectPath, 'deployment', 'manager-pid.txt');
  await fs.promises.writeFile(pidFilePath, process.pid.toString(), 'utf-8');

  if (instancePath) {
    c.log(`Initializing previous instance from "${instancePath}"`);
    try {
      await executeInstanceRestart(instancePath);
    } catch (err) {
      c.log(`Instance manager failed to start previous instance: ${err.message}`);
    }
  }
}

async function nodeDeploymentProcessor() {
  const projectPath = path.resolve(args[1]);
  const config = await getProjectConfig(projectPath);
  if (!config) {
    throw new Error(`Could not load project configuration file for "${projectPath}"`);
  }
  if (config.logFilePath) {
    c.logFilePath = config.logFilePath;
  }
  c.log(`Node deployment processor started for "${projectPath}"`);

  let runningPipelineId;
  let replacingPipelineId;

  async function executeDeployPipeline(id, repositoryPath) {
    c.log(`Deployment processing for pipeline "${id}" started`);
    const config = await getProjectConfig(projectPath);
    if (!config || !config.steps || !config.steps.length) {
      throw new Error('Missing config or pipeline steps');
    }
    const isFirstReuse = config.steps[0].id === 'reuse';
    const steps = isFirstReuse ? config.steps.slice(1) : config.steps;
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      if (runningPipelineId !== id || replacingPipelineId !== null) {
        c.log(`Pipeline ${id} - Cancelled at step ${i + 1}`);
        break;
      }
      c.log(`Pipeline ${id} - Starting step ${i + 1}: ${step.name}`);
      if (step.id === 'purge') {
        const instanceParentDir = path.dirname(repositoryPath);
        const pipelineList = await fs.promises.readdir(instanceParentDir);
        c.log(`There are currently ${version.length} pipeline folders at "${instanceParentDir}"`);
        const exceedList = pipelineList.length <= 15 ? [] : pipelineList.length <= 16 ? [pipelineList[0]] : [pipelineList[0], pipelineList[1]];
        if (exceedList.length === 0) {
          c.log(`Pipeline ${id} - Skipping step ${i + 1} because there aren\'t enough pipeline folders to trigger deletion`);
        } else {
          let hadError = false;
          for (let j = 0; j < exceedList.length; j++) {
            const pipelinePath = path.resolve(instanceParentDir, exceedList[i]);
            try {
              c.log(`Removing old pipeline folder at "${pipelinePath}"`);
              cp.execSync(`rm -rf "${pipelinePath}"`, {
                cwd: repositoryPath,
                stdio: 'inherit',
              });
            } catch (err) {
              hadError = true;
              c.log(`Failed at removing old pipeline folder of "${exceedList[i]}": ${err.message}`);
            }
          }
          c.log(`Pipeline ${id} - Finished step ${i + 1} ${hadError ? 'with errors' : 'without errors'}`);
        }
      } else if (step.id === 'restart') {
        const response = await fetch(`http://localhost:${config.instanceManagerPort}/`, {
          method: 'POST',
          body: JSON.stringify({ repositoryPath })
        });
        const text = await response.text();
        if (text) {
          console.log(`Instance manager response: ${text}`);
        }
        if (!response.ok) {
          throw new Error('Instance manager responded with error');
        }
        c.log(`Pipeline ${id} - Finished step ${i + 1} without errors`);
      } else if (step.id === 'install') {
        await new Promise((resolve, reject) => {
          const command = step.command.split('"');
          c.log(`Pipeline ${id} - Step ${i + 1} - $ ${command.join(' ')}`);
          const child = cp.spawn(command[0], command.slice(1), {
            cwd: repositoryPath,
            stdio: ['inherit', 'pipe', 'pipe']
          });
          child.stdout.on('data', (text) => {
            c.log(text.toString().replace(/\r/g, ''));
          });
          child.stderr.on('data', (text) => {
            c.log(text.toString().replace(/\r/g, ''));
          });
          child.on('error', reject);
          child.on('exit', code => {
            if (code === 0) {
              resolve();
            } else {
              reject(new Error(`Install command failed at "${repositoryPath}" with error code ${code}`));
            }
          });
        });
        c.log(`Pipeline ${id} - Finished step ${i + 1} without errors`);
      } else if (step.id === 'script') {
        await new Promise((resolve, reject) => {
          const command = step.command.split('"');
          c.log(`Pipeline ${id} - Step ${i + 1} - $ ${command.join(' ')}`);
          const child = cp.spawn(command[0], command.slice(1), {
            cwd: repositoryPath,
            stdio: ['inherit', 'pipe', 'pipe']
          });
          child.stdout.on('data', (text) => {
            c.log(text.toString().replace(/\r/g, ''));
          });
          child.stderr.on('data', (text) => {
            c.log(text.toString().replace(/\r/g, ''));
          });
          child.on('error', reject);
          child.on('exit', code => {
            if (code === 0) {
              resolve();
            } else {
              reject(new Error(`Command "${command.join(' ')}" exited with error code ${code}`));
            }
          });
        });
        c.log(`Pipeline ${id} - Finished step ${i + 1} without errors`);
      } else {
        throw new Error(`Unknown pipeline step id "${step.id}" at index ${i} of "${projectPath}"`);
      }
    }
  }

  async function processPipelineRequest(data) {
    if (!data || !data.repositoryPath) {
      throw new Error('Invalid input');
    }
    const targetInstancePath = data.repositoryPath;
    const id = path.basename(targetInstancePath);
    if (runningPipelineId) {
      c.log(`Deployment pipeline for "${id}" will start after ${runningPipelineId} is cancelled or finishes`);
      replacingPipelineId = id;
      for (let i = 0; i < 600; i++) {
        await new Promise(resolve => setTimeout(resolve, 100));
        if (replacingPipelineId !== id) {
          c.log(`Deployment pipeline for "${id}" was cancelled by the start of "${replacingPipelineId}"`);
          return;
        }
        if (runningPipelineId === null) {
          break;
        }
      }
    }
    if (runningPipelineId === null) {
      replacingPipelineId = null;
      runningPipelineId = id;
    } else {
      c.log(`Deployment pipeline for "${id}" was cancelled by the start of another pipeline`);
      return;
    }
    executeDeployPipeline(id, targetInstancePath).catch((err) => {
      c.log(`Deployment processing for "${id}" failed: ${err.stack}`);
    });
  }

  c.log('');
  c.log(`Initializing deployment processor server at http://localhost:${config.deploymentProcessorPort}/`);

  try {
    await new Promise((resolve, reject) => {
      const server = http.createServer(
        processHttpServerRequest.bind(
          null,
          'Deployment Processor',
          processPipelineRequest
        )
      );
      server.on('listening', () => resolve());
      server.on('error', reject);
      server.listen(config.deploymentProcessorPort);
    });
  } catch (err) {
    c.log(`Could not start deployment server at tcp port ${config.deploymentProcessorPort}: ${err.message}`);
    process.exit(4);
  }

  c.log('');

  const pidFilePath = path.resolve(projectPath, 'deployment', 'processor-pid.txt');
  await fs.promises.writeFile(pidFilePath, process.pid.toString(), 'utf-8');
}

async function nodeDeploymentPostUpdate() {
  const projectPath = path.resolve(args[1]);
  const branchRef = args[2];
  const config = await getProjectConfig(projectPath);
  if (!config) {
    throw new Error(`Could not load project configuration file for "${projectPath}"`);
  }
  if (config.logFilePath) {
    c.logFilePath = config.logFilePath;
  }
  if (config.triggerBranch) {
    if (!branchRef) {
      c.log(`Node deployment post update started without a branch reference`);
      c.log(`Ignoring update as it does not match configured trigger branch`);
      return;
    } else if (!branchRef.endsWith(`/${config.triggerBranch}`)) {
      c.log(`Node deployment post update started for ref "${branchRef}"`);
      c.log('Ignoring update as it does not match configured trigger branch');
      return;
    } else {
      c.log(`Node deployment post update started for triggered branch "${config.triggerBranch}"`);
    }
  } else {
    c.log(`Node deployment post update started`);
  }
  const id = new Date().toISOString().replace('T', '_').substring(0, 23).replace(/\:/g, '-').replace('.', '_');
  const repositoryPath = path.resolve(projectPath, 'deployment', 'versions', id);
  c.log(`Creating new deployment folder with id "${id}"`);
  await fs.promises.mkdir(repositoryPath, { recursive: true });

  if (config.steps.length && config.steps[0] && config.steps[0].id === 'reuse') {
    try {
      const instanceFilePath = path.resolve(projectPath, 'deployment', 'instance-path.txt');
      const instancePath = await asyncTryCatchNull(fs.promises.readFile(instanceFilePath, 'utf-8'));
      if (instancePath && fs.existsSync(instancePath)) {
        cp.execSync(`cp -rf "${instancePath}" "${repositoryPath}"`, {
          cwd: projectPath,
          stdio: 'inherit'
        });
        c.log('Successfully copied instance files to new pipeline folder');
      }
    } catch (err) {
      c.log('Failed while copying previous instance folder to new pipeline folder');
    }
  }
  try {
    c.log(`Executing checkout at "${repositoryPath}"`);
    cp.execSync(`git --work-tree=${repositoryPath} checkout -f`, {
      cwd: projectPath,
      stdio: 'inherit',
    });
  } catch (err) {
    c.log(`Post update failed while executing git checkout.`);
    c.log(err.message);
    process.exit(1);
  }
  try {
    c.log(`Sending new pipeline request "${id}" to deployment processor`);
    const response = await fetch(`http://localhost:${config.deploymentProcessorPort}/`, {
      method: 'POST',
      body: JSON.stringify({ id, repositoryPath })
    });
    const text = await response.text();
    if (text) {
      c.log(`Deployment processor response: ${text}`);
    }
    if (!response.ok) {
      throw new Error('Deployment processor responded with error');
    }
  } catch (err) {
    c.log(`Post update failed while sending new pipeline request to deployment processor.`);
    c.log(err.stack);
    process.exit(1);
  }
}

function executeProgramAs(func, role) {
  c.vlog(`Starting node deployment script as "${role}" at pid ${process.pid}`);
  func().then(() => {
    c.vlog(`Node deployment script finished as "${role}" at pid ${process.pid}`);
    process.exit(0);
  }).catch((err) => {
    c.log(`Node deployment script failed as "${role}" at pid ${process.pid}:`);
    c.log(err.stack);
    process.exit(1);
  });
}

async function waitForUserConfirmation(question) {
  if (question) {
    process.stdout.write(`${question} (y/n) `);
  }
  for (let k = 0; k < 1000; k++) {
    const y = await waitForUserInput();
    if (y === '' || y.toLowerCase()[0] === 'y') {
      return true;
    }
    if (y.toLowerCase()[0] === 'n') {
      return false;
    }
    process.stdout.write('Unknown response. Try again.\n');
    process.stdout.write(question ? question : 'Do you confirm?');
    process.stdout.write(' (y/n) ');
  }
  return false;
}

async function getProjectConfig(projectPath) {
  if (!projectPath) {
    return null;
  }

  const configPath = path.resolve(projectPath, 'deployment', 'config.json');

  const configText = await asyncTryCatchNull(
    fs.promises.readFile(configPath, 'utf-8')
  );

  if (!configText) {
    return null;
  }

  const config = {
    configPath,
  };

  configText.split('\n').forEach(line => {
    const sep = line.indexOf('=');
    if (sep !== -1) {
      config[line.substring(0, sep)] = line.substring(sep + 1);
    }
  });

  return config;
}

async function evaluateProjectPath(projectPath) {
  const valid = typeof projectPath === 'string' && projectPath.length >= 1 && !projectPath.includes('..');

  const obj = {
    config: {},
    path: {
      parent: valid ? path.resolve(path.dirname(projectPath)) : '',
      repository: valid ? path.resolve(projectPath) : '',
      hooks: valid ? path.resolve(projectPath, 'hooks') : '',
      deployment: valid ? path.resolve(projectPath, 'deployment') : '',
      config: valid ? path.resolve(projectPath, 'deployment', 'config.json') : ''
    },
    exists: {
      parent: valid ? null : false,
      repository: valid ? null : false,
      hooks: valid ? null : false,
      deployment: valid ? null : false,
      config: valid ? null : false
    }
  }
  if (!valid) {
    return obj;
  }
  for (const key of ['parent', 'repository', 'hooks', 'deployment', 'config']) {
    try {
      const stat = await asyncTryCatchNull(fs.promises.stat(obj.path[key]));
      obj.exists[key] = stat !== null;
      if (obj.exists[key] === false) {
        return obj;
      }
    } catch (err) {
      c.vlog(`Warning: Stat error while evaluating "${obj.path[key]}": ${err.message}`);
    }
  }
  if (obj.exists.repository && obj.exists.config) {
    obj.config = await getProjectConfig(obj.path.repository);
  }
  return obj;
}

async function executeNodeDeploymentSetupForProject(projectPath) {
  const ev = await evaluateProjectPath(projectPath);
  // Step 1
  if (!ev.exists.repository) {
    c.log(`Step 1. Creating directory for project`);
    c.log('');
    await fs.promises.mkdir(ev.path.repository, { recursive: true });
    ev.exists.repository = true;
  }
  // Step 2
  if (!ev.exists.hooks) {
    c.log(`Step 2. Creating git bare repository`);
    c.log('');
    cp.execSync('git init --bare', {
      cwd: ev.path.repository,
      stdio: ['ignore', 'inherit', 'inherit']
    });
    ev.exists.hooks = true;
  }
  // Step 3
  if (!ev.exists.deployment) {
    c.log(`Step 3. Creating the deployment folder`);
    c.log('');
    await fs.promises.mkdir(ev.path.deployment, { recursive: true });
    ev.exists.deployment = true;
  }
  // Step 4
  if (!ev.exists.script) {
    c.log(`Step 4. Adding the deployment script to the deployment folder`);
    c.log('');
  }
  {
    const targetScriptPath = ev.path.script;
    const targetScriptSource = await asyncTryCatchNull(fs.promises.readFile(targetScriptPath, 'utf-8'));
    const originScriptPath = path.resolve(process.cwd(), process.argv[1]);
    const originScriptSource = await asyncTryCatchNull(fs.promises.readFile(originScriptPath, 'utf-8'));
    if (ev.exists.script && !originScriptSource) {
      c.log(`Skipping verification of main script because the current script was not found at "${originScriptPath}"`);
    } else if (!originScriptSource) {
      throw new Error(`Could not load the contents of the current script from "${originScriptPath}" to write to "${targetScriptPath}"`);
    } else if (targetScriptSource === null || targetScriptSource !== originScriptSource) {
      if (targetScriptSource !== null && ev.exists.script) {
        c.log(`Configured node deployment script mismatch`);
        c.log(`The project's deployment script is different than the one executing`);
        c.log('');
        c.log(`   this script path: ${originScriptPath}`);
        c.log(` target script path: ${targetScriptPath}`);
        c.log('');

        c.log('Do you want to update the project script contents with the contents of this one?');

        const confirm = await waitForUserConfirmation('Replace script?');
        if (confirm) {
          await fs.promises.writeFile(targetScriptPath, originScriptSource, 'utf-8');
        }
      } else {
        await fs.promises.writeFile(targetScriptPath, originScriptSource, 'utf-8');
        ev.exists.script = true;
      }
    }
  }
  // Step 5
  const saveConfig = await fs.promises.writeFile(ev.path.config, JSON.stringify(ev.config, null, '  '), 'utf-8');
  if (!ev.exists.config) {
    c.log(`Step 5. Adding the configuration file to the deployment folder`);
    c.log('');
    const [instanceManagerPort, deploymentProcessorPort] = await Promise.all(
      [0, 200].map((delay) => new Promise((resolve, reject) => {
        const server = http.createServer((req, res) => res.end(''));
        server.on('listening', () => {
          try {
            const port = server.address().port;
            server.close();
            resolve(port);
          } catch (err) {
            reject(err);
          }
        });
        server.on('error', reject);
        setTimeout(() => server.listen(), delay);
      }))
    );
    ev.config = {
      logFilePath: path.resolve(ev.path.deployment, 'logs.txt'),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      managerPort: instanceManagerPort,
      processorPort: deploymentProcessorPort,
      steps: getStartingPipelineSteps()
    }
    c.log(`Configured ports for deployment communication: "${JSON.stringify([instanceManagerPort, deploymentProcessorPort])}"`);
    await saveConfig();
  }
  // Step 6
  {
    const postUpdateSource = `#!/bin/bash\n/bin/node ./deployment/post-update.js --post-update "${ev.path.repository}" \$*\n`;
    const postUpdateHookPath = path.resolve(ev.path.hooks, 'post-update');
    const postUpdateContent = await asyncTryCatchNull(fs.promises.readFile(postUpdateHookPath, 'utf-8'));
    if (postUpdateContent === null) {
      c.log('Step 6. Adding the post-update hook to the repository');
      await fs.promises.writeFile(
        postUpdateHookPath,
        `${postUpdateContent}# do not edit above this command because node-deployment uses it\n`,
        'utf-8'
      );
    } else if (!postUpdateContent.startsWith(postUpdateSource)) {
      c.log('The "post-update" git hook has an invalid content');
      c.log('This script will update it to be correct');
      await fs.promises.writeFile(
        postUpdateHookPath,
        `${postUpdateSource}# do not edit above this command because node-deployment uses it\n`,
        'utf-8'
      );
    }
  }

  // Step 7
  if (!ev.config.madePostUpdateExecutable) {
    c.log('Step 7. Making the post-update script executable by git');
    cp.execSync(`chmod +x "${postUpdateHookPath}"`, {
      cwd: ev.path.hooks,
      stdio: 'inherit'
    });
    ev.config.madePostUpdateExecutable = true;
    await saveConfig();
  }
  // Step 8
  {
    // Verify if instance manager is running
    let instanceManagerPidText = await asyncTryCatchNull(
      fs.promises.readFile(
        path.resolve(ev.path.deployment, 'manager-pid.txt'),
        'utf-8'
      )
    );
    let willStartManager = false;
    if (!willStartManager && instanceManagerPidText === null) {
      c.log('Step 8. Starting Instance Manager');
      c.log('');
      willStartManager = true;
    }
    if (!willStartManager && instanceManagerPidText) {
      const running = await isProcessRunningByPid(parseInt(instanceManagerPidText, 10));
      if (!running) {
        willStartManager = true;
        c.log('Detected instance manager not executing');
        c.log('This script will attempt to start it manually');
        c.log('');
      }
    }
    if (willStartManager) {
      const child = cp.spawn('node', ['./deployment/node-deployment.js', '--manager', ev.path.project], {
        cwd: ev.path.repository,
        env: process.env,
        stdio: 'ignore',
        detached: true
      });
      child.unref();
      c.log('');
      c.log('Verifying if instance manager started...');
      await new Promise(resolve => setTimeout(resolve, 500));
      instanceManagerPidText = await asyncTryCatchNull(
        fs.promises.readFile(
          path.resolve(ev.path.deployment, 'manager-pid.txt'),
          'utf-8'
        )
      )
      const running = await isProcessRunningByPid(parseInt(instanceManagerPidText, 10));
      if (!running) {
        throw new Error(`Instance manager process failed to start at "${ev.path.repository}"`);
      }
    }
  }
  // Step 9
  if (ev.config.suggestedCronjobSetup === undefined) {
    c.log('Step 9. [Optional] Setup Cron to Restart on Reboot');
    c.log('');
    c.log('  The instance manager maintains your app process running.');
    c.log('  If your server reboots it will stop and so will your app.');
    c.log('  You can make it start automatically by configuring the cronjob.');
    c.log('');
    const confirmation = await waitForUserConfirmation('Do you want to configure the cronjob?');
    ev.config.suggestedCronjobSetup = confirmation;
    await saveConfig();
    if (confirmation === true) {
      c.log('');
      c.log('The following command must be executed on another shell on this server:');
      c.log('');
      c.log('$ crontab -e');
      c.log('');
      c.log('Your cronjob should open for editing. Add this line at the end of it:');
      c.log('');
      c.log(`@reboot cd ${ev.path.repository} && /usr/bin/node ./deployment/node-deployment.js --manager ${ev.path.repository}`);
      c.log('');
      c.log('Save the file and this should be enough. Cron will start this automatically on boot.');
      c.log('');
    } else {
      c.log('');
      c.log('Skipped cronjob setup');
      c.log('');
    }
  }
  if (!ev.config.setupComplete) {
    ev.config.setupComplete = true;
    c.log('Setup is complete');
    c.log('');
    c.log('The repository can be cloned with a command like this:');
    c.log('');
    c.log(`$ git clone ssh://[username]@[server-host]:[server-port]${ev.path.repository}`);
    c.log('');
    c.log('You may now configure this project.');
    await saveConfig();
  }

  c.log('');
  await nodeDeploymentProjectConfig(
    ev.path.repository,
    ev.config,
    saveConfig
  );
}

async function nodeDeploymentProjectConfig(projectPath, config, saveConfig) {
  c.log('');
  for (let k = 0; k < 1000; k++) {
    c.log(`Project configuration for "${projectPath}":`);
    c.log('');
    c.log(' [0] Exit script');
    c.log(` [1] ${config.instanceManagerDisabled ? 'Enable' : 'Disable'} Instance Manager (currently  ${config.instanceManagerDisabled ? 'disabled' : 'enabled'})`);
    c.log(` [2] ${config.deploymentProcessorDisabled ? 'Enable' : 'Disable'} Deployment Processor (currently ${config.deploymentProcessorDisabled ? 'disabled' : 'enabled'})`);
    c.log(' [3] View deployment logs');
    c.log(' [4] View instance logs');
    c.log(' [5] Configure triggers');
    c.log(' [6] Configure deployment pipeline steps');
    c.log('');
    process.stdout.write('Enter an option: ');
    const selection = await waitForUserInput();
    process.stdout.write('\n');
    if (selection.length !== 1 || isNaN(parseInt(selection, 10)) || parseInt(selection, 10) > 6) {
      process.stdout.write('Unrecognized option.\n');
      continue;
    }
    const optionId = parseInt(selection, 10);
    c.log(`Selected option: ${optionId}`);
    if (optionId === 0) {
      c.log('Goodbye');
      process.exit(0);
    }
    if (optionId === 1) {
      config.instanceManagerDisabled = !config.instanceManagerDisabled;
      await saveConfig();
      c.log('Warning: Unimplemented switching action');
      continue;
    }
    if (optionId === 2) {
      config.deploymentProcessorDisabled = !config.deploymentProcessorDisabled;
      await saveConfig();
      c.log('Warning: Unimplemented switching action');
      continue;
    }
    let targetLogFile = null;
    if (optionId === 3 || optionId === 4) {
      if (optionId === 3) {
        c.log('Deployment logs for this project are stored at:');
        c.log('');
        targetLogFile = config.logFilePath || path.resolve(projectPath, 'deployment', 'logs.txt')
      } else {
        const currentInstanceFilePath = path.resolve(projectPath, 'deployment', 'instance-path.txt');
        const instancePath = await asyncTryCatchNull(fs.promises.readFile(currentInstanceFilePath, 'utf-8'));
        if (instancePath === null) {
          c.log('Instance logs have not been created for this project.');
          c.log('An instance for this project has not been started.');
          continue;
        }
        const instanceFolderStat = await asyncTryCatchNull(fs.promises.stat(instancePath));
        if (instanceFolderStat === null) {
          c.log('Instance logs dont exist for the current instance.');
          c.log(`The instance folder at "${instancePath}" does not exist`);
          continue;
        }
        c.log('Instance logs for this project are stored at:');
        c.log('');
        targetLogFile = path.resolve(instancePath, 'logs.txt');
      }
      c.log(targetLogFile);
      const stat = await asyncTryCatchNull(fs.promises.stat(targetLogFile));
      if (stat === null) {
        c.log('However the file does not exist.');
        continue;
      }
      c.log(`The file has ${(stat.size / 1024).toFixed(0)} kB`);
      c.log(`Here are the last 100 lines from it:`);
      process.stdout.write('\n');
      await new Promise(resolve => setTimeout(resolve, 1000));
      await new Promise(async (resolve) => {
        try {
          const child = cp.spawn('tail', ['-n', '100', targetLogFile], {
            cwd: path.dirname(targetLogFile),
            stdio: ['ignore', 'inherit', 'inherit']
          });
          child.on('error', (err) => {
            c.log(`Failed while starting tail command: ${err.message}`);
            resolve();
          });
          child.on('exit', () => resolve());
        } catch (err) {
          c.log(`Failed while starting tail command: ${err.message}`);
          resolve();
        }
      });
      continue;
    }
    throw new Error('Unimplemented option');
  }
}

async function nodeDeploymentSetup() {
  let targetPath = args.length === 1 ? path.resolve(args[0]) : '';

  // Check if we must change our log file path
  {
    const startConfig = targetPath ? getProjectConfig(targetPath) : null;

    if (startConfig && startConfig.logFilePath) {
      c.logFilePath = config.logFilePath;
    }
  }

  c.log('Node deployment program started');
  c.log('');
  c.log(`   process id: "${process.pid}"`);
  c.log(`    parent id: "${process.ppid}"`);
  c.log(`     cwd path: "${process.cwd()}"`);
  c.log(`    logs path: ${c.logFilePath}`);
  if (targetPath) {
    c.log(` start path: ${targetPath}`);
  }
  c.log('');

  startUserInput();

  for (let k = 0; k < 1000; k++) {
    if (k !== 0 || args.length === 0) {
      process.stdout.write('Enter the path to the the project\'s repository:\n\n');
    }
    const newPath = await waitForUserInput();
    if (!newPath || newPath.length > 256) {
      process.stdout.write('Invalid path. Try again\n');
      continue;
    }
    const resPath = path.resolve(newPath);
    if (resPath !== newPath) {
      process.stdout.write('The selected project path was expanded to:\n\n');
    } else {
      process.stdout.write('The selected project path is:\n\n');
    }
    process.stdout.write(` ${resPath}\n\n`);
    const stat = await asyncTryCatchNull(fs.promises.stat(resPath));
    if (stat === null) {
      process.stdout.write('Currently this directory does not exist.\n\n');
    } else if (!stat.isDirectory()) {
      process.stdout.write('This path cannot be used because it is a file.\n');
      continue;
    }
    const confirm = await waitForUserConfirmation(stat === null ? 'Create the new directory for the project?' : 'Confirm target repository path?');
    process.stdout.write('\n');
    if (confirm === false) {
      continue;
    }
    targetPath = resPath;
    c.log('');
    for (let m = 0; m < 1000; m++) {
      if (m !== 0) {
        c.log(``);
        c.log(`Node deployment will execute setup for "${targetPath}" again.`);
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      try {
        await executeNodeDeploymentSetupForProject(targetPath);
      } catch (err) {
        c.log(`The setup for "${targetPath}" failed:`);
        c.log(err.stack);
        c.log('');
        c.log('Do you want to retry at this path?');
        const confirm = await waitForUserConfirmation();
        if (confirm === true) {
          continue;
        }
      }
      break;
    }
  }
}

async function isProcessRunningByPid(pid) {
  let yesCount = 0;
  let noCount = 0;
  for (let i = 0; i < 8; i++) {
    try {
      process.kill(parseInt(pid.toString().trim()), 0);
      yesCount++;
    } catch (err) {
      noCount++;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  return yesCount > noCount;
}

function processHttpServerRequest(name, targetFunc, req, res) {
  if (req.method !== 'POST') {
    res.writeHead(404).end(req.url === '/' ? `${name} internal http server` : '');
    return;
  }
  const chunks = [];
  req.on("data", (d) => chunks.push(d));
  req.on("end", async () => {
    try {
      const requestData = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
      const responseData = await targetFunc(requestData);
      if (responseData) {
        res.end(responseData);
      } else {
        res.end();
      }
      return;
    } catch (err) {
      res.writeHead(500);
      res.end(`${name} failed: ${err.message}`);
      return;
    }
  });
}

async function asyncTryCatchNull(p) {
  try {
    return await p;
  } catch (err) {
    if (err.code === 'ENOENT') {
      return null;
    }
    throw err;
  }
}

function getStartingPipelineSteps() {
  return [{
    id: 'reuse',
    name: 'Reuse previous deployment folder',
    command: 'cp -rf ./deployment/versions/<current-instance-id> ./deployment/versions/<new-instance-id>',
    description: 'Copies the files of the current running instance to speed up the deployment pipeline of the new instance',
    question: 'Reuse previous instance contents?'
  }, {
    id: 'purge',
    name: 'Remove old instance folders and keep only the 15 most recent',
    description: 'Executes when there are more than 15 pipeline folders and removes old instance folders at "./deployment/versions" so that only the 15 versions are kept',
    command: 'rm -rf ./deployment/versions/<old-instance-id>',
    question: 'Purge old instance folders and keep only the 15 most recent?',
  }, {
    id: 'install',
    name: 'Install project dependencies with npm',
    command: 'npm ci',
    question: 'Install the dependencies from package.json?',
  }, {
    id: 'script',
    name: 'Execute "build" script',
    command: 'npm run build',
    question: 'Execute the "build" script from package.json?',
  }, {
    id: 'restart',
    name: 'Restart instance',
    description: 'Stops the instance running on the previous version and starts the new one on the new pipeline folder.',
    command: 'npm run start',
    question: 'Restart the process executes app instance?'
  }]
}