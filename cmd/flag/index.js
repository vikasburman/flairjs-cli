const fsx = require('fs-extra');
const path = require('path');
const readline = require('readline');
const config = require('../../shared/options.js').config;

const setFlag = (options) => {
    // ask flag name and folders where to flag the build
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    rl.question('   Flag? (dev, prod, <...>): ', (activeFlag) => {
        if (activeFlag) {
            rl.question(`   Build folders? ${optionsJSON.dest} (<...>,<...>): `, (atFolders) => {
                let folders = [''];
                if (atFolders) {
                    folders = atFolders.split(',')
                } 
                for(let fld of folders) {
                    // update flags.json file for __active field with current active flag
                    fld = fld.trim();
                    let fileName = path.join(optionsJSON.dest, fld, 'flags.json'),
                        flags = null,
                        oldFlag = '',
                        content = '';
                    if (fsx.existsSync(fileName)) {
                        flags = JSON.parse(fsx.readFileSync(fileName));
                        if (flags[activeFlag]) { // update active flag only if this flag exists
                            oldFlag = flags.__active;
                            flags.__active = activeFlag; // mark this as active
                            content = JSON.stringify(flags);
                            fsx.writeFileSync(fileName, content, 'utf8');
                            console.log(`       - done: ${fileName} [flagged: ${oldFlag} -> ${activeFlag}]`);
                        } else {
                            console.log(`       - error: Flag: '${flag}' does not exists in '${fld}/flags.json.`); // eslint-disable-line no-console
                        }
                    } else {
                        console.log(`       - error: ${fileName} does not exists.`); // eslint-disable-line no-console
                    }                    
                }

                // done
                rl.close();
            });
        } else {
            rl.close();
        }
    });
};

// do
const doTask = (argv, done) => {
    // change active flag of current build in dest
    let options = config(argv.options, 'build');
    if (!options) {
        console.log('Build options definition is not configured.');  // eslint-disable-line no-console
        done(); return;
    }

    // set flag
    console.log('flairFlag: (start)');
    setFlag(options);
    console.log('flairFlag: (end)');

    // done
    done();
};

exports.run = function(argv, cb) {
    doTask(argv, cb);
};