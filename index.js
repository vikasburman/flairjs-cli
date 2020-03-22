#!/usr/bin/env node

// args
const argv = require('minimist')(process.argv.slice(2));

// process command
let cmdName = (argv._[0] || '').toLowerCase(),
    cmd = null;

if (['help', 'create', 'build', 'flag', 'test'].indexOf(cmdName) !== -1) { cmd = require(`./cmd/${cmdName}/index.js`); }
if (!cmd) { cmd = require('./cmd/help/index.js'); }

cmd.run(argv, () => {
    // done
});
