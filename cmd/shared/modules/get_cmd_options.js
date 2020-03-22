const path = require('path');
const fsx = require('fs-extra');
const mergeObjects = require('./merge_objects');

module.exports = function() {
    // first layer is full-set of default command options
    let options = Object.assign({}, require(`../../options.js`)); 

    // on top, apply any inbuilt master overrides
    // it's like in options.js define sort of inbuilt-default
    // and in this local flair.json here, define any overrides
    options = mergeObjects(options, require('../../flair.json'));

    // finally on this, apply any project specific overrides
    // from flair.json at project root
    let flairjson = path.resolve('./flair.json');
    if (fsx.existsSync(flairjson)) {
        options = mergeObjects(options, require(flairjson));
    }
    
    // return
    return options;
};