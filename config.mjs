import path from "path";
export const projectRepositoryFolderPath = ".";
export const deployRepositoryFolderPath = ".";

export const productionLog = path.resolve(projectRepositoryFolderPath, "production.log");
export const productionFolder = path.resolve(projectRepositoryFolderPath, "prod");
export const newProductionFolder = path.resolve(projectRepositoryFolderPath, "new-prod");
export const oldProductionFolder = path.resolve(projectRepositoryFolderPath, "old-prod");
export const oldProductionArchive = path.resolve(projectRepositoryFolderPath, "old-prod");

export const managerPort = 7383;

// Logging
export const schedulerLog = path.resolve(projectRepositoryFolderPath, "scheduler.log");
export const processorLog = path.resolve(projectRepositoryFolderPath, "processor.log");
export const managerLog = path.resolve(projectRepositoryFolderPath, "manager.log");
export const setupLog = null;

// State
export const managerPid = path.resolve(projectRepositoryFolderPath, "manager.pid");

// Arguments
export const programMode = process.argv[2] || "setup";
export const hasRestartArg = process.argv.includes('--restart');
export const hasTerminateArg = process.argv.includes('--terminate');
export const syncronousScheduler = process.argv.includes("--sync");
