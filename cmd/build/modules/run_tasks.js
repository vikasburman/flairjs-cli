const mergeObjects = require('../../shared/modules/merge_objects');
const path = require('path');

module.exports = async function(options, mode, level, obj) {
    if (!options.custom.perform) { return; }

    const getModule = (modName) => {
        try {
            if (path.basename(modName) === modName) { // inbuild module
                return require('../tasks/' + modName);
            } else {
                return require.resolve(modName);
            }
        } catch (err) {
            throw `Task module not found. (${modName})`;
        }
    };
    const getTasks = (rootObject) => {
        let tasks = [], 
            list = [],
            taskConfig = null;

        // get list and config root
        if (mode === 'pre') {
            if (rootObject.pre && rootObject.pre.length > 0) {
                list = rootObject.pre;
            }
        } else if (mode === 'post') {
            if (rootObject.post && rootObject.post.length > 0) {
                list = rootObject.post;
            }
        }

        // process list
        for(let item of list) {
            if (!item.task) { throw `Task not defined. (${level}, ${mode})`; }
            if (!options.custom.tasks[item.task]) { throw `Task definition not found. (${item.task})`; }
            taskConfig = mergeObjects(options.custom.tasks[item.task], (item.config || {}), true);
            
            // add current prop to task config
            taskConfig.current = {
                mode: mode,
                level: (level === 'top' ? '' : (level === 'all-asms' ? 'asm' : level)),
                options: options,
                profile: (level === 'top' ? null : (level === 'profile' ? obj : obj.profile)), // both for group and asm, it's obj.profile
                group: (level === 'top' ? null : (level === 'profile' ? null : (level === 'grpup' ? obj : obj.group))),
                asm: (level === 'top' ? null : (level === 'profile' ? null : (level === 'grpup' ? null : obj)))
            };
            
            // add
            tasks.push({
                task: item.task,
                func: getModule(options.custom.tasks[item.task].module),
                config: taskConfig
            });
        }

        return tasks;
    };

    // build list of tasks to run
    let tasks = [],
        profile = null,
        group = null,
        asm = null;
    switch(level) {
        case 'top': // runs before/after default build activities
            tasks = getTasks(options.custom); 
            break;
        case 'profile': // runs before/after profile build activities
            profile = obj;
            if (options.custom.profiles && 
                options.custom.profiles[profile.name]) {
                tasks = getTasks(options.custom.profiles[profile.name]); 
            }
            break;
        case 'group': // runs before/after group build activities of profile
            group = obj;
            if (options.custom.profiles && 
                options.custom.profiles[group.profile.name] && 
                options.custom.profiles[group.profile.name].groups && 
                options.custom.profiles[group.profile.name].groups[group.name]) {
                tasks = getTasks(options.custom.profiles[group.profile.name].groups[group.name]);
            }
            break;
        case 'all-asms': // runs before/after asm build activities (for all assemblies anywhere)
            asm = obj;
            if (options.custom.assemblies) {
                tasks = getTasks(options.custom.assemblies);
            }  
        case 'asm': // runs before/after asm build activities of group of the profile
            asm = obj;
            if (options.custom.profiles && 
                options.custom.profiles[asm.profile.name] && 
                options.custom.profiles[asm.profile.name].groups && 
                options.custom.profiles[asm.profile.name].groups[asm.group.name] &&
                options.custom.profiles[asm.profile.name].groups[asm.group.name].assemblies &&
                options.custom.profiles[asm.profile.name].groups[asm.group.name].assemblies[asm.name]) {
                tasks = getTasks(options.custom.profiles[asm.profile.name].groups[asm.group.name].assemblies[asm.name]);
            }
            break;
    }

    // run tasks
    if (tasks.length > 0) {
        options.logger(1, chalk.keyword('mediumpurple')('tasks'), tasks.length);
        for(let task of tasks) {
            try {
                // skip check
                if (options.session.build.quick && task.config.skipOnQuick) { continue; }
                if (options.session.build.full && task.config.skipOnFull) { continue; }
                
                // run task
                options.logger(1, chalk.keyword('thistle')('task'), task.taskName);
                await task.func(task.config);
            } catch (err) {
                throw err;
            } finally{
                options.logger(-1);
            }
        }
        options.logger(-1);
    }
};
