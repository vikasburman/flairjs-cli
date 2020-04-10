const fsx = require('fs-extra');
const chalk = require('chalk');
const getOptions = require('../shared/modules/get_cmd_options.js');
const flairServe = require('./flairServe.js');

// do
const doTask = (argv, done) => {
    // read command line options
    let server = argv.server,                // --server
        client = argv.client;               // --client 

    // get options
    let options = getOptions();

    if (client) {
        options.session.serve.client = true;
    }
    if (server) {
        options.session.serve.server = true;
    }

    // serve/kill server
    flairServe(options).catch((err) => {
        options.logger(0, chalk.redBright('ABORT: ' + err + (err.line ? `\nfile: ${err.filename}\nline: ${err.line}\ncol: ${err.col}` : '')) + chalk.gray('\n' + err.stack));
    }).finally(done);
};

exports.run = function(argv, cb) {
    doTask(argv, cb);
};
