const fsx = require('fs-extra');

const deepMerge = (objects, isMergeArray = true) => { // credit: https://stackoverflow.com/a/48218209
    const isObject = obj => obj && typeof obj === 'object';
    
    return objects.reduce((prev, obj) => {
        Object.keys(obj).forEach(key => {
            const pVal = prev[key];
            const oVal = obj[key];
        
            if (Array.isArray(pVal) && Array.isArray(oVal)) {
                if (isMergeArray) {
                    prev[key] = pVal.concat(...oVal); // merge array
                } else {
                    prev[key] = [].concat(...oVal); // overwrite as new array
                }
            } else if (isObject(pVal) && isObject(oVal)) {
                prev[key] = deepMerge([pVal, oVal], isMergeArray);
            } else {
                prev[key] = oVal;
            }
        });
        return prev;
    }, {});
};
const doMerge = (source, target) => {
    return deepMerge([source, target], true); // merge arrays also - means arrays will be concatenated
};

const getObject = (config, cmd, section, isPreloaded) => {
    let isMergeNeeded = true,
        defaultFile = require.resolve(`../cmd/${cmd}/options/${section || cmd}.json`);
    
    isMergeNeeded = true;
    if (isPreloaded) { cmd = section; }
    if (typeof config[cmd] === 'boolean') { // type A
        if (config[cmd] === false) { // configured not to be read
            config = null;
            isMergeNeeded = false;
        } else {
            if (typeof config[cmd + 'Config'] === 'string') { // defined as file
                if (config[cmd + 'Config'] === '') {
                    config = {}; // defaults will come over here
                } else {
                    config = fsx.readJSONSync(config[cmd + 'Config'], 'utf8');
                }
            } else if (typeof config[cmd + 'Config'] === 'object') {
                config = config[cmd + 'Config'];
            } else { // undefined/unknown
                isMergeNeeded = false;
            }
        }
    } else { // type B
        if (typeof config[cmd] === 'string') { // defined as file
            if (config[cmd] === '') {
                config = {}; // defaults will come over here
            } else {
                config = fsx.readJSONSync(config[cmd], 'utf8');
            }
        } else if (typeof config[cmd] === 'object') {
            config = config[cmd];
        } else { // undefined/unknown
            isMergeNeeded = false;
        }
    }
    if (isMergeNeeded) {
        config = doMerge(fsx.readJSONSync(defaultFile, 'utf8'), config);
    }

    // done
    return config;
}

const getConfig = (flairOptions, cmd, section) => {
    let defaultOptions = require.resolve('../cmd/flair.json'),
        isPreloaded = typeof flairOptions === 'object',
        isMergeNeeded = false,
        config = {};

    if (isPreloaded) { // it is preloaded first level options
        config = flairOptions; 
    } else { 
        // get options
        isMergeNeeded = true;
        if (!flairOptions) { flairOptions = './flair.json'; } // no default options file is given - try to find at root
        if (!fsx.existsSync(flairOptions)) {
            flairOptions = defaultOptions;
            isMergeNeeded = false;
        }
        config = fsx.readJSONSync(flairOptions, 'utf8');
        if (isMergeNeeded) {
            config = doMerge(fsx.readJSONSync(defaultOptions, 'utf8'), config);
        }
   
        // get command config
        // command config can be defined in two formats:
        // A: 
        //  command: true/false
        //  commandConfig: "config file name" OR "config object itself"
        // B:
        //  command: "config file name" OR "config object itself"
        config = getObject(config, cmd);
    }

    // get config section (optional)
    // config section can be defined in two formats:
    // section config can be defined in two formats:
    // A: 
    //  section: true/false
    //  sectionConfig: "section config file name" OR "section object itself"
    // B:
    //  section: "section config file name" OR "section config object itself" 
    if (config && section) {
        config = getObject(config, cmd, section, isPreloaded);
    }

    // return
    return config;
};

exports.config = function(...args) {
   return getConfig(...args);
};