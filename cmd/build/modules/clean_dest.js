const chalk = require('chalk');
const delAll = require('../../shared/modules/delete_all');
const pathJoin = require('../../shared/modules/path_join');

// clean destination
module.exports = function(options) { 
    if (!options.build.clean) { return; }

    options.logger(1, 'clean');
    delAll(options.build.dest); options.logger(0, chalk.red(options.build.dest));
    delAll(options.build.cache); options.logger(0, chalk.red(options.build.cache));
    if (options.docs.perform) { delAll(options.docs.dest.root); options.logger(0, chalk.red(options.docs.dest.root)); }
    options.logger(-1);
};