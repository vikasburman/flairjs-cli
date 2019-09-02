const fsx = require('fs-extra');

/**
 * @name create_bundle
 * @description bundle misc files for current profile, if configured
 * @example
 *  exec(settings, options, cb)
 * @params
 *  settings: object - plugin settings object
 *  options: object - build configuration object
 *  cb: function - callback function
 * @returns void
 */
exports.exec = function(settings, options, cb) { // eslint-disable no-unused-vars
    options.logger(0, 'bundle', '', true);

    // bundle misc files on dest location
    let src = '',
        bundleFile = path.resolve(path.join(options.profiles.current.dest, options.profiles.current.bundle.target)),
        bundleFileContent = `// created: ${Date.now().toString()}\n`;
    for(let toBundlefile of options.profiles.current.bundle.files) {
        src = path.resolve(path.join(options.profiles.current.dest, toBundlefile));
        bundleFileContent += `\\  file (start): ${src}\n ${fsx.readFileSync(src, 'utf8')} \n \\ file (end)`;
    }
    fsx.writeFileSync(bundleFile, bundleFileContent, 'utf8');

    // minify if configured
    let isMinified = false;
    if (settings.minify && options.minify && options.minifyConfig) {
        await options.funcs.minifyFile(bundleFile);
        options.logger(1, '', bundleFile.replace('.js', '.min.js'));
    } else {
        options.logger(1, '', bundleFile);
    }

    // done
    cb();
};