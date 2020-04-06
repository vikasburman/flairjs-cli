const path = require('path');
const fsx = require('fs-extra');
const rrd = require('recursive-readdir-sync'); 
const copyDir = require('copy-dir');
const del = require('del');
const pathJoin = require('../../shared/modules/path_join');
const wildcards = require('../../shared/modules/wildcard_match');

// copy files/folders as per given config
// config: {
//      src: ''
//      exclude: []
//      dest: '',
//      skipOnQuick: false
//      skipOnFull: false
//  }
//  src: 'path'         <-- (mandatory) depending upon the current level, it will resolve it based on the root path of that level
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
    if (!taskConfig.src) { throw `Copy source must be defined. (${taskConfig.level}, ${taskConfig.mode})`; }

    // read config
    let level = taskConfig.current.level,
        mode =  taskConfig.current.mode,
        options = taskConfig.current.options,
        profile = taskConfig.current.profile,
        group = taskConfig.current.group,
        asm = taskConfig.current.asm;

    // resolve paths
    let { src, dest } = taskConfig.path(taskConfig.src || '', taskConfig.dest || '');

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
    options.logger(0, chalk.green(taskConfig.src), '', '', '', chalk.keyword('limegreen')('✔'));
};