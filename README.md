<h1 align="center">
  <a href="#">Node Deployment Manager</a>
</h1>
<h3 align="center">
 Automatic and Continuous Deployment Manager for Node.js projects.
</h3>

<h4 align="justify">
This project configures a project to automatically process a deployment pipeline when a project is updated. It performs steps such as dependency install, project building, script execution (test / lint), etc and when the process succeeds the project instance process is restarted with the new project version.
</h4>

When executed it provides a interactive setup process to configure a project repository, it also attempt to start and manage the project instance process (`npm run start`) so that it can restart it when new versions are available. This project also supports reconfiguration, streaming of logs (from deployment or from the project instance process), status retrieval, and is flexible and easy to adapt to different use cases.

## Usage

The `node-deploy.cjs` script can be executed direcly with [Node](https://nodejs.org/en) to setup the remote repository of your project, the latest version is [node-deploy.cjs](./node-deploy.cjs) but a stable release version can be downloaded from the [releases](https://github.com/GuilhermeRossato/node-deployment/releases) tab at this repository.

You can download it from the or use this command to fetch and execute it direcly:

```bash
node -e "fetch('https://raw.githubusercontent.com/GuilhermeRossato/node-deployment/master/node-deploy.cjs').then(r=>r.text()).then(t=>new Function(t)()).catch(console.log))"
```

You can also download it with curl / wget / node:

```bash
curl -o node-deploy.cjs https://raw.githubusercontent.com/GuilhermeRossato/node-deployment/master/node-deploy.cjs
wget https://raw.githubusercontent.com/GuilhermeRossato/node-deployment/master/node-deploy.cjs -O node-deploy.cjs
node -e "fetch('https://raw.githubusercontent.com/GuilhermeRossato/node-deployment/master/node-deploy.cjs').then(r=>r.text()).then(t=>fs.promises.writeFile('node-deploy.cjs', t, 'utf-8')).catch(console.log))"
```

Note: The standalone Node.js script does not need any dependency and it is generated from the bundling process of this project (with `npm run build`) by concatenating the source files in this project.

## Deployment

The asynchronous deployment process starts when updates are submited to the project that has been configured with this. The process is isolated and spawns to perform the following steps (by default):

- Checkout the new repository version to `./deployment/upcoming-instance`
- Copies files from the current instance (configurations, dependencies, data, etc)
- Install project dependencies (if they changed).
- Execute project scripts such as `npm run build` and `npm run test` from `package.json`
- Backup the contents of the current project folder to `./deployment/previous-instance`
- Stop the current instance process
- Move the new project files to the project folder at `./deployment/current-instance`
- Starts the instance process in the folder with the project version

The [post-update](https://git-scm.com/docs/githooks) hook (configured by this script) triggers the process and the logs from the instance process and the deployment pipelines are written to `<proj>/deployment/instance.log` and `<proj>/deployment/deployment.log` respectively. The process id of the instance is stored at `<proj>/deployment/instance.pid` when it spawns and it is removed when the instance process exits.

## Setup

The setup mode is the default program mode and it prompts the user to configure a repository, it can also create the git bare repository to store the project's git data (commits, branches, etc). To initialize a repository it creates a `deployment` folder inside the repo to store **logs**, status, process ids, scripts, and backups.

The [post-update](https://git-scm.com/docs/githooks) hook is configured to begin the deployment process when commits are pushed to the repository. Pipelines start creating a new release folder at (`./deployment/upcoming-instance`) and processing it until its content are ready to replace the project instance folder (`./deployment/current-instance/`). The contents of the instance previously in executing are moved to `./deployment/previous-instance` and can be used to restore the version by moving it back to its original location.

## Program modes

    --help / -h           Display help text
    --setup               Initialize and setup a project for automatic deployment (default)
    --config              Change settings and reconfigure projects
    --status / -s         Retrieve status information from the manager process
    --logs / -l           Print and stream logs continuously
    --runtime / --app     Only stream logs from the project instance process
    --start / --restart   Start or restart the manager process and display its status
    --shutdown / --stop   Stop the project instance process and the instance manager process
    --upgrade <path>      Fetch the deployment script source and write to a target file

The "--status" mode can be combined with "--restart" to restart the manager process and "--start" to only start the process if it is not running.

## Flags

    --debug / --verbose / -d   Enable verbose mode (prints more logs)
    --force / --yes / -y       Force confirmations, automatically assuming yes
    --dry-run / --dry          Simulate execution by not writing files and causing no side-effects
    --sync / --wait            Execute child processes syncronously
    --port <port>              Define the internal manager server port

## Advanced modes

    --schedule            Manually schedule an asyncronous deployment of the project
    --schedule <commit>   Schedules deployment of a specific version of the project by commit
    --schedule <ref>      Schedules deployment specifying the project version by a reference
    --process             Execute the deployment pipeline syncronously
    --process <commit>    Execute the deployment at a specific commit
    --process <rev>       Execute a deployment pipeline at a specific branch reference
    --manager             Run this program to manage the project instance synchronously

## Tips

If you have SSH access you can send and execute the deployment script from the server with `scp`:

```bash
wget https://raw.githubusercontent.com/GuilhermeRossato/node-deployment/master/index.js -O node-deploy.cjs
scp ./node-deploy.cjs [username]@[hostname]:~/Downloads/node-deploy.cjs
ssh [username]@[hostname] "node ~/Downloads/node-deploy.cjs"
```

New repositores can be cloned from remote git repositores with `git clone ssh://[[username]]@[[hostname]]:[[port]]/[[git-bare-path]]` and existing repositories can be configured to fetch and submit (pull and push) changes to a remote server with git:

```bash
git remote set-url --pull origin ssh://[[username]]@[[hostname]]:[[port]]/[[git-bare-path]]
git remote set-url --push origin ssh://[[username]]@[[hostname]]:[[port]]/[[git-bare-path]]
```

## Dependencies

This project handles repositories with [git](https://git-scm.com/book/en/v2/Getting-Started-Installing-Git) and is executed with [node](https://nodejs.org/en). It does not need any npm packages.

## Objective

I created to help bootstrap new self-hosted projects to private servers to quickly validate new frameworks and to experiment with small projects.

Running a production environment with CI/CD requires multiple time-consuming steps that are hard to debug. This script organize the most common CI/CD process for modern Node.js projects (and can be adapted easily to others) by creating repositories, seting up hooks, managing processes, automatic restarts, logging, etc, and new project versions replace the executing process transparently when everything goes right.

I wanted to get a deeper understanding of how CI/CD works by implementing it and dealing with its complexities: In professional development I've used enterprise services like [Github Actions](https://docs.github.com/en/actions), [Bitbucket Pipelines](https://bitbucket.org/product/features/pipelines) and [Google App Engine](https://cloud.google.com/build/docs/deploying-builds/deploy-appengine) and they are amazing for development and have great features, the only downside is that they are either slow, expensive, or unflexible.

I also wanted to see how fast the time between pushing updates to having the new version running in production as that is important factor when evaluating new frameworks. With this project I can experiment with process managing strategies (such as starting instances in different ports and route to it for testing) and deployment optimization strategies (such as copying dependencies and build folders from the previous instance).
