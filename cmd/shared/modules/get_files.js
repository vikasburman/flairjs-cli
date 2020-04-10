const path = require('path');
const fsx = require('fs-extra');
const junk = require('junk');
const rrd = require('recursive-readdir-sync');
const wildcards = require('../../shared/modules/wildcard_match');
const pathJoin = require('../../shared/modules/path_join');
const guid = require('../../shared/modules/guid');

module.exports = (options, root, exclude, asm, changedSince) => {
    let set = {
        changed: false,
        files: [] // { folder, file, filename, basename, ext, index, isAsset, isNamespaced, nsname, nspath }
    };
    
    // get all files
    let allFiles = rrd(root).filter(file => junk.not(path.basename(file))),
        excludedFolders = [],
        cleanFolders = [],
        nsRoot = (asm ? asm.folders.types : ''),
        ns = '',
        idx = -1;
    for(let f of allFiles) {
        // file info
        let file = {
            folder: './' + path.dirname(f),                 // ./src/path
            file: './' + f,                                 // ./src/path/(#-99).abc.js | ./src/path/(#-99).abc.min.js | ./src/path/(@).abc.json
            filename: '',                                   // ./src/path/abc.js | ./src/path/abc.min.js | ./src/path/abc.json
            basename: path.basename(f),                     // abc.js / abc.min.js / abc.json 
            ext: path.extname(f).substr(1), // remove .     // js | json
            index: 0,                                       // -99 / 0
            isAsset: false,                                 // true, if starts with '(@).' OR ($). OR if kept inside 'types' folder and ext matches as listed in options.assets.ext
            isL10n: false,                                  // true, if starts with '($).'
            isSpec: path.basename(f).toLowerCase().endsWith('.spec.js'), // abc.spec.js
            isNamespaced: false,                            // true, if file is a namespaced file 
            nsName: '',                                     // empty for root namesapace, else name
            nsPath: '',                                     // namespace path
            docs: ''                                        // extracted docs symbols - loaded in code files after one pass, that helps in template generation
        };

        // extract namespace (only when asm is passed)
        if(asm && file.folder.startsWith(nsRoot)) {
            file.isNamespaced = true;
            ns = file.folder.replace(nsRoot + '/', ''); if (ns === nsRoot) { ns = ''; } 
            idx = ns.indexOf('/');
            file.nsName = (idx === -1 ? ns : ns.substring(0, idx));
            file.nsPath = pathJoin(nsRoot, file.nsName);
        }

        // exclusions
        // 1: some parent folder of this file was already skipped, so skip this
        if (excludedFolders.findIndex(a => file.folder.startsWith('./' + a)) !== -1) { continue; }

        // 2: file (path+name) matches some pattern, so skip this
        if (wildcards.isMatchAny(file.file, exclude)) { continue; }

        // 3: file name (without path) matches some pattern, so skip this
        if (wildcards.isMatchAny(file.basename, exclude)) { continue; }

        // 4: any parent folder of this file (which is not yet added in excludedFolders is to be skipped)
        // check only, if this is not identified as clean folder already
        if (cleanFolders.indexOf(file.folder) === -1) {
            let allFolders = file.folder.substr(2).split('/'), // exclude initial ./
            isExecluded = false,
            excluded = '';
            if (allFolders.length > 0) {
                excluded = '';
                for(let fld of allFolders) {
                    excluded += fld + '/';
                    if (wildcards.isMatchAny(fld, exclude)) { 
                        if (excludedFolders.indexOf(excluded) === -1) {
                            excludedFolders.push(excluded); 
                            isExecluded = true;
                            break;
                        } else {
                            isExecluded = true;
                            break;
                        }
                    }
                }
                if (isExecluded) {
                    continue; 
                } else {
                    cleanFolders.push(file.folder); // mark as clean, so all files of this folder, don't come here in above loop
                }
            }
        }

        // get index and type of file
        // any file inside assembly folder can be named as:
        // {(#n).|(@).|($).}fileName.ext
        // index can be:
        //  (#n).         <-- file to be placed at nth positon wrt other files
        //  all files are given 0 index by default
        //  n can be negative ->>  (#-23).
        //  n can be positive ->>  (#23). 
        //  sorting happens: -23, 0, 23
        if (file.basename.startsWith('(#')) { // file that will be embedded at a certain ordered position
            let idx = file.basename.indexOf(').'); // first index of ).
            if (idx !== -1) { // process only when ').' is also found (otherwise assume that (# is part of file name itself)
                try {
                    file.index = file.basename.substring(2, idx);
                    if (file.index.substr(0) === '-') {
                        file.index = parseInt(file.index) * -1;
                    } else {
                        file.index = parseInt(file.index);
                    }
                } catch (err) {
                    throw new Error(`Between '(#' and ').', there must be an integer number. (${file.file})`);
                }
                file.basename = file.basename.substr(idx + 2);
                file.filename = pathJoin(file.folder, file.basename);
            }
        } else if (file.basename.startsWith('(@).')) { // in-place namespaced asset of the assembly
            if (file.isNamespaced) {
                file.basename = file.basename.substr(4);
                file.filename = pathJoin(file.folder, file.basename);
                file.isAsset = true;
            }
        } else if (file.basename.startsWith('($).')) { // in-place namespaced localized asset of the assembly
            if (file.isNamespaced) {
                file.basename = file.basename.substr(4);
                file.filename = pathJoin(file.folder, file.basename);
                file.isAsset = true;
                file.isL10n = true;
            }
        }
        if (!file.filename) { file.filename = file.file; }

        // add to list
        set.files.push(file);
     
        // check for changed state, if needed to set and yet not found a changed
        if (changedSince && !set.changed) { if (fsx.statSync(f).mtime > changedSince) { set.changed = true; } }
    }

    // return
    return set;
};
