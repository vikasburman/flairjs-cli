const path = require('path');
const fsx = require('fs-extra');

// get all folders under given folder
module.exports = function(root, excludeRoot) {
    const _getFolders = () => {
        return fsx.readdirSync(root)
            .filter((file) => {
                return fsx.statSync(path.join(root, file)).isDirectory();
        });
    }
    if (excludeRoot) {
        return _getFolders();
    } 
    return ['/'].concat(_getFolders());
};