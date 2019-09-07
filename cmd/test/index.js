const fsx = require('fs-extra');
const path = require('path');
const fg = require('fast-glob');
const config = require('../../shared/options.js').config;

const clientTestsExecution = (options, done) => {
    // create temp spec runner
    const runnerTemplate = require.resolve('flairjs-cli/cmd/test/jasmine/SpecRunner.html');
    let tempDir = options.temp_dir;
    let tempRunner = path.join(tempDir, 'specRunner.html');
    fsx.ensureDirSync(tempDir);
    fsx.copyFileSync(runnerTemplate, tempRunner);

    // collect tests and helpers to include
    let specDir = options.spec_dir,
        relativePrefixBetweenSpecAndTempDir = options.relative_prefix,
        helperGlobs = [],
        specGlobs = [];
    if (options.helpers) {
        for(let file of options.helpers) {
            helperGlobs.push(path.join(specDir, file));
        }
    }
    if (options.spec_files) {
        for(let file of options.spec_files) {
            specGlobs.push(path.join(specDir, file));
        }
    }
    let helpers = helperGlobs.length > 0 ? fg.sync(helperGlobs) : [];
    let specs = specGlobs.length > 0 ? fg.sync(specGlobs) : [];

    // write files in specRunner
    let helpersScript = '',
        specsScript = '',
        tempRunnerHtml = fsx.readFileSync(tempRunner, 'utf8');
    for(let file of helpers) {
        helpersScript += `<script src="${relativePrefixBetweenSpecAndTempDir}${file}"></script>\n`;
    }
    for(let file of specs) {
        specsScript += `<script src="${relativePrefixBetweenSpecAndTempDir}${file}"></script>\n`;
    }
    tempRunnerHtml = tempRunnerHtml.replace('<!-- helpers -->', helpersScript);
    tempRunnerHtml = tempRunnerHtml.replace('<!-- specs -->', specsScript);
    fsx.writeFileSync(tempRunner, tempRunnerHtml, 'utf8');

    // open temp runner
    const open = require('open');
    open(tempRunner);
    done();
};
const serverTestsExecution = (options, done) => {
    const Jasmine = require('jasmine');
    const jasmine = new Jasmine();
    jasmine.loadConfig(options);
    jasmine.onComplete(done);
    jasmine.execute();  
};

// do
const doTask = (argv, done) => {
    // get options
    let options = config(argv.options, 'test'),
        clientMode = argv.client || false;

    if (!options) {
        console.log('Test options definition is not configured.');  // eslint-disable-line no-console
        done(); return;
    }

    // run jasmine tests
    if (options.jasmine) {
        let jasmineOptions = config(options, 'test', 'jasmine');
        if (clientMode) {
            clientTestsExecution(jasmineOptions, done);
        } else {
            serverTestsExecution(jasmineOptions, done);
        }
    }
};

exports.run = function(argv, cb) {
    doTask(argv, cb);
};