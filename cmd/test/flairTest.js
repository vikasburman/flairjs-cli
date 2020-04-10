const path = require('path');
const chalk = require('chalk');
const runServer = require('./modules/run_server');
const runClient = require('./modules/run_client');
const loggerFunc = require('../shared/modules/logger').logger; 
const buildInfo = {
    name: 'flairTest',
    version: '1.0.0'
};

module.exports = async function(options) {
    // #region initialize

    // build info
    options.buildInfo = buildInfo;

    // package.json object
    options.package = require(path.resolve(options.build.files.package));

    // logger
    options.logger = (...args) => { if (options.session.suppressLogging) { return; } loggerFunc(...args); };

     // #endregion

    // start
    options.logger(1, buildInfo.name, chalk.magenta(options.package.name), (options.session.test.client ? 'browser' : 'node'));

    // run tests
    if (options.session.test.client) {
        await runClient(options);
    } else {
        await runServer(options);
    }

    // end
    options.logger(-1);
    options.logger(0, buildInfo.name, 'done');
    
    //#region cleanup

    delete options.package;
    delete options.logger;

    //#endregion
};
