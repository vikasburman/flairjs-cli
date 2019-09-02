const fsx = require('fs-extra');
const path = require('path');

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
exports.exec = async function(settings, options, cb) { // eslint-disable no-unused-vars
    if (!options.profiles.current.bundles || options.profiles.current.bundles.length === 0) { cb(); return; }

    options.logger(0, 'bundle', '', true);

    // bundle misc files on dest location
    let src = '',
        bundleFile = '',
        bundleFileContent = '';
    for(let bundleInfo of options.profiles.current.bundles) {
        bundleFile = path.resolve(path.join(options.profiles.current.dest, bundleInfo.target));
        bundleFileContent = `// created: ${Date.now().toString()}\n`;
        for(let toBundlefile of bundleInfo.files) {
            src = path.resolve(path.join(options.profiles.current.dest, toBundlefile));
            bundleFileContent += `\/\/  file (start): ${toBundlefile}\n ${fsx.readFileSync(src, 'utf8')} \n \/\/ file (end) \n`;
        }
        fsx.ensureFileSync(bundleFile); // ensure any directories are created
        fsx.writeFileSync(bundleFile, bundleFileContent, 'utf8');

        // minify if configured 
        let minFile = bundleFile.replace('.js', '.min.js'),
            gzFile = minFile + '.gz';
        if (settings.minify && options.minify && options.minifyConfig) {
            await options.funcs.minifyFile(bundleFile);
            if (settings.gzip && options.gzip && options.gzipConfig) {
                await options.funcs.gzipFile(minFile);
                options.logger(1, '-->', bundleInfo.target + ` (${Math.round(fsx.statSync(bundleFile).size / 1024)}kb, ${Math.round(fsx.statSync(minFile).size / 1024)}kb minified, ${Math.round(fsx.statSync(gzFile).size / 1024)}kb gzipped)`);
            } else {
                options.logger(1, '-->', bundleInfo.target + ` (${Math.round(fsx.statSync(bundleFile).size / 1024)}kb, ${Math.round(fsx.statSync(minFile).size / 1024)}kb minified)`);
            }
        } else {
            options.logger(1, '-->', bundleInfo.target + ` (${Math.round(fsx.statSync(bundleFile).size / 1024)}kb)`);
        }        
    }

    // done
    cb();
};