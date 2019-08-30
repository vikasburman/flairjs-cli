const path = require('path');
const fsx = require('fs-extra');
const rrd = require('recursive-readdir-sync'); 
const del = require('del');
const copyDir = require('copy-dir');

const wildcardMatch = (find, source) => { // for future use when we support basic wildcard in copy definitions
    find = find.replace(/[\-\[\]\/\{\}\(\)\+\.\\\^\$\|]/g, "\\$&");
    find = find.replace(/\*/g, ".*");
    find = find.replace(/\?/g, ".");
    var regEx = new RegExp(find, "i");
    return regEx.test(source);
};

/**
 * @name copy_files
 * @description copy files for current profile, if configured
 * @example
 *  exec(settings, options, cb)
 * @params
 *  settings: object - plugin settings object
 *  options: object - build configuration object
 *  cb: function - callback function
 * @returns void
 */
exports.exec = function(settings, options, cb) { // eslint-disable no-unused-vars
    if (!options.profiles.current.copy || options.profiles.current.copy.length === 0) { cb(); return; }

    options.logger(0, 'copy', '', true);  

    // copy all files or folders as is from src in dest
    let src = '',
        bareSrc = '',
        dispSrc = '',
        dest = '';

    let copyThis = (_src, _dest, _bareSrc) => {
        options.logger(1, '', _bareSrc);
        if (fsx.lstatSync(_src).isDirectory()) {
            if (fsx.existsSync(_dest) && !(options.clean || options.fullBuild)) { // if exists and clean or full build not happening, delete the folder, so any deleted files are removed
                del.sync([_dest]); 
            }
            fsx.ensureDirSync(_dest);
            copyDir.sync(_src, _dest, {
                utimes: true,
                mode: true,
                cover: true
              });
        } else {
            fsx.ensureDirSync(path.dirname(_dest));
            fsx.copyFileSync(_src, _dest);
        }        
    };
    // file definition can be:
    // "file|folder" <-- assumed to be at root folder of the profile
    // "./file|folder" <-- assumed to be at root of the profile
    // "../file|folder" <-- assumed to be at root of the source
    // "~/file|folder" <-- assumed to be at root of the project
    // "file|folder >> destination-path-and-name" <-- '>>' delimited if present - target path and file|folder name can be defined in relation to dest folder
    // destination-path-name can start with: 
    // "file|folder" <-- assumed to be at root folder of the profile at destination
    // "./file|folder" <-- assumed to be at root of the profile at destination
    // "../file|folder" <-- assumed to be at root of the destination
    for(let fileOrFolder of options.profiles.current.copy) {
        if (fileOrFolder.indexOf('>>') !== -1) {
            let items = fileOrFolder.split('>>');
            src = items[0].trim();
            dest = items[1].trim();
        } else {
            src = fileOrFolder;
            dest = '';
        }
        if (src.startsWith('../')) { // assume source root
            dispSrc = src;
            src = src.substr(3); //  remove '../'
            bareSrc = src;
            src = path.resolve(path.join(options.src, bareSrc));
        } else if (src.startsWith('~/')) { // assume project root
            dispSrc = src;
            src = src.substr(2); //  remove '~/'
            bareSrc = src;
            src = path.resolve(path.join(process.cwd(), bareSrc));
        } else { // assume profile root
            if (src.startsWith('./')) { 
                src = src.substr(2); //  remove './'
            }
            dispSrc = './' + src;
            bareSrc = src;
            src = path.resolve(path.join(options.src, options.profiles.current.root, bareSrc));
        }
        if (dest === '') { // specific target not given, assume same name and same path in context of dest folder
            dest = path.resolve(path.join(options.profiles.current.dest, bareSrc))
        } else { // specific target given, use given path and name in context of dest folder
            if (dest.startsWith('../')) { // assume dest root
                dest = dest.substr(3); //  remove '../'
                dest = path.resolve(path.join(options.dest, dest));
            } else { // assume profile dest root
                if (dest.startsWith('./')) { 
                    dest = dest.substr(2); //  remove './'
                }                
                dest = path.resolve(path.join(options.profiles.current.dest, dest));
            }
        }            
    
        if (options.clean || options.fullBuild) { // cleaned or full build    
            copyThis(src, dest, dispSrc);
        } else if (!fsx.existsSync(dest)) { // file does not exists
            copyThis(src, dest, dispSrc);
        } else { // file exists
            if (fsx.statSync(src).mtime > fsx.statSync(dest).mtime) { // file updated
                copyThis(src, dest, dispSrc);
            } else {
                // folder specific checking
                if (fsx.lstatSync(src).isDirectory()) {
                    // get most recent updated file in src and if that time is greater than dest folder time, means something is updated in this folder
                    let _files = rrd(src),
                        _isUpdated = false;
                    for (let _file of _files) { 
                        _isUpdated = fsx.statSync(_file).mtime > fsx.statSync(dest).mtime;
                        if (_isUpdated) { break; }
                    }
                    if (_isUpdated) {
                        copyThis(src, dest, dispSrc);
                    } else {
                        options.logger(1, '', dispSrc + ' [exists, copy skipped]');
                    }
                } else {
                    options.logger(1, '', dispSrc + ' [exists, copy skipped]');
                }
            }
        }
    }

    // done
    cb();
};