const fsx = require('fs-extra');
const config = require('../../shared/options.js').config;
const flairBuild = require('./flairBuild.js');

// do
const doTask = (argv, done) => {
    // get options file
    let options = config(argv.options, 'build'),
        flag = argv.flag || '',
        forcedFullBuild = argv.full,
        forcedQuickBuild = argv.quick;
    if (!options) {
        console.log('Build options definition is not configured.');  // eslint-disable-line no-console
        done(); return;
    }

    // modify options for given flags
    if (forcedFullBuild) { options.fullBuild = true; }
    if (forcedQuickBuild && !forcedFullBuild) { options.quickBuild = true; }
    if (flag) { // active flag defined
        options.activeFlag = flag;
    }

    // run build
    flairBuild(options, done);
};

exports.run = function(argv, cb) {
    doTask(argv, cb);
};