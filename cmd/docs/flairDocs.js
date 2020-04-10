const open = require('open');
const chalk = require('chalk');
const child_process = require('child_process');
const loggerFunc = require('../shared/modules/logger').logger; 
const buildInfo = {
    name: 'flairDocs',
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

    // open server
    let proc = child_process.execFile('http-server', [options.docs.dest.root, `-p${options.docs.port}`]);

    // show
    options.logger(0, `Serving '${chalk.yellow(options.docs.dest.root)}' at: ` + chalk.blueBright(`http://localhost:${options.docs.port}`) + ` (PID: ${chalk.green(proc.pid)})`);

    // open required browser
    // NOTE: this await will resolve when browser is closed (not just tab where index.html was opened)
    let url = `http://localhost:${options.docs.port}`,
        browser = options.browsers[options.session.docs.browser || options.docs.browser || '']; // args given or configured or default
    if (browser) {
        await open(url, { app: browser.cmd, wait: true });
    } else { // use default
        await open(url, { wait: true });
    }

    // kill server
    proc.kill();

    // end
    options.logger(-1);
    options.logger(0, buildInfo.name, 'done');
    
    //#region cleanup

    delete options.logger;

    //#endregion    
};