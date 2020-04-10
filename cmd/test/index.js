const fsx = require('fs-extra');
const chalk = require('chalk');
const getOptions = require('../shared/modules/get_cmd_options.js');
const flairTest = require('./flairTest.js');

// do
const doTask = (argv, done) => {
    // read command line options
    let client = argv.client || false,                  // --client
        forcedFullTest = argv.full,                     // --full
        forcedQuickTest = argv.quick;                   // --quick
        group = argv.group;                             // --group <groupName>
        types = argv.types;                             // --types <typeName>,<typeName>
        browser = argv.browser;                         // --browser <browserName>
        suppressLogging = argv.nolog;                   // --nolog

    // get options
    let options = getOptions();

    // set session mode and modify options for given mode
    options.session.suppressLogging = (suppressLogging ? true : false);

    // full, quick, group
    if (forcedFullTest) { 
        options.session.test.full = true;
    }
    if (forcedQuickTest && !forcedFullTest) { 
        options.session.test.quick = true;
    }
    if (!forcedFullTest && !forcedQuickTest && group) {
        options.session.test.group = group;
    }
    if (!forcedFullTest && !forcedQuickTest && !group && types) {
        options.session.test.types = types;
    }    

    // client mode
    if (client) {
        options.session.test.client = true;

        // browser
        if (browser) {
            options.session.test.browser = browser;
        }
    }

    // run test session
    flairTest(options).catch((err) => {
        options.logger(0, chalk.redBright('ABORT: ' + err + (err.line ? `\nfile: ${err.filename}\nline: ${err.line}\ncol: ${err.col}` : '')) + chalk.gray('\n' + err.stack));
    }).finally(done);
};

exports.run = function(argv, cb) {
    doTask(argv, cb);
};
