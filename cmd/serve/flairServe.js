const chalk = require('chalk');
const pathJoin = require('../shared/modules/path_join');
const child_process = require('child_process');
const loggerFunc = require('../shared/modules/logger').logger; 
const buildInfo = {
    name: 'flairServe',
    version: '1.0.0'
};

module.exports = async (options) => {
    // #region initialize

    // build info
    options.buildInfo = buildInfo;

    // logger
    options.logger = (...args) => { if (options.session.suppressLogging) { return; } loggerFunc(...args); };
     
    // #endregion

    // start
    options.logger(1, buildInfo.name);

    // if given as args, disregard configured ones
    // means use only given 
    if (options.session.serve.server || options.session.serve.client) {
        options.debug.server.enable = false;
        options.debug.client.enable = false;
    }

    // start for server
    let root = '',
        port = -1;
        serverProc = null,
        clientProc = null;
    if (options.session.serve.server || options.debug.server.enable) {
        root = pathJoin(options.build.dest, options.debug.server.root);
        port = options.debug.server.port;
        serverProc = child_process.execFile('http-server', [root, `-p${port}`]);

        // show
        options.logger(0, `Serving '${chalk.yellow(root)}' at: ` + chalk.blueBright(`http://localhost:${port}`) + ` (PID: ${chalk.green(serverProc.pid)})`);
    }
   
    // start another for client
    if (options.session.serve.client || options.debug.client.enable) {
        root = pathJoin(options.build.dest, options.debug.client.root);
        port = options.debug.client.port;
        clientProc = child_process.execFile('http-server', [root, `-p${port}`]);

        // show
        options.logger(0, `Serving '${chalk.yellow(root)}' at: ` + chalk.blueBright(`http://localhost:${port}`) + ` (PID: ${chalk.green(clientProc.pid)})`);
    }

    // end
    options.logger(-1);
    options.logger(0, buildInfo.name, 'done', '', chalk.magenta('Press ^C to terminate server(s).'));
    
    //#region cleanup

    delete options.logger;

    //#endregion        
};