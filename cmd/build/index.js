const fsx = require('fs-extra');
const chalk = require('chalk');
const getOptions = require('../shared/modules/get_cmd_options.js');
const flairBuild = require('./flairBuild.js');

// do
const doTask = (argv, done) => {
    // read command line options
    let flag = argv.flag || '',         // 
        forcedFullBuild = argv.full,    // --full
        forcedQuickBuild = argv.quick;  // --quick
        suppressLogging = argv.nolog    // --nolog

    // get options
    let options = getOptions();

    // set session mode and modify options for given mode
    options.session.suppressLogging = (suppressLogging ? true : false);
    if (forcedFullBuild) { 
        options.session.build.full = true;

        options.build.clean = true;
        options.build.version = true;
        options.lint.perform = true;
        options.minify.perform = true;
        options.gzip.perform = true;
        options.resources.lint = true;
        options.resources.minify = true;
        options.assets.gzip = true;        
    }
    if (forcedQuickBuild && !forcedFullBuild) { 
        options.session.build.quick = true;

        options.build.clean = false;
        options.build.version = false;
        options.lint.types = ['js']; // restrict to js only, in case lint was on
        options.build.assembly.lint.members = false;
        options.minify.perform = false;
        options.gzip.perform = false;
        options.assets.gzip = true;  
        options.docs.perform = false;
        options.pack.perform = false;
    }
    if (flag) {
        options.session.build.flag = flag;
    }

    // run build session
    flairBuild(options).catch((err) => {
        options.logger(0, chalk.redBright('ABORT: ' + err) + chalk.gray('\n' + err.stack));
    }).finally(done);
};

exports.run = function(argv, cb) {
    doTask(argv, cb);
};