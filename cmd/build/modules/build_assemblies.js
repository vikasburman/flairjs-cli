const chalk = require('chalk');
const path = require('path');
const fsx = require('fs-extra');
const replaceAll = require('../../shared/modules/replace_all');
const wildcards = require('../../shared/modules/wildcard_match');
const lint = require('./lint');
const minify = require('./minify');
const gzip = require('./gzip');
const buildDocs = require('./build_docs');
const buildTests = require('./build_tests');
const runTasks = require('./run_tasks');
const kinds = require('./kinds');

// build assemblies, corrosponding docs and test fixture
module.exports = async function(options) { 
    let profile, group, asm;
    options.logger(1, 'build'); 
    runTasks(options, 'pre', 'top');

    // start docs builder
    if (options.docs.perform) { await buildDocs.start(options); }

    // start tests builder
    if (options.tests.perform) { await buildTests.start(options); }    

    for(let profileName of options.build.profiles.list) {
        profile = options.profiles[profileName];
        if (profile) {
            options.logger(1, 'profile', chalk.blue(profileName), `${chalk.cyan(profile.groups.list.length)} group/s`);
            runTasks(options, 'pre', 'profile', profile);

            // build profile's assemblies, by groups
            for(let groupName of profile.groups.list) {
                group = profile.groups[groupName];
                options.logger(1, 'group', chalk.cyan(groupName), `${chalk.keyword('orange')(group.assemblies.list.length)} assembly/ies`);
                runTasks(options, 'pre', 'group', group);

                // build assemblies of the group
                for(let asmName of group.assemblies.list) {
                    asm = group.assemblies[asmName]();
                    await buildAssembly(options, asm);
                }

                // write preamble of group
                await buildGroupPreamble(options, group);

                // done building group
                runTasks(options, 'post', 'group', group);
                options.logger(-1);
            }

            // write preamble of profile
            await buildPreamblePreamble(options, profile);

            // done building profile
            runTasks(options, 'post', 'profile', profile);            
            options.logger(-1);
        }
    }

    // finish writing tests
    if (options.tests.perform) { await buildTests.finish(options); }   

    // finish writing docs
    if (options.docs.perform) { await buildDocs.finish(options); }
   
    runTasks(options, 'post', 'top');
    options.logger(-1);
};

const getAssemblySize = (file) => {
    file = path.resolve(file);
    let size = '';
    let minJS = file.replace('.js', '.min.js'),
        gz = minJS + '.gz';
    size = Math.round(fsx.statSync(file).size / 1024) + 'k';
    if (fsx.existsSync(minJS)) { size += ', ' + Math.round(fsx.statSync(minJS).size / 1024) + 'k min'; }
    if (fsx.existsSync(gz)) { size += ', ' + Math.round(fsx.statSync(gz).size / 1024) + 'k gz'; }
    return size;
};
const getFileContent = (file, isJson) => {
    if (!file) { return (isJson ? '{}' : ''); }
    if (isJson) { return fsx.readJSONSync(file, 'utf8'); }
    return fsx.readFileSync(file, 'utf8');
};
const findDefinitionOf = (likes, file, content) => {
    // required definitions to find
    // types: (Class)|(Struct)|(Mixin)|(Enum)|(Interface)
    // components: (Component)|(Annotation)
    // globals: none of the above
    let rex = new RegExp(`(${likes})\\s*\\(\\s*()\\s*`, 'g');

    const getKind = (type) => {
        if (!kinds[type]) { throw new Error(`Unknown/unsupported type. (${type})`); }
        return kinds[type];
    };

    // find
    let result = {
        type: '',               // found type: Class = getKind('class'), Struct = getKind('struct'), Component = getKind('component'), etc.
        index: -1,              // position where 'XXX(' starts
        lineStartIndex: -1      // posiiton where the line is started on which 'XXX(' is found
    };
    while (true) {
        let match = rex.exec(content);
        if (match) {
            // find start of the line where this match is found
            let lineStartIndex = content.lastIndexOf('\n', match.index);
            if (lineStartIndex === -1) { lineStartIndex = 0; } // this must be first line itself
            
            // check if this line is a comment, skip this one and try to find next one
            let line = content.substring(lineStartIndex, match.index).trim();
            if (line.startsWith('*') || line.startsWith('//') || line.startsWith('/**') || line.startsWith('*/')) { // this is a comment, ignore this match and try to find next one
                continue;
            } else { // record this
                // record, if not already found
                if (result.index === -1) {
                    result.type = getKind(match[1].toLowerCase());
                    result.index = match.index;
                    result.lineStartIndex = lineStartIndex;
                } else {
                    throw new Error(`Multiple '${match[1]}' definitions are not allowed in one file. (${file})`);
                }

                // continue searching, as no two legit matches are allowed
                // there may still be legit matches in there
                continue;
            }
        } else { // not found
            break;
        }
    }

    // return
    return result;
};
const injectAnnotations = (content, result, annotations) => {
    // annotations: array or string like:
    // Host('name'), Name('name'), Internal, Private, etc.

    // inject
    if (result.index !== -1) {
        let inject = '';
        for(let ano of annotations) {
            inject += `\n-[${ano}]`;
        }
        if (inject) {
            content = content.substring(0, result.lineStartIndex) + `\n${inject}\n` + content.substr(result.index); // from start till match-point + inject + from match-point till end
        }
    }

    // return
    return content;
};
const injectFiles = (options, asm, content) => { // <!-- inject: ./file -->
    // Unescaped \s*([\(\)\w@_\-.\\\/]+)\s*
    const FILENAME_PATTERN = '\\s*([\\(\\)\\w@_\\-.\\\\/]+)\\s*';
    const FILENAME_MARKER = '<filename>';
    const DEFAULT_PATTERN = '<!--\\s*inject:<filename>-->';
    
    const injectPattern = '^([ \\t]*)(.*?)' + DEFAULT_PATTERN.replace(FILENAME_MARKER, FILENAME_PATTERN);
    const regex = new RegExp(injectPattern, 'm');
    let fileName, textBefore, whitespace, currMatch, match, item, name;
    
    while ((currMatch = regex.exec(content))) {
        match = currMatch[0];
        whitespace = currMatch[1];
        textBefore = currMatch[2];
        fileName = currMatch[3];

        var injectContent = whitespace + textBefore +
                            fsx.readFileSync(path.join(asm.src, fileName), 'utf8').split(/\r?\n/)
                            .map((line, i) => {
                                return (i > 0) ? whitespace + line : line
                            }).join('\n');
        content = content.replace(match, function () { return injectContent; })
    }
        
    return content;
};
const lintByType = async (options, file) => {
    let result = null;
    switch(file.ext) {
        case 'js': result = await lint.js(options, file.file); break;
        case 'html': result = await lint.html(options, file.file); break;
        case 'css': result = await lint.css(options, file.file); break;
        default: throw new Error(`Unknown file type for lint operation. (${file.file})`); break;
    }
    return result;
};
const minifyByType = async (options, type, content, src, dest, destRoot) => {
    let result = null;
    switch(type) {
        case 'js': 
            if (content) {
                result = await minify.jsContent(options, content);
            } else {
                result = await minify.js(options, src, dest, destRoot);
            }
            break;
        case 'html': 
            if (content) {
                result = await minify.htmlContent(options, content);
            } else {
                result = await minify.html(options, src, dest);
            } 
            break;
        case 'css': 
            if (content) {
                result = await minify.cssContent(options, content);
            } else {
                result = await minify.css(options, src, dest);
            } 
            break;
        default: 
            throw new Error(`Unknown type for minify operation. (${type})`); 
            break;
    }
    return result;
};

const buildAssembly = async (options, asm) => {
    if (asm.skipBuild) {
        options.logger(1, 'assembly', chalk.keyword('orange')(asm.name), `${chalk.white(asm.dest.file)}`, getAssemblySize(asm.dest.file), chalk.keyword('limegreen')(' ✔ '));
        await addPreamble(options, asm);
    } else {
        // build assembly
        options.logger(1, 'assembly', chalk.keyword('orange')(asm.name), `${asm.members} members`);
        runTasks(options, 'pre', 'all-asms', asm);
        runTasks(options, 'pre', 'asm', asm);

        await createAssembly(options, asm);  // main, config, settings
        await injectIncludes(options, asm); // includes
        await injectGlobals(options, asm); // globals
        await injectComponents(options, asm); // components
        await injectResources(options, asm); // resources
        await injectTypes(options, asm); // types, ado.ty
        await copyAssets(options, asm); // assets, namespaced-assets, libs, locales
        await injectADO(options, asm);  // ado
        await writeAssembly(options, asm);
        await addPreamble(options, asm);

        runTasks(options, 'post', 'asm', asm);
        runTasks(options, 'post', 'all-asms', asm);
    }
    options.logger(-1);
};
const createAssembly = async (options, asm) => { // main, config, settings
    // custom main/template main
    if (asm.files.main) {
        options.logger(1, chalk.keyword('tan')('main'), 1);
        options.logger(0, chalk.keyword('lightseagreen')(asm.files.main.replace(asm.src, '.')));
        options.logger(-1);
    }
    asm.content = getFileContent(asm.files.main || options.build.assembly.main);
    asm.content = replaceAll(asm.content, '<<asm>>', asm.ado.n); 
    asm.content = replaceAll(asm.content, '<<file>>', asm.ado.f);
    asm.content = replaceAll(asm.content, '<<version>>', asm.ado.v); 
    asm.content = replaceAll(asm.content, '<<lupdate>>', asm.ado.u);
    asm.content = replaceAll(asm.content, '<<title>>', asm.ado.p.t);
    asm.content = replaceAll(asm.content, '<<desc>>', asm.ado.p.d);
    asm.content = replaceAll(asm.content, '<<copyright>>', asm.ado.c); 
    asm.content = replaceAll(asm.content, '<<license>>', asm.ado.l);
    asm.content = replaceAll(asm.content, '<<internal_id>>', asm.ado.i);

    // config, settings
    if (asm.files.config || asm.files.settings) {
        options.logger(1, chalk.keyword('tan')('config'), (asm.files.config ? 1 : 0) + (asm.files.settings ? 1 : 0));
        asm.content = replaceAll(asm.content, '<<config>>', JSON.stringify(getFileContent(asm.files.config, true))); 
        asm.content = replaceAll(asm.content, '<<settings>>', JSON.stringify(getFileContent(asm.files.settings, true)));
        if (asm.files.config) { options.logger(0, chalk.keyword('lightseagreen')(asm.files.config.replace(asm.folders.config, '.'))); }
        if (asm.files.settings) { options.logger(0, chalk.keyword('lightseagreen')(asm.files.settings.replace(asm.folders.settings, '.'))); }
        options.logger(-1);
    }
};
const injectADO = async(options, asm) => {
    // inject ado
    asm.content = replaceAll(asm.content, '<<ado>>', JSON.stringify(asm.ado));
};
const injectIncludes = async (options, asm) => { // includes
    // inject includes files, if defined
    if (asm.includes.length > 0) {
        options.logger(1, chalk.keyword('tan')('includes'), asm.includes.length);
        let content = '';
        for(let inc of asm.includes) { // { file: {}, name: '', filename: '' }
            // assemble content
            content +=  `/\/\ #region name: ${inc.name}, file: ${inc.file.filename} (start)\n` +
                        `${getFileContent(inc.file.file).trim()}\n` +
                        `/\/\ #endregion name: ${inc.name}, file: ${inc.file.filename} (end)\n`;
            options.logger(0, chalk.keyword('lightseagreen')(inc.filename, ''));
        }

        // inject
        asm.content = replaceAll(asm.content, '<<includes>>', content);
        options.logger(-1);
    } else {
        asm.content = replaceAll(asm.content, '<<includes>>', '');
    }
};
const injectGlobals = async (options, asm) => { // globals
    if (asm.globals.length > 0) {
        options.logger(1, chalk.keyword('tan')('globals'), asm.globals.length);
        let content = '',
            lintText = '';
        for(let global of asm.globals) { // { file: {}, name: '', desc: '', lint: t/f, content: '', filename: '' }
            // perform lint
            if (global.lint) { 
                try { 
                    lintText = await lintByType(options, global.file);
                } catch (err) {
                    lintText = err;
                }
                if (lintText) {
                    options.logger(0, chalk.keyword('lightseagreen')(global.filename), '', '', '', chalk.red(' lint: ✘ '));
                    throw new Error(lintText);
                } else {
                    lintText = ' lint: ✔ ';
                }
            } else {
                lintText = '';
            }

            // assemble content
            global.content = getFileContent(global.file.file).trim(); // load and keep for docs generation
            content +=  `/\/\ #region name: ${global.name}, file: ${global.file.filename} (start)\n` +
                        `${global.content}\n` +
                        `/\/\ #endregion name: ${global.name}, file: ${global.file.filename} (end)\n`;
            options.logger(0, chalk.keyword('lightseagreen')(global.filename), '', '', '', chalk.keyword('limegreen')(lintText));
        }

        // inject
        asm.content = replaceAll(asm.content, '<<globals>>', content);
        options.logger(-1);
    } else {
        asm.content = replaceAll(asm.content, '<<globals>>', '');
    }
};
const injectComponents = async (options, asm) => { // components
    if (asm.components.length > 0) {
        options.logger(1, chalk.keyword('tan')('components'), asm.components.length);
        let content = '',
            lintText = '';
        for(let comp of asm.components) { // { file: {}, name, '', desc: '', lint: t/f, content: '', type: '', filename: '' }

            // perform lint
            if (comp.lint) { 
                try {
                    lintText = await lintByType(options, comp.file);
                } catch (err) {
                    lintText = err;
                }
                if (lintText) {
                    options.logger(0, chalk.keyword('lightseagreen')(comp.filename), '', '', comp.name, chalk.red(' lint: ✘ '));
                    throw new Error(lintText);
                } else {
                    lintText = ' lint: ✔ ';
                }
            } else {
                lintText = '';
            }

            // read content
            comp.content = getFileContent(comp.file.file).trim(); // load and keep for docs generation

            // identify component type
            result = findDefinitionOf('(Component)|(Annotation)', comp.file.file, comp.content);
            comp.type = result.type;
            if (!comp.type) { 
                options.logger(0, chalk.keyword('lightseagreen')(comp.filename), '', '', comp.name, chalk.red('Unknown component type.'));
                throw new Error(`Unknown component type. Components can only be defined with: Component(), Annotation()`);
            }

            // inject annotations
            if (!asm.profile.injections.exclude.components || !wildcards.isMatchAny(comp.name, asm.profile.injections.exclude.components)) {
                try {
                    comp.content = injectAnnotations(comp.content, result, [
                        `Host('${asm.ado.i}')`,
                        `Type('${result.type}')`,
                        `Name('${comp.name}')`
                    ]);
                } catch (err) {
                    options.logger(0, chalk.keyword('lightseagreen')(comp.filename), '', '', comp.name, chalk.keyword('limegreen')(lintText));
                    throw err;
                }            
            }

            // assemble content
            content +=  `/\/\ #region name: ${comp.name}, file: ${comp.file.filename} (start)\n` +
                        `${comp.content}\n` +
                        `/\/\ #endregion name: ${comp.name}, file: ${comp.file.filename} (end)\n`;
            options.logger(0, chalk.keyword('lightseagreen')(comp.filename), '', '', comp.name, chalk.keyword('limegreen')(lintText));
        }

        // inject
        asm.content = replaceAll(asm.content, '<<components>>', content);
        options.logger(-1);
    } else {
        asm.content = replaceAll(asm.content, '<<components>>', '');
    }
};
const injectResources = async (options, asm) => { // resources
    if (asm.resources.length > 0) {
        options.logger(1, chalk.keyword('tan')('resources'), asm.resources.length);
        let content = '',
            fileContent = '',
            result = null,
            lintMinText = '';
        for(let res of asm.resources) { // { file: {}, name: '', desc: '', encoding: '', lint: t/f, minify: t/f, filename: '' }

            // perform lint
            if (res.lint) { 
                try {
                    lintMinText = await lintByType(options, res.file);
                } catch(err) {
                    lintMinText = err;
                }
                if (lintMinText) {
                    options.logger(0, chalk.keyword('lightseagreen')(res.filename), '', '', res.name, chalk.red(' lint: ✘ '));
                    throw new Error(lintMinText);
                } else {
                    lintMinText += ' lint: ✔ ';
                }
            } else {
                lintMinText = '';
            }

            // read content
            if (res.encoding === 'utf8') {
                fileContent = fsx.readFileSync(res.file.file, 'utf8');
            } else {
                fileContent = fsx.readFileSync(res.file.file);
            }
            res.encoding += ';';
            
            // perform minify
            if (res.minify) {
                try {
                    result = await minifyByType(options, res.file.ext, fileContent);
                    fileContent = result.code;
                    lintMinText += ' min: ✔ '
                } catch (err) {
                    options.logger(0, chalk.keyword('lightseagreen')(res.filename), '', '', res.name, chalk.keyword('limegreen')(lintMinText) + chalk.red(' min: ✘ '));                    
                    throw err;
                }
            }

            // base64 encoding before adding to file
            fileContent = Buffer.from(fileContent).toString('base64');
            res.encoding += ' base64;';

            // assemble content
            content +=  `/\/\ #region name: ${res.name}, file: ${res.file.filename} (start)\n` +
                        `_.rs('${asm.name}', '${res.name}', '${res.file.filename}', '${res.desc}', '${res.encoding}', '${fileContent}');\n` +
                        `/\/\ #endregion name: ${res.name}, file: ${res.file.filename} (end)\n`;
            options.logger(0, chalk.keyword('lightseagreen')(res.filename), '', `Encoding: ${res.encoding}`, res.name, chalk.keyword('limegreen')(lintMinText));
        }

        // inject
        asm.content = replaceAll(asm.content, '<<resources>>', content);
        options.logger(-1);
    } else {
        asm.content = replaceAll(asm.content, '<<resources>>', ''); 
    }
};
const injectTypes = async (options, asm) => { // types, ado.ty
    if (asm.types.length > 0) {
        options.logger(1, chalk.keyword('tan')('types'), asm.types.length);
        let content = '',
            result = null,
            lintText = '';
        for(let type of asm.types) { // { file: '', ns: '', name, '', qualifiedName: '', desc: '', lint: t/f, content: '', type: '', filename: '' }

            // perform lint
            if (type.lint) { 
                try {
                    lintText = await lintByType(options, type.file);
                } catch (err) {
                    lintText = err;
                }
                if (lintText) {
                    options.logger(0, chalk.keyword('lightseagreen')(type.filename), '', '', '', chalk.red(' lint: ✘ '));
                    throw new Error(lintText);
                } else {
                    lintText = ' lint: ✔ ';
                }
            } else {
                lintText = '';
            }

            // read content
            type.content = getFileContent(type.file.file).trim(); // load and keep for docs generation

            // identify type's type
            result = findDefinitionOf('(Class)|(Struct)|(Mixin)|(Enum)|(Interface)', type.file.file, type.content);
            type.type = result.type;
            if (!type.type) { 
                options.logger(0, chalk.keyword('lightseagreen')(type.filename), '', '', type.name, chalk.red('Unknown type of type.'));
                throw new Error(`Unknown type of type. Types can only be defined with: Class(), Struct(), Mixin(), Enum(), and Interface()`);
            }            

            // inject annotations
            if (!asm.profile.injections.exclude.types || !wildcards.isMatchAny(type.qualifiedName, asm.profile.injections.exclude.types)) {
                try {
                    type.content = injectAnnotations(type.content, result, [
                        `Host('${asm.ado.i}')`,
                        `Type('${result.type}')`,
                        `Name('${type.qualifiedName}')`
                    ]);
                } catch (err) {
                    options.logger(0, chalk.keyword('lightseagreen')(type.filename), '', '', type.qualifiedName, chalk.keyword('limegreen')(lintText));
                    throw err;
                }
            }

            // assemble content
            content +=  `/\/\ #region name: ${type.qualifiedName}, file: ${type.filename} (start)\n` +
                        (asm.asyncTypeLoading ? `await (async () => {` : `(() => {`) + '\n' + 
                        `${type.content}\n` +
                        `})();\n` + 
                        `/\/\ #endregion name: ${type.qualifiedName}, file: ${type.filename} (end)\n`;
            options.logger(0, chalk.keyword('lightseagreen')(type.filename), '', '', type.qualifiedName, chalk.keyword('limegreen')(lintText));
        }

        // inject
        asm.content = replaceAll(asm.content, '<<types>>', content);
        options.logger(-1);
    } else {
        asm.content = replaceAll(asm.content, '<<types>>', '');
    }
};
const copyAssets = async (options, asm) => { // assets, namespaced-assets, libs, locales
    if (asm.assets.length > 0) {
        options.logger(1, chalk.keyword('tan')('assets'), asm.assets.length);
        let content = '',
            fileContent = '',
            result = null,
            lintMinGzText = '';

        // copy all assets from src to dest
        for(let ast of asm.assets) { // { src: '', dest: '', skipCopy: t/f, lint: t/f, minify: t/f, gzip: t/f, gzDest: '', desc: '', name: '', file: {} }
            if (ast.skipCopy) {
                options.logger(0, chalk.white(ast.name), '', '', '', chalk.keyword('limegreen')(' ✔ '));
            } else {
                // perform lint
                if (ast.lint) { 
                    try {
                        lintMinGzText = await lintByType(options, ast.file);
                    } catch (err) {
                        lintMinGzText = err;
                    }
                    if (lintMinGzText) {
                        options.logger(0, chalk.green(ast.name), '', '', '', chalk.red(' lint: ✘ '));
                        throw new Error(lintMinGzText);
                    } else {
                        lintMinGzText += ' lint: ✔ ';
                    }
                } else {
                    lintMinGzText = '';
                }

                // copy
                fsx.ensureDirSync(path.dirname(ast.dest)); // ensure dest folder exists
                fsx.copyFileSync(ast.src, ast.dest);            

                // perform minify
                if (ast.minify) {
                    try {
                        await minifyByType(options, ast.file.ext, '', ast.src, ast.dest, ast.dest.replace(asm.dest.files));
                        lintMinGzText += ' min: ✔ '
                    } catch (err) {
                        options.logger(0, chalk.green(ast.name), '', '', '', chalk.keyword('limegreen')(lintMinGzText) + chalk.red(' min: ✘ '));
                        throw err;
                    }
                }

                // perform gzip
                if (ast.gzip) { 
                    try {
                        await gzip.file(options, ast.dest, ast.gzDest);
                        lintMinGzText += ' gz: ✔ '
                    } catch (err) {
                        options.logger(0, chalk.green(ast.name), '', '', '', chalk.keyword('limegreen')(lintMinGzText) + chalk.red(' gz: ✘ '));
                        throw err;
                    }
                }

                // status
                options.logger(0, chalk.green(ast.name), '', '', '', chalk.keyword('limegreen')(lintMinGzText));
            }
        }
        options.logger(-1);
    }
};
const writeAssembly = async (options, asm) => {
    let lintMinGzText = '';

    // write assembly file
    fsx.writeFileSync(asm.dest.file, asm.content, 'utf8');

    // perform lint
    if (!asm.skipLint) { 
        let lintError = await lint.js(options, asm.dest.file);
        if (lintError) {
            options.logger(0, '', chalk.keyword('orange')('>>>'), chalk.green(asm.dest.file), '', chalk.red(' lint: ✘ '));
            throw new Error(lintError);
        } else {
            lintMinGzText += ' lint: ✔ ';
        }
    }

    // perform minify
    if (!asm.skipMinify) { 
        try {
            await minify.js(options, asm.dest.file, asm.dest.minFile, asm.dest);
            lintMinGzText += ' min: ✔ '
        } catch (err) {
            options.logger(0, '', chalk.keyword('orange')('>>>'), chalk.green(asm.dest.file), '', chalk.keyword('limegreen')(lintMinGzText) + chalk.red(' min: ✘ '));
            throw err;
        }

        // perform scramble
        if (asm.doScramble) {
            // scrambled file content is just base64 version of the whole assembly file
            // flair() when founds a string coming in, puts this whole thing in a dynamic function
            // and runs the function as is and returns its value
            let scrambledFileContent = `flair("${Buffer.from(fsx.readFileSync(asm.dest.minFile, 'utf8')).toString('base64')}");`

            // overwrite minified file with scrambled version
            fsx.writeFileSync(asm.dest.minFile, scrambledFileContent, 'utf8');
            lintMinGzText += ' scr: ✔ '
        }
    }

    // perform gzip
    if (!asm.skipGzip) { 
        try {
            await gzip.file(options, (asm.dest.minFile || asm.dest.file), asm.dest.gzFile);
            lintMinGzText += ' gz: ✔ '
        } catch (err) {
            options.logger(0, '', chalk.keyword('orange')('>>>'), chalk.green(asm.dest.file), '', chalk.keyword('limegreen')(lintMinGzText) + chalk.red(' gz: ✘ '));
            throw err;
        }
    }

    // write adocache file
    if (asm.dest.adoCache) {
        fsx.ensureDirSync(path.dirname(asm.dest.adoCache));
        fsx.writeJSONSync(asm.dest.adoCache, asm.ado, 'utf8');
    }

    // build docs
    if (!asm.skipDocs) {
        try {
            await buildDocs.build(options, asm); 
            lintMinGzText += ' docs: ✔ '
        } catch (err) {
            options.logger(0, '', chalk.keyword('orange')('>>>'), chalk.green(asm.dest.file), '', chalk.keyword('limegreen')(lintMinGzText) + chalk.red(' docs: ✘ '));
            throw err;
        }
    }

    // build tests
    if (!asm.skipTests) {
        try {
            await buildTests.build(options, asm); 
            lintMinGzText += ' tests: ✔ '
        } catch (err) {
            options.logger(0, '', chalk.keyword('orange')('>>>'), chalk.green(asm.dest.file), '', chalk.keyword('limegreen')(lintMinGzText) + chalk.red(' tests: ✘ '));
            throw err;
        }
    }

    // status
    options.logger(0, '', chalk.keyword('orange')('>>>'), chalk.green(asm.dest.file), getAssemblySize(asm.dest.file), chalk.keyword('limegreen')(lintMinGzText));
};
const addPreamble = async (options, asm) => {
    if (!asm.skipPreamble) {
        // add preamble to profile/group
        if (asm.profile.preamble.dest) { // profile
            asm.profile.preamble.list.push(asm.ado);
        } else { // group
            asm.group.preamble.list.push(asm.ado);
        }    
    }
};
const buildGroupPreamble = async (options, group) => {
    if (group.preamble.dest && group.preamble.list.length > 0) {
        // assemble preamble content
        let content = `flair(JSON.parse('${JSON.stringify(group.preamble.list)}'));`;
        fsx.writeFileSync(group.preamble.dest, content, 'utf8');
        options.logger(0, '', chalk.cyan('>>>'), chalk.green(group.preamble.dest), `${group.preamble.list.length} definitions`);
    }
};
const buildPreamblePreamble = async (options, profile) => {
    if (profile.preamble.dest && profile.preamble.list.length > 0) {
        // assemble preamble content
        let content = `flair(JSON.parse('${JSON.stringify(profile.preamble.list)}'));`;
        fsx.writeFileSync(profile.preamble.dest, content, 'utf8');
        options.logger(0, '', chalk.blue('>>>'), chalk.green(profile.preamble.dest), `${profile.preamble.list.length} definitions`);
    }
};
