const fsx = require('fs-extra');
const path = require('path');

const pathJoin = require('../../shared/modules/path_join');
const wildcards = require('../../shared/modules/wildcard_match');

// TODO: not done here beyond signature def

// create bundle of files in src, at dest folder
// config: {
//      src: []
//      dest: '',
//      minify: t/f
//      gzip: t/f
//      skipOnQuick: false
//      skipOnFull: false
//  }
//  src: ['path']       <-- (mandatory) depending upon the current level, it will resolve it based on the root path of that level
//                      level: ''           ../ = project root      ./                                      
//                      level: ''           ./  = source root       ./src                                  
//                      level: profile      ../ = source root       ./src                                  
//                      level: profile      ./  = profile root      ./src/<profile>                        
//                      level: group        ../ = profile root      ./src/<profile>                        
//                      level: group        ./  = group root        ./src/<profile>/<group>               
//                      level: asm          ../ = group root        ./src/<profile>/<group>                
//                      level: asm          ./  = asm root          ./src/<profile>/<group>/<asm>           
//
//                      path must start with either './' or '../'. These are not actual path definition
//                      but help in getting right path, so path like ../../../path or something like this are not allowed
//
//  exclude:[]          can define wildcards for files/folders to exclude, in case src is a folder
//
//  dest: path'         <-- (optional) if not given, it will use the matching dest path of the same level,
//                                     if given, it will resolve in context of the dest path of the same level
//                      level: ''           ../ = project root      ./
//                      level: ''           ./  = source root       ./dest
//                      level: profile      ../ = source root       ./dest
//                      level: profile      ./  = profile root      ./dest/<profile>
//                      level: group        ../ = profile root      ./dest/<profile>
//                      level: group        ./  = group root        ./dest/<profile>/<group>
//                      level: asm          ../ = group root        ./dest/<profile>/<group>
//                      level: asm          ./  = asm root          ./dest/<profile>/<group>/<asm>_files
//  
//  clean: t/f          if destination is to be deleted before files are copied
//  
//  skipOnQuick: t/f    if task to be skipped when running a quick build <-- this is checked in run_tasks itself
//  skipOnFull: t/f     if task to be skipped when running a full build  <-- this is checked in run_tasks itself
module.exports = async function(taskConfig) {
    if (!taskConfig.src) { throw new Error(`Copy source must be defined. (${taskConfig.level}, ${taskConfig.mode})`); }

    // read config
    let src = '', 
        dest = '',
        level = taskConfig.current.level,
        mode =  taskConfig.current.mode,
        options = taskConfig.current.options,
        profile = taskConfig.current.profile,
        group = taskConfig.current.group,
        asm = taskConfig.current.asm,
        dest = taskConfig.dest || '';
    switch(level) {
        case '':
            if (src.startsWith('../')) { // project root
                src = src.substr(1); // make ../ -> ./
                dest = pathJoin('./', dest);
            } else if(src.startsWith('./')) { // source root
                src = pathJoin(options.src, src);
                dest = pathJoin(options.dest, src);
            }
            break;
        case 'profile':
            if (src.startsWith('../')) { // source root
                src = pathJoin(options.src, src.substr(1));
                dest = pathJoin(options.dest, dest || src.substr(1));
            } else if(src.startsWith('./')) { // profile root
                src = pathJoin(profile.src, src);
                dest = pathJoin(profile.dest, dest || src);
            }
            break;
        case 'group':
            if (src.startsWith('../')) { // profile root
                src = pathJoin(profile.src, src.substr(1));
                dest = pathJoin(profile.dest, dest || src.substr(1));
            } else if(src.startsWith('./')) { // group root
                src = pathJoin(group.src, src);
                dest = pathJoin(group.dest, dest || src);
            }
            break;
        case 'asm':
            if (src.startsWith('../')) { // group root
                src = pathJoin(group.src, src.substr(1));
                dest = pathJoin(group.dest, dest || src.substr(1));
            } else if(src.startsWith('./')) { // asm root
                src = pathJoin(asm.src, src);
                dest = pathJoin(asm.dest.files, dest || src);
            }
            break;
    }

    // copy file/folder
    if (fsx.lstatSync(src).isDirectory()) { // folder
        // if exists and destination is to be cleaned before copy
        if (fsx.existsSync(dest) && taskConfig.clean) { del.sync([dest]); }

        // copy
        fsx.ensureDirSync(dest);
        if (taskConfig.exclude && taskConfig.exclude.length > 0) { // check for exclusions
            copyDir.sync(src, dest, {
                utimes: true,
                mode: true,
                cover: true,
                filter: (state, filepath, filename) => {
                    let fullpath = path.join(filepath, filename);
                    if (wildcards.isMatchAny(fullpath, taskConfig.exclude)) { return false; }
                    return true;
                }});
        } else { // no filters
            copyDir.sync(src, dest, {
                utimes: true,
                mode: true,
                cover: true
            });
        }
    } else { // file
        fsx.ensureDirSync(path.dirname(dest));
        fsx.copyFileSync(src, dest);
    }
    options.logger(0, chalk.green(dest), '', '', '', chalk.keyword('limegreen')('✔'));
};


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