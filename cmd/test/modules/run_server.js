const fsx = require('fs-extra');
const path = require('path');
const pathJoin = require('../../shared/modules/path_join');
const open = require('open');
const child_process = require('child_process');
const Jasmine = require('jasmine');
const JasmineConsoleReporter = require('jasmine-console-reporter');
const JSONReporter = require('jasmine-json-test-reporter');
const Jasmine2HtmlReporter = require('protractor-jasmine2-html-reporter');

module.exports = (options) => {
    return new Promise(async (resolve, reject) => {
        // support
        let index = fsx.readJsonSync(pathJoin(options.tests.dest, 'index.json'), 'utf8');
        const loadAndRun = async (files) => {
            for (let file of files) { 
                if (file.startsWith('./')) { // file
                    require(pathJoin(options.tests.dest, file)); 
                } else { // some module
                    require(file); 
                }
            }
        };
        const getSpecs = () => {
            let q = '', 
                n = '',
                specs = []
            
            // full, quick, group, types, OR compiled default
            if (options.session.test.full) { q = 'full'; }
            else if (options.session.test.quick) { q = 'quick'; }
            else if (options.session.test.group) { q = 'group'; n = options.session.test.group; }
            else if (options.session.test.types) { q = 'types'; n = options.session.test.types; }
            if (!q) { q = 'types'; n = index.coverage; } // compiled default

            switch(q) {
                case 'full':
                    specs.push(...index.specs.unit);
                    specs.push(...index.specs.func);
                    specs.push(...index.specs.integration);
                    specs.push(...index.specs.nonfunc);
                    specs.push(...index.specs.system);
                    specs.push(...index.specs.e2e);
                    break;
                case 'quick':
                    specs.push(...index.specs.unit);
                    specs.push(...index.specs.func);
                    break;
                case 'group':
                    if (n && index.groups[n]) {
                        specs.push(...index.groups[n]);
                    }
                    break;
                case 'types':
                    if (n) {
                        let types = n.split(',');
                        for(let type of types) {
                            if (index.specs[type]) {
                                specs.push(...index.specs[type]);
                            }
                        }
                    }
                    break;
                default: // inbuild default (here)
                    specs.push(...index.specs.unit);
                    break;
            }
    
            // return
            return specs;
        };
        const getJasmine = () => {
            // instance
            let jasmine = new Jasmine();

            // config
            let config = options.tests.config;
            config.spec_dir = options.tests.dest;
            config.spec_files = getSpecs();
            config.helpers = index.helpers;
            jasmine.loadConfig(config);

            // reporters
            let rConfig = null,
                reporter = null;
            if (!options.tests.reporters.inbuilt.enable) { // inbuilt
                // remove inbuilt default
                jasmine.env.clearReporters();
            }
            if (options.tests.reporters.console.enable) { // console
                rConfig = options.tests.reporters.console.config;
                reporter = new JasmineConsoleReporter(rConfig);
                jasmine.addReporter(reporter);
            }
            if (options.tests.reporters.html.enable) { // html
                rConfig = options.tests.reporters.html.config;
                rConfig.savePath = pathJoin(options.tests.dest, 'logs', 'node', 'html');
                rConfig.fileName = 'report';
                reporter = new Jasmine2HtmlReporter(rConfig);
                jasmine.addReporter(reporter);
            }
            if (options.tests.reporters.json.enable) { // json
                rConfig = options.tests.reporters.json.config;
                rConfig.file = pathJoin(options.tests.dest, 'logs', 'node', 'json', 'report.json');
                fsx.ensureDirSync(path.dirname(rConfig.file));
                reporter = new JSONReporter(rConfig);
                jasmine.addReporter(reporter);
            }            
            
            // handler
            jasmine.onComplete(() => {
                // clean
                delete global.flairTest;

                // resolve
                resolve();
            }); 
            
            // return
            return jasmine;
        };

        // 0: setup jasmine
        let jasmine = getJasmine();

        // 1: environment (server)
        await loadAndRun(index.env.server);
        global.flairTest = {}; // to share items across tests

        // 2: bundled helpers, specs
        jasmine.execute();  
    });
};
