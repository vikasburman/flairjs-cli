const path = require('path');
const fsx = require('fs-extra');
const copyDir = require('copy-dir');
const child_process_exec = require('child_process').exec;
const delAll = require('../../shared/modules/delete_all');
const wildcards = require('../../shared/modules/wildcard_match');

module.exports = async function(options) {
    if (!options.pack.perform) { return; }

    options.logger(0, 'package', '');
    
    // delete all old files of at temp
    let temp = path.resolve(options.pack.temp);
    delAll(temp);
    options.logger(1, '', 'clean');

    // copy files to package, so it can be published using
    let src = '', 
        dest = '',
        excludes = [...options.general.ignoreFilesFolders];
    for(let file of options.pack.files) {
        options.logger(1, '', file.src);
        src = path.resolve(file.src);
        if (fsx.lstatSync(src).isDirectory()) {
            dest = path.join(temp, (file.dest || '')) || dest; // if destination is defined for item level
            fsx.ensureDirSync(dest);
            copyDir.sync(src, dest, {
                utimes: true,
                mode: true,
                cover: true,
                filter: (stat, filepath) => {
                    if (wildcards.isMatchAny(filepath, excludes)) { return false; }
                    if (wildcards.isMatchAny(path.basename(filepath), excludes)) { return false; }
                    return true;
                }                
              });
        } else {
            dest = path.join(temp, (file.dest || path.basename(src)));
            fsx.ensureDirSync(path.dirname(dest));
            fsx.copyFileSync(src, dest);
        }
    }
    
    // run pack command
    let cmd = options.pack.cmd,
        file = `${options.package.name}-${options.package.version}.tgz`, // 'flairjs-0.67.85.tgz'
        pkg = path.join(temp, file),
        target = path.join(options.pack.dest, file);
    
    return new Promise((resolve, reject) => {
        child_process_exec(cmd, { cwd: options.pack.temp }, (err) => {
            if (err) { 
               throw new Error(err);
            } else {
                if (fsx.existsSync(pkg)) {
                    fsx.ensureDirSync(options.pack.dest);
                    fsx.copyFileSync(pkg, target);
                    fsx.removeSync(pkg);
                    options.logger(1, '', '> ' + file);
                } else {
                    options.logger(1, '', 'failed!');
                }
            }
            resolve();
        });
    });
};