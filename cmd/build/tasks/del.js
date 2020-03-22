const path = require('path');
const fsx = require('fs-extra');
const del = require('del');
const pathJoin = require('../../shared/modules/path_join');

// delete files/folders as per given config
// config: {
//      path: ''
//      exclude: []
//      skipOnQuick: false
//      skipOnFull: false
//  }
//  path: 'path'        <-- (mandatory) depending upon the current level, it will resolve it based on the root path of that level 'at dest'
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
    if (!taskConfig.path) { throw `Delete path must be defined. (${taskConfig.level}, ${taskConfig.mode})`; }

    // read config
    let pth = taskConfig.path, 
        level = taskConfig.current.level,
        mode =  taskConfig.current.mode,
        options = taskConfig.current.options,
        profile = taskConfig.current.profile,
        group = taskConfig.current.group,
        asm = taskConfig.current.asm;
    switch(level) {
        case '':
            if (pth.startsWith('../')) { // project root
                pth = pth.substr(1); // make ../ -> ./
                if (pth === './' ) { throw `Project root cannot be deleted. (${level}, ${mode})`; } // just project root itself 
                if (pth.startsWith(options.src)) { throw `Any source folder cannot be deleted. (${level}, ${mode})`; } // any source folder
            } else if(pth.startsWith('./')) { // source root @ dest
                pth = pathJoin(options.dest, pth);
            }
            break;
        case 'profile':
            if (pth.startsWith('../')) { // source root @ dest
                pth = pathJoin(options.dest, pth.substr(1));
            } else if(pth.startsWith('./')) { // profile root @ dest
                pth = pathJoin(profile.dest, pth);
            }
            break;
        case 'group':
            if (pth.startsWith('../')) { // profile root @ dest
                pth = pathJoin(profile.dest, pth.substr(1));
            } else if(pth.startsWith('./')) { // group root @ dest
                pth = pathJoin(group.dest, pth);
            }
            break;
        case 'asm':
            if (pth.startsWith('../')) { // group root @ dest
                pth = pathJoin(group.dest, pth.substr(1));
            } else if(pth.startsWith('./')) { // asm root @ dest
                pth = pathJoin(asm.dest.files, pth);
            }
            break;
    }

    // delete file/folder
    if (fsx.existsSync(pth)) { 
        if (fsx.lstatSync(src).isDirectory()) { // folder
            if (taskConfig.exclude && taskConfig.exclude.length > 0) { // check for exclusions
                del.sync([pth, ...taskConfig.exclude]); // NOTE: exclude patterns must start with '!' to be exclusions
            } else { // no filters
                del.sync([pth]); 
            }            
        } else { // file
            fsx.unlinkSync(pth);
        }
    } 
    options.logger(0, chalk.green(pth), '', '', '', chalk.keyword('limegreen')('✔'));
};