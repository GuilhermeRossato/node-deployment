# Node Deployment: Program to manage a project's automatic deployment process

This is a node script used to setup and configure projects with an automatic deployment process.

When a developer submits changes to a repository configured by this script an asyncronous deployment pipeline is scheduled and executes the configured steps. When a pipeline finishes successfully the app instance is restarted.

## How to use

The `node-deployment.js` file is self-contained and has no dependencies besides node. Add and execute it on the server where you your project repository is or bill be stored, it is also the where the deployment is processed and the app instances managed.

Download the script:

```shell
curl -o node-deployment.js https://raw.githubusercontent.com/GuilhermeRossato/node-deployment/master/node-deployment.js
```

Execute the script:

```shell
node node-deployment.js
```

The script will interactively guide you to configure your project, starting by asking for a path to setup the repository. You can also pass the project path as the first argument.

## How it works

This program creates a bare git repository on a specified directory which is used to clone and push changes the project.

A folder named `deployment` is created on the repository path to hold data related to the automatic deployment.

When changes are pushed to the project, git will execute the [post-update](https://git-scm.com/docs/githooks) hook, which this script configures to schedule a deployment pipeline to be processed asyncronously.

The deployment pipeline begins by cloning the repository to a newly created folder at `./deployment/versions/[id]` and then executes the configured pipeline steps.

After the pipeline succeeds the previous app instance is stopped and a new one is started (by running `npm run start`) on the working directory that was created for that pipeline.

## Configuration

After setting up a project you can run this script again to reconfigure it, read logs, or manage instances.

## Dependencies

This program runs with [node](https://nodejs.org/en), it does not depend on any npm package so nothing needs to be installed with `npm install`, just cloning it works.

This script uses [git](https://git-scm.com/book/en/v2/Getting-Started-Installing-Git) for the creation and handling of the repository of projects.

## Tips

If you have `wget` you can download and execute the script with:

```bash
wget https://raw.githubusercontent.com/GuilhermeRossato/node-deployment/master/node-deployment.js -O node-deployment.js && node node-deployment.js
```

You can upload a local `node-deployment.js` file to a remote server with scp and execute it with ssh:

```bash
scp -P 22 ./node-deployment.js [username]@[hostname]:~/Downloads/node-deployment.js
ssh -p 22 [username]@[hostname] "node ~/Downloads/node-deployment.js"
```

## Final notes

I created this setup script to help bootstrap new projects for my own experiments. Validating frameworks and ideas quickly is useful but setting up a good development process for a new project when self-hosting is difficult and error-prone.

I like when apps eventually restart with the new version after their repository receive updates. This speeds up deployment significantly but creating self-hosted projects like this involves a lot of work: creating the repository, setting up hooks, performing process management, automatic instance restart, configuring reboot scripts, logging to files, etc.

This script can quickly organize the most common CI/CD process of node projects, each git update creates new version, install the dependencies if they changed, perform the project build, and finally run the new version of the app!

I also wanted to see how quickly I could go from pushing changes to a project to having the new version serving requests in production. Most projects have a high push-to-production time and experimenting with it is not easy.
