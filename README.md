# Node Deployment: Program to manage a project's automatic deployment process

This repository contains the source of a node program that configures the automatic deployment of npm projects stored on a git repository.

## How to use

Add and execute the script on this repository on the server where you want your project repository to be stored, it must also be the server where the deployment will be processed and instances managed.

```shell
node node-deployment.js
```

The script will interactive guide you to configure your project.

You can add `--verbose` to the command to include additional output.

## How it works

This program configures a project by creating a git bare repository on the specified project directory. The bare git repository is used to clone and push changes the project.

When changes are pushed to the project git will execute the [post-update](https://git-scm.com/docs/githooks) hook that is configured by this program to trigger an asyncronous process the deployment pipeline.

This program also creates a folder called `deployment` inside the project's directory to hold its deployment state, configuration, logs, etc.

This script executes itself in different modes to fully handle the deployment process.

When a pipeline finishes executing successfully the instance management will restart running instance: The process that is executing the project (with `npm run start`) is stopped and another is started on the working directory with the new version of the app.

## Dependencies

This program runs with [node](https://nodejs.org/en), it does not depend on any npm package so running `npm install` is not necessary after cloning it.

This script requires [git](https://git-scm.com/book/en/v2/Getting-Started-Installing-Git) for the creation and handling of the project repository.
