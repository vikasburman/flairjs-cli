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
        dest = '',
        isDeleteFileOrFolder = false,
        ifPickFromDest = false;

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
    // file definition format can be:
    // source
    // source >> destination
    // source X
    // source can be:
    //      "file|folder" <-- assumed to be at root folder of the profile
    //      "./file|folder" <-- assumed to be at root of the profile
    //      "../file|folder" <-- assumed to be at root of the source
    //      "~/file|folder" <-- assumed to be at root of the project
    // special source modifiers:
    //      [>] source - is a modifier which will pick the source file|folder in context of destination folder, instead of source folder
    //          this applies for ./ and ../ cases but not ~/
    //      [X] source - is a modifier which will pick the source file|folder in context of destination folder, instead of source folder
    //          and will delete this file|folder
    //          this means if for some reason some files are copied at destination either via build or otherwise 
    //          using another copying mechanism when they are transferred at other location, these can be deleted via this
    //          in this case - no destination should be provided, else this flag will be ignored
    // destination can be:
    //      "file|folder" <-- assumed to be at root folder of the profile at destination folder
    //      "./file|folder" <-- assumed to be at root folder of the profile at destination folder
    //      "../file|folder" <-- assumed to be at root folder of the destination folder
    for(let fileOrFolder of options.profiles.current.copy) {
        fileOrFolder = fileOrFolder.trim();
        isDeleteFileOrFolder = false;
        ifPickFromDest = false;
        if (fileOrFolder.startsWith('[X]')) { // if delete flag is given
            fileOrFolder = fileOrFolder.substr(3).trim(); // remove [X]
            if (fileOrFolder.indexOf('>>') === -1) { // destination not given, then only
                isDeleteFileOrFolder = true;
            }
        } else if (fileOrFolder.startsWith('[>]')) { // if pick from dest flag is given
            fileOrFolder = fileOrFolder.substr(3).trim(); // remove [>]
            ifPickFromDest = true;
        }        

        if (fileOrFolder.indexOf('>>') !== -1) { // destination given
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
            src = path.resolve(path.join((ifPickFromDest ? options.dest : options.src), bareSrc));
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
            src = path.resolve(path.join((ifPickFromDest ? options.dest : options.src), options.profiles.current.root, bareSrc));
        }
        if (dest === '') { // specific target not given, assume same name and same path in context of dest folder
            if (isDeleteFileOrFolder) {
                if (dest.startsWith('../')) { // assume dest root
                    dest = dest.substr(3); //  remove '../'
                    dest = path.resolve(path.join(options.dest, dest));
                } else { // assume profile dest root
                    if (dest.startsWith('./')) { 
                        dest = dest.substr(2); //  remove './'
                    }                
                    dest = path.resolve(path.join(options.profiles.current.dest, dest));
                }
            } else {
                dest = path.resolve(path.join(options.profiles.current.dest, bareSrc));
            }
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
    
        if (isDeleteFileOrFolder) { // if to delete
            if (fsx.existsSync(dest)) {
                del.sync([dest]); // delete this folder at destination
            } else {
                console.log(dest + ' ------------');
            }
        } else { // to copy
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
    }

    // done
    cb();
};