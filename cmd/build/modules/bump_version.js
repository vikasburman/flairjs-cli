const fsx = require('fs-extra');
const chalk = require('chalk');

// bumps version to next up
module.exports = function(options) { 
    if (!options.build.version) { return; }

    // bump version
    let ver = options.package.version.split('.');
    ver[0] = parseInt(ver[0]);
    ver[1] = parseInt(ver[1]);
    ver[2] = parseInt(ver[2]);
    if (ver[2] >= 99) {
        ver[2] = 0
        if (ver[1] >= 99) {
            ver[1] = 0
            ver[0] += 1
        } else {
            ver[1] += 1
        }
    } else {
        ver[2] += 1
    }
    let newVer = ver[0].toString() + '.' + ver[1].toString() + '.' + ver[2].toString();
    options.package.version = newVer;

    // update package.json as well
    fsx.writeFileSync(options.build.files.package, JSON.stringify(options.package, null, 4), 'utf8');
    
    options.logger(0, 'version', chalk.yellow(newVer));
};