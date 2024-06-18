<h1 align="center">
  <a href="#">Node Deployment Manager</a>
</h1>
<h3 align="left">
 Continuous Deployment Manager for Self-Hosted Node.js projects.
</h3>

<h4 align="left">
Configures automatic deployment process when changes are submited to Node.js projects. When pipelines Successful pipelines cause the application instance to be restarted and replaced with the new project version.
</h4>

The program uses an interactive setup process to configure a git repository and its deployment pipelines, it then manages the app instance of a project. It also supports reconfiguration, log watching, and handling the project process.

## Purpose

When a project is updated a deployment is scheduled to build and deploy a new version of the project in an asynchronous deployment process:

 - Checkout the new version to `./deployment/new-instance`
 - Install project dependencies (or just copy it from the previous `node_modules` folder)
 - Execute the `package.json` build script (`npm run build`)
 - Execute the `package.json` test script (`npm run test`)
 - Stops the current instance process
 - Move the old contents of the project folder to `./deployment/old-instance`
 - Move the new project files to the project folder
 - Starts the instance on the updated contents

Everything starts at the [post-update](https://git-scm.com/docs/githooks) hook (configured by this script). The logs from the instance process and the deployment pipelines are written to `instance.log` and `deployment.log` respectively. The process id of the instance is stored at `instance.pid` when it spawns, the file is removed when the instance process exits.

## Usage

A standalone script is built from this project, it can be executed direcly with the following command:

```bash
node -e "fetch('https://raw.githubusercontent.com/GuilhermeRossato/node-deployment/master/node-deploy.cjs').then(r=>r.text()).then(t=>new Function(t)()).catch(console.log))"
```

You can also download the script locally from this project with curl/wget/node:

```bash
curl -o node-deploy.cjs https://raw.githubusercontent.com/GuilhermeRossato/node-deployment/master/node-deploy.cjs
wget https://raw.githubusercontent.com/GuilhermeRossato/node-deployment/master/node-deploy.cjs -O node-deploy.cjs
node -e "fetch('https://raw.githubusercontent.com/GuilhermeRossato/node-deployment/master/node-deploy.cjs').then(r=>r.text()).then(t=>fs.promises.writeFile('node-deploy.cjs', t, 'utf-8')).catch(console.log))"
```

## Setup behaviour

The setup creates a git bare repository to store a project data related to git (commits, branches, etc) and a `deployment` folder for things related to deploy handling (logs, status, process ids, scripts, and old release folders).

The [post-update](https://git-scm.com/docs/githooks) hook is configured execute the script that schedule asyncronous deployments after pushes are submited to the repository. When pipeline starts when the new release folder is created `./deployment/new-instance` and if it a step fails it halts and the new folder is renamed to `err-instance`, the `deployment.log` file inside should contain the error message. If a pipeline succeeds instead the contents of the new version are moved to the configured instance folder and its instance is restarted. The contents of the instance previously in executing are moved to `./deployment/old-inst` and can be restored by moving it back to its original location.

## Tips

If you have SSH access you can send the deployment script from the client to the server with `scp` and execute it directly:

```bash
wget https://raw.githubusercontent.com/GuilhermeRossato/node-deployment/master/index.js -O node-deploy.cjs
scp ./node-deploy.cjs [username]@[hostname]:~/Downloads/node-deploy.cjs
ssh [username]@[hostname] "node ~/Downloads/node-deploy.cjs"
```

Existing repositories can be configured to pull (fetch) and to push (submit) changes to a remote server with git:

```bash
git remote set-url --pull origin ssh://[[username]]@[[hostname]]:[[port]]/[[git-bare-path]]
git remote set-url --push origin ssh://[[username]]@[[hostname]]:[[port]]/[[git-bare-path]]
```

Repositores can be cloned from remote git repositores with `git clone ssh://[[username]]@[[hostname]]:[[port]]/[[git-bare-path]]`

## Dependencies

This project handles repositories with [git](https://git-scm.com/book/en/v2/Getting-Started-Installing-Git) and runs with [node](https://nodejs.org/en). It does not depend on any npm packages.

## Objective

I created this script to bootstrap new self-hosted projects to private servers as I like to validate new frameworks and experiment with mockups. Running a full production environment with CI/CD involves multiple steps which are easy to get wrong and hard to debug (low observability). This script organize the most common CI/CD process for modern Node.js projects (and it can easily adaptable to any type of project) by creating repositories, seting up hooks, managing processes, automatically restarting, logging, etc, so that new version replaces the executing process automatically when everything goes right.

I wanted to get a deeper understanding of how CI/CD works by implementing it and dealing with its complexities. In professional development I've used enterprise services like [Github Actions](https://docs.github.com/en/actions), [Bitbucket Pipelines](https://bitbucket.org/product/features/pipelines) and [Google App Engine](https://cloud.google.com/build/docs/deploying-builds/deploy-appengine) and they are amazing for development and have great features, the only downside is that they are either slow, expensive, or unflexible.

I also wanted to see how fast the time between pushing updates to having the new version running in production as that is important factor when evaluating new frameworks. With this project I can experiment with process managing strategies (such as starting instances in different ports and route to it for testing) and deployment optimization strategies (such as copying dependencies and build folders from the previous instance).
