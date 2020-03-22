const path = require('path');

// join path using path.join - but add leading ./, if orginally was there
module.exports = function(...parts) {
    if (parts[0].startsWith('./')) {
        return './' + path.join(...parts);
    } else {
        return path.join(...parts);
    }
};