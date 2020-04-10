const chalk = require('chalk');
const path = require('path');
const fsx = require('fs-extra');
const pathJoin = require('../../shared/modules/path_join');
const replaceAll = require('../../shared/modules/replace_all');
const rrd = require('recursive-readdir-sync');
const junk = require('junk');
const copyDir = require('copy-dir');
const specsTemplate = fsx.readFileSync(require.resolve('../templates/tests/specs/index.js'), 'utf8');

// generation steps
exports.start = async (options) => {
    // temp place to hold values for the duration of steps
    options.tests.temp = {
        helpers: [],
        specs: {
            unit: [],
            func: [],
            integration: [],
            nonfunc: [],
            system: [],
            e2e: []
        },
        groups: {},
        converage: ''
    };

    // ensure tests fixture root exists
    fsx.ensureDirSync(options.tests.dest);

    // write helpers (first loaded in specs[])
    // therefore loaded before any specs 
    await writeHelpers(options);  
};
exports.build = async (options, asm) => {
    // next in specs[] will be all assemblies

    // write unit tests for asm
    await writeUnitTests(options, asm);

    // write functional tests for asm
    await writeFuncTests(options, asm);
};
exports.finish = async (options) => {
    // specs[] will have these

    // write integration tests
    await writeIntegrationTests(options);

    // write nonfunc tests
    await writeNonFuncTests(options);
    
    // write system tests
    await writeSystemTests(options);
    
    // write e2e tests
    await writeE2ETests(options);    

    // write group specifc tests
    await writeGroupTests(options);        
    
    // write data
    await writeData(options); 

    // write engine
    await writeEngine(options);    

    // cleanup
    delete options.tests.temp;
};

// support
const getFiles = (root) => {
    // get all files
    let allFiles = rrd(root).filter(file => junk.not(path.basename(file))),
        files = [];
        
    for(let f of allFiles) {
        // file info
        let file = {
            folder: './' + path.dirname(f),                 // ./src/path
            file: './' + f,                                 // ./src/path/(#-99).abc.js | ./src/path/(#-99).abc.min.js | ./src/path/(@).abc.json
            filename: '',                                   // ./src/path/abc.js | ./src/path/abc.min.js | ./src/path/abc.json
            basename: path.basename(f),                     // abc.js / abc.min.js / abc.json 
            ext: path.extname(f).substr(1), // remove .     // js | json
            index: 0,                                       // -99 / 0
            isSpec: path.basename(f).toLowerCase().endsWith('.spec.js')
        };

        // get index of file
        // any file inside test specs folder can be named as:
        // {(#n).fileName.ext
        // index can be:
        //  (#n).         <-- file to be placed at nth positon wrt other files
        //  all files are given 0 index by default
        //  n can be negative ->>  (#-23).
        //  n can be positive ->>  (#23). 
        //  sorting happens: -23, 0, 23
        if (file.basename.startsWith('(#')) { // file that will be embedded in specs at a certain ordered position
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
                    throw `Between '(#' and ').', there must be an integer number. (${file.file})`;
                }
                file.basename = file.basename.substr(idx + 2);
                file.filename = pathJoin(file.folder, file.basename);
            }
        } 
        if (!file.filename) { file.filename = file.file; }

        // add to list
        files.push(file);
    }

    // return
    return files;
};
const collectSpecs = (options, files) => {
    let collectedFiles = [];
    for(let file of files) {
        if (file.isSpec) {
            collectedFiles.push(file.filename); 
            addToGroups(options, file.filename);
        } 
    }
    return collectedFiles;
};
const writeSpecsFile = async (options, outFile, files, asm, testType) => {
    if (files.length === 0) { return; }

    // build content
    let content = '';
    for(let file of files) {
        content +=  `/\/\ #region ${file} (start)\n` +
        `await (async () => {\n` +
        `${fsx.readFileSync(file, 'utf8')}\n` +
        `})();\n` +
        `/\/\ #endregion ${file} (end)\n`;
    }

    // update stamps
    content = specsTemplate.replace('<<specs>>', content);
    content = replaceAll(content, '<<title>>', options.package.title + (asm ? ` (${asm.name})` : '') + ` - ${testType}`);
    content = replaceAll(content, '<<version>>', options.package.version); 
    content = replaceAll(content, '<<lupdate>>', new Date().toUTCString());
    content = replaceAll(content, '<<copyright>>', options.package.copyright); 
    content = replaceAll(content, '<<license>>', options.package.license);

    // write
    fsx.ensureDirSync(path.dirname(outFile));
    fsx.writeFileSync(outFile, content, 'utf8');
};
const addToGroups = (options, spec) => {
    for(let group of options.tests.groups) {
        if (path.basename(spec).indexOf(`-${group}`) !== -1) { // group name exists in file name
            options.tests.temp.groups[group] = options.tests.temp.groups[group] || [];
            options.tests.temp.groups[group].push(spec);
        }
    }
};

// tests
const writeUnitTests = async (options, asm) => {
    let files = [],
        file = pathJoin(options.tests.dest, 'specs', asm.name, 'units.specs.js');

    // collect from globals
    // order depends on code file's order itself
    folder = asm.folders.globals;
    if (fsx.existsSync(folder)) {
        files.push(...collectSpecs(options, getFiles(folder)));
    }

    // collect from components
    // order depends on code file's order itself
    folder = asm.folders.components;
    if (fsx.existsSync(folder)) {
        files.push(...collectSpecs(options, getFiles(folder)));
    }

    // collect from types
    // order depends on code file's order itself
    folder = asm.folders.types;
    if (fsx.existsSync(folder)) {
        files.push(...collectSpecs(options, getFiles(folder)));
    }    

    // write
    await writeSpecsFile(options, file, files, asm, 'Unit Tests');
    options.tests.temp.specs.unit.push(file.replace(options.tests.dest, '.'));
};
const writeFuncTests = async (options, asm) => {
    let files = [],
        file = pathJoin(options.tests.dest, 'specs', asm.name, 'func.specs.js');
    
    // collect from asm/tests
    if (asm.folders.tests) {
        files.push(...collectSpecs(options, getFiles(asm.folders.tests)));
    }

    // write
    await writeSpecsFile(options, file, files, asm, 'Functional Tests');
    options.tests.temp.specs.func.push(file.replace(options.tests.dest, '.'));
};
const writeIntegrationTests = async (options) => {
    let files = [],
        file = pathJoin(options.tests.dest, 'specs', 'integration.specs.js'),
        folder = pathJoin(options.build.src, 'tests', 'specs', 'integration');
    
    // collect from ./src/tests/specs/integration/
    if (fsx.existsSync(folder)) {
        files.push(...collectSpecs(options, getFiles(folder)));
    }
   
    // write
    await writeSpecsFile(options, file, files, null, 'Integration Tests');
    options.tests.temp.specs.integration.push(file.replace(options.tests.dest, '.'));
};
const writeNonFuncTests = async (options) => {
    let files = [],
        file = pathJoin(options.tests.dest, 'specs', 'nonfunc.specs.js'),
        folder = pathJoin(options.build.src, 'tests', 'specs', 'nonfunc');
    
    // collect from ./src/tests/specs/nonfunc/
    if (fsx.existsSync(folder)) {
        files.push(...collectSpecs(options, getFiles(folder)));
    }
   
    // write
    await writeSpecsFile(options, file, files, null, 'Non Functional Tests');
    options.tests.temp.specs.nonfunc.push(file.replace(options.tests.dest, '.'));
};
const writeSystemTests = async (options) => {
    let files = [],
        file = pathJoin(options.tests.dest, 'specs', 'system.specs.js'),
        folder = pathJoin(options.build.src, 'tests', 'specs', 'system');
    
    // collect from ./src/tests/specs/system/
    if (fsx.existsSync(folder)) {
        files.push(...collectSpecs(options, getFiles(folder)));
    }
   
    // write
    await writeSpecsFile(options, file, files, null, 'System Tests');
    options.tests.temp.specs.system.push(file.replace(options.tests.dest, '.'));
};
const writeE2ETests = async (options) => {
    let files = [],
        file = pathJoin(options.tests.dest, 'specs', 'e2e.specs.js'),
        folder = pathJoin(options.build.src, 'tests', 'specs', 'e2e');
    
    // collect from ./src/tests/specs/e2e/
    if (fsx.existsSync(folder)) {
        files.push(...collectSpecs(options, getFiles(folder)));
    }
   
    // write
    await writeSpecsFile(options, file, files, null, 'End-to-End Tests');
    options.tests.temp.specs.e2e.push(file.replace(options.tests.dest, '.'));
};
const writeHelpers = async (options) => {
    let files = [],
        file = pathJoin(options.tests.dest, 'helpers', 'helpers.js'),
        folder = pathJoin(options.build.src, 'tests', 'helpers');
    
    // collect from ./src/tests/helpers
    if (fsx.existsSync(folder)) {
        let allFiles = getFiles(folder);
        for(let theFile of allFiles) {
            if (theFile.ext === 'js') {
                files.push(theFile.filename); 
            }
        }
    }
   
    // write
    // helpers.js is also create like a specs.js file with same 
    // closure style
    await writeSpecsFile(options, file, files, null, 'Helpers');
    options.tests.temp.helpers.push(file.replace(options.tests.dest, '.'));
};
const writeGroupTests = async (options) => {
    let files = [],
        file = '';
    for(let group of options.tests.groups) {
        files = options.tests.temp.groups[group];
        if (Array.isArray(files) && files.length > 0) {
            // write
            file = pathJoin(options.tests.dest, 'specs', `${group}.specs.js`);
            await writeSpecsFile(options, file, files, null, `Test Collection (${group})`);
            options.tests.temp.groups[group] = []; // overwrite here with empty array
            options.tests.temp.groups[group].push(file.replace(options.tests.dest, '.'));
        }
    }
};
const writeData = async (options) => {
    // copy as is
    let folder = pathJoin(options.build.src, 'tests', 'data');
    if (fsx.existsSync(folder)) {
        copyDir.sync(folder, pathJoin(options.tests.dest, 'data'), {
            utimes: true,
            mode: true,
            cover: true
        });        
    }
};
const writeEngine = async (options) => {
    // copy engine files at root, except known files
    let engineFile = require.resolve('../templates/tests/engine/index.html'),
        engineRoot = engineFile.replace('index.html', ''); 
    copyDir.sync(engineRoot, options.tests.dest, {
        utimes: true,
        mode: true,
        cover: true,
        filter: (stat, filepath) => {
            // do not copy these files
            if(stat === 'file') {
                if (['index.js'].indexOf(path.basename(filepath)) !== -1) {
                    return false;
                }
            }
            return true;
        }
    });

    // write engine data, this will be used both by server and client
    let data = {
        env: {
            server: options.tests.env.server || [],
            client: options.tests.env.client || []
        },
        helpers: options.tests.temp.helpers,
        specs: options.tests.temp.specs,
        groups: options.tests.temp.groups,
        coverage: ``
    };
    if (options.tests.coverage.unit) { data.coverage += 'unit,'; }
    if (options.tests.coverage.func) { data.coverage += 'func,'; }
    if (options.tests.coverage.integration) { data.coverage += 'integration,'; }
    if (options.tests.coverage.nonfunc) { data.coverage += 'nonfunc,'; }
    if (options.tests.coverage.e2e) { data.coverage += 'e2e,'; }
    if (data.coverage.endsWith(',')) { data.coverage = data.coverage.substr(0, data.coverage.length - 1); }
    fsx.writeJSONSync(pathJoin(options.tests.dest, 'index.json'), data, { encoding: 'utf8', spaces: '\t' });

    // copy index.js at root with embedded data
    let indexJS = pathJoin(engineRoot, 'index.js'),
        content = fsx.readFileSync(indexJS, 'utf8');
        content = replaceAll(content, '<<json>>', JSON.stringify(data));
    fsx.writeFileSync(pathJoin(options.tests.dest, 'index.js'), content, 'utf8');
};