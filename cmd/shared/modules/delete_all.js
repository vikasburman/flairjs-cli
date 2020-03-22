const del = require('del');

// delete all files and folders under given root
module.exports = function(root) {
    del.sync([root + '/**', '!' + root]);
};