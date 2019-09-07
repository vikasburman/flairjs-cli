const path = require('path');
const fsx = require('fs-extra');
const del = require('del');
const copyDir = require('copy-dir');
const config = require('../../shared/options.js').config;

const delAll = (root) => {
    del.sync([root + '/**', '!' + root]);
};
const NPMPackage = (options) => {
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

    console.log('   package: npm (end)');
};

// do
const doTask = (argv, done) => {
    // get options file
    let options = config(argv.options, 'pack');
    if (!options) {
        console.log('Pack options definition is not configured.');  // eslint-disable-line no-console
        done(); return;
    }

    // process each supported type of packaging
    console.log('flairPack: (start)');
    if (options.npm) {
        let npmOptions = config(options, 'pack', 'npm');
        NPMPackage(npmOptions);
    }
    console.log('flairPack: (end)');

    // done
    done();
};

exports.run = function(argv, cb) {
    doTask(argv, cb);
};