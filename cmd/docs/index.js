const chalk = require('chalk');
const getOptions = require('../shared/modules/get_cmd_options.js');
const flairDocs = require('./flairDocs.js');

// do
const doTask = (argv, done) => {
    // read command line options
    let browser = argv.browser;          // --browser name

    // get options
    let options = getOptions();

    if (browser) {
        options.session.docs.browser = browser;
    }

    // serve docs
    flairDocs(options).catch((err) => {
        options.logger(0, chalk.redBright('ABORT: ' + err + (err.line ? `\nfile: ${err.filename}\nline: ${err.line}\ncol: ${err.col}` : '')) + chalk.gray('\n' + err.stack));
    }).finally(done);
};

exports.run = function(argv, cb) {
    doTask(argv, cb);
};
