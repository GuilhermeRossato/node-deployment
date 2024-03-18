# Todo

1. Logs
    - Disable saving of persistent logs on CLI (setup) mode
    - Change how the logs are printed to include logs from other processes

2. Main operation
    - Disable executing setup steps of configured projects without prompt, including sub-process checking and startup
    - Disable asking of project directory inside configured projects
    - Create a method to collect output from cli commands to display in case of error instead of using inherit
    - Add logic to try to create a symlink to the production folder at the git bare repository
    - (Low priority) Replace instructions to add to cron with interactive script
    - Change display menu for logs to  print last few minutes or a default amount of lines
        - Print at least 30 lines and at most 120, depending on process.stdout.rows
    - Simplify menu options and add an advanced mode
    - Revise and implement navigate version files
    - Implement direct log mode: Program arguments to select project and just display latest logs

## Low priority Todo

1. Main file
    - Break apart utility functions into `lib` folder
    - Break apart execution modes into `scripts` folder
    - Create build system to create resulting standalone script

2. Interactive connection guide
    - Implement step-by-step re-trying attempt to ssh into a target server and create project
    - Implement Git clone attempt, including 
    