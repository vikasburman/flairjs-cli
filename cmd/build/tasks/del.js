const fsx = require('fs-extra');
const del = require('del');

// delete files/folders as per given config
// config: {
//      dest: ''
//      exclude: []
//      skipOnQuick: false
//      skipOnFull: false
//  }
//  dest: 'path'        <-- (mandatory) depending upon the current level, it will resolve it based on the root path of that level 'at dest'
//                      level: ''           ./  = source root       ./dest                                  
//                      level: profile      ../ = source root       ./dest                                  
//                      level: profile      ./  = profile root      ./dest/<profile>                        
//                      level: group        ../ = profile root      ./dest/<profile>                        
//                      level: group        ./  = group root        ./dest/<profile>/<group>               
//                      level: asm          ../ = group root        ./dest/<profile>/<group>                
//                      level: asm          ./  = asm root          ./dest/<profile>/<group>/<asm>           
//
//                      path must start with either './' or '../'. These are not actual path definition
//                      but help in getting right path, so path like ../../../path or something like this are not allowed
//
//  exclude:[]          can define negative glob patterns for files/folders to exclude, in case src is a folder (ref: https://www.npmjs.com/package/del)
//  
//  skipOnQuick: t/f    if task to be skipped when running a quick build <-- this is checked in run_tasks itself
//  skipOnFull: t/f     if task to be skipped when running a full build  <-- this is checked in run_tasks itself
module.exports = async function(taskConfig) {
    if (!taskConfig.dest) { throw `Delete path must be defined. (${taskConfig.level}, ${taskConfig.mode})`; }

    // read config
    let level = taskConfig.current.level,
        mode =  taskConfig.current.mode,
        options = taskConfig.current.options,
        profile = taskConfig.current.profile,
        group = taskConfig.current.group,
        asm = taskConfig.current.asm;

    // resolve paths (use destination path, never delete anything in source folder)
    let { dest } = taskConfig.path(taskConfig.dest || '');

    // delete file/folder
    if (fsx.existsSync(dest)) { 
        if (fsx.lstatSync(dest).isDirectory()) { // folder
            if (taskConfig.exclude && taskConfig.exclude.length > 0) { // check for exclusions
                del.sync([dest, ...taskConfig.exclude]); // NOTE: exclude patterns must start with '!' to be exclusions
            } else { // no filters
                del.sync([dest]); 
            }            
        } else { // file
            fsx.unlinkSync(dest);
        }
    } 
    options.logger(0, chalk.green(taskConfig.dest), '', '', '', chalk.keyword('limegreen')('✔'));
};