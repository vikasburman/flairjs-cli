exports.js = async (options, file) => {
    let lintReport = options.lint.engines.js.executeOnFiles([file]);
    if (lintReport.errorCount > 0 || lintReport.warningCount > 0) {
        return options.lint.engines.jsFormatter(lintReport.results);
    }
    return '';
};
exports.css = async (options, file) => {
    return new Promise((resolve, reject) => {
        let content = (isContent ? fileOrContent : fsx.readFileSync(fileOrContent, 'utf8'));
        options.lint.engines.css({
            files: [file],
            config: options.lint.css
        }).then((result) => {
            if (result.errored) { 
                resolve(result.output);
            } else {
                resolve('');
            }
        }).catch((err) => {
            reject(err);
        });
    });
};
exports.htmlContent = async (options, content) => { 
    return new Promise((resolve, reject) => {
        options.lint.engines.html(content, options.lint.html).then((errors) => {
            if (errors && errors.length > 0) {
                // HACK: some rules after being set to false are still showing up in errors,
                // filter them
                let finalErrors = [];
                errors.forEach(item => {
                    let rule = item.rule || item.data.name;
                    if (typeof options.lint.html[rule] !== 'undefined' && options.lint.html[rule] === false) { return; }
                    finalErrors.push(item);
                });
                if (finalErrors.length > 0) {
                    resolve(finalErrors);
                } else {
                    resolve('');
                }
            } else {
                resolve('');
            }
        }).catch((err) => {
            reject(err);
        });
    });
};
exports.html = async (options, file) => { 
    return new Promise((resolve, reject) => {
        let content = fsx.readFileSync(file, 'utf8');
        exports.htmlContent(options, content).then(resolve).catch(reject);
    });
};
