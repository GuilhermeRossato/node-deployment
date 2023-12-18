# [Unfinished] Node Deployment: Program to manage a project's automatic deployment process

This repository will contain the source of a node program that configures the automatic deployment of npm projects stored on a git repository.

## How to use

Add and execute the main script on this repository on the server where you want your project repository to be stored, it must also be the server where the deployment will be processed and instances managed.

```shell
node node-module.js
```

The script will ask you where you want your project to start

This script will interactively guide the setup of your project on that server, configuring what is necessary.

You can add `--verbose` to the command to include additional output.

## How it works

This program configures a project by creating a git bare repository on the project directory. This folder will be used to clone and push changes the project.

When the project files are changed git will execute the [post-update](https://git-scm.com/docs/githooks) hook, configured by this program to asyncronously process the deployment.

This program also creates a folder called `deployment` inside the project's directory to hold its deployment state, configuration, logs, etc.

This script executes itself in different modes to fully handle the deployment process.

When instance management of a project is enabled a successfull pipeline will trigger a instance restart: The process that is executing the instance of your project is stopped if it was executing, and another one will start on the working directory with the new version of the app.

## Dependencies

This program is executed with [node](https://nodejs.org/en) and has no packages on its dependencies.

This script depends on [git](https://git-scm.com/book/en/v2/Getting-Started-Installing-Git) to hold the repository data and to execute the `post-update` hook when it receives changes.
