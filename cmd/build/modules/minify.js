const fsx = require('fs-extra');

exports.jsContent = async (options, content) => {
    return new Promise((resolve, reject) => {
        try {
            let result =  options.minify.engines.js(content, options.minify.js);
            if (result.error) { 
                reject(result.error);
            } else {
                resolve(result);
            }
        } catch (err) {
            reject(err);
        }
    });
};
exports.js = async (options, src, dest, destRoot) => {
    return new Promise((resolve, reject) => {
        dest = (dest.endsWith('.min.js') ? dest : dest.replace('.js', '.min.js'));
        let content = fsx.readFileSync(src, 'utf8'),
            mapFile = dest + '.map',
            mapFileUrl = mapFile.replace(destRoot, '.');
        if (options.minify.maps) {
            options.minify.js.sourceMap = {
                root: '',
                url: mapFileUrl
            };
        }
        exports.jsContent(options, content).then((result) => {
            if (options.minify.maps && result.map) {
                fsx.writeFileSync(mapFile, result.map, 'utf8');
            }
            fsx.writeFileSync(dest, result.code, 'utf8');
            resolve('');
        }).catch((error) => { // result.error
            reject(error); 
        }).finally(() => {
            if (options.minify.maps) {
                delete options.minify.js.sourceMap;
            }
        });
    });
};
exports.cssContent = async (options, content) => {
    return new Promise((resolve, reject) => {
        try {
            let result = new options.minify.engines.css(options.minify.css).minify(content);
            if (result.errors.length > 0) { 
                reject(result.errors); 
            } else {
                resolve(result.styles); 
            }
        } catch (err) {
            reject(err);
        }
    });
};
exports.css = async (options, src, dest) => {
    return new Promise((resolve, reject) => {   
        let content = fsx.readFileSync(src, 'utf8'),
            dest = dest.replace('.css', '.min.css');
        exports.cssContent(options, content).then((styles) => {
            fsx.writeFileSync(dest, styles, 'utf8');
            resolve(''); 
        }).catch((errors) => { // result.errors // err
            reject(errors);
        });
    });
};
exports.htmlContent = async (options, content) => { 
    return new Promise((resolve, reject) => {
        try {
            let result = options.minify.engines.html(content, options.minify.html);
            resolve(result);
        } catch (err) {
            reject(err);
        }
    });
};
exports.html = async (options, src, dest) => { 
    return new Promise((resolve, reject) => { // eslint-disable-line no-unused-vars           
        let content = fsx.readFileSync(src, 'utf8'),
            dest = dest.replace('.html', '.min.html');
        exports.htmlContent(options, content).then((result) => {
            fsx.writeFileSync(dest, result, 'utf8');
            resolve('');
        }).catch((err) => {
            reject(err);
        });
    });
};
