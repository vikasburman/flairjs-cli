const path = require('path');
const fsx = require('fs-extra');
const child_process_exec = require('child_process').exec;

/**
 * @name node_modules
 * @description install node_modules for current profile, if configured
 * @example
 *  exec(settings, options, cb)
 * @params
 *  settings: object - plugin settings object
 *  options: object - build configuration object
 *  cb: function - callback function
 * @returns void
 */
exports.exec = function(settings, options, cb) { // eslint-disable no-unused-vars
    options.logger(0, 'node-modules', '', true);

    // copy package.json, if not already copied
    let src = options.package,
        dest = path.resolve(path.join(options.profiles.current.dest, src)),
        isCopied = false,
        isNodeModulesFolderExists = true;
    if (!fsx.existsSync(dest)) {
        fsx.copyFileSync(src, dest);
        isCopied = true;
    } else {
        let node_modules_folder = path.resolve(path.join(options.profiles.current.dest, 'node_modules'));
        if (!fsx.existsSync(node_modules_folder)) {
            isNodeModulesFolderExists = false;
        }
    }

    const doExec = () => {
        // install node-modules
        child_process_exec(settings.cmd, {
            cwd: path.resolve(options.profiles.current.dest)
        }, () => {
            options.logger(1, '', Object.keys(options.packageJSON.dependencies).length + ' dependencies installed');
            cb();
        });
    };

    if (isCopied || !isNodeModulesFolderExists || options.clean || options.fullBuild) { // when cleaned or fullbuild, go exec
        doExec();
    } else { // else, even if this is not quickBuild, this optimization works
        if (fsx.statSync(src).mtime > fsx.statSync(dest)) {
            doExec();
        } else { // skip
            options.logger(1, '', '[no change, install skipped]');
            cb();
        }
    }
};