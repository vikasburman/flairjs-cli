const chalk = require('chalk');
const path = require('path');
const wildcards = require('../../shared/modules/wildcard_match');
const fsx = require('fs-extra');
const copyDir = require('copy-dir');
const delAll = require('../../shared/modules/delete_all');

// copy dependencies pre/post build as per configuration
const copyDeps = function(options, isPost, done) {
    let deps = [];
    if (isPost) {
        if (options.deps.perform.post && options.deps.post.length > 0) { 
            deps = options.deps.post.slice();
        }
    } else {
        if (options.deps.perform.pre && options.deps.pre.length > 0) {
            deps = options.deps.pre.slice();
        }
    }
    if (deps.length === 0) { done(); return; }
    options.logger(1, 'deps',  (isPost ? 'post' : 'pre'));

    const processNext = (items) => {
        if (items.length !== 0) {
            let item = items.shift(); // {src, dest, clean, onlyMin, exclude} // exclude can have wildcard patterns
            if (item && !isPost && item.src.startsWith('http')) { // http is supported only in case of pre deps
                let httpOrhttps = null,
                    body = '';
                if (item.src.startsWith('https')) {
                    httpOrhttps = require('https');
                } else {
                    httpOrhttps = require('http'); // for urls where it is not defined
                }
                httpOrhttps.get(item.src, (resp) => {
                    resp.on('data', (chunk) => { body += chunk; });
                    resp.on('end', () => {
                        let dest = path.resolve(item.dest);
                        fsx.ensureFileSync(dest);
                        fsx.writeFileSync(dest, body, 'utf8'); // overwrite
                        options.logger(0, chalk.green(item.dest));
                        processNext(items);
                    });
                }).on('error', (e) => {
                    throw `Failed to fetch dependency: ${item.src}. \n\n ${e}`;
                });
            } else { // local file / folder path
                let src = path.resolve(item.src),
                    dest = path.resolve(item.dest),
                    minFile = '';
                if (src !== dest) {  
                    if (fsx.lstatSync(src).isDirectory()) {
                        // delete all content inside (if need be)
                        if (item.clean) { 
                            options.logger(0, 'clean', chalk.red(item.dest));
                            delAll(dest);
                        } 
                        
                        // copy
                        fsx.ensureDirSync(dest);
                        copyDir.sync(src, dest, (state, filepath, filename) => { // copy
                            let result = true;

                            // (onlyMin - true/false) for every js file, check if it's .min version exists at same path, don't copy this js file, as .min.js might have been copied or will be copied
                            if (result && item.onlyMin && path.extname(filepath) === '.js' && !path.extname(filepath).endsWith('.min.js')) {
                                minFile = filepath.substr(0, filepath.length - 3) + '.min.js'; // remove .js and add .min.js
                                if (fsx.existsSync(minFile)) { result = false; }
                            }

                            // patterns (wildcard pattern: https://www.npmjs.com/package/matcher)
                            if (result && item.exclude && item.exclude.length > 0) {
                                result = !wildcards.isMatchAny(filepath, item.exclude);
                            }

                            // ok
                            return result;
                        }); 
                    } else {
                        fsx.ensureDirSync(path.dirname(dest));
                        fsx.copyFileSync(src, dest); // overwrite
                    }
                    options.logger(0, chalk.green(item.dest));
                } else {
                    throw `Destination is same as source. (${item.src})`;
                }
                processNext(items);
            }
        } else {
            options.logger(-1);
            done();
        }
    };

    processNext(deps);
};

exports.pre = async function(options) {
    return new Promise((resolve, reject) => {
        copyDeps(options, false, resolve);
    });
};
exports.post = async function(options) {
    return new Promise((resolve, reject) => {
        copyDeps(options, true, resolve);
    });
};
