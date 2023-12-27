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
  logFilePath: path.resolve(process.cwd(), 'deployment.log'),
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
    const message = `${parts.join(' ')}\n`;
    if (process.stdout && process.stdout.write) {
      process.stdout.write(message);
    }
    const logFilePath = c.logFilePath;
    if (!logFilePath) {
      return;
    }
    fs.promises.appendFile(logFilePath, message, 'utf-8').catch((err) => {
      if (c.lastFailFilePath && logFilePath === c.lastFailFilePath) {
        return;
      }
      c.lastFailFilePath = logFilePath;
      console.log(`\nFailed while storing logs at "${logFilePath}": ${err.message}\n`);
    });
  },
  vlog: (...args) => isVerbose ? c.log('[verbose]', ...args) : null,
}

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
  if (!args[1]) {
    c.log('Node Deployment Process Manager does not have a project path as argument');
    throw new Error('Missing project target path');
  }
  if (args[1] !== process.cwd()) {
    c.log(`Node Deployment Process Manager target project mismatch`);
    c.log(`Manager started at "${process.cwd()}"`);
    c.log(` First argument is "${args[1]}"`);
    throw new Error('Unmatching project target path');
  }
  const projectPath = path.resolve(args[1]);
  const deploymentStat = await asyncTryCatchNull(fs.promises.stat(path.resolve(projectPath, 'deployment')));
  if (deploymentStat === null) {
    throw new Error(`Could not find project deployment folder for "${projectPath}"`);
  }
  c.logFilePath = path.resolve(projectPath, 'deployment', 'deployment.log');
  const config = await getProjectConfig(projectPath);
  if (!config) {
    throw new Error(`Could not load project configuration file for "${projectPath}"`);
  }
  if (config.logFilePath) {
    c.logFilePath = config.logFilePath;
  }
  if (!config.managerPort) {
    throw new Error('Setup incomplete: Missing instance manager port on config');
  }
  c.log(`Instance manager started for "${projectPath}" at pid ${process.pid}`);
  c.log('');

  c.log('Instance manager is starting deployment processor in attached mode');
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      c.log(`Deployment processor failed to start due to spawn timeout`);
      reject(new Error('Timeout exceeded while starting deployment processor'));
    }, 3000);
    const processor = cp.spawn('node', ['./deployment/node-deployment.js', '--processor', projectPath], {
      cwd: projectPath,
      stdio: 'ignore'
    });
    processor.on('spawn', () => {
      clearTimeout(timer);
      c.log(`Instance manager started deployment processor at pid ${processor.pid}`);
      resolve(processor);
    });
    processor.on('error', (err) => {
      clearTimeout(timer);
      c.log(`Deployment processor failed to start due to error: ${err.message}`);
      reject(err);
    });
    processor.on('exit', (code) => {
      c.log(`Deployment processor exited with code ${code}`);
    });
  });

  const instanceFilePath = path.resolve(projectPath, 'deployment', 'instance-path.txt');
  let instancePath = await asyncTryCatchNull(fs.promises.readFile(instanceFilePath, 'utf-8'));
  let instance;

  async function executeInstanceRestart(targetInstancePath) {
    const id = path.basename(targetInstancePath);
    const stat = await asyncTryCatchNull(fs.promises.stat(targetInstancePath));
    if (stat === null) {
      c.log(`Aborting restart request for "${id}" because target was not found at "${targetInstancePath}"`);
      return;
    }
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
      c.log(`Aborting restart request for "${id}" because of a newer request: "${process.basename(instancePath)}"`);
      return;
    }
    instanceBeingReplaced = null;
    instancePath = targetInstancePath;

    await new Promise(resolve => setTimeout(resolve, 100));
    const instancePidPath = path.resolve(projectPath, 'deployment', 'instance.pid');
    const instanceLogPath = path.resolve(targetInstancePath, 'instance.log');
    await fs.promises.writeFile(instanceLogPath, `Started at ${new Date().toISOString()}\n`, 'utf-8');

    if (instanceBeingReplaced !== null || instancePath !== targetInstancePath || instance !== null) {
      c.log(`Aborting restart request for "${id}" because of a change in state during start`);
      return;
    }
    await fs.promises.writeFile(instanceFilePath, targetInstancePath, 'utf-8');
    instance = cp.spawn('npm', ['run', 'start'], {
      cwd: targetInstancePath,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    instance.on('error', (err) => {
      c.log(`Instance from "${id}" failed to start: ${err.message}`);
      instance = null;
    });
    instance.on('exit', (code) => {
      c.log(`Instance from "${id}" exited with code ${JSON.stringify(code)}`);
      instance = null;
    });
    instance.on('spawn', () => {
      c.log(`Instance from "${id}" started with pid ${instance.pid}\nInstance log path: ${instanceLogPath}`);
      fs.promises.writeFile(instancePidPath, instance.pid.toString(), 'utf-8');
    });
    instance.stdout.on('data', (data) => fs.promises.appendFile(instanceLogPath, data));
    instance.stderr.on('data', (data) => fs.promises.appendFile(instanceLogPath, data));
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
  c.log(`Initializing instance manager server at http://localhost:${config.managerPort}/`);

  let server;
  try {
    server = await new Promise((resolve, reject) => {
      const server = http.createServer(
        (req, res) => processHttpServerRequest('Instance Manager', processRestartRequest, req, res)
      );
      server.on('error', (err) => {
        c.log(`Instance manager failed to start server: ${err.message}`);
        reject(err);
      });
      server.listen(config.managerPort, () => {
        resolve(server);
      });
    });
  } catch (err) {
    c.log(`Could not start instance manager server at tcp port ${config.managerPort}: ${err.message}`);
    process.exit(1);
  }

  if (!server) {
    c.log('Instance manager server object is missing');
    process.exit(1);
  }

  const pidFilePath = path.resolve(projectPath, 'deployment', 'manager.pid');
  c.log(`Writing manager pid at "${pidFilePath}"`);
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
  if (!args[1]) {
    c.log('Node Deployment Processor does not have a project path as argument');
    throw new Error('Missing project target path');
  }
  if (args[1] !== process.cwd()) {
    c.log(`Node Deployment Processor target project mismatch`);
    c.log(`Manager started at "${process.cwd()}"`);
    c.log(` First argument is "${args[1]}"`);
    throw new Error('Unmatching project target path');
  }
  const projectPath = path.resolve(args[1]);
  const deploymentStat = await asyncTryCatchNull(fs.promises.stat(path.resolve(projectPath, 'deployment')));
  if (deploymentStat === null) {
    throw new Error(`Could not find project deployment folder for "${projectPath}"`);
  }
  c.logFilePath = path.resolve(projectPath, 'deployment', 'deployment.log');
  const config = await getProjectConfig(projectPath);
  if (!config) {
    throw new Error(`Could not load project configuration file for "${projectPath}"`);
  }
  if (config.logFilePath) {
    c.logFilePath = config.logFilePath;
  }
  if (!config.processorPort) {
    throw new Error('Setup incomplete: Missing deployment processor port on config');
  }
  c.log(`Node deployment processor started for "${projectPath}"`);

  let runningPipelineId;
  let replacingPipelineId;

  async function executeDeployPipeline(id, repositoryPath) {
    c.log(`Processing for "${id}" started`);
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
        c.log(`Purge step found ${version.length} pipeline folders at "${instanceParentDir}"`);
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
        const response = await fetch(`http://localhost:${config.managerPort}/`, {
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
        runningPipelineId = null;
      } else {
        throw new Error(`Unknown pipeline step id "${step.id}" at index ${i} of "${projectPath}"`);
      }
    }
  }
  async function waitThenProcessPipelineRequest(id, repositoryPath) {
    if (runningPipelineId) {
      c.log(`"${id}" will wait for "${runningPipelineId}" to be stopped`);
      replacingPipelineId = id;
      for (let i = 0; i < 600; i++) {
        await new Promise(resolve => setTimeout(resolve, 100));
        if (replacingPipelineId !== id) {
          c.log(`Pipeline "${id}" was cancelled by the start of "${replacingPipelineId}"`);
          return;
        }
        if (runningPipelineId === null) {
          c.log(`The previous pipeline was cancelled and "${id}" will start`);
          return;
        }
      }
    }
    if (runningPipelineId !== null) {
      c.log(`The pipeline "${id}" could not be executed because "${runningPipelineId}" was executing.`);
      return;
    }
    
    
    replacingPipelineId = null;
    runningPipelineId = id;
    executeDeployPipeline(id, repositoryPath).catch((err) => {
      c.log(`Deployment processing for "${id}" failed: ${err.stack}`);
      runningPipelineId = null;
    });
  }

  async function processPipelineRequest(data) {
    if (!data || !data.repositoryPath) {
      throw new Error('Invalid input');
    }
    const targetInstancePath = data.repositoryPath;
    const id = path.basename(targetInstancePath);
    c.log(`Received pipeline request "${id}" (${runningPipelineId ? `while "${runningPipelineId}" is executing` : 'while idle'})`);
    
    waitThenProcessPipelineRequest(id, targetInstancePath).catch((err) => {
      c.log(`The processing start for "${id}" failed: ${err.stack}`);
    });
  }

  c.log('');
  c.log(`Initializing deployment processor server at http://localhost:${config.processorPort}/`);

  let server;
  try {
    server = await new Promise((resolve, reject) => {
      const server = http.createServer(
        (req, res) => processHttpServerRequest(
          'Deployment Processor',
          processPipelineRequest,
          req,
          res
        )
      );
      server.on('error', reject);
      server.listen(config.processorPort, () => {
        resolve(server);
      });
    });
  } catch (err) {
    c.log(`Could not start deployment server at tcp port ${config.processorPort}: ${err.message}`);
    process.exit(1);
  }

  if (!server) {
    c.log('Missing server object');
    process.exit(1);
  }

  const pidFilePath = path.resolve(projectPath, 'deployment', 'processor.pid');
  c.log(`Writing processor pid at "${pidFilePath}"`);
  await fs.promises.writeFile(pidFilePath, process.pid.toString(), 'utf-8');
}

async function nodeDeploymentPostUpdate() {
  const projectPath = path.resolve(args[1]);
  const deploymentStat = await asyncTryCatchNull(fs.promises.stat(path.resolve(projectPath, 'deployment')));
  if (deploymentStat === null) {
    throw new Error(`Could not find project deployment folder for "${projectPath}"`);
  }
  c.logFilePath = path.resolve(projectPath, 'deployment', 'deployment.log');
  const config = await getProjectConfig(projectPath);
  if (!config) {
    throw new Error(`Could not load project configuration file for "${projectPath}"`);
  }
  if (config.logFilePath) {
    c.logFilePath = config.logFilePath;
  }
  const branchRef = args[2];
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
    c.log(`Sending pipeline "${id}" to processor`);
    const response = await fetch(`http://localhost:${config.processorPort}/`, {
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
    c.log(`Pipeline ${id} scheduled sucessfully`);
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
    if (role === 'Setup') {
      process.exit(0);
    }
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

  return JSON.parse(configText);
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
    try {
      await fs.promises.mkdir(ev.path.repository, { recursive: true });
    } catch (err) {
      if (err.code === 'EACCES') {
        c.log('Got permission denied while trying to create the target folder');
        c.log('You can create the folder manually and retry the setup');
        c.log('');
      }
      throw err;
    }
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
    process.stdout.write('\n');
    ev.exists.hooks = true;
  }
  // Step 3
  if (!ev.exists.deployment) {
    c.log(`Step 3. Creating the deployment folder`);
    c.log('');
    await fs.promises.mkdir(ev.path.deployment, { recursive: true });
    ev.exists.deployment = true;
    const oldLogFilePath = c.logFilePath;
    const newLogFilePath = path.resolve(ev.path.deployment, 'deployment.log');
    c.log(`Continuing logs to new path at "${newLogFilePath}"`);
    try {
      await fs.promises.copyFile(oldLogFilePath, newLogFilePath);
    } catch (err) {
      // Ignore copy failure
    }
    c.logFilePath = newLogFilePath;
    c.log(`Continuing logs from old path at "${oldLogFilePath}"`);
    c.log('');
  } else {
    c.logFilePath = path.resolve(ev.path.deployment, 'deployment.log');
  }
  // Step 4
  {
    const targetScriptPath = path.resolve(ev.path.deployment, 'node-deployment.js');
    const targetScriptSource = await asyncTryCatchNull(fs.promises.readFile(targetScriptPath, 'utf-8'));
    if (targetScriptSource === null) {
      c.log(`Step 4. Adding the node deployment script to the deployment folder`);
      c.log('');
    }
    const originScriptPath = path.resolve(process.cwd(), process.argv[1]);
    const originScriptSource = await asyncTryCatchNull(fs.promises.readFile(originScriptPath, 'utf-8'));
    if (originScriptSource === null) {
      if (targetScriptSource === null) {
        throw new Error(`Could not load the contents of the current script from "${originScriptPath}" to write to "${targetScriptPath}"`);
      } else {
        c.log(`The current executing script was not found at "${originScriptPath}"`);
        c.log(`The verification of the project script was skipped as it already exists`);
      }
    } else {
      if (targetScriptSource === null) {
        await fs.promises.writeFile(targetScriptPath, originScriptSource, 'utf-8');
        c.log(`Created the script at "${targetScriptPath}"`);
        c.log('');
      } else if (targetScriptSource.trim() !== originScriptSource.trim()) {
        c.log(`The deployment script configured on the project might be outdated`);
        c.log(`The source code does not match the currently executing script`);
        c.log('');
        c.log(` project script path: ${targetScriptPath}`);
        c.log(` project script size: ${(targetScriptSource.length / 1024).toFixed(1)} kB`);
        c.log(`    this script path: ${originScriptPath}`);
        c.log(`    this script size: ${(originScriptSource.length / 1024).toFixed(1)} kB`);
        c.log('');
        c.log('Do you want to replace the script at the project with this one?');
        process.stdout.write('\n');
        const confirm = await waitForUserConfirmation(' > Replace deployment script of project?');
        process.stdout.write('\n');
        if (confirm) {
          await fs.promises.writeFile(targetScriptPath, originScriptSource, 'utf-8');
          c.log(`Sucessfully updated the source code content of "${targetScriptPath}"`);
          c.log('');
        }
      }
    }
  }
  // Step 5
  const saveConfig = () => fs.promises.writeFile(ev.path.config, JSON.stringify(ev.config, null, '  '), 'utf-8');
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
      logFilePath: path.resolve(ev.path.deployment, 'deployment.log'),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      managerPort: instanceManagerPort,
      processorPort: deploymentProcessorPort,
      steps: getStartingPipelineSteps()
    }
    c.log(`Configured port for instance manager: ${instanceManagerPort}`);
    c.log(`Configured port for deployment processor: ${deploymentProcessorPort}`);
    c.log('');
    await saveConfig();
  }
  // Step 6
  const postUpdateHookPath = path.resolve(ev.path.hooks, 'post-update');
  {
    const postUpdateSource = `#!/bin/bash\n/bin/node ./deployment/node-deployment.js --scheduler "${ev.path.repository}" \$*\n`;
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
      c.log('');
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
        path.resolve(ev.path.deployment, 'manager.pid'),
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
      for (let t = 0; t < 2; t++) {
        c.log(`Executing instance manager ${t === 0 ? 'in attached mode' : 'in detached mode'} from setup`);
        await new Promise(resolve => setTimeout(resolve, 500));
        c.log('');
        await new Promise((resolve, reject) => {
          const child = cp.spawn('node', ['./deployment/node-deployment.js', '--manager', ev.path.repository], {
            cwd: ev.path.repository,
            env: process.env,
            stdio: t === 0 ? ['ignore', 'pipe', 'pipe'] : 'ignore',
            detached: t === 0 ? false : true,
          });
          if (t === 1) {
            child.unref();
            resolve();
            return;
          }
          let hasSpawned = false;
          let wasKilled = false;
          let timeout = setTimeout(() => {
            try {
              wasKilled = true;
              child.kill();
            } catch (err) {
              // ignore
            }
            if (!hasSpawned) {
              reject(new Error('Node deployment instance manager spawn timeout'));
            }
          }, 3000);
          child.on('spawn', () => {
            hasSpawned = true;
            c.log(`Node deployment instance manager spawned in attached mode at pid ${child.pid}`);
          });
          child.on('error', (err) => {
            clearTimeout(timeout);
            reject(err);
          });
          child.on('exit', (code) => {
            if (wasKilled) {
              resolve();
            } else {
              reject(new Error(`Node deployment instance manager exited with code ${code} unexpectedly`));
            }
          });
          child.stdout.on('data', data => process.stdout.write(data));
          child.stderr.on('data', data => process.stderr.write(data));
        });
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      await new Promise(resolve => setTimeout(resolve, 250));
      c.log('Checking if instance manager started');
      await new Promise(resolve => setTimeout(resolve, 250));
      instanceManagerPidText = await asyncTryCatchNull(
        fs.promises.readFile(
          path.resolve(ev.path.deployment, 'manager.pid'),
          'utf-8'
        )
      )
      const running = await isProcessRunningByPid(parseInt(instanceManagerPidText, 10));
      if (!running) {
        throw new Error(`Instance manager process failed to start at "${ev.path.repository}"`);
      }
      c.log('Instance manager started sucessfully and is running');
      c.log('');
    }
  }
  // Step 9
  if (ev.config.suggestedCronjobSetup === undefined) {
    c.log('Step 9. [Optional] Setup Cron to Restart on Reboot');
    c.log('');
    c.log('  The instance manager maintains your app process running.');
    c.log('  If your server reboots it will stop and so will your app.');
    c.log('  You can make it start automatically by configuring the cronjob.');
    process.stdout.write('\n');
    const confirmation = await waitForUserConfirmation(' > Do you want to configure the reboot script?');
    process.stdout.write('\n');
    ev.config.suggestedCronjobSetup = confirmation;
    await saveConfig();
    if (confirmation === true) {
      c.log('');
      c.log('The following command must be executed on another shell on this server:');
      c.log('');
      c.log('$ crontab -e');
      c.log('');
      c.log('Your cron configuration should open for editing. Add this line at the end of it:');
      c.log('');
      c.log(`@reboot cd ${ev.path.repository} && /usr/bin/node ./deployment/node-deployment.js --manager ${ev.path.repository}`);
      c.log('');
      c.log('Save the file and cron will start the process when the computer boots up.');
      c.log('');
      process.stdout.write('\nPress enter to continue\n');
      await waitForUserInput();
    } else {
      c.log('');
      c.log('Skipped cron job setup');
      c.log('');
    }
  }
  if (!ev.config.setupComplete) {
    ev.config.setupComplete = true;
    c.log('Setup is complete.');
    c.log('');
    c.log(`The repository of the project at "${ev.path.repository}" is ready to be used.`);
    c.log('');
    c.log(`When it updates the automatic deployment pipeline will start.`);
    c.log('');
    c.log(`Every pipeline creates a new folder at "${path.resolve(ev.path.repository, 'deployment', 'versions')}/[id]"`);
    c.log('');
    c.log(`The current pipeline steps can be configured.`);
    c.log('');
    c.log('This repository can be cloned remotely through ssh with a command like this:');
    c.log('');
    c.log(`$ git clone ssh://[username]@[server-host]:[server-port]${ev.path.repository}`);
    c.log('');
    c.log('Changes on any branch will trigger it to deploy, this can be configured.');
    c.log('');
    c.log('You will now go to the project status and configuration menu.');
    await saveConfig();
    process.stdout.write('\n\nPress enter to continue\n');
    await waitForUserInput();
  }

  await nodeDeploymentProjectConfig(
    ev.path.repository,
    ev.config,
    saveConfig
  );
}

async function getProjectConfigurationMenuState(projectPath, config) {
  const deployLogFilePath = config.logFilePath || path.resolve(projectPath, 'deployment', 'deployment.log');
  const deployLogStat = await asyncTryCatchNull(
    fs.promises.stat(
      deployLogFilePath,
      'utf-8'
    )
  );
  const [managerState, processorState, instanceState] = await Promise.all(
    ['manager', 'processor', 'instance'].map(async (name) => {
      const pidFilePath = path.resolve(projectPath, 'deployment', `${name}.pid`);
      const obj = {
        pid: null,
        running: false,
      }
      try {
        const text = await asyncTryCatchNull(fs.promises.readFile(pidFilePath, 'utf-8'));
        if (text) {
          obj.pid = parseInt(text.trim(), 10);
          obj.running = await isProcessRunningByPid(obj.pid);
        }
      } catch (err) {
        obj.running = false;
      }
      return obj;
    })
  );

  const currentInstanceFilePath = path.resolve(projectPath, 'deployment', 'instance-path.txt');
  const instancePathText = await asyncTryCatchNull(fs.promises.readFile(currentInstanceFilePath, 'utf-8'));

  const versionIdList = await asyncTryCatchNull(
    fs.promises.readdir(
      path.resolve(projectPath, 'deployment', 'versions')
    )
  );
  const versionPathList = versionIdList === null ? [] : versionIdList.map(
    fileName => path.resolve(projectPath, 'deployment', 'versions', fileName)
  );

  /** @type {{id: string, repositoryPath: string, isCurrentInstance: boolean, logFilePath: string, logFileSize: null | number}[]} */
  const versionList = await Promise.all(versionPathList.map(async (repositoryPath) => {
    const isCurrentInstance = instancePathText && instancePathText.trim() === repositoryPath;
    const obj = {
      id: path.basename(repositoryPath),
      repositoryPath,
      isCurrentInstance,
      logFilePath: path.resolve(repositoryPath, 'instance.log'),
      logFileSize: null,
      createdAt: null,
      startedAt: null,
    }
    try {
      const stat = await asyncTryCatchNull(fs.promises.stat(obj.repositoryPath));
      if (stat !== null) {
        obj.createdAt = stat.ctime;
      }
      const logStat = await asyncTryCatchNull(fs.promises.stat(obj.logFilePath));
      if (logStat !== null) {
        obj.logFileSize = logStat.size;
        obj.startedAt = logStat.ctime;
      }
    } catch (err) {
      // ignore
    }
    return obj;
  }));

  return {
    versionList,
    deploymentLogFilePath: deployLogFilePath,
    deploymentLogFileSize: deployLogStat ? deployLogStat.size : null,
    managerPid: managerState.pid,
    managerRunning: managerState.running,
    processorPid: processorState.pid,
    processorRunning: processorState.running,
    instanceId: instancePathText ? path.basename(instancePathText.trim()) : null,
    instancePid: instanceState.pid,
    instanceRunning: instanceState.running,
  }
}

async function nodeDeploymentProjectConfig(projectPath, config, saveConfig) {
  for (let k = 0; k < 1000; k++) {
    let state = {};
    try {
      state = await getProjectConfigurationMenuState(projectPath, config);
      c.log(`Project: ${projectPath}`);
      c.log('');
      if (state.instanceId) {
        c.log(`    App Instance: "${state.instanceId}" ${state.instanceRunning ? `running at pid ${state.instancePid}` : 'not executing anymore'}`);
      }
      c.log(`    Deployment Manager: ${state.managerRunning ? 'running' : 'not running'} (${state.managerRunning ? `at pid ${state.managerPid}` : (state.managerPid ? `last pid was ${state.managerPid}` : 'no pid info')})`);
      c.log(`  Deployment Processor: ${state.processorRunning ? 'running' : 'not running'} (${state.processorRunning ? `at pid ${state.processorPid}` : (state.processorPid ? `last pid was ${state.processorPid}` : 'no pid info')})`);
      if (state.versionList.length) {
        c.log(`              Versions: ${state.versionList.length} versions (last was "${state.versionList[state.versionList.length - 1].id}")`);
      } else {
        c.log(`              Versions: No pipelines have been scheduled yet`);
      }
      c.log('');
      c.log(' Options:');
    } catch (err) {
      c.log('');
      c.log('Failed while retrieving project state:');
      c.log(err.stack);
      c.log('');
      c.log(`Node Deployment Configuration Menu for: ${projectPath}`);
    }
    c.log('');
    c.log(' [0] Exit program');
    if (state.versionList && state.versionList.length) {
      const last = state.versionList[state.versionList.length - 1];
      if (last.isCurrentInstance && state.instanceRunning) {
        c.log(` [1] View current instance version "${last.id}" (currently executing at pid ${state.instancePid})`)
      } else if (last.startedAt || last.createdAt) {
        const diff = getFormattedHourDifference(new Date(), last.startedAt || last.createdAt);
        c.log(` [1] View latest created pipeline "${last.id}" (pipeline ${last.startedAt ? 'started' : 'created'} ${diff} hours ago)`);
      } else {
        c.log(` [1] View latest created pipeline "${last.id}"`);
      }
    } else {
      c.log(' [/] There are no pipelines (no app versions have been pushed)');
    }
    c.log(` [2] View deployment logs (${state.deploymentLogFileSize ? (state.deploymentLogFileSize / 1024).toFixed(1) + 'KB' : 'not found'})`);
    c.log('');

    process.stdout.write('\n > Enter an option: ');
    const selection = await waitForUserInput();
    process.stdout.write('\n');
    if (selection === '0') {
      c.log('Goodbye');
      process.exit(0);
    } else if (selection === '1' && state.versionList && state.versionList.length) {
      const last = state.versionList[state.versionList.length - 1];
      c.log(`The last pipeline created is "${last.id}"`);
      if (last.isCurrentInstance) {
        if (state.instanceRunning) {
          c.log(`It is currently running at pid ${state.instancePid} as the current app instance`);
        } else if (state.instancePid) {
          c.log(`It is the app instance but it has exited`);
        } else {
          c.log(`It is the app instance but it has not started`);
        }
      }
      if (last.createdAt) {
        const diff = getFormattedHourDifference(new Date(), last.createdAt);
        c.log(`It was created at ${last.createdAt.toISOString()} (${diff} hours ago)`);
      }
      if (last.startedAt) {
        const diff = getFormattedHourDifference(new Date(), last.startedAt);
        c.log(`It was started at ${last.startedAt.toISOString()} (${diff} hours ago)`);
      }
      c.log('');
      continue;
    } else if (selection === '2') {
      c.log(`Deployment logs path: ${state.deploymentLogFilePath}`);
      c.log(`Deployment logs size: ${state.deploymentLogFileSize ? `${(state.deploymentLogFileSize / 1024).toFixed(1)} KB` : '(no file)'}`);
      const targetLogFile = state.deploymentLogFilePath;
      const stat = await asyncTryCatchNull(fs.promises.stat(targetLogFile));
      if (stat === null) {
        c.log('The file does not exist and therefore cannot be read.');
        continue;
      }
      process.stdout.write(`\nLast 100 lines of "${targetLogFile}"\n\n`);
      await new Promise(resolve => setTimeout(resolve, 200));
      process.stdout.write('\n');
      await new Promise(resolve => setTimeout(resolve, 200));
      process.stdout.write('\n');
      await new Promise(async (resolve) => {
        try {
          const child = cp.spawn('tail', ['-n', '100', targetLogFile], {
            cwd: path.dirname(targetLogFile),
            stdio: ['ignore', 'inherit', 'inherit']
          });
          child.on('error', (err) => {
            c.log(`Could not execute the "tail" command: ${err.message}`);
            resolve();
          });
          child.on('exit', () => resolve());
        } catch (err) {
          c.log(`Failed while starting "tail" command: ${err.message}`);
          resolve();
        }
      });
      process.stdout.write('\n');
      await new Promise(resolve => setTimeout(resolve, 500));
      process.stdout.write(`\nLog finished\n\n`);
      continue;
    } else {
      c.log('Option not recognized as valid input');
      continue;
    }
  }
}

async function nodeDeploymentSetup() {
  let targetPath = args.length === 1 ? path.resolve(args[0]) : '';

  // Check if we must change our log file path
  {
    const startConfig = targetPath ? getProjectConfig(targetPath) : null;

    if (startConfig && startConfig.logFilePath) {
      const stat = await asyncTryCatchNull(fs.promises.stat(startConfig.logFilePath));
      if (stat !== null) {
        c.logFilePath = startConfig.logFilePath;
      }
    }
  }

  c.log('Node deployment setup started');
  c.log('');
  c.log(`   process id: ${process.pid}`);
  c.log(`    parent id: ${process.ppid}`);
  c.log(` current path: ${process.cwd()}`);
  c.log(`    logs path: ${c.logFilePath}`);
  if (targetPath) {
    c.log(`   start path: ${targetPath}`);
  }

  startUserInput();

  for (let k = 0; k < 1000; k++) {
    if (k !== 0 || args.length === 0) {
      process.stdout.write('\nEnter the path for the project repository:\n\n > ');
    }
    const newPath = k === 0 && args.length === 1 ? targetPath : await waitForUserInput();
    process.stdout.write('\n');
    if (!newPath || newPath.length > 256) {
      process.stdout.write('Invalid path. Try again\n');
      continue;
    }
    const resPath = path.resolve(newPath);
    if (resPath !== newPath) {
      process.stdout.write('The path was expanded to: ');
    } else {
      process.stdout.write('Selected path: ');
    }
    process.stdout.write(`${resPath}\n`);
    const stat = await asyncTryCatchNull(fs.promises.stat(resPath));
    if (stat === null) {
      process.stdout.write('\nThis directory does not exist yet.\n');
    } else if (!stat.isDirectory()) {
      process.stdout.write('\nThis path cannot be used because it is a file.\n');
      continue;
    }
    process.stdout.write('\n');
    const confirm = await waitForUserConfirmation(stat === null ? ' > Create the new directory for the project?' : ' > Confirm target repository path?');
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
        c.log('');
        c.log(err.stack);
        c.log('');
        c.log('You may retry at the same path or choose another.');
        process.stdout.write('\n');
        const confirm = await waitForUserConfirmation(' > Retry at same path?');
        process.stdout.write('\n');
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

async function waitForUserInput() {
  return await new Promise((resolve) => {
    global.userInputResolve = resolve;
  });
}

function startUserInput() {
  if (global.userInput) {
    return;
  }
  global.userInput = true;
  process.stdin.on('data', (data) => {
    const resolve = global.userInputResolve;
    if (resolve) {
      global.userInputResolve = null;
      resolve(data.toString('utf-8').trim());
    }
  })
}

function getFormattedHourDifference(date1, date2) {
  const delta = Math.abs(date1.getTime() - date2.getTime());
  const s = delta / 1000;
  const m = s / 60;
  const h = m / 60;
  return [h, m, s].map(n => Math.floor(n).toString().padStart(2, '0'));
}
