const path = require('path');
const fsx = require('fs-extra');

exports.file = async (options, src, dest) => {
    return new Promise((resolve, reject) => {
        let content = fsx.readFileSync(src, 'utf8'),
            ext = path.extname(src).substr(1),
            gzConfig = options.gzip[ext] || options.gzip.common; // pick ext specific configuration or generic (common)
        try {
            fsx.writeFileSync(dest, options.gzip.engines.common.gzipSync(content, gzConfig));
            resolve('');
        } catch (err) {
            reject(err);
        }
    });
};
