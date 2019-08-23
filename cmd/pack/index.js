const path = require('path');
const fsx = require('fs-extra');
const del = require('del');
const copyDir = require('copy-dir');
const open = require('open');

const delAll = (root) => {
    del.sync([root + '/**', '!' + root]);
};
const NPM = (options) => {
    let dest = path.join(path.resolve(options.dest), 'npm');
    
    // delete all old files of package
    delAll(dest);
   
    // copy files to package, so it can be published using
    // via npm publish <package<package-folder>/npm
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

    // build package
    open(`npm pack ${dest}`);
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
    NPM(optionsJSON.npm);

    // done
    done();
};

exports.run = function(argv, cb) {
    doTask(argv, cb);
};