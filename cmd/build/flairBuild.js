const path = require('path');
const chalk = require('chalk');
const loggerFunc = require('../shared/modules/logger').logger; 
const cleanDest = require('./modules/clean_dest');
const bumpVersion = require('./modules/bump_version');
const loadProfiles = require('./modules/load_profiles');
const buildAsemblies = require('./modules/build_assemblies');
const buildPackage = require('./modules/build_package');
const buildInfo = {
    name: 'flairBuild',
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

    // linters
    if (options.lint.perform) { // lint
        options.lint.engines = {};
        if (options.lint.types.indexOf('js') !== -1) { // js
            const CLIEngine = new require('eslint').CLIEngine;
            options.lint.engines.js = new CLIEngine(options.lint.js);
            options.lint.engines.jsFormatter = options.lint.engines.js.getFormatter();
        }
        if (options.lint.types.indexOf('css') !== -1) { // css
            options.lint.engines.css = require('stylelint').lint;
        }
        if (options.lint.types.indexOf('html') !== -1) { // html
            options.lint.engines.html = require('htmllint');
        }
    }

    // minifiers
    if (options.minify.perform) { 
        options.minify.engines = {};
        if (options.minify.types.indexOf('js') !== -1) { // js
            options.minify.engines.js = require('uglify-es').minify;
        }
        if (options.minify.types.indexOf('css') !== -1) { // css
            options.minify.engines.css = require('clean-css');
        }
        if (options.minify.types.indexOf('html') !== -1) { // html
            options.minify.engines.html = require('html-minifier').minify;
        }        
    }

    // gzippers
    if (options.gzip.perform) { 
        options.gzip.engines = {};
        options.gzip.engines.common = require('zlib');
    }

    // #endregion

    // start
    options.logger(1, buildInfo.name, chalk.magenta(options.package.name), (options.session.build.full ? 'full' : (options.session.build.quick ? 'quick' : 'standard')));

    // bump version
    bumpVersion(options);

    // clean dest
    cleanDest(options);

    // load profiles
    await loadProfiles(options);

    // build assemblies
    await buildAsemblies(options);

    // build package
    await buildPackage(options);

    // end
    options.logger(-1);
    options.logger(0, buildInfo.name, 'done');
    
    //#region cleanup

    delete options.package;
    delete options.logger;
    delete options.lint.engines;
    delete options.minify.engines;
    delete options.gzip.engines;
    delete options.profiles;
    delete options.buildInfo;

    //#endregion
};
