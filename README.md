<h1 align="center">
  <a href="#">Node Deployment Manager</a>
</h1>
<h3 align="center">
 Automatic and Continuous Deployment Manager for Node.js projects.
</h3>

<h4 align="justify">
This project configures a project to automatically process deployment when it receive updates, performing steps such as instalation of dependencies, building, execution of scripts (testing), etc. Successfull deployments replace the instance process with the new version.
</h4>

An interactive setup process guides the user to configure the repository of a project to perform deployment, it also starts and manages the long-running instance process, restarting it when new versions are available. It supports reconfiguration, log streaming, and displaying of status.

## Usage

The source file `node-deploy.cjs` from this project can be executed direcly with Node.js to begin configuring your projects with it.

You can download it manually from the [releases](https://github.com/GuilhermeRossato/node-deployment/releases) page or automatically fetch and execute it with this command:

```bash
node -e "fetch('https://raw.githubusercontent.com/GuilhermeRossato/node-deployment/master/node-deploy.cjs').then(r=>r.text()).then(t=>new Function(t)()).catch(console.log))"
```

The [node-deploy.cjs](./node-deploy.cjs) script is a standalone Node.js script generated from the build process of this project (`npm run build`). You can also download the script with curl/wget/node:

```bash
curl -o node-deploy.cjs https://raw.githubusercontent.com/GuilhermeRossato/node-deployment/master/node-deploy.cjs
wget https://raw.githubusercontent.com/GuilhermeRossato/node-deployment/master/node-deploy.cjs -O node-deploy.cjs
node -e "fetch('https://raw.githubusercontent.com/GuilhermeRossato/node-deployment/master/node-deploy.cjs').then(r=>r.text()).then(t=>fs.promises.writeFile('node-deploy.cjs', t, 'utf-8')).catch(console.log))"
```

## Deployment

The asynchronous deployment process starts when updates are submited to the project. An isolated process is spawned to perform these steps:

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

The setup mode is the default program mode and it alows the user to configure or create a repository to store a project's git data (commits, branches, etc). It also creates a `deployment` folder data related to deployment such as logs, status, process ids, scripts, and backups.

The [post-update](https://git-scm.com/docs/githooks) hook is configured to begin the deployment process when commits are pushed to the repository. Pipelines start creating a new release folder at (`./deployment/upcoming-instance`) and processing it until its content are ready to replace the project instance folder (`./deployment/current-instance/`). The contents of the instance previously in executing are moved to `./deployment/previous-instance` and can be used to restore the version by moving it back to its original location.

## Program modes

    --help / -h           Display help text
    --setup               Initialize and setup a project for automatic deployment (default)
    --config              Change settings and configure a project interactively
    --status / -s         Retrieve status information from the manager process
    --logs / -l           Print the latest log data continuously
    --instance / --app    Stream logs from the project instance process
    --start / --restart   Start or restart the manager process and display its status
    --shutdown            Stop the project instance process and the instance manager process
    --upgrade <path>      Fetch the deployment script source and write to a target file

The "--status" mode can be combined with "--restart" to restart the manager process. You can also use "--start" to only start the process if it is not running.

## Flags

    --debug / --verbose / -d   Enable verbose mode (prints more logs)
    --force / --yes / -y       Force confirmations, automatically assuming yes
    --dry-run / --dry          Simulate execution by not writing files and causing no side-effects
    --sync / --wait            Execute child processes syncronously

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

New repositores can be cloned from remote git repositores with `git clone ssh://[[username]]@[[hostname]]:[[port]]/[[git-bare-path]]` and existing repositories can be configured to pull (fetch) and to push (submit) changes to a remote server with git:

```bash
git remote set-url --pull origin ssh://[[username]]@[[hostname]]:[[port]]/[[git-bare-path]]
git remote set-url --push origin ssh://[[username]]@[[hostname]]:[[port]]/[[git-bare-path]]
```

## Dependencies

This project handles repositories with [git](https://git-scm.com/book/en/v2/Getting-Started-Installing-Git) and is executed with [node](https://nodejs.org/en). It does not need any npm packages.

## Objective

I created to help bootstrap new self-hosted projects to private servers so that I could quickly validate new frameworks and experiment with mockups.

Running a production environment with CI/CD requires multiple steps which are easy to get wrong and hard to debug (low observability). This script organize the most common CI/CD process for modern Node.js projects (and can be adapted easily to others) by creating repositories, seting up hooks, managing processes, automatic restarts, logging, etc, and new project versions replace the executing process transparently when everything goes right.

I wanted to get a deeper understanding of how CI/CD works by implementing it and dealing with its complexities: In professional development I've used enterprise services like [Github Actions](https://docs.github.com/en/actions), [Bitbucket Pipelines](https://bitbucket.org/product/features/pipelines) and [Google App Engine](https://cloud.google.com/build/docs/deploying-builds/deploy-appengine) and they are amazing for development and have great features, the only downside is that they are either slow, expensive, or unflexible.

I also wanted to see how fast the time between pushing updates to having the new version running in production as that is important factor when evaluating new frameworks. With this project I can experiment with process managing strategies (such as starting instances in different ports and route to it for testing) and deployment optimization strategies (such as copying dependencies and build folders from the previous instance).
