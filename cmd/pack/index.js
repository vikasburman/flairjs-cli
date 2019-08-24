const path = require('path');
const fsx = require('fs-extra');
const del = require('del');
const copyDir = require('copy-dir');
const packageJSON = require(path.join(process.cwd(), 'package.json'));
const { spawnSync } = require('child_process');

const delAll = (root) => {
    del.sync([root + '/**', '!' + root]);
};
const NPM = (argv, options) => {
    let dest = path.join(path.resolve(options.dest), 'npm');
    
    console.log('   package: npm (start)');

    // delete all old files of package
    console.log('       clean:');
    delAll(dest);
    console.log('           - done');

    // copy files to package, so it can be published using
    // via npm publish <package<package-folder>/npm
    console.log('       copy:');
    let files = options.files;
    
    let _src, _dest = '';
    for(let file of files) {
        _src = path.resolve(file.src);
        if (fsx.lstatSync(_src).isDirectory()) {
            _dest = path.join(dest, (file.dest || '')) || dest; // if destination is defined for item level
            fsx.ensureDirSync(dest);
            copyDir.sync(_src, _dest, {
                utimes: true,
                mode: true,
                cover: true
              });
        } else {
            _dest = path.join(dest, (file.dest || path.basename(_src)));
            fsx.ensureDirSync(path.dirname(_dest));
            fsx.copyFileSync(_src, _dest);
        }
    }
    console.log('           - done');

    // build package
    console.log('       tarball:');
    let child = spawnSync('yarn', ['pack', dest]);
    let tgzFile = `${packageJSON.name}-v${packageJSON.version}.tgz`;
    if (!fsx.existsSync(tgzFile)) {
        console.log(`       - error: ${child.error}`);
    } else {
        console.log(`       - done: ${tgzFile}`);
    }

    console.log('   package: npm (end)');
};

// do
const doTask = (argv, done) => {
    // get options file
    let options = argv.options || '',
        optionsJSON = null;
    if (!options) {
        console.log('Package options definition is not configured. Use --options <file> to define.'); // eslint-disable-line no-console
        return;
    }

    // load options
    optionsJSON = fsx.readJSONSync(options, 'utf8');

    // process each supported type of packaging
    NPM(argv, optionsJSON.npm);

    // done
    done();
};

exports.run = function(argv, cb) {
    console.log('flairPack: (start)');
    doTask(argv, () => {
        console.log('flairPack: (end)');
        cb();
    });
};