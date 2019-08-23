const fsx = require('fs-extra');

// do
const doTask = (argv, done) => {
    // get options file
    let options = argv.options || '',
        flag = argv.flag || '',
        forcedFullBuild = argv.full,
        forcedQuickBuild = argv.quick,
        optionsJSON = null;
    if (!options) {
        console.log('Build options definition is not configured. Use --options <file> to define.'); // eslint-disable-line no-console
        done(); return;
    }

    // load options
    optionsJSON = fsx.readJSONSync(options, 'utf8');
    if (forcedFullBuild) { optionsJSON.fullBuild = true; }
    if (forcedQuickBuild && !forcedFullBuild) { optionsJSON.quickBuild = true; }
    if (flag) { // active flag defined
        optionsJSON.activeFlag = flag;
    }
    let engine = optionsJSON.engine || './flairBuild.js';
    if (!engine) {
        console.log('Build engine is not configured. Define correct path of flairBuild.js at "engine" option in build options file.'); // eslint-disable-line no-console
        done(); return;
    }

    // load and run engine
    let flairBuild = require(engine);
    flairBuild(optionsJSON, done);
};

exports.run = function(argv, cb) {
    doTask(argv, cb);
};