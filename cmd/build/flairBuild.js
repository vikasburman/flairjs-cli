/**
 * flairBuild
 * v1
 */
(function(root, factory) {
    'use strict';

    // #region module definition

    if (typeof define === 'function' && define.amd) { // AMD support
        define(factory);
    } else if (typeof exports === 'object') { // CommonJS and Node.js module support
        if (typeof module !== 'undefined' && module.exports) {
            exports = module.exports = factory(); // Node.js specific `module.exports`
        }
        module.exports = exports = factory(); // CommonJS        
    } else { // expose as global on window
        root.flairBuild = factory();
    }

    // #endregion
    
})(this, function() {
    'use strict';

    // #region globals

    // includes
    const rrd = require('recursive-readdir-sync'); 
    const junk = require('junk');
    const copyDir = require('copy-dir');
    const path = require('path');
    const fsx = require('fs-extra');
    const del = require('del');
    const path_sort = require('path-sort');

    // build info
    const buildInfo = {
        name: 'flairBuild',
        version: '1',
        format: 'fasm',
        formatVersion: '1',
        contains: [
            'init',         // index.js is bundled outside closure, which can have injected dependencies
            'func',         // functions.js is bundled in closure, which can have local closure functions as well as a special named function 'onLoadComplete'
            'comp',         // components.js is bundled in closure, which can have local closure level components
            'type',         // types are embedded
            'vars',         // flair variables are made available in a closure where types are bundled
            'reso',         // resources are bundled
            'asst',         // assets are processed and their names are added in ado
            'rout',         // routes are collected, and added in ado
            'docs',         // docs generation processed
            'sreg'          // selfreg code is bundled
        ]
    };    

    // plugins
    const all_plugins = {
        node_modules: { cmd: "yarn install --prod" },
        web_modules: {},
        copy_files: {},
        minify_files: { gzip: true },
        write_flags: { defaultFlag: "dev" },
        create_bundle: { minify: true, gzip: true }
    };

    // options (carry options for current build session, when session starts)
    let options = null;

    // support functions
    const guid = () => {
        return '-xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
            var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    };    
    const logger = (level, msg, data, prlf, polf) => {
        if (options.suppressLogging) { return; }
        
        prlf=false; polf=false; // no lf is much cleaner - so turn off all pre/post lf settings
        
        let colLength = 15;
        msg = ' '.repeat(colLength - msg.length) + msg + (level === 0 ? ': ' : '');
        if (level !== 0) { data = '- ' + data; }
        msg = msg + '  '.repeat(level) + data.toString();
        if (prlf) { msg = '\n' + msg; }
        if (polf) { msg += '\n'; }
        console.log(msg);   // eslint-disable-line no-console
    }; 
    const getFolders = (root, excludeRoot) => {
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
    const delAll = (root) => {
        del.sync([root + '/**', '!' + root]);
    };
    const escapeRegExp = (string) => {
        return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");  // eslint-disable-line no-useless-escape
    };
    const replaceAll = (string, find, replace) => {
        return string.replace(new RegExp(escapeRegExp(find), 'g'), replace);
    };
    const bumpVersion = () => {
        if (options.skipBumpVersion) { return; }
    
        // bump version
        let ver = options.packageJSON.version.split('.');
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
        options.packageJSON.version = newVer;
        fsx.writeFileSync(options.package, JSON.stringify(options.packageJSON, null, 4), 'utf8');
        
        logger(0, 'version', newVer);
    };
    const copyDeps = (isPost, done) => {
        let deps = [];
        if (isPost) {
            if (options.postBuildDeps && options.depsConfig && options.depsConfig.post.length > 0) { 
                deps = options.depsConfig.post.slice();
            }
        } else {
            if (options.preBuildDeps && options.depsConfig && options.depsConfig.pre.length > 0) {
                deps = options.depsConfig.pre.slice();
            }
        }
        if (deps.length === 0) { done(); return; }
        options.logger(0, 'deps',  (isPost ? '(post)' : '(pre)'), true);
    
        const processNext = (items) => {
            if (items.length !== 0) {
                let item = items.shift(); // {src, dest, exclude}
                options.logger(1, '', item.dest);
                if (!isPost && item.src.startsWith('http')) { // http is supported only in case of pre deps
                    let httpOrhttps = null,
                        body = '';
                    if (item.src.startsWith('https')) {
                        httpOrhttps = require('https');
                    } else {
                        httpOrhttps = require('http'); // for urls where it is not defined
                    }
                    httpOrhttps.get(item.src, (resp) => {
                        resp.on('data', (chunk) => { body += chunk; });
                        resp.on('end', () => {
                            let dest = path.resolve(item.dest);
                            fsx.ensureFileSync(dest);
                            fsx.writeFileSync(dest, body, 'utf8'); // overwrite
                            processNext(items);
                        });
                    }).on('error', (e) => {
                        throw `Failed to fetch dependency: ${item.src}. \n\n ${e}`;
                    });
                } else { // local file / folder path
                    let src = path.resolve(item.src),
                        dest = path.resolve(item.dest),
                        exclude = item.exclude,
                        minFile = '';
                    if (fsx.lstatSync(src).isDirectory()) {
                        delAll(dest); // delete all content inside
                        fsx.ensureDirSync(dest);
                        copyDir.sync(src, dest, (state, filepath, filename) => { // copy
                            let result = true;
                            // maps
                            if (exclude.maps && path.extname(filename) === '.map') { result = false; }
    
                            // un-min: for every js file, check if it's .min version exists at same path, don't copy this file, as .min.js might have been copied or will be copied
                            if (result && exclude["un-min"] && path.extname(filename) === '.js' && !path.extname(filename).endsWith('.min.js')) {
                                minFile = filepath.substr(0, filepath.length - 3) + '.min.js'; // remove .js and add .min.js
                                if (fsx.existsSync(minFile)) { result = false; }
                            }
    
                            // pattern
                            if (result) {
                                for(let pattern of exclude.patterns) {
                                    if (pattern.startsWith('*')) {
                                        pattern = pattern.substr(1); // remove *
                                        if (filename.endsWith(pattern)) { result = false; break; }
                                    } else if (pattern.endsWith('*')) {
                                        pattern = pattern.substr(0, pattern.length - 1); // remove *
                                        if (filename.startsWith(pattern)) { result = false; break; }
                                    } else {
                                        if (filename === pattern) { result = false; break; }
                                    }
                                }
                            }
    
                            // ok
                            return result;
                        }); 
                    } else {
                        fsx.ensureDirSync(path.dirname(dest));
                        fsx.copyFileSync(src, dest); // overwrite
                    }
                    processNext(items);
                }
            } else {
                done();
            }
        };
    
        processNext(deps);
    };

    //#endregion 

    // #region code processor
    let code = { templates: {}, extract: {} };

    // templates
    code.templates.get = (file) => { return fsx.readFileSync(path.join(__dirname, 'templates', 'asm', file), 'utf8'); };
    code.templates.module = code.templates.get('module.js');
    code.templates.preamble = code.templates.get('preamble.js');
    code.templates.preamble_line = code.templates.get('preamble_line.js');
    code.templates.resource = code.templates.get('resource.js');
    code.templates.type_async = code.templates.get('type_async.js');
    code.templates.type_sync = code.templates.get('type_sync.js');
    
    // extractors
    code.extract.componentInfo = (content) => {
        let item = {
            desc: ''
        };

        // 1: it looks for first occurance of '@component'
        // 2: then it looks for first occurance of @desc after that
        let foundAt = content.indexOf('@component');
        if (foundAt !== -1) {
            content = content.substring(foundAt);
            foundAt = content.indexOf('@desc'); // length of @desc = 5
            if (foundAt !== -1) {
                item.desc = content.substring(foundAt + 5,  content.indexOf('\n', foundAt)).trim(); // pick all content after @desc till next line break
            }
        }
        return item;
    };
    code.extract.typeInfo = (content) => {
        let item = {
            type: '',
            desc: ''
        };
        // 1: it looks for first occurance of 'Class(', 'Interface(', 'Mixin(', 'Struct(' or 'Enum(' because flairTypes = ['class', 'enum', 'interface', 'mixin', 'struct']
        // 2: then look for presence of @type before this
        // 3: then look for prescnce of @desc between #2 and #3
        let foundAt = content.indexOf('Class(');
        if (foundAt !== -1) { 
            item.type = 'class';
        } else {
            foundAt = content.indexOf('Interface(');
            if (foundAt !== -1) { 
                item.type = 'interface';
            } else {
                foundAt = content.indexOf('Mixin(');
                if (foundAt !== -1) { 
                    item.type = 'mixin';
                } else {
                    foundAt = content.indexOf('Enum(');
                    if (foundAt !== -1) { 
                        item.type = 'enum';
                    } else {
                        foundAt = content.indexOf('Struct(');
                        if (foundAt !== -1) { 
                            item.type = 'struct';
                        } 
                    } 
                }                                    
            }
        }
        if (foundAt !== -1) { // found at some level
            content = content.substring(0, foundAt);
            foundAt = content.indexOf('@type');
            if (foundAt !== -1) {
                content = content.substring(foundAt);
                foundAt = content.indexOf('@desc');
                if (foundAt !== -1) {
                    item.desc = content.substring(foundAt,  content.indexOf('\n', foundAt)).trim(); // pick all content after @desc till next line break
                }
            }
        }
        return item;
    };

    // injector
    code.inject = (base, content, isInjectionsAreComponents, docComponents) => {
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
                                fsx.readFileSync(path.join(base, fileName), 'utf8').split(/\r?\n/)
                                .map((line, i) => {
                                    return (i > 0) ? whitespace + line : line
                                }).join('\n');
            
            // store injection content as docComponent (since it is being bundled)
            if (isInjectionsAreComponents) {
                item = code.extract.componentInfo(injectContent);
                name = path.basename(fileName, path.extname(fileName)); // gives just the file name, which is the name of the component
                docComponents.push({ name: name, desc: item.desc, file: fileName, content: injectContent });
            }
            
            content = content.replace(match, function () { return injectContent })
        }
        
        return content;
    };
   
    // #endregion

    // #region docs generator
    let docs = { templates: {}, jsdocs: {}, annotations: {}, render: { link: {}, sections: {} }}
    
    // jsdocs
    docs.jsdocs.extractBlocks = (content) => {
        // credits: https://www.npmjs.com/package/jsdoc-regex
        // https://stackoverflow.com/questions/35905181/regex-for-jsdoc-comments
        let rx = new RegExp(/[ \t]*\/\*\*\s*\n([^*]*(\*[^/])?)*\*\//g); 

        return content.match(rx) || [];
    };
    docs.jsdocs.extractSymbols = (block) => {
        // NOTE: it will leave all unknown/unsupported symbols
        // known symbols and format types are:
        //
        // Type 1: @<symbol>
        // Supported: 
        //  @public | @private |  @privateSet | @protected | @protectedSet | @internal
        //  @abstract | @virtual | @override | @sealed
        //  @overload
        //  @optional
        //  @static
        //  @async
        //  @generator
        //  @readonly
        //  @ignore
        //  @type | @component
        //  @construct | @noconstruct
        // 
        // Type 2: @<symbol> value
        //  @desc <desc>
        //  @extends <class-type>
        //  @deprecated <desc>
        //  @restricted <desc>
        //  @since <version>
        //                                         
        // Type 3: @<symbol> value1, value2, ...
        //  @mixes <mixin-type>, <mixin-type>, ...
        //  @implements <interface-type>, <interface-type>, ...
        //  @conditional <cond1>, <cond2>, ...
        //
        // Type 4: @<symbol> { value1 } value2
        //  @returns {<type>/<type2>} <desc> | @yields {<type>/<type2>} <desc>
        //  @throws {<type>} <desc>                                 [multiple allowed]
        //
        // Type 5: @<symbol> { value1 } value2 - value3
        //  @param {<type>/<type2>: <default>} <name> - <desc>      [multiple allowed]
        //  @seealso {<link>} <name> - <desc>                       [multiple allowed]
        //  @back {<link>} <name> - <desc>
        //  @next {<link>} <name> - <desc>
        //  @prop {<type>: <default>} <name> - <desc>
        //  
        // Type 6: @<symbol> value1 - value2
        //  @func <name> - <desc>
        //  @event <name> - <desc>
        //
        // Type 7: @<symbol> \n multi-line value
        //  @remarks                                                
        //  @example                                                
        let lines = block.split('\n'),
            line = '',
            symbol = '',
            symbolData = '',
            items = [],
            idx = -1,
            isIgnore = false,
            isIgnoreBlock = false,
            symbols = {},
            type1 = ['type', 'component', 'construct', 'noconstruct', 'public', 'private', 'privateSet', 'protected', 'protectedSet', 'internal', 'abstract', 'virtual', 'override', 'sealed', 'overload', 'optional', 'static', 'async', 'generator', 'readonly', 'ignore'],
            type2 = ['desc', 'extends', 'deprecated', 'restricted', 'since'],
            type3 = ['mixes', 'implements', 'conditional'],
            type4 = ['returns', 'yields', 'throws'],
            type5 = ['param', 'seealso', 'prop', 'back', 'next'],
            type6 = ['func', 'event'],
            type7 = ['example', 'remarks'],
            multiInstance = ['param', 'seealso', 'throws'];
        for(let i = 0; i < lines.length; i++) {
            
            line = lines[i].trim();
            if (line !== '/**' && line !== '*/') { // not start/end line
                
                line = line.substr(1).trim(); // remove *
                if (line.substr(0, 1) === '@') { // symbol line

                    // extract symbol
                    idx = line.indexOf(' ');
                    if (idx === -1) {
                        symbol = line.substr(1).trim();
                        line = '';
                    } else {
                        symbol = line.substr(1, idx).trim();
                        line = line.substr(idx).trim();
                    }

                    // if @ignore is found, stop processing this block
                    // that's why, its best to put @ignore as first, in case a documentation block
                    // is only for code file and not for generated documentation
                    if (symbol === 'ignore') { isIgnoreBlock = true; break; }

                    // multi instance error check
                    if (symbols[symbol] && multiInstance.indexOf(symbol) === -1) {
                        throw `Multiple instances of @${symbol} are not allowed. (${block})`;
                    }

                    // get symbol data
                    isIgnore = false;                        
                    if (type1.indexOf(symbol) !== -1) { // @<symbol>
                        symbolData = true;
                    } else if (type2.indexOf(symbol) !== -1) { // @<symbol> value
                        symbolData = line;
                    } else if (type3.indexOf(symbol) !== -1) { // @<symbol> value1, value2, ...
                        symbolData = line.split(',').map(item => item.trim());
                    } else if (type4.indexOf(symbol) !== -1) { // @<symbol> { value1 } value2
                        symbolData = [];    
                        items = line.split('}').map(item => item.trim());
                        symbolData.push(items[0].substr(1).trim()); // remove {
                        symbolData.push(items[1] || '');                        
                    } else if (type5.indexOf(symbol) !== -1) { // @<symbol> { value1 } value2 - value3
                        symbolData = [];
                        items = line.split('}').map(item => item.trim());
                        symbolData.push(items[0].substr(1).trim()); // remove {
                        items = (items[1] || '').split('-').map(item => item.trim());
                        symbolData.push(items[0] || '');
                        symbolData.push(items[1] || '');  
                    } else if (type6.indexOf(symbol) !== -1) { // @<symbol> value1 - value2
                        symbolData = [];
                        items = line.split('-').map(item => item.trim());
                        symbolData.push(items[0] || '');
                        symbolData.push(items[1] || '');
                    } else if (type7.indexOf(symbol) !== -1) { // @<symbol> \n multi-line value
                        idx = i;
                        symbolData = '';
                        while(true) {
                            idx++;
                            line = lines[idx].trim();
                            if (line !== '*/' && !line.startsWith('* @')) {
                                line = line.substr(1).trim(); // remove *
                                symbolData += line + '\n';
                            } else {
                                i = idx - 1;
                                break;
                            }
                        }
                    } else {
                        isIgnore = true;
                        // unsupported symbol - ignore (don't throw)
                    }

                    // store symbol data
                    if (!isIgnore) {
                        if (multiInstance.indexOf(symbol) !== -1) { // multiple instances
                            if (!symbols[symbol]) { symbols[symbol] = []; }
                            symbols[symbol].push(symbolData);
                        } else { // single instance
                            symbols[symbol] = symbolData;
                        }
                    }
                }
            }
        }

        // return
        if (!isIgnoreBlock) { return symbols; }
        return null;
    };

    // annotation processor
    docs.annotations.Annotation = function(symbols, type, name, typeOfType) {
        // All Known Symbols
        /** 
         * @type | @component | @func <name> - <desc> | @prop {<type>} name - <desc> | @event <name> - <desc>
         * @construct | @noconstruct
         * @desc <desc>                                             
         * @public | @private | @privateSet | @protected | @protectedSet | @internal  
         * @abstract | @virtual | @override | @sealed                           
         * @overload                                                           
         * @static                                                              
         * @async | @generator  
         * @readonly                                                           
         * @extends <class-type>                                    
         * @mixes <mixin-type>, <mixin-type>, ...                   
         * @implements <interface-type>, <interface-type>, ...      
         * @param {<type>} <name> - <desc>                                      
         * @returns {<type>} <desc> | @yields {<type>} <desc>    
         * @throws {<type>} <desc> 
         * @optional        
         * @conditional <cond1>, <cond2>, ... 
         * @deprecated <desc>                                       
         * @restricted <desc>                                       
         * @since <version>                                         
         * @remarks                                                 
         *      <multi-line markdown format desc>
         * @exmple                                                  
         *      <multi-line markdown format text and embedded code>
         * @seealso {<link>} <name> - <desc>                        
         * @back {<link>} <name> - <desc>                        
         * @next {<link>} <name> - <desc>                        
        */  
       
        // common
        let ano = {
            name: '',
            desc: '',
            type: '',
            scope: 'public',
            optional: false,
            isMember: false,
            static: false,
            modifiers: [],
            conditional: [],
            deprecated: '',
            restricted: '',
            since: '',
            remarks: '',
            example: '',
            seealso: [], // [ { link, name, desc } ]
            back: null, // { link, name, desc }
            next: null // { link, name, desc }
        },
        allowedScopes = [];

        // extended
        switch (type) {
            case 'type':
                /** 
                 * @type
                 * @desc <desc>                                             
                 * @public
                 * @abstract | @sealed                           
                 * @static                                                              
                 * @extends <class-type>                                    
                 * @mixes <mixin-type>, <mixin-type>, ...                   
                 * @implements <interface-type>, <interface-type>, ...      
                 * @deprecated <desc>                                       
                 * @restricted <desc>                                       
                 * @since <version>                                         
                 * @remarks                                                 
                 *      <multi-line markdown format desc>
                 * @exmple                                                  
                 *      <multi-line markdown format text and embedded code>
                 * @seealso {<link>} <name> - <desc>  
                 * @back {<link>} <name> - <desc>                        
                 * @next {<link>} <name> - <desc>                        
                */                
                // add
                ano.isType = true;
                ano.isClass = false;
                ano.isInterface = false;
                ano.isMixin = false;
                ano.isStruct = false;
                ano.isEnum = false;
                ano.justName = '';
                ano.ns = '';
                ano.extends = '';
                ano.mixes = [];
                ano.implements = [];

                // remove
                delete ano.isMember;
                delete ano.optional;
                delete ano.conditional;

                // type
                switch(typeOfType) {
                    case 'class': ano.type = 'Class'; ano.isClass = true; break;
                    case 'interface': ano.type = 'Interface'; ano.isInterface = true; break;
                    case 'mixin': ano.type = 'Mixin'; ano.isMixin = true; break;
                    case 'struct': ano.type = 'Structure'; ano.isStruct = true; break;
                    case 'enum': ano.type = 'Enum'; ano.isEnum = true; break;
                    default: throw `Unknown type definition. ${typeOfType}`;
                }   
                
                // name, desc
                ano.name = name;
                ano.desc = symbols['desc'] || '';

                // scope
                allowedScopes = ['public']; // till the time more scopes are supported for types

                // modifiers
                if (!symbols['static']) {
                    if (symbols['abstract']) {
                        ano.modifiers.push('abstract');
                    } else if (symbols['sealed']) {
                        ano.modifiers.push('sealed');
                    }
                }                

                // extends, mixes, implements
                ano.extends = symbols['extends'] || '';
                ano.mixes = symbols['mixes'] || [];
                ano.implements = symbols['implements'] || [];

                break;
            case 'component':
                /** 
                 * @component
                 * @construct | @noconstruct
                 * @desc <desc>                                             
                 * @public | @internal  
                 * @async | @generator  
                 * @param {<type>} <name> - <desc>                                      
                 * @returns {<type>} <desc> | @yields {<type>} <desc>    
                 * @throws {<type>} <desc> 
                 * @deprecated <desc>                                       
                 * @restricted <desc>                                       
                 * @since <version>                                         
                 * @remarks                                                 
                 *      <multi-line markdown format desc>
                 * @exmple                                                  
                 *      <multi-line markdown format text and embedded code>
                 * @seealso {<link>} <name> - <desc>   
                 * @back {<link>} <name> - <desc>                        
                 * @next {<link>} <name> - <desc>                        
                */                  
                // add
                ano.isComponent = true;
                ano.isConstructible = false;
                ano.isNonConstructible = false;
                ano.isObject = false;

                // type
                // a component can be of following types:
                // 1. constructible (constructible intent and possibility): function(){}
                // 2. Function (Non-constructible intent or possibility): function(){}, function()* {} or ()=>{} 
                // 3. Object: (any object)
                // 
                // this is identified by the presence of either @construct or @noconstruct or absence of both
                if (symbols['construct']) {
                    ano.type = 'Constructible';
                    ano.isConstructible = true;
                } else if (symbols['noconstruct']) {
                    ano.type = 'Function';
                    ano.isNonConstructible = true;
                } else {
                    ano.type = 'Object';
                    ano.isObject = true;
                }

                // name, desc
                ano.name = name;
                ano.desc = symbols['desc'] || '';

                // scope
                allowedScopes = ['public', 'internal'];

                if (ano.isConstructible || ano.isNonConstructible) {
                    ano.overload = false;
                    ano.overloadId = '';
                    ano.params = []; // [ { type, name, desc } ]
                    ano.signature = '';
                    ano.throws = []; // [ { type, desc } ]
                        
                    if (ano.isNonConstructible) {
                        ano.async = false;
                        ano.generator = false;
                        ano.returns = {
                            type: '',
                            desc: ''
                        };
                        ano.yields = {
                            type: '',
                            desc: ''
                        };
                    }
                }

                break;
            case 'prop':
                /** 
                 * @prop {<type>} name - <desc>
                 * @desc <desc>                                             
                 * @public | @private | @privateSet | @protected | @protectedSet
                 * @abstract | @virtual | @override | @sealed                           
                 * @static                                                              
                 * @readonly                                                           
                 * @optional
                 * @conditional <cond1>, <cond2>, ... 
                 * @deprecated <desc>                                       
                 * @restricted <desc>                                       
                 * @since <version>                                         
                 * @remarks                                                 
                 *      <multi-line markdown format desc>
                 * @exmple                                                  
                 *      <multi-line markdown format text and embedded code>
                 * @seealso {<link>} <name> - <desc>                        
                */                  
                // add
                ano.isProperty = true;

                // remove
                delete ano.back;
                delete ano.next;

                // type, name, desc
                ano.type = symbols['prop'][0] || 'object';
                ano.name = symbols['prop'][1]; if(!ano.name) { throw `Document block must carry prop name at @prop symbol.`; }
                ano.desc = symbols['prop'][2] || '';

                // scope
                allowedScopes = ['public', 'protected', 'private', 'protectedSet', 'privateSet'];

                // modifiers
                if (!symbols['static']) {
                    if (symbols['abstract']) {
                        ano.modifiers.push('abstract');
                    } else if (symbols['virtual']) {
                        ano.modifiers.push('virtual');
                    } else if (symbols['override']) {
                        ano.modifiers.push('override');
                        if (symbols['sealed']) { ano.modifiers.push('sealed'); }
                    }
                }
                if (symbols['readonly']) { ano.modifiers.push('readonly'); }

                break;            
            case 'func':
                /** 
                 * @func <name> - <desc>
                 * @desc <desc>                                             
                 * @public | @private | @protected
                 * @abstract | @virtual | @override | @sealed                           
                 * @overload                                                           
                 * @static                                                              
                 * @async | @generator  
                 * @param {<type>} <name> - <desc>                                      
                 * @returns {<type>} <desc> | @yields {<type>} <desc>    
                 * @throws {<type>} <desc> 
                 * @optional        
                 * @conditional <cond1>, <cond2>, ... 
                 * @deprecated <desc>                                       
                 * @restricted <desc>                                       
                 * @since <version>                                         
                 * @remarks                                                 
                 *      <multi-line markdown format desc>
                 * @exmple                                                  
                 *      <multi-line markdown format text and embedded code>
                 * @seealso {<link>} <name> - <desc>                        
                */                  
                // add
                ano.isMethod = true;
                ano.isConstructible = false;
                ano.isDestructor = false;
                ano.overload = false;
                ano.overloadId = '';
                ano.async = false;
                ano.params = []; // [ { type, name, desc } ]
                ano.signature = '';
                ano.generator = false;
                ano.returns = {
                    type: '',
                    desc: ''
                };
                ano.yields = {
                    type: '',
                    desc: ''
                };
                ano.throws = []; // [ { type, desc } ]

                 // remove
                delete ano.type;
                delete ano.back;
                delete ano.next;

                // name, desc, constructor, destructor
                ano.name = symbols['func'][0]; if(!ano.name) { throw `Document block must carry func name at @func symbol.`; }
                ano.desc = symbols['func'][1] || '';
                if (ano.name === 'construct') { ano.isConstructor = true; }
                if (ano.name === 'dispose') { ano.isDestructor = true; }

                // scope
                allowedScopes = ['public', 'protected', 'private'];

                // modifiers
                if (!symbols['static']) {
                    if (symbols['abstract']) {
                        ano.modifiers.push('abstract');
                    } else if (symbols['virtual']) {
                        ano.modifiers.push('virtual');
                    } else if (symbols['override']) {
                        ano.modifiers.push('override');
                        if (symbols['sealed']) { ano.modifiers.push('sealed'); }
                    }
                }

                break;
            case 'event':
                /** 
                 * @event <name> - <desc>
                 * @desc <desc>                                             
                 * @public | @private | @protected  
                 * @abstract | @virtual | @override | @sealed                           
                 * @static                                                              
                 * @param {<type>} <name> - <desc>                                      
                 * @optional        
                 * @conditional <cond1>, <cond2>, ... 
                 * @deprecated <desc>                                       
                 * @restricted <desc>                                       
                 * @since <version>                                         
                 * @remarks                                                 
                 *      <multi-line markdown format desc>
                 * @exmple                                                  
                 *      <multi-line markdown format text and embedded code>
                 * @seealso {<link>} <name> - <desc>                        
                */  
                // add
                ano.isEvent = true;
                ano.params = []; // [ { type, name, desc } ]
                ano.signature = '';

                // remove
                delete ano.type;
                delete ano.static;
                delete ano.back;
                delete ano.next;

                // name, desc
                ano.name = symbols['event'][0]; if(!ano.name) { throw `Document block must carry event name at @event symbol.`; }
                ano.desc = symbols['event'][1] || '';
                
                // scope
                allowedScopes = ['public', 'protected', 'private'];

                // modifiers
                if (symbols['abstract']) {
                    ano.modifiers.push('abstract');
                } else if (symbols['virtual']) {
                    ano.modifiers.push('virtual');
                } else if (symbols['override']) {
                    ano.modifiers.push('override');
                    if (symbols['sealed']) { ano.modifiers.push('sealed'); }
                }                  

                break;
        }

        // static
        if (typeof ano.static !== 'undefined') { ano.static = symbols['static'] ? true : false; }

        // scope
        ano.scope = symbols['public'] || '';
        if (allowedScopes.indexOf(ano.scope) === -1) { ano.scope = 'public'; }
        if (ano.scope === 'protectedSet') { ano.scope = 'public (get), protected (set))'; }
        if (ano.scope === 'privateSet') { ano.scope = 'public (get), private (set))'; }

        // ns, justName
        if (typeof ano.ns !== 'undefined') {
            let items = ano.name.split('.');
            if (items.length === 1) {
                ano.ns = '(root)';
                ano.justName = name;
            } else {
                ano.justName = items.splice(items.length - 1, 1)[0];
                ano.ns = items.join('.');
            }
        }

        // params
        if (typeof ano.params !== 'undefined') {
            let _params = symbols['param'] || [],
                p = null;
            for(let _p of _params) { // [ [type, name, desc] ]
                p = { type: _p[0], name: _p[1], desc: _p[2]};
                if (!p.type) { throw `Param type must be defined at @param symbol. (${ano.name})`; }
                if (!p.name) { throw `Param name must be defined at @param symbol. (${ano.name})`; }
                ano.params.push(p);
            }
        }

        // signature
        let signatureTypesList = '';
        if (typeof ano.signature !== 'undefined') {        
            if (ano.params && ano.params.length > 0) {
                for(let p of ano.params) {
                    if (signatureTypesList) { signatureTypesList += ', '; }
                    signatureTypesList += p.type;
                }
                ano.signature = `${ano.name}(${signatureTypesList})`;
            } else {
                ano.signature = `${ano.name}()`;
            }
        }

        // overload
        if (typeof ano.overload !== 'undefined') {    
            ano.overload = symbols['overload'] ? true : false;
            if (ano.overload) { ano.overloadId = signatureTypesList.split(', ').join('-'); }
        }

        // async, generator
        if (typeof ano.async !== 'undefined') {    
            ano.async = symbols['async'] ? true : false;
            if (!ano.async) {
                ano.generator = symbols['generator'] ? true : false;
            }
        }

        // update modifiers to have one sequence of all modifiers
        // 1: static
        // 2: <scope>
        // 3: async, generator
        // 4: everything else
        if(ano.generator) { ano.modifiers.unshift('generator'); }
        if(ano.async) { ano.modifiers.unshift('async'); }
        ano.modifiers.unshift(ano.scope);
        if(ano.static) { ano.modifiers.unshift('static'); }

        // returns
        if (typeof ano.returns !== 'undefined') {
            if (symbols['returns']) { 
                ano.returns = {
                    type: symbols['returns'][0],
                    desc: symbols['returns'][1]  || ''
                };
                if (!ano.returns.type) { throw `Document block must carry return type at @returns symbol or omit the @returns symbol, if there is no return value. (${ano.name})`; }
            } else {
                ano.returns = {
                    type: 'void',
                    desc: ''
                };         
            }
        }

        // yields
        if (typeof ano.generator !== 'undefined') {
            if (ano.generator) {
                ano.returns = {
                    type: 'Generator',
                    desc: ''                
                };
                if (!symbols['yields']) { throw `Document block must carry @yields symbol for a generator function. (${ano.name})`; }
                ano.yields = {
                    type: symbols['yields'][0],
                    desc: symbols['yields'][1] || ''
                };
                if (!ano.yields.type) { throw `Document block must carry yield type at @yields symbol. (${ano.name})`; }
            } else {
                ano.yields = null;
            }
        }

        // throws
        if (typeof ano.throws !== 'undefined') { 
            let _throws = symbols['throws'] || [], // { type, desc }
                e = null;
            if (_throws.length > 0) {
                for(let _e of _throws) { // [ [type, desc] ]
                    e = { type: _e[0], desc: _e[1] || ''};
                    if (!e.type) { throw `Exception type must be defined at @throws symbol. (${ano.name})`; }
                    ano.throws.push(e);
                }
            }
        }

        // optional, conditional
        if (typeof ano.optional !== 'undefined') { ano.optional = symbols['optional'] ? true : false; }   
        if (typeof ano.conditional !== 'undefined') { ano.conditional = symbols['conditional'] || []; }

        // since, deprecated, restricted
        ano.deprecated = symbols['deprecated'] || '';
        ano.restricted = symbols['restricted'] || '';
        ano.since = symbols['since'] || '';

        // remarks, example
        ano.remarks = symbols['remarks'] || '';
        ano.example = symbols['example'] || '';

        // seealso
        let _seealso = symbols['seealso'] || [],
            s = null;
        for(let _s of _seealso) { // [ [link, name, desc] ]
            s = { link: _s[0], name: _s[1], desc: _s[2] || ''};
            if (!s.link) { throw `Seealso link must be defined at @seealso symbol. (${ano.name})`; }
            if (!s.name) { throw `Seealso name must be defined at @seealso symbol. (${ano.name})`; }
            ano.seealso.push(s);
        }

        // back, next
        if (typeof ano.back !== 'undefined') {
            let _back = symbols['back'] || [];
            if (_back.length > 0) { // [link, name, desc]
                ano.back = {
                    link: _back[0],
                    name: _back[1],
                    desc: _back[2] || ''
                };
                if (!ano.back.link) { throw `Back link must be defined at @back symbol. (${ano.name})`; }
                if (!ano.back.name) { throw `Back name must be defined at @back symbol. (${ano.name})`; }
            }
        }
        if (typeof ano.next !== 'undefined') {
            let _next = symbols['next'] || [];
            if (_next.length > 0) { // [link, name, desc]
                ano.next = {
                    link: _next[0],
                    name: _next[1],
                    desc: _next[2]
                };
                if (!ano.next.link) { throw `Next link must be defined at @next symbol. (${ano.name})`; }
                if (!ano.next.name) { throw `Next name must be defined at @next symbol. (${ano.name})`; }
            }
        }

        return ano;
    };
    docs.annotations.createFromSymbols = (symbols, name, type) => {
        let annotation = null;
        if (symbols['type']) {
            annotation = docs.annotations.Annotation(symbols, 'type', name, type);
        } else if (symbols['component']) {
            annotation = docs.annotations.Annotation(symbols, 'component', name);
        } else if (symbols['prop']) {
            annotation = docs.annotations.Annotation(symbols, 'prop');
        } else if (symbols['func']) {
            annotation = docs.annotations.Annotation(symbols, 'func');
        } else if (symbols['event']) {
            annotation = docs.annotations.Annotation(symbols, 'event');
        } else {
            // ignore the block
            // this is an alternate way of defining the @ignore, otherwise on a known block type
        }

        // return
        return annotation;
    };
    docs.annotations.getAll = (content, name, type) => {
        let blocks = docs.jsdocs.extractBlocks(content),
            mainAnnotation = null,
            memberName = {}, // annotation
            propAnnotations = [], // [name]
            methodAnnotations = [], // [name]
            eventAnnotations = [], // [name]
            symbols = [],
            a = null,
            annotations = {
                main: null,
                members: 0,
                constructors: [],
                destructors: [],                    
                properties: [],
                methods: [],
                events: []
            };
        for(let block of blocks) { // process each block
            symbols = docs.jsdocs.extractSymbols(block);
            a = docs.annotations.createFromSymbols(symbols, name, type);
            if (a) {
                if (a.isType) { // type
                    if (mainAnnotation) { throw `Only one block can have @type/@component symbol. (${a.name})`; }
                    mainAnnotation = a;
                } else if (a.isComponent) { // component
                    if (mainAnnotation) { throw `Only one block can have @type/@component symbol. (${a.name})`; }
                    mainAnnotation = a;
                } else if (a.isProperty) { // member: property
                    if (memberName[a.name]) { throw `Only one definition can exisit for a member. (${a.name})`; }
                    memberName[a.name] = a; 
                    propAnnotations.push(a.name);
                } else if (a.isMethod) { // member: method
                    if (methodAnnotations.indexOf(a.name) !== -1) { 
                        if(!a.overload) {
                            throw `Only one definition can exisit for a method unless defined as an overload. (${a.name})`; 
                        } else {
                            memberName[a.name].push(a);
                        }
                    } else {
                        if (memberName[a.name]) { throw `Only one definition can exisit for a member (unless its an overload method). (${a.name})`; }
                        memberName[a.name] = [a];
                        methodAnnotations.push(a.name);
                    }
                } else if (a.isEvent) { // member: event
                    if (memberName[a.name]) { throw `Only one definition can exisit for a member. (${a.name})`; }
                    memberName[a.name] = a;
                    eventAnnotations.push(a.name);
                }
            }
        }
        if (mainAnnotation) { 
            // define render ready annotations structure
            // type
            annotations.type = mainAnnotation.isType ? mainAnnotation : null;

            // component
            annotations.component = mainAnnotation.isComponent ? mainAnnotation : null;          

            // properties
            propAnnotations.sort(); // sort by name
            for(let propName of propAnnotations) {
                annotations.properties.push(memberName[propName]);
            }

            // methods
            methodAnnotations.sort(); // sort by name
            for(let methodName of methodAnnotations) {
                if (methodName === 'construct') { // constructor
                    annotations.constructors.push(...memberName[methodName]);
                } else if (methodName === 'dispose') { // destructor
                    annotations.destructors.push(...memberName[methodName]);
                } else { // others
                    annotations.methods.push(...memberName[methodName]);
                }
            }

            // sort by signature as there may be overloads
            if (annotations.constructors.length > 1) {
                annotations.constructors.sort((a, b) => (a.signature > b.signature) ? 1 : -1)
            }
            if (annotations.destructors.length > 1) {
                annotations.destructors.sort((a, b) => (a.signature > b.signature) ? 1 : -1)
            }           
            if (annotations.methods.length > 1) {
                annotations.methods.sort((a, b) => (a.signature > b.signature) ? 1 : -1)
            }                    

            // events
            eventAnnotations.sort(); // sort by name
            for(let eventName of eventAnnotations) {
                annotations.events.push(memberName[eventName]);
            }

            // members count
            annotations.members = annotations.constructors.length + annotations.properties.length + annotations.methods.length + annotations.events.length + annotations.destructors.length;
        } else {
            throw `At least one block must contain @type/@component symbol. ${name}`;
        }

        return annotations;
    };

    // links rendering
    docs.render.link.getIdOfName = (name, ...prefix) => {
        return prefix.join('-') + '-' + replaceAll(name, '.', '-');
    };
    docs.render.link.getFileOfName = (name, ...prefix) => {
        return docs.render.link.getIdOfName(name, ...prefix) + '.md';
    };
    docs.render.link.sectionEntry = (type) => {
        let link = '',
            isLocal = options.docsConfig.oneDoc;
        switch(type) {
            case 'components': link = '[Components]' + (isLocal ? '(#components)' : '(./components.md)'); break;
            case 'namespaces': link = '[Namespaces]' + (isLocal ? '(#namespaces)' : '(./namespaces.md)'); break;
            case 'types': link = '[Types]' + (isLocal ? '(#types)' : '(./types.md)'); break;
            case 'resources': link = '[Resources]' + (isLocal ? '(#resources)' : '(./resources.md)'); break;
            case 'assets': link = '[Assets]' + (isLocal ? '(#assets)' : '(./assets.md)'); break;
            case 'routes': link = '[Routes]' + (isLocal ? '(#routes)' : '(./routes.md)'); break;
        }
        return link;
    };
    docs.render.link.sectionHeader = (type) => {
        let link = '',
            isLocal = options.docsConfig.oneDoc;
        switch(type) {
            case 'components': link = isLocal ? '[Components](#section-header)' : 'Components'; break;
            case 'namespaces': link = isLocal ? '[Namespaces](#section-header)' : 'Namespaces'; break;
            case 'types': link = isLocal ? '[Types](#section-header)' : 'Types'; break;
            case 'resources': link = isLocal ? '[Resources](#section-header)' : 'Resources'; break;
            case 'assets': link = isLocal ? '[Assets](#section-header)' : 'Assets'; break;
            case 'routes': link = isLocal ? '[Routes](#section-header)' : 'Routes'; break;
        }
        return link;                    
    };
    docs.render.link.itemEntry = (name, type) => {
        let link = '',
            itemId = '',
            isLocal = options.docsConfig.oneDoc;
            
        itemId = (isLocal ? '#' + docs.render.link.getIdOfName(name, type) : './' + docs.render.link.getFileOfName(name, type));
        link = `<a href="${itemId}">${name}</a>`;
        
        return link;
    };
    docs.render.link.itemHeader = (name, type) => {
        let link = '',
            backLink = '',
            isLocal = options.docsConfig.oneDoc;

        switch(type) {
            case 'component': backLink = (isLocal ? '#components' : './components.md'); break;
            case 'type': backLink = (isLocal ? '#types' : './types.md'); break;
        }
        link = `<h3 id="${docs.render.link.getIdOfName(name, type)}"><a href="${backLink}">${name}</a></h3>`;

        return link;
    };
    docs.render.link.itemList = (items, type) => {
        let list = '',
            i = -1;

        if (items.length > 0) {
            for(let item of items) {
                i++;
                if (i > 0) { list += ', '; }
                list += docs.render.link.itemEntry(item, type);
            }  
        }

        return list;
    };
    docs.render.link.item = (item, prefix, suffix, isSkipDesc) => {
        let link = '';

        // item = { link, name, desc }
        // links can be:
        //  #something
        //  ./something
        //  https:// something
        //  http:// something
        //  T:something      <-- this means link to a type,
        //  C:something      <-- this means link to a component
        if (item.link.startsWith('T:')) {
            link = docs.render.link.itemEntry(item.link.replace('T:', ''), 'type');
        } else if (item.link.startsWith('C:')) {
            link = docs.render.link.itemEntry(item.link.replace('C:', ''), 'component');
        } else {
            link = `<a href="${item.link}">${prefix || ''} ${item.name} ${suffix || ''}</a>`;
        }
        link = `${link} ${isSkipDesc ? '' : '&nbsp;' + item.desc}`;

        return link;
    };
    docs.render.link.getLinkInfoOfMember = (member, parent, parentType) => {
        let link = '',
            id = '',
            name = '',
            parentName = docs.render.link.getIdOfName(parent.name, parentType);
        
        if (member.isMethod) {
            if (member.overload) {
                id = docs.render.link.getIdOfName(member.name, parentName, 'method', member.overloadId);
            } else {
                id = docs.render.link.getIdOfName(member.name, parentName, 'method');
            }
            name = member.signature;
        } else if (member.isProperty) {
            id = docs.render.link.getIdOfName(member.name, parentName, 'property');
            name = member.name;
        } else if (member.isEvent) {
            id = docs.render.link.getIdOfName(member.name, parentName, 'event');
            name = member.name;
        }

        return {
            id: id,
            name: name
        };
    };
    docs.render.link.memberEntry = (member, parent, parentType) => {
        let link = '',
            linkInfo = docs.render.link.getLinkInfoOfMember(member, parent, parentType);
        
        link = `<a href="#${linkInfo.id}">${linkInfo.name}</a>`;

        return link;
    };
    docs.render.link.memberHeader = (member, backLink) => {
        let link = '',
            name = '';
        
        if (member.isMethod) {
            name = member.signature;
        } else if (member.isProperty) {
            name = member.name;
        } else if (member.isEvent) {
            name = member.signature;
        }
        link = `<a href="#${backLink}">${name}</a>`;

        return link;
    };    

    // sections rendering
    docs.render.sections.file_header = () => {
        let section = '';

        // 0: block start
        section += `\n<span name="file_header" id="file-header">\n`;

        // // 1: title
        // title - desc
        // copyright
        section += `<small><small>\n`;
        section += `\n**[${options.packageJSON.title}](${options.packageJSON.link || options.packageJSON.repository.url || '#'})** - ${options.current.ado.desc}\n`;
        section += `</br>Copyright ${options.current.ado.copyright.replace('(C)', '&copy;').replace('(c)', '&copy;')}.\n`;
        if (options.current.ado.license) { section += `Distributed under ${options.current.ado.license}\n`; }
        section += `</small></small>\n`;

        // 2: block end
        section += `\n</span>\n`;
        
        return section;
    };
    docs.render.sections.asm_header = () => {
        let section = '';

        // 0: block start
        section += `\n<span name="asm_header" id="asm-header">\n`;

        // 1: asm info
        // name
        // Version version | lupdate
        // 
        section += '\n';
        if (options.docsConfig.oneDoc) {
            section += `# <u>${options.current.ado.name}</u>\n`;
        } else {
            section += `# <u>[${options.current.ado.name}](../index.md)</u>\n`;
        }
        section += '<small>\n';
        section += `Version ${options.current.ado.version} | ${options.current.ado.lupdate}\n`;
        section += '</small>\n';

        // 2: asm files
        // file (minified, gzipped)
        let jsFile = options.current.asm.replace(options.current.dest + '/', ''),
            minFile = options.current.asm.replace('.js', '.min.js'),
            gzFile = options.current.asm.replace('.js', '.min.js.gz');
        let fileList = `[${jsFile}](./${jsFile})`;
        fileList += ' (' + Math.round(fsx.statSync(options.current.asm).size / 1024) + 'k';
        if (fsx.existsSync(minFile)) {
            fileList += ', ' + Math.round(fsx.statSync(minFile).size / 1024) + `k [minified](${jsFile.replace('.js', '.min.js')})`;
        }
        if (fsx.existsSync(gzFile)) {
            fileList += ', ' + Math.round(fsx.statSync(gzFile).size / 1024) + `k [gzipped](${jsFile.replace('.js', '.min.js.gz')})`;
        }
        fileList += ')';
        section += '</br>\n';
        section += '<small>\n';
        section += `\n${fileList}\n`;
        section += '</small>\n';

        // 3: block end
        section += `\n</span>\n`;
        
        return section;                  
    };
    docs.render.sections.sections_header = () => {
        let section = '',
            prefix = '';

        // 0: block start
        section += `\n<span name="section_header" id="section-header">\n`;
        section += `\n\n`;

        // 1: sections list
        // section || section || section 
        if (options.docsConfig.include.components && options.current.docComponents.length > 0) { 
            section += prefix + docs.render.link.sectionEntry('components'); prefix = ' &nbsp;||&nbsp; ';
        }
        if (options.docsConfig.include.namespaces) { 
            section += prefix + docs.render.link.sectionEntry('namespaces'); prefix = ' &nbsp;||&nbsp; ';
        }
        if (options.docsConfig.include.types && options.current.ado.types.length > 0) { 
            section += prefix + docs.render.link.sectionEntry('types'); prefix = ' &nbsp;||&nbsp; ';
        }
        if (options.docsConfig.include.resources && options.current.ado.resources.length > 0) { 
            section += prefix + docs.render.link.sectionEntry('resources'); prefix = ' &nbsp;||&nbsp; ';
        }
        if (options.docsConfig.include.assets && options.current.ado.assets.length > 0) { 
            section += prefix + docs.render.link.sectionEntry('assets'); prefix = ' &nbsp;||&nbsp; ';
        }
        if (options.docsConfig.include.routes && options.current.ado.routes.length > 0) { 
            section += prefix + docs.render.link.sectionEntry('routes'); prefix = ' &nbsp;||&nbsp; ';
        }

        // 2: block end
        section += `\n</span>\n`;

        return section;                  
    };
    docs.render.sections.items = (type) => {
        let section = '',
            ano = null,
            api = '',
            itemsType = '',
            isContinue = false;
        
        switch(type) {
            case 'type': 
                isContinue = options.docsConfig.include.types && options.current.ado.types.length !== 0; 
                itemsType = 'types';
                break;     
            case 'component': 
                isContinue = (options.docsConfig.include.components && options.current.docComponents.length !== 0); 
                itemsType = 'components';
                break;
        }
        if (!isContinue) { return ''; }

        // file header
        if (!options.docsConfig.oneDoc && !options.docsConfig.supressHeaderFooterInGeneratedDocs) {
            section = docs.render.sections.file_header();
            section += docs.render.sections.asm_header();
        }

        // 0: block start
        section += `<span name="asm_${itemsType}" id="asm-${itemsType}">\n`;
        section += '\n&nbsp;\n';

        // 1: title
        // title
        // 
        section += `## ${docs.render.link.sectionHeader(itemsType)}\n`;

        // 2: members list
        //
        // Name | Description
        // ---- | -----------
        // ...  | ...
        const processItems = (title, items, isStatic) => {
            let _api = '';

            // title
            if (title) { section += `**${title}** | &nbsp; \n`; }

            // list
            for (let ano of items) {
                // ano[type] will resolve to ano.type OR ano.component because type is either 'type' or 'component'
                section += `${docs.render.link.itemEntry(ano[type].name, type)} ${(isStatic && ano[type].static ? ' &nbsp; \` static \`': '')} | ${ano[type].desc}\n`;
                
                // api (either append for oneDoc, or create a file for the type)
                _api = docs.render.sections.api(ano, type);
                if (options.docsConfig.oneDoc) {
                    api += _api;
                } else {
                    if (_api) {
                        let _api_section = '';

                        // file header
                        if (!options.docsConfig.oneDoc && !options.docsConfig.supressHeaderFooterInGeneratedDocs) {
                            _api_section = docs.render.sections.file_header();
                            _api_section += docs.render.sections.asm_header();
                        }
    
                        // _api
                        _api_section += _api;
    
                        // file footer
                        if (!options.docsConfig.oneDoc && !options.docsConfig.supressHeaderFooterInGeneratedDocs) {
                            _api_section += docs.render.sections.file_footer();
                        }  
                        docs.createFile(_api_section, docs.render.link.getFileOfName(ano[type].name, type));

                        _api = '';
                    }
                }
            }
        };        
        section += '\n';
        section += `Name | Description\n`;
        section += `:---|:---\n`;
        switch(type) {
            case 'type':
                // get lists to process
                let classes = [],
                    interfacees = [],
                    mixins = [],
                    structs = [],
                    enums = [];
                for(let thisItem of options.current.ado.types) {
                    // get annotations written in code
                    ano = docs.annotations.getAll(options.current.docTypes[thisItem.name], thisItem.name, thisItem.type);
        
                    // sort out in different buckets based on type of the type
                    if (ano.type.isClass) {
                        classes.push(ano);
                    } else if (ano.type.isInterface) {
                        interfacees.push(ano);
                    } else if (ano.type.isMixin) {
                        mixins.push(ano);
                    } else if (ano.type.isStruct) {
                        structs.push(ano);
                    } else if (ano.type.isEnum) {
                        enums.push(ano);
                    }
                }

                // process all items
                if (classes.length > 0) { processItems('Classes', classes, true); }
                if (interfacees.length > 0) { processItems('Interfaces', interfacees); }
                if (mixins.length > 0) { processItems('Mixins', mixins); }
                if (structs.length > 0) { processItems('Structures', structs); }
                if (enums.length > 0) { processItems('Enums', enums); }
                break;
            case 'component':
                // get list to process
                let constructibles = [],
                    nonconstructibles = [],
                    objects = [];
                for(let thisItem of options.current.docComponents) {
                    // get annotations written in code
                    ano = docs.annotations.getAll(thisItem.content, thisItem.name);
                    
                    // sort out in different buckets based on type of the type
                    if (ano.component.isConstructible) {
                        constructibles.push(ano);
                    } else if (ano.component.isNonConstructible) {
                        nonconstructibles.push(ano);
                    } else if (ano.component.isObject) {
                        objects.push(ano);
                    }
                }

                // process all items
                if (constructibles.length > 0) { processItems('Costructibles', constructibles); }
                if (nonconstructibles.length > 0) { processItems('Functions', nonconstructibles); }
                if (objects.length > 0) { processItems('Objects', objects); }
        }
        
        // 3: member details
        if (api) {
            section += '\n\n';
            section += api;
        }

        // 4: block end
        section += `</span>\n`;

        // file footer
        if (!options.docsConfig.oneDoc && !options.docsConfig.supressHeaderFooterInGeneratedDocs) {
            section += docs.render.sections.file_footer();
        }            

        return section;            
    };   
    docs.render.sections.api = (ano, type) => {
        let section = '',
            item = ano[type]; // 'type' or 'component' == ano.type or ano.component

        // 0: block: start
        section += `\n<span name="asm_item_${type}_${item.name}" id="asm-item-${type}-${item.name}">\n</br>\n`;

        // 1: back, next link (only when multiple docs)
        // ` <- back ` &nbsp;&nbsp; ` next -> `
        if (!options.docsConfig.oneDoc) {
            if (item.back) { section += `${docs.render.link.item(item.back, '&larr;', '', true)}`; }
            if (item.back && item.next) { section += `&nbsp; || &nbsp;`; }
            if (item.next) { section += `${docs.render.link.item(item.next, '', '&rarr;', true)}`; }
            if(item.back || item.next) { section += '\n'; }
        }

        // 2: title
        // <h3 id="{id}">{name}</h3>
        section += `${docs.render.link.itemHeader(item.name, type)}\n`;

        // 3: meta information
        // **type** &nbsp;&nbsp; ` modifier ` ` modifier ` ` ... `
        // _extends_ {type} &nbsp;&nbsp; _mixes_ {type, type, ...} &nbsp;&nbsp; _implements_ {type, type, ...}
        section += '\n';
        section += `**\` ${item.type} \`** &nbsp;&nbsp;`;
        if (item.modifiers.length > 0) { 
            for (let m of item.modifiers) { section += ` \` ${m} \` `; } 
        }
        section += '\n';

        if (item.extends || (item.mixes && item.mixes.length > 0) || (item.implements && item.implements.length > 0)) {
            section += '\n';
            if (item.extends) { section += `_extends_ ${docs.render.link.itemEntry(item.extends)} &nbsp;&nbsp;`; }
            if (item.mixes && item.mixes.length > 0) { section += `_mixes_ ${docs.render.link.itemList(item.mixes, 'type')} &nbsp;&nbsp;`; }
            if (item.implements && item.implements.length > 0) { section += `_implements_ ${docs.render.link.itemList(item.implements, 'type')}`; }
            section += '\n';
        }

        // 4: divider
        // ***
        section += '***\n';

        // 5: desc
        // desc
        // 
        if (item.desc) { 
            section += `_${item.desc}_\n`;
            section += `\n`; 
        }

        // 6: remarks
        // **Remarks**
        // multi-line remarks
        // 
        if (item.remarks) {
            section += '**Remarks**\n';
            section += `\n`; 
            section += `${item.remarks}\n`;
            section += `\n`; 
        }          

        // 7: examples
        // **Examples**
        // multi-line example remarks with possible ```javascript ... ``` blocks
        // 
        if (item.example) {
            section += '**Examples**\n';
            section += `\n`; 
            section += `${item.example}\n`;
            section += `\n`; 
        }

        // 8: parameters
        // **Parameters**
        // * name ` type ` desc
        // * ...
        // 
        if (item.params && item.params.length > 0) {
            section += `**Parameters**\n`;
            section += `\n`;
            for(let p of item.params) { section += `* _${p.name}_ &nbsp; \` ${p.type} \` &nbsp; ${p.desc}\n`; }
            section += `\n`;
        }                

        // 9: returns
        // **Returns**
        // ` type ` &nbsp; desc
        // 
        if (item.returns) {
            section += '**Returns**\n';
            section += `\n`;
            section += `\` ${item.returns.type} \` &nbsp; ${item.returns.desc}\n`;
            section += `\n`;
        }
    
        // 10: yields
        // **Yields**
        // ` type ` &nbsp; desc
        // 
        if (item.generator && item.yields) {
            section += '**Yields**\n';
            section += `\n`;
            section += `\` ${item.yields.type} \` &nbsp; ${item.yields.desc}\n`;
            section += `\n`;                
        }

        // 10: exceptions
        // **Exceptions**
        // * ` type ` &nbsp; desc
        // * ...
        // 
        if(item.throws && item.throws.length > 0) {
            section += `**Exceptions**\n`;
            section += `\n`;
            for(let t of item.throws) { section += `* \` ${t.type} \` &nbsp; ${t.desc}\n`; }
            section += `\n`;
        }

        // 12: members list
        // **Members**
        //
        // Name | Description
        // ---- | -----------
        // ...  | ...
        // 
        let membersSectionId = docs.render.link.getIdOfName(item.name, type, 'members');
        if (ano.members > 0) {
            section += `\n<span id="${membersSectionId}">**Members**</span>\n`;
            section += `\n`;
            section += `Name | Description\n`;
            section += `:---|:---\n`;

            const processMembers = (title, members) => {
                section += `**${title}** | &nbsp; \n`;
                for (let member of members) {
                    section += docs.render.link.memberEntry(member, item, type) + ` | ${member.desc}\n`;
                }
            };
            if (ano.constructors.length > 0) { processMembers('Constructors', ano.constructors); }
            if (ano.properties.length > 0) { processMembers('Properties', ano.properties); }
            if (ano.methods.length > 0) { processMembers('Methods', ano.methods); }
            if (ano.events.length > 0) { processMembers('Events', ano.events); }
            if (ano.destructors.length > 0) { processMembers('Destructors', ano.destructors); }
            section += `\n`; 
        }        

        // 13: member details
        // **Constructors/Properties/Functions/Events/Destructors**
        // 
        // [
        // **member**
        // > ` modifier ` ` modifier ` ` ... `
        // > 
        // > ` type ` &nbsp; desc
        // >   
        // > **Parameters**
        // > * name ` type ` desc
        // > * ...
        // >
        // > **Returns**
        // > ` type ` &nbsp; desc
        // >
        // > **Yields**
        // > ` type ` &nbsp; desc
        // >
        // > **Exceptions**
        // > * ` type ` &nbsp; desc
        // > * ...
        // > 
        // > **Remarks**
        // > remarks
        // >
        // > **Examples**
        // > example
        // > 
        // > **Additional Information**
        // > * _Since:_ version
        // > * _Deprecated:_ desc
        // > * _Restricted:_ desc 
        // > * _Optional:_ desc
        // > * _Conditional:_ desc
        // > 
        // > **See Also**
        // > * name - desc
        // > ..
        // ]
        // 
        if (ano.members > 0) {

            const processMember = (member) => {
                let indentPrefix = (options.docsConfig.oneDoc ? '>' : '');

                // 0: block: start
                let memberId = docs.render.link.getLinkInfoOfMember(member, item, type);
                section += `\n<span name="${memberId.id}" id="${memberId.id}">\n`;

                // 1: title, modifiers
                // title  ' modifier ' ' modifier ' ...
                section += '\n\n';
                section += `**${docs.render.link.memberHeader(member, membersSectionId)}**`;
                if (member.modifiers.length > 0) { 
                    section += `&nbsp;&nbsp;`;
                    for (let m of member.modifiers) { section += ` \` ${m} \` `; } 
                    section += '\n';
                }
                section += '\n\n';

                // 3: desc
                if (member.type || member.desc) {
                    section += `${indentPrefix} `;
                    if (member.type) { section += `\` ${member.type} \` &nbsp;&nbsp;`; }
                    if (member.desc) { section += `${member.desc}`; }
                    section += '\n';
                    section += `${indentPrefix} \n`;
                }

                // 4: parameters
                if (member.params && member.params.length > 0) {
                    section += `${indentPrefix} **Parameters**\n`;
                    section += `${indentPrefix} \n`;
                    for(let p of member.params) { section += `${indentPrefix} * _${p.name}_ &nbsp; \` ${p.type} \` &nbsp; ${p.desc}\n`; }
                    section += `${indentPrefix} \n`;
                }                

                // 5: returns
                if (member.returns) {
                    section += `${indentPrefix} **Returns**\n`;
                    section += `${indentPrefix} \n`;
                    section += `${indentPrefix} \` ${member.returns.type} \` &nbsp; ${member.returns.desc}\n`;
                    section += `${indentPrefix} \n`;
                }
            
                // 6: yields
                if (member.generator && member.yields) {
                    section += `${indentPrefix} **Yields**\n`;
                    section += `${indentPrefix} \n`;
                    section += `${indentPrefix} \` ${member.yields.type} \` &nbsp; ${member.yields.desc}\n`;
                    section += `${indentPrefix} \n`;                
                }

                // 7: exceptions
                if(member.throws && member.throws.length > 0) {
                    section += `${indentPrefix} **Exceptions**\n`;
                    section += `${indentPrefix} \n`;
                    for(let t of member.throws) { section += `${indentPrefix} * \` ${t.type} \` &nbsp; ${t.desc}\n`; }
                    section += `${indentPrefix} \n`;
                }

                // 8: remarks
                if (member.remarks) {
                    section += `${indentPrefix} **Remarks**\n`;
                    section += `${indentPrefix} \n`;
                    section += `${indentPrefix} ` + replaceAll(member.remarks, '\n', `\n${indentPrefix} `);
                    section += `${indentPrefix} \n`;
                }  

                // 9: examples
                if (member.example) {
                    section += `${indentPrefix} **Examples**\n`;
                    section += `${indentPrefix} \n`;
                    section += `${indentPrefix} ` + replaceAll(member.example, '\n', `\n${indentPrefix} `);
                    section += `${indentPrefix} \n`;
                }  

                // 10: additional informaiton
                if (member.since || member.deprecated || member.restricted || member.optional || member.conditional) {
                    section += `${indentPrefix} **Additional Information**\n`;
                    if (member.since) { section += `${indentPrefix} * _Since:_ ${member.since}\n`; }
                    if (member.deprecated) { section += `${indentPrefix} * _Deprecated:_ ${member.deprecated}\n`; }
                    if (member.restricted) { section += `${indentPrefix} * _Restricted:_ ${member.restricted}\n`; }
                    if (member.optional) { section += `${indentPrefix} * _Optional:_ This member is marked as optional and its absence will not fail any interface compliance check.\n`; }
                    if (member.conditional && member.conditional.length > 0) { section += `${indentPrefix} * _Conditional:_ This member is marked as conditional and will be present only when all of the following environmental conditions are met: **${member.conditional.join(', ')}**\n`; }
                    section += `${indentPrefix} \n`;
                }
                
                // 11: see also
                if (member.seealso.length > 0) {
                    section += `${indentPrefix} **See Also**\n`;
                    for(let s of member.seealso) { section += `${indentPrefix} * ${docs.render.link.item(s)}\n`; }
                    section += `${indentPrefix} \n`;
                }
    
                // 12: space
                section += `${indentPrefix} &nbsp;\n`;

                // 13: block: end
                section += `\n</span>\n`;
            };
            const processMembers = (title, members) => {
                section += `<u>**${title}**</u>\n`;
                section += `\n`;
                for (let member of members) { processMember(member); }
                section += `\n`;
            };
            if (ano.constructors.length > 0) { processMembers('Constructors', ano.constructors); }
            if (ano.properties.length > 0) { processMembers('Properties', ano.properties); }
            if (ano.methods.length > 0) { processMembers('Methods', ano.methods); }
            if (ano.events.length > 0) { processMembers('Events', ano.events); }
            if (ano.destructors.length > 0) { processMembers('Destructors', ano.destructors); }
            section += `\n`;
        }

        // 14: additional information
        // **Additional Information**
        // * _Since:_ version
        // * _Deprecated:_ desc
        // * _Restricted:_ desc 
        // 
        if (ano.since || ano.deprecated || ano.restricted) {
            section += `**Additional Information**\n`;
            if (ano.since) { section += `* _Since:_ ${ano.since}\n`; }
            if (ano.deprecated) { section += `* _Deprecated:_ ${ano.deprecated}\n`; }
            if (ano.restricted) { section += `* _Restricted:_ ${ano.restricted}\n`; }
            section += `\n`;
        }

        // 15: see also
        // **See Also**
        // * Name - Desc
        // * ...
        // 
        if (ano.seealso && ano.seealso.length > 0) {
            section += `**See Also**\n`;
            for(let s of ano.seealso) { section += `* ${docs.render.link.item(s)}\n`; }
            section += `\n`;
        }

        // 16: block: end
        section += '\n</span>\n';

        return section;
    };    
    docs.render.sections.namespaces = () => {
        if (!options.docsConfig.include.namespaces || options.current.ado.ns.length === 0) { return ''; }

        let section = '';

        // file header
        if (!options.docsConfig.oneDoc && !options.docsConfig.supressHeaderFooterInGeneratedDocs) {
            section = docs.render.sections.file_header();
            section += docs.render.sections.asm_header();
        }

        // 0: block start
        section += `<span name="asm_namespaces" id="asm-namespaces">\n`;
        section += '\n&nbsp;\n';

        // 1: title
        // title
        // 
        section += `## ${docs.render.link.sectionHeader('namespaces')}\n`;

        // 2: members list
        //
        // Name | Description
        // ---- | -----------
        // ...  | ...
        section += '\n';
        section += `Name | Description\n`;
        section += `:---|:---\n`;
        for(let item of options.current.ado.ns) {
            section += `${item.name} | ${item.desc}\n`;
        }

        // 3: block end
        section += `</span>\n`;

        // file footer
        if (!options.docsConfig.oneDoc && !options.docsConfig.supressHeaderFooterInGeneratedDocs) {
            section += docs.render.sections.file_footer();
        }            

        return section;
    };
    docs.render.sections.resources = () => {
        if (!options.docsConfig.include.resources || options.current.ado.resources.length === 0) { return ''; }

        let section = '';

        // file header
        if (!options.docsConfig.oneDoc && !options.docsConfig.supressHeaderFooterInGeneratedDocs) {
            section = docs.render.sections.file_header();
            section += docs.render.sections.asm_header();
        }

        // 0: block start
        section += `<span name="asm_resources" id="asm-resources">\n`;
        section += '\n&nbsp;\n';

        // 1: title
        // title
        // 
        section += `## ${docs.render.link.sectionHeader('resources')}\n`;

        // 2: resources list
        //
        // Name | Description
        // ---- | -----------
        // ...  | ...
        let resType = '', 
            resSize = '',
            skipSizes = ['0k', '1k'];
        section += '\n';
        section += `Name | Description\n`;
        section += `:---|:---\n`;
        for(let item of options.current.ado.resources) {
            resType = (item.type ? ` &nbsp; \` ${item.type} \`` : '');
            resSize = (item.size && skipSizes.indexOf(item.size) === -1 ? ` &nbsp; \` ${item.size} \`` : ''); // size is shown only those which are not skipped
            section += `${item.name} ${resType} ${resSize} | ${item.desc}\n`;
        }

        // 3: block end
        section += `</span>\n`;

        // file footer
        if (!options.docsConfig.oneDoc && !options.docsConfig.supressHeaderFooterInGeneratedDocs) {
            section += docs.render.sections.file_footer();
        }    

        return section;
    };   
    docs.render.sections.assets = () => {
        if (!options.docsConfig.include.assets || options.current.ado.assets.length === 0) { return ''; }

        let section = '';

        // file header
        if (!options.docsConfig.oneDoc && !options.docsConfig.supressHeaderFooterInGeneratedDocs) {
            section = docs.render.sections.file_header();
            section += docs.render.sections.asm_header();
        }

        // 0: block start
        section += `<span name="asm_assets" id="asm-assets">\n`;
        section += '\n&nbsp;\n';

        // 1: title
        // title
        // 
        section += `## ${docs.render.link.sectionHeader('assets')}\n`;

        // 2: assets location
        // Assets are located under: path
        let basePath = options.current.asm.replace(options.current.dest + '/', '').replace('.js', ''),
            base = './' + basePath + '/';
        section += `Assets are located under: [${base}](${base})\n`;

        // 3: assets list
        //
        // Name | Description
        // ---- | -----------
        // ...  | ...
        let mainFile = '',
            baseFile = '',
            fileSize = 0,
            fileType = '',
            fileExt = '',
            sizeShowGreaterThan = 5,
            astPath = options.current.asm.replace('.js', '/');
        section += '\n';
        section += `Name | Description\n`;
        section += `:---|:---\n`;
        for(let item of options.current.ado.assets) {
            baseFile = item.file.replace('{.min}', '');
            mainFile = astPath + baseFile;
            fileExt = path.extname(item.file).substr(1);
            fileSize = Math.round(fsx.statSync(mainFile).size / 1024);
            fileSize = (fileSize > sizeShowGreaterThan ? ` &nbsp; \` ${fileSize}k \`` : ''); // only assets >5k are shown size 
            fileType = (item.type === fileExt ? '' : ` &nbsp; \` ${item.type} \``); // file type is shown only where it is a known file type or user defined, which is different from file extension
            section += `[${baseFile}](./${basePath}/${baseFile}) ${fileType} ${fileSize} | ${item.desc}\n`;     
        }

        // 3: block end
        section += `</span>\n`;

        // file footer
        if (!options.docsConfig.oneDoc && !options.docsConfig.supressHeaderFooterInGeneratedDocs) {
            section += docs.render.sections.file_footer();
        }    

        return section;
    };  
    docs.render.sections.routes = () => {
        if (!options.docsConfig.include.routes || options.current.ado.routes.length === 0) { return ''; }

        let section = '';

        // file header
        if (!options.docsConfig.oneDoc && !options.docsConfig.supressHeaderFooterInGeneratedDocs) {
            section = docs.render.sections.file_header();
            section += docs.render.sections.asm_header();
        }

        // 0: block start
        section += `<span name="asm_routes" id="asm-routes">\n`;
        section += '\n&nbsp;\n';

        // 1: title
        // title
        // 
        section += `## ${docs.render.link.sectionHeader('routes')}\n`;

        // 2: routes list
        //
        // Name | Route | Description
        // ---- | ----- | -----------
        // ...  | ...   | ...
        let verbs = '';
        section += '\n';
        section += `Name | Route | Description\n`;
        section += `:---|:---|:---\n`;
        for(let item of options.current.ado.routes) {
            verbs = '';
            for (let v of item.verbs) { verbs += ` \` ${v} \` `; }
            section += `{${item.name} | **{${item.mount}}** ${item.path} &nbsp; ${verbs} | ${item.desc}\n`;
        }
 
        // 3: block end
        section += `</span>\n`;

        // file footer
        if (!options.docsConfig.oneDoc && !options.docsConfig.supressHeaderFooterInGeneratedDocs) {
            section += docs.render.sections.file_footer();
        }    

        return section;
    };                                                              
    docs.render.sections.extra = () => {
        if (!fsx.existsSync(options.current.docx)) { return ''; }

        let section = '';

        // file header
        if (!options.docsConfig.oneDoc && !options.docsConfig.supressHeaderFooterInGeneratedDocs) {
            section = docs.render.sections.file_header();
            section += docs.render.sections.asm_header();
        }

        // 0: block start
        section += `<span name="asm_extra" id="asm-extra">\n`;

        // 1: extra content as is
        section += fsx.readFileSync(options.current.docx, 'utf8');

        // 2: block end
        section += `</span>\n`;

        // file footer
        if (!options.docsConfig.oneDoc && !options.docsConfig.supressHeaderFooterInGeneratedDocs) {
            section += docs.render.sections.file_footer();
        }            

        return section;
    };   
    docs.render.sections.file_footer = () => {
        let section = '';

        // 0: block start
        section += `\n<span name="file_footer" id="file-footer">\n`;

        // 1: thin line break
        section += `\n</br>\n\n##\n\n`;

        // 2: built with
        // Build with engine (version) using name (format version) format.
        section += `<small><small>\n`;
        section += `Built with [${options.current.ado.builder.name}](${options.packageJSON.link}/#/flairBuild) (v${options.current.ado.builder.version}) using [${options.current.ado.builder.format}](${options.packageJSON.link}/#/fasm) (v${options.current.ado.builder.formatVersion}) format.\n`;
        
        // 3: go top link
        // [arrow]
        section += `&nbsp;&nbsp; <a href="#file-header">[&nwarr;]</a>\n`;
        section += `</small></small>\n`;

        // 4: block end
        section += `\n</span>\n`;
        
        return section;
    };

    // file generators
    docs.createFile = (doc, fileName) => {
        if (options.docsConfig.oneDoc) {
            fsx.writeFileSync(options.current.asmDoc, doc.trim(), 'utf8');
            logger(0, 'docs',  options.current.asmDoc); // doc generated
        } else {
            doc = doc.trim();
            if (doc) {
                let docFile = './' + path.join(options.docsConfig.dest, options.current.asmName, fileName);
                fsx.ensureDirSync(path.dirname(docFile));
                fsx.writeFileSync(docFile, doc.trim(), 'utf8');
                logger(1, '', fileName); // doc generated
            }
        }
    };
    docs.copyFiles = () => {
        let docsSrc = './' + path.join(options.current.asmPath, '(docs)'),
            docsDest = './' + path.join(options.docsConfig.dest, options.current.asmName);

        if (fsx.existsSync(docsSrc)) {
            let moreDocs = rrd(docsSrc).filter(file => junk.not(path.basename(file))),
                src = '',
                dest = '', 
                content = '';
            for (let doc of moreDocs) {
                if (doc.indexOf('/_') !== -1) { continue; } // either a folder or file name starts with '_'. skip it
                src = './' + doc;
                dest = './' + path.join(docsDest, doc.replace(docsSrc.replace('./', ''), ''));

                if (options.docsConfig.includeHeaderFooterInBundledDocs) { // header-footer to be added in copied doc
                    content = docs.render.sections.file_header(); 
                    content += fsx.readFileSync(src, 'utf8').trim();
                    content += docs.render.sections.file_footer();
                    fsx.writeFileSync(dest, content, 'utf8');
                } else { // header-footer not be added, copy doc as is
                    fsx.copySync(src, dest, { errorOnExist: false });
                }
                logger(1, '', src);
            }
        }
    };

    // docs generators
    docs.generateOneDoc = () => {
        let doc = '';

        doc += docs.render.sections.file_header();
        doc += docs.render.sections.asm_header();
        doc += docs.render.sections.sections_header();
        doc += docs.render.sections.items('component');
        doc += docs.render.sections.namespaces();
        doc += docs.render.sections.items('type');
        doc += docs.render.sections.resources();
        doc += docs.render.sections.assets();
        doc += docs.render.sections.routes();
        doc += docs.render.sections.extra();
        doc += docs.render.sections.file_footer();

        // write document
        docs.createFile(doc);
    }
    docs.generateMultiDocs = () => {
        let doc = '';
        logger(0, 'docs', options.docsConfig.dest); // starting processing docs
        
        docs.createFile(docs.render.sections.items('component'), 'components.md');
        docs.createFile(docs.render.sections.namespaces(), 'namespaces.md');
        docs.createFile(docs.render.sections.items('type'), 'types.md');
        docs.createFile(docs.render.sections.resources(), 'resources.md');
        docs.createFile(docs.render.sections.assets(), 'assets.md');
        docs.createFile(docs.render.sections.routes(), 'routes.md');
    };
    docs.generateMultiDocsEntry = () => {
        // in multi-docs mode, one folder is created for each assembly - under docs/dest folder
        // folder name is same as assembly name
        // get that list from there and then build assemblies.md and then copy it to main folder
        // on docs dest
        // NOTE: header/footer is not added here, because there is no current assembly, so not 
        // packageJSON to pick data from
        
        let section = '';

        // 0: block start
        section += `<span name="asm_main" id="asm-main">\n`;

        // 1: list of assemblies
        // Name | Members
        // asm1 | Components || Namespaes || Types || ...
        // asm2 | ...
        //
        section += '\n';
        section += `Name | Members\n`;
        section += `:---|:---\n`;        
        let folders = getFolders(options.docsConfig.dest, true),
            sections = '',
            prefix = '',
            sectionFile = '',
            fileLink = '';
        for(let asm of folders) {
            prefix = '';

            // components
            sectionFile = './' + path.join(options.docsConfig.dest, asm, 'components.md');
            if (fsx.existsSync(sectionFile)) { 
                prefix = ', '
                fileLink = './' + path.join(asm, 'components.md');
                sections += `<a href="${fileLink}">Components</a>`; 
            }

            // namespaces
            sectionFile = './' + path.join(options.docsConfig.dest, asm, 'namespaces.md');
            if (fsx.existsSync(sectionFile)) { 
                fileLink = './' + path.join(asm, 'namespaces.md');
                sections += prefix + `<a href="${fileLink}">Namespaces</a>`; 
                prefix = ', '
            }

            // types
            sectionFile = './' + path.join(options.docsConfig.dest, asm, 'types.md');
            if (fsx.existsSync(sectionFile)) { 
                fileLink = './' + path.join(asm, 'types.md');
                sections += prefix + `<a href="${fileLink}">Types</a>`; 
                prefix = ', '
            }            

            // resources
            sectionFile = './' + path.join(options.docsConfig.dest, asm, 'resources.md');
            if (fsx.existsSync(sectionFile)) {
                fileLink = './' + path.join(asm, 'resources.md'); 
                sections += prefix + `<a href="${fileLink}">Resources</a>`; 
                prefix = ', '
            }            

            // assets
            sectionFile = './' + path.join(options.docsConfig.dest, asm, 'assets.md');
            if (fsx.existsSync(sectionFile)) { 
                fileLink = './' + path.join(asm, 'assets.md'); 
                sections += prefix + `<a href="${fileLink}">Assets</a>`; 
                prefix = ', '
            }            

            // routes
            sectionFile = './' + path.join(options.docsConfig.dest, asm, 'routes.md');
            if (fsx.existsSync(sectionFile)) { 
                fileLink = './' + path.join(asm, 'routes.md'); 
                sections += prefix + `<a href="${fileLink}">Routes</a>`; 
                prefix = ', '
            }

            // add
            section += `${asm} | ${sections}\n`;
        }

        // 2: block end
        section += `</span>\n`;

        // write file
        let docsEntryFile = './' + path.join(options.docsConfig.dest, 'index.md');
        fsx.ensureDirSync(path.dirname(docsEntryFile));
        fsx.writeFileSync(docsEntryFile, section, 'utf8');
        logger(0, 'docs-entry',  docsEntryFile); // doc entry file generated
    };

    // main
    docs.build = () => {
        if (options.docsConfig.oneDoc) { 
            docs.generateOneDoc(); // one-document-per-assembly
        } else { 
            docs.generateMultiDocs(); // multi-docs-per-assembly
            docs.copyFiles(); // copy '(docs)' folder of this assembly also, as is
        }
    };
    docs.buildMain = () => {
        if (!options.docsConfig.oneDoc) { 
            docs.generateMultiDocsEntry();
        }
    }

    // #endregion

    // core engine
    const build = async (buildDone) => {
        // lint, minify and gzip
        const lintJS = (file) => {
            return new Promise((resolve, reject) => {
                let lintReport = options.lintJS.executeOnFiles([file]);
                if (lintReport.errorCount > 0 || lintReport.warningCount > 0) {
                    console.log(options.eslintFormatter(lintReport.results)); // eslint-disable-line no-console
                    reject(`Lint for ${file} failed.`); 
                }
                resolve();
            });
        };
        const lintCSS = (file) => { // eslint-disable-line no-unused-vars
            return new Promise((resolve, reject) => { // eslint-disable-line no-unused-vars
                options.lintCSS({
                    files: [file],
                    config: options.lintConfig.css
                }).then((result) => {
                    if (result.errored) { 
                        console.log(result.output); // eslint-disable-line no-console
                        reject(`Lint for ${file} failed.`); 
                    } else {
                        resolve();
                    }
                }).catch(reject);
            });
        };
        const lintHTML = (file) => { 
            return new Promise((resolve, reject) => {
                let content = fsx.readFileSync(file, 'utf8');
                options.lintHTML(content, options.lintConfig.html).then((errors) => {
                    if (errors && errors.length > 0) {
                        // HACK: some rules after being set to false are still showing up in errors,
                        // filter them
                        let finalErrors = [];
                        errors.forEach(item => {
                            let rule = item.rule || item.data.name;
                            if (typeof options.lintConfig.html[rule] !== 'undefined' && options.lintConfig.html[rule] === false) { return; }
                            finalErrors.push(item);
                        });
                        if (finalErrors.length > 0) {
                            console.log(finalErrors); // eslint-disable-line no-console
                            reject(`Lint for ${file} failed.`); 
                        } else {
                            resolve();
                        }
                    } else {
                        resolve();
                    }
                }).catch(reject);
            });
        };
        const minifyJS = (file, mapFile, mapFileUrl) => {
            return new Promise((resolve, reject) => {
                let content = fsx.readFileSync(file, 'utf8');
                if (options.generateJSSourceMap && mapFile) {
                    options.minifyConfig.js.sourceMap = {
                        root: '',
                        url: mapFileUrl
                    };
                }
                let result = options.minifyJS(content, options.minifyConfig.js);
                if (options.generateJSSourceMap && mapFile) {
                    delete options.minifyConfig.js.sourceMap;
                }
                if (result.error) { 
                    console.log(result.error); // eslint-disable-line no-console
                    reject(`Minify for ${file} failed.`); 
                } else {
                    if (options.generateJSSourceMap && mapFile && result.map) {
                        fsx.writeFileSync(mapFile, result.map, 'utf8');
                    }
                    resolve(result.code);
                }
            });
        };
        const minifyCSS = (file) => {
            return new Promise((resolve, reject) => {        
                let content = fsx.readFileSync(file, 'utf8');
                let result = new options.minifyCSS(options.minifyConfig.css).minify(content);
                if (result.errors.length > 0) { 
                    console.log(result.errors); // eslint-disable-line no-console
                    reject(`Minify for ${file} failed.`); 
                } else {
                    resolve(result.styles); 
                }
            });
        };
        const minifyHTML = (file) => {
            return new Promise((resolve, reject) => { // eslint-disable-line no-unused-vars           
                let content = fsx.readFileSync(file, 'utf8');
                let result = options.minifyHTML(content, options.minifyConfig.html);
                resolve(result);
            });
        };
        const lintFile = (src) => {
            return new Promise((resolve, reject) => { 
                // run lint only if either fullBuild OR this file is changed since last build
                if (!options.fullBuild && options.current.asmLupdate) {
                    let srcLupdate = fsx.statSync(src).mtime;
                    if (srcLupdate < options.current.asmLupdate) { resolve(); return; }
                }
    
                let ext = path.extname(src).substr(1);
                if (options.lintTypes.indexOf(ext) !== -1) {
                    switch(ext) {
                        case 'js': lintJS(src).then(resolve).catch(reject); break;
                        case 'css': lintCSS(src).then(resolve).catch(reject); break;
                        case 'html': lintHTML(src).then(resolve).catch(reject); break;
                        default: resolve(); break;
                    }
                } else {
                    resolve();
                }
            });
        };
        const minifyFile = (src) => {
            return new Promise((resolve, reject) => { // eslint-disable-line no-unused-vars
                let ext = path.extname(src).substr(1),
                    dest = src.replace('.' + ext, '.min.' + ext),
                    mapFile = dest + '.map',
                    mapFileUrl = mapFile.replace(options.current.dest, '.');
                if (options.minifyTypes.indexOf(ext) !== -1) {
                    let p = null;
                    switch(ext) {
                        case 'js': p = minifyJS(src, mapFile, mapFileUrl); break;
                        case 'css': p = minifyCSS(src); break;
                        case 'html': p = minifyHTML(src);  break;
                    }
                    if (p === null) {
                        resolve('');
                    } else {
                        p.then((content) => {
                            fsx.writeFileSync(dest, content, 'utf8');
                            resolve(content);
                        }).catch(reject);
                    }
                } else {
                    resolve('');
                }
            });
        };
        const gzipFile = (src) => {
            return new Promise((resolve, reject) => { // eslint-disable-line no-unused-vars
                let content = fsx.readFileSync(src, 'utf8'),
                    ext = path.extname(src).substr(1),
                    dest = src + '.gz';
                if (options.gzipTypes.indexOf(ext) !== -1) {
                    let gzConfig = options.gzipConfig[ext] || options.gzipConfig.all; // pick ext specific configuration or generic (all)
                    fsx.writeFileSync(dest, options.zlib.gzipSync(content, gzConfig));
                }
                resolve();
            });
        };

        // 5: process namespaces
        const processNamespaces = (done) => {
            if (options.current.namespaces.length === 0) { 
                delete options.current.nsName;
                delete options.current.nsPath;
    
                // sort namespace items of types by index, so they are added in right required order
                // since only types have mutual dependency, only types are considered for sorting
                // even if number was added by user on some other type, it is ignored for now
                options.current.ado.types.sort((a, b) => { 
                    if (a.index < b.index) { return -1; }
                    if (a.index > b.index) { return 1; }
                    return 0;
                });

                done(); return; 
            }

            // support functions
            const resolveRootNS = (isAddDot) => {
                let rootNS = ''; // root namespace is always without any name, no matter which assembly
                if (rootNS && isAddDot) { rootNS += '.'; }
                return rootNS;
            };
            const collectNSAssets = (nsaSrc, nsName) => {
                // NOTE: This method should be in sync with collectAssets, as both doing similar things in different context
                // Since info files are already filtered when this method is being called, so they are not being checked here
                let assetsInfo = [],
                    astSrc = nsaSrc,
                    astDest = './' + path.join(options.current.dest, options.current.asmName);
            
                if (fsx.existsSync(astSrc)) {
                    let assets = rrd(astSrc).filter(file => junk.not(path.basename(file)));
                    for (let asset of assets) {
                        if (asset.indexOf('/_') !== -1) { continue; } // either a folder or file name starts with '_'. skip it
                        
                        // asset file info
                        let till_nsa = asset.substr(0, asset.indexOf('/(nsa)/') + 7), // pick from start till where /(nsa)/ ends
                            astFileName = path.basename(asset);

                        let astFile = {
                            ext: path.extname(asset).toLowerCase().substr(1),
                            src: './' + asset,
                            dest: path.join(astDest, asset.replace(till_nsa, '').replace(astFileName, nsName + '.' + astFileName))
                        };
                        if (nsName === '(root)') { // for root namespace, remove this from name
                            astFile.dest = astFile.dest.replace('(root).', '');
                        }
                        assetsInfo.push(astFile);
                    }
                }

                // done
                return assetsInfo;
            };     
            const collectInPlaceNSAsset = (file, destFile, knownTypeFolder) => {
                // NOTE: This structure being pushed to nsAssets array - should be in sync with how it is in collectAssets and collectNSAssets
                // Since info files are already filtered when this method is being called, so they are not being checked here
                let inPlaceAstDest = './' + path.join(options.current.dest, options.current.asmName),
                    nsName = options.current.nsName;

                let astFile = {
                    ext: path.extname(file).toLowerCase().substr(1),
                    src: file,
                    dest: path.join(inPlaceAstDest, knownTypeFolder, nsName + '.' + path.basename(destFile))
                };
                if (nsName === '(root)') { // for root namespace, remove this from name
                    astFile.dest = astFile.dest.replace('(root).', '');
                }
                options.current.nsAssets.push([astFile]);
            };
            const collectTypesAndResourcesAndRoutes = () => {
                let files = rrd(options.current.nsPath).filter(file => junk.not(path.basename(file))),
                    ext = '',
                    processedNSAs = [],
                    till_nsa = '';
                options.current.ado.resourcesAndTypes = [];
                for (let file of files) { 
                    if (file.indexOf('/_') !== -1) { continue; } // either a folder or file name starts with '_'. skip it

                    ext = path.extname(file).toLowerCase().substr(1);
                    if (ext === 'info') { continue; } // skip info files                    
                    
                    // collect nsa assets for this nsa folder
                    if (file.indexOf('/(nsa)/') !== -1) { 
                        till_nsa = file.substr(0, file.indexOf('/(nsa)/') + 7); // pick from start till where /(nsa)/ ends
                        if (processedNSAs.indexOf(till_nsa) === -1) { // process this nsa folder, if not already processed
                            processedNSAs.push(till_nsa); // record for next time skip

                            let assetsInfo = collectNSAssets(till_nsa, options.current.nsName); 
                            options.current.nsAssets.push(assetsInfo); // push collected assets array as element in this array
                            continue; // skip collecting types resources or assets from this special folder inside namespace (at any level inside)
                        } else {
                            continue; // else ignore the file, as it must have already been processed as asset
                        }
                    }

                    // handle position first
                    let lastIndex = 999999999, 
                        index = lastIndex, // all are at bottom by default
                        idx = -1,
                        filePath = path.dirname(file),
                        fileName = path.basename(file),
                        originalFile = file,
                        place = 'normal';
                    if (fileName.startsWith('@@')) {
                        place = 'bottom';
                    } else if (fileName.startsWith('@')) {
                        place = 'top';
                    }
                    if (place === 'top') { // file name can be given @n- to help sorting a file *before* others - this helps in right bundling order
                        idx = fileName.indexOf('-');
                        if (idx !== -1) {
                            index = parseInt(fileName.substr(1, idx-1));
                            fileName = fileName.substr(idx+1);
                            file = path.join(filePath, fileName);
                        }
                    } else if (place === 'bottom') { // file name can be given @@n- to help sorting a file *after* others - this helps in right bundling order
                        idx = fileName.indexOf('-');
                        if (idx !== -1) {
                            index = lastIndex + parseInt(fileName.substr(2, idx-1));
                            fileName = fileName.substr(idx+1);
                            file = path.join(filePath, fileName);
                        }
                    } 
        
                    let nsFile = {
                        nsPath: options.current.nsPath,
                        nsName: options.current.nsName,
                        ext: path.extname(file).toLowerCase().substr(1),
                        originalFile: originalFile,
                        file: file,
                        type: '',
                        index: index
                    };
                    
                    // in-place assets
                    if (file.endsWith('.ast.' + nsFile.ext)) { // in-place asset
                        collectInPlaceNSAsset(file, file.replace('.ast.', '.'), ''); continue; // file collected as asset - don't process further
                    } else if (file.endsWith('.ast.view.' + nsFile.ext)) { // special known asset type
                        collectInPlaceNSAsset(file, file.replace('.ast.view.', '.'), 'views'); continue; // file collected as asset - don't process further
                    } else if (file.endsWith('.ast.layout.' + nsFile.ext)) { // special known asset type
                        collectInPlaceNSAsset(file, file.replace('.ast.layout.', '.'), 'layouts'); continue; // file collected as asset - don't process further
                    } else if (file.endsWith('.ast.data.' + nsFile.ext)) { // special known asset type
                        collectInPlaceNSAsset(file, file.replace('.ast.data.', '.'), 'data'); continue; // file collected as asset - don't process further
                    } else if (file.endsWith('.ast.style.' + nsFile.ext)) { // special known asset type
                        collectInPlaceNSAsset(file, file.replace('.ast.style.', '.'), 'css'); continue; // file collected as asset - don't process further
                    }

                    // specs
                    if (file.endsWith('.spec.js')) { continue; } // ignore specs
                        
                    // routes.json, types and resources
                    if (file.endsWith('/routes.json')) { // routes definition
                        nsFile.type = 'routes';
                    } else if (file.endsWith('.res.js')) { // js as a resource
                        nsFile.typeName = path.basename(file).replace('.res.js', '');
                        nsFile.type = 'res';
                    } else if (file.endsWith('.js')) { // type
                        nsFile.typeName = path.basename(file).replace('.js', '');
                        nsFile.type = 'type';
                    } else if (file.endsWith('.res.' + nsFile.ext)) { // resource
                        nsFile.typeName = path.basename(file).replace('.res.' + nsFile.ext, '');
                        nsFile.type = 'res';
                    } else if (file.endsWith('.res.view.' + nsFile.ext)) { // special known resource type
                        nsFile.typeName = path.basename(file).replace('.res.view.' + nsFile.ext, '');
                        nsFile.type = 'res';
                    } else if (file.endsWith('.res.layout.' + nsFile.ext)) { // special known resource type
                        nsFile.typeName = path.basename(file).replace('.res.layout.' + nsFile.ext, '');
                        nsFile.type = 'res';
                    } else if (file.endsWith('.res.data.' + nsFile.ext)) { // special known resource type
                        nsFile.typeName = path.basename(file).replace('.res.data.' + nsFile.ext, '');
                        nsFile.type = 'res';
                    } else if (file.endsWith('.res.style.' + nsFile.ext)) { // special known resource type
                        nsFile.typeName = path.basename(file).replace('.res.style.' + nsFile.ext, '');
                        nsFile.type = 'res';
                    } else if (['html', 'css', 'json'].indexOf(nsFile.ext) !== -1) { // special known resources
                        nsFile.typeName = path.basename(file).replace('.' + nsFile.ext, '_' + nsFile.ext); // "Footer.html" will become "Footer_html" typename
                        nsFile.type = 'res';
                    } else { // anything else
                        continue; // ignore any other type of file
                    }

                    if (nsFile.type !== 'routes') { // type or resource
                        if (nsFile.typeName.indexOf('.') !== -1) { throw `Type/Resource names cannot contain dots. (${options.current.nsName}.${nsFile.typeName})`; }
                        nsFile.qualifiedName = (options.current.nsName !== '(root)' ? options.current.nsName + '.' : resolveRootNS(true))  + nsFile.typeName;

                        if (options.current.ado.resourcesAndTypes.indexOf(nsFile.typeName) !== -1) {
                            throw `Type/Resource is already added. (${options.current.nsName}.${nsFile.typeName})`; 
                        } else {
                            options.current.ado.resourcesAndTypes.push(nsFile.typeName);
                            if (nsFile.type === 'res') {
                                options.current.ado.resources.push(nsFile);
                            } else {
                                options.current.ado.types.push(nsFile);
                            }
                        }
                    } else {
                        let allRoutes = fsx.readJSONSync(nsFile.file, 'utf8');
                        let routes = [];
                        // routes.json named files can be placed anywhere inside an assembly
                        // all these files will eventually be read and merged and all routes be 
                        // registered
                        // structure of the file should be:
                        // [
                        //      { .. route definition .. },
                        //      { .. route definition .. }
                        // ]
                        // Each route Definition can be:
                        // {
                        //   name: route name, to access route programmatically, it will be prefixed with namespace under which this routes.json is kept
                        //   mount: route root mount name - by default it is 'main', as per config.json setting, it can be any other mount also (each mount is a different express/page app for server/client)
                        //   path: route path in relation to mount
                        //   handler: qualified type name that handles this route
                        //      handler can be of any class that is derived from Handler base class
                        //   verbs: name of the verbs supported on this route, like get, post, etc. - handler must have the same name methods to handle this verb - methods can be sync or async
                        //   mw: standard server/client middleware definitions as per usage context -> { name: '', func: '', args: [] } OR { name: '', args: [] }
                        //   index: any + or - number to move routes up or down wrt other routes, all routes from all assemblies are sorted by index before being activated
                        //      routes are indexed first and then applied in context of their individual mount
                        //      mount's order in config ultimately defines the overall order first than the index of the route itself inside the mount
                        //   desc: any desc of the route
                        for(let route of allRoutes) { // add each route separately
                            if (route.name.indexOf('.') !== -1) { throw `Route name cannot contain dots. (${route.name})`; }
                            if (!route.path) { throw `Route path must be defined. (${route.name}`; }
                            if (!route.handler) { throw `Route handler must be defined. (${route.name}`; }
                            route.qualifiedName = (options.current.nsName !== '(root)' ? options.current.nsName + '.' : resolveRootNS(true))  + route.name;
                            routes.push({ 
                                name: route.qualifiedName,
                                mount: route.mount || 'main', // by default all routes mount to main
                                index: route.index || 0, // no index means all are at same level
                                verbs: route.verbs || [], // verbs, e.g., view / get / post, etc.
                                mw: route.mw || [], 
                                path: route.path, 
                                handler: route.handler,
                                desc: route.desc || ''
                            });
                        }
                        options.current.ado.routes.push({
                            nsPath: options.current.nsPath,
                            nsName: options.current.nsName,
                            file: file,
                            data: routes
                        });
                    }
                }
                delete options.current.ado.resourcesAndTypes;
            };            

            // define namespace to process
            let nsFolder = options.current.namespaces.splice(0, 1)[0]; // pick from top
            if (nsFolder.startsWith('_')) { processNamespaces(done); return; } // ignore if starts with '_'
            if (['(assets)', '(libs)', '(locales)','(bundle)', '(docs)', '(..)'].indexOf(nsFolder) !== -1) { processNamespaces(done); return; } // skip special folders at namespace level
    
            options.current.nsName = nsFolder;
            options.current.nsPath = './' + path.join(options.current.asmPath, options.current.nsName);
    
            // collect types and resources and routes
            collectTypesAndResourcesAndRoutes();
    
            // pick next
            processNamespaces(done); 
        };

        // 4: process assemblies
        const processAssemblies = (done) => {
            if (options.current.assemblies.length === 0) { done(); return; }

            // support functions
            const getFileInfo = (file, defaultType, typeContent, isExtractKnownTypes) => {
                let infoFile = file + '.info',
                    ext = path.extname(file).substr(1),
                    info = {
                        type: defaultType || '',
                        size: (options.docs ? Math.round(fsx.statSync(file).size / 1024) + 'k' : '0k'),
                        desc: ''
                    },
                    item = null;
                if (options.docs) { // don't do if docs are not to be generated
                    let loadInfo = (text) => {
                        if (text) {
                            if (text.indexOf('|') !== -1) { // type | desc
                                let items = text.split('|');
                                info.type = items[0].trim() || defaultType;
                                info.desc = items[1].trim() || '';
                            } else { // desc only
                                info.desc = text;
                            }
                        }
                    };

                    if (isExtractKnownTypes) { // extrat special known asset or resource types
                        if (file.endsWith('.view.' + ext)) { 
                            info.type = 'View';
                        } else if (file.endsWith('.layout.' + ext)) {
                            info.type = 'Layout';
                        } else if (file.endsWith('.data.' + ext)) {
                            info.type = 'Data';
                        } else if (file.endsWith('.style.' + ext)) { 
                            info.type = 'Style';
                        }
                    }

                    if (fsx.existsSync(infoFile)) {
                        let infoFileContent = fsx.readFileSync(infoFile, 'utf8').trim();
                        let firstLine = infoFileContent.substr(0, infoFileContent.indexOf('\n')).trim() || infoFileContent;
                        loadInfo(firstLine);
                    } else if (typeContent) { // if type content is given
                        typeContent = typeContent.trim();
                        let firstLine = typeContent.substr(0, typeContent.indexOf('\n')).trim();
                        if (firstLine.startsWith('//!')) {
                            firstLine = firstLine.substr(3).trim();
                            loadInfo(firstLine);
                        } else { // try to get type and desc automatically
                            item = code.extract.typeInfo(typeContent);
                            info.type = item.type;
                            info.desc = item.desc;
                        }
                    }
                }

                return info;
            };
            const appendADO = () => {
                // each ADO object has:
                //      "name": "", 
                //      "file": "",
                //      "package": "",
                //      "desc": "",
                //      "title": "",
                //      "version": "",
                //      "lupdate": "",
                //      "builder": ""
                //      "copyright": "",
                //      "license": "",
                //      "ns": [], // { name, desc }
                //      "types": [{}, {}, ...], // { name, type, desc }
                //      "resources": [{}, {}, ...], // { name, type, size, desc }
                //      "assets": [{}, {}, ...], // { file, type, size, desc }
                //      "routes": [{}, {}, ...]  // { name, mount, handler, verbs, mw, index, desc }
                options.current.ado = {
                    name: options.current.asmName,
                    file: ((options.minify && !options.current.skipMinify && !options.current.skipMinifyThisAssembly) ? options.current.asmFileName.replace('.js', '{.min}.js') : options.current.asmFileName),
                    package: (options.packaged ? options.packageJSON.name : ''),
                    desc: options.packageJSON.description,
                    title: options.packageJSON.title,
                    version: options.packageJSON.version,
                    lupdate: new Date().toUTCString(),
                    builder: buildInfo,
                    copyright: options.packageJSON.copyright,
                    license: options.packageJSON.license,
                    ns: [],
                    types: [],
                    resources: [],
                    assets: [],
                    routes: []
                };
        
                if (options.skipPreambleFor.indexOf(options.current.asmName) === -1) { // if not to be skipped for preamble
                    options.current.adosJSON.push(options.current.ado);
                }

                // delete old file from cache
                if (fsx.existsSync(options.current.adoCache)) {
                    fsx.removeSync(options.current.adoCache);
                }
            };
            const appendADOFromCache = () => {
                // read from cache file
                options.current.ado = fsx.readJSONSync(options.current.adoCache, 'utf8');
                
                if (options.skipPreambleFor.indexOf(options.current.asmName) === -1) { // if not to be skipped for preamble
                    options.current.adosJSON.push(options.current.ado);
                }                
            };
            const saveADOToCache = () => {
                // ensure dir exists
                fsx.ensureDirSync(path.dirname(options.current.adoCache));

                // save to cache file
                fsx.writeJSONSync(options.current.adoCache, options.current.ado, 'utf8');
            };
            const isBuildAssembly = (onYes, onNo) => {
                const goBuild = () => {
                    // ensure file is created
                    fsx.ensureFileSync(options.current.asm);

                    // go build
                    onYes(() => {
                        // pick next
                        processAssemblies(done);                        
                    });
                };
                const skipBuild = () => {
                    onNo(() => {
                        // pick next
                        processAssemblies(done);
                    });
                };

                if (options.clean || options.fullBuild) { // when cleaned or fullbuild, go build
                    goBuild();
                } else { // else, even if this is not quickBuild, this optimization works
                    if (fsx.existsSync(options.current.asm) && fsx.existsSync(options.current.adoCache)) { 
                        options.current.asmLupdate = fsx.statSync(options.current.asm).mtime; 
                        const areFilesUpdatedSinceLupdate = () => {
                            let isChanged = false;
                            let allFiles = rrd(options.current.asmPath).filter(file => junk.not(path.basename(file)));
                            for(let f of allFiles) {
                                if (fsx.statSync(f).mtime > options.current.asmLupdate) {
                                    isChanged = true;
                                    break;
                                }
                            }
                            return isChanged;
                        };
    
                        // check if any file for this assembly was updated since this assembly was last created
                        if (areFilesUpdatedSinceLupdate()) {
                            goBuild();
                        } else {
                            skipBuild();
                        }
                    } else {
                        goBuild();
                    }
                }
            };
            const collectAssets = () => {
                // NOTE: This method should be in sync with collectNSAssets, as both doing similar things in different context
                let assetsInfo = [],
                    ext = '',
                    astSrc = './' + path.join(options.current.asmPath, '(assets)'),
                    astDest = './' + path.join(options.current.dest, options.current.asmName);
                
                if (fsx.existsSync(astSrc)) {
                    let assets = rrd(astSrc).filter(file => junk.not(path.basename(file)));
                    for (let asset of assets) {
                        if (asset.indexOf('/_') !== -1) { continue; } // either a folder or file name starts with '_'. skip it
                        
                        ext = path.extname(asset).toLowerCase().substr(1);
                        if (ext === 'info') { continue; } // skip info files

                        // asset file info
                        let astFile = {
                            ext: ext,
                            src: './' + asset,
                            dest: path.join(astDest, asset.replace(astSrc.replace('./', ''), ''))
                        };
                        assetsInfo.push(astFile);
                    }
                }

                // merge all options.current.nsAssets items into assetsInfo
                for(let nsAssetsInfo of options.current.nsAssets) {
                    for(let nsAstFile of nsAssetsInfo) {
                        // check for duplicate file name at dest
                        if (assetsInfo.findIndex(item => { return (item.dest === nsAstFile.dest ? true : false); }) !== -1) {
                            throw `Asset is already added. (${nsAstFile.src})`; 
                        }
                        assetsInfo.push(nsAstFile);
                    }
                }

                // done
                return assetsInfo;
            };            
            const processAssets = (cb, justData) => {
                justData = justData || [];
                if (options.current.ado.assets.length === 0) { 
                    options.current.ado.assets = justData;
                    cb(); return; 
                }
                
                // define asset to process
                let astFile = options.current.ado.assets.splice(0, 1)[0], // pick from top
                    astFileDest = astFile.dest,
                    astFileDestMin = '';
                if (!astFileDest.startsWith('./')) { astFileDest = './' + astFileDest; }
                astFileDest = astFileDest.replace('/' + options.current.build, '/').replace(options.dest, '').replace(options.current.ado.name, '').replace('//', ''); // this becomes 'path/fileName.ext' without ./ in start (to save preamble size)
                if (options.custom && options.profiles.current.omitRoot) {
                    astFileDest = astFileDest.replace(options.profiles.current.destRoot, '');
                }
                if (astFileDest.startsWith('/')) { astFileDest = astFileDest.substr(1); }
                astFileDestMin = astFileDest.replace('.' + astFile.ext, '{.min}.' + astFile.ext);

                let fileInfo = getFileInfo(astFile.src, astFile.ext, '', true); // true = extract known asset type name, if available (View, Layout, Data, Style)
                let assetInfo = {
                    file: '',
                    size: fileInfo.size,
                    type: fileInfo.type,
                    desc: fileInfo.desc
                };
                if (options.minify && !options.current.skipMinify && !options.current.skipMinifyThisAssembly && options.minifyTypes.indexOf(astFile.ext) !== -1) {    
                    assetInfo.file = astFileDestMin;
                } else {
                    assetInfo.file = astFileDest;
                }
                justData.push(assetInfo);
        
                // process only if full build OR asset is changed
                if (!options.fullBuild && fsx.existsSync(astFile.dest)) {
                    let srcLupdate = fsx.statSync(astFile.src).mtime.toString(),
                        destLupdate = fsx.statSync(astFile.dest).mtime.toString();
                    if (srcLupdate === destLupdate) { processAssets(cb, justData); return; }
                }
                if (!options.current.isAssetsHeadingPrinted) { logger(0, 'assets', ''); options.current.isAssetsHeadingPrinted = true; }
        
                // process asset info
                fsx.ensureDirSync(path.dirname(astFile.dest)); // ensure dest folder exists
                fsx.copyFileSync(astFile.src, astFile.dest);
                astFile.stat = astFile.dest.replace(options.current.dest, '.') + 
                ' (' + Math.round(fsx.statSync(astFile.dest).size / 1024) + 'kb';
        
                let minFile = '';
                const afterGzip = () => {
                    astFile.stat += ')';
        
                    logger(1, '', astFile.stat);
                    delete astFile.stat;
        
                    processAssets(cb, justData); // pick next
                };
                const afterMinify = () => {
                    // gzip
                    let gzFile = '';
                    if (options.gzip && !options.current.skipMinify && !options.current.skipMinifyThisAssembly) {
                        if (options.minify && fsx.existsSync(minFile)) {
                            gzFile = minFile + '.gz';
                            gzipFile(minFile).then(() => {
                                if (fsx.existsSync(gzFile)) {
                                    astFile.stat += ', ' + Math.round(fsx.statSync(gzFile).size / 1024) + 'kb gzipped';
                                }
                                afterGzip();
                            }).catch((err) => { throw err; })
                        } else {
                            gzFile = astFile.dest + '.gz';
                            gzipFile(astFile.dest).then(() => {
                                if (fsx.existsSync(gzFile)) {
                                    astFile.stat += ', ' + Math.round(fsx.statSync(gzFile).size / 1024) + 'kb gzipped';
                                }
                                afterGzip();
                            }).catch((err) => { throw err; });
                        }
                    } else { // delete old existing
                        if (!options.fullBuild) { 
                            gzFile = minFile + '.gz';
                            if (fsx.existsSync(gzFile)) { 
                                fsx.removeSync(gzFile); 
                            } else {
                                gzFile = astFile.dest + '.gz';
                                if (fsx.existsSync(gzFile)) { fsx.removeSync(gzFile); }
                            }
                        }
                        afterGzip();
                    }
                };
                const afterLint = () => {
                    // minify
                    minFile = astFile.dest.replace('.' + astFile.ext, '.min.' + astFile.ext);
                    if (options.minify && !options.current.skipMinify && !options.current.skipMinifyThisAssembly) {
                        minifyFile(astFile.dest).then(() => {
                            if (fsx.existsSync(minFile)) {
                                astFile.stat += ', ' + Math.round(fsx.statSync(minFile).size / 1024) + 'kb minified';
                            }
                            afterMinify();
                        }).catch((err) => { throw err; });
                    } else { // delete old existing
                        if (!options.fullBuild && fsx.existsSync(minFile)) { fsx.removeSync(minFile); }
                        let mapFile = minFile + '.map';
                        if (!options.fullBuild && fsx.existsSync(mapFile)) { fsx.removeSync(mapFile); }
                        afterMinify();
                    }
                };
        
                // lint
                if (options.lintAssets) {
                    lintFile(astFile.dest).then(afterLint).catch((err) => { throw err; });
                } else {
                    afterLint();
                }
            };  
            const copyLibs = () => {
                let libsSrc = './' + path.join(options.current.asmPath, '(libs)'),
                    libsDest = './' + path.join(options.current.dest, options.current.asmName);
                
                if (fsx.existsSync(libsSrc)) {
                    logger(0, 'libs', libsSrc);
                    let libs = rrd(libsSrc).filter(file => junk.not(path.basename(file)));
                    for (let lib of libs) {
                        if (lib.indexOf('/_') !== -1) { continue; } // either a folder or file name starts with '_'. skip it
                        
                        // lib file info
                        let libFile = {
                            ext: path.extname(lib).toLowerCase().substr(1),
                            src: './' + lib,
                            dest: './' + path.join(libsDest, lib.replace(libsSrc.replace('./', ''), ''))
                        };
                        fsx.copySync(libFile.src, libFile.dest, { errorOnExist: true })

                        // add it to assets list as well - since at the end this is an asset 
                        // the only diff is that these type of assets does not pass through lint, min and gz pipeline
                        // and these are throwing error too when exist
                        let libFileDest = libFile.dest;
                        if (!libFileDest.startsWith('./')) { libFileDest = './' + libFileDest; }
                        libFileDest = libFileDest.replace('/' + options.current.build, '/').replace(options.dest, '').replace(options.current.ado.name, '').replace('//', ''); // this becomes 'path/fileName.ext' without ./ in start (to save preamble size)
                        if (options.custom && options.profiles.current.omitRoot) {
                            libFileDest = libFileDest.replace(options.profiles.current.destRoot, '');
                        }                        
                        if (libFileDest.startsWith('/')) { libFileDest = libFileDest.substr(1); }
                        let fileInfo = getFileInfo(libFile.src, libFile.ext, '', true); // true = extract known asset type name, if available (View, Layout, Data, Style)

                        let assetInfo = {
                            file: libFileDest,
                            size: fileInfo.size,
                            type: fileInfo.type,
                            desc: fileInfo.desc
                        };
                        options.current.ado.assets.push(assetInfo);
                    }
                }
            };
            const copyLocales = () => {
                let locSrc = './' + path.join(options.current.asmPath, '(locales)'),
                    locDest = './' + path.join(options.current.dest, options.current.asmName, 'locales');
                
                if (fsx.existsSync(locSrc)) {
                    logger(0, 'locales', locSrc);
                    let locales = rrd(locSrc).filter(file => junk.not(path.basename(file)));
                    for (let locale of locales) {
                        if (locale.indexOf('/_') !== -1) { continue; } // either a folder or file name starts with '_'. skip it
                        
                        // locale file info
                        let locFile = {
                            ext: path.extname(locale).toLowerCase().substr(1),
                            src: './' + locale,
                            dest: './' + path.join(locDest, locale.replace(locSrc.replace('./', ''), ''))
                        };
                        fsx.copySync(locFile.src, locFile.dest, { errorOnExist: true })

                        // add it to assets list as well - since at the end this is an asset 
                        // the only diff is that these type of assets does not pass through lint, min and gz pipeline
                        // and these are throwing error too when exist
                        let locFileDest = locFile.dest;
                        if (!locFileDest.startsWith('./')) { locFileDest = './' + locFileDest; }
                        locFileDest = locFileDest.replace('/' + options.current.build, '/').replace(options.dest, '').replace(options.current.ado.name, '').replace('//', ''); // this becomes 'path/fileName.ext' without ./ in start (to save preamble size)
                        if (options.custom && options.profiles.current.omitRoot) {
                            locFileDest = locFileDest.replace(options.profiles.current.destRoot, '');
                        }                        
                        if (locFileDest.startsWith('/')) { locFileDest = locFileDest.substr(1); }
                        let fileInfo = getFileInfo(locFile.src, locFile.ext, '', true); // true = extract known asset type name, if available (View, Layout, Data, Style)
                        let assetInfo = {
                            file: locFileDest,
                            size: fileInfo.size,
                            type: fileInfo.type,
                            desc: fileInfo.desc
                        };
                        options.current.ado.assets.push(assetInfo);                        
                    }
                }
            };            
            const copyRootFiles = () => {
                let rootSrc = './' + path.join(options.current.asmPath, '(..)'),
                    rootDest = options.current.dest;

                if (fsx.existsSync(rootSrc)) {
                    logger(0, 'root', rootSrc); 
                    let rootFiles = rrd(rootSrc).filter(file => junk.not(path.basename(file)));
                    for (let rootFile of rootFiles) {
                        if (rootFile.indexOf('/_') !== -1) { continue; } // either a folder or file name starts with '_'. skip it
                        
                        // root file info
                        let rFile = {
                            ext: path.extname(rootFile).toLowerCase().substr(1),
                            src: './' + rootFile,
                            dest: './' + path.join(rootDest, rootFile.replace(rootSrc.replace('./', ''), ''))
                        };
                        fsx.copySync(rFile.src, rFile.dest, { errorOnExist: true })
                    }
                }
            };
            const initializeAssemblyContent = () => {
                // create assembly wrapper
                // if index.js exists, this is the custom wrapper, use it, else
                // define default wrapper
                if (fsx.existsSync(options.current.asmMain)) {
                    options.current.asmContent = fsx.readFileSync(options.current.asmMain, 'utf8');
                    options.current.asyncTypeLoading = false;
                } else {
                    options.current.asmContent = code.templates.module; // template
                    options.current.asyncTypeLoading = true;
                }

                // process already-defined file injections and assume them all as built-in components
                // and also record injected items as docComponents for later usage
                options.current.asmContent = code.inject(options.current.asmPath, options.current.asmContent, true, options.current.docComponents); 
                
                // replace payload placeholder via injection
                options.current.asmContent = replaceAll(options.current.asmContent, '<<asm_payload>>', '<!-- inject: ./templates/asm/payload.js -->');
                options.current.asmContent = code.inject(__dirname, options.current.asmContent); 

                // replace components placeholder via read file
                // this means, 'components.js' file should control only injection statements and nothing else
                // and also record injected items as docComponents for later usage
                if (fsx.existsSync(options.current.components)) {
                    options.current.asmContent = replaceAll(options.current.asmContent, '<<asm_components>>', fsx.readFileSync(options.current.components, 'utf8'));
                    options.current.asmContent = code.inject(options.current.asmPath, options.current.asmContent, true, options.current.docComponents); 
                    logger(0, 'components',  options.current.components);
                } else {
                    options.current.asmContent = replaceAll(options.current.asmContent, '<<asm_components>>', '// (not defined)');
                }
                // replace placeholders (multiple copies of same placeholder may be present)
                options.current.asmContent = replaceAll(options.current.asmContent, '<<name>>',  options.packageJSON.name);
                options.current.asmContent = replaceAll(options.current.asmContent, '<<title>>',  options.current.ado.title);
                options.current.asmContent = replaceAll(options.current.asmContent, '<<desc>>',  options.current.ado.desc);
                options.current.asmContent = replaceAll(options.current.asmContent, '<<asm>>', options.current.ado.name);
                options.current.asmContent = replaceAll(options.current.asmContent, '<<file>>', options.current.asmFileName);
                options.current.asmContent = replaceAll(options.current.asmContent, '<<version>>', options.current.ado.version);
                options.current.asmContent = replaceAll(options.current.asmContent, '<<lupdate>>', options.current.ado.lupdate);
                options.current.asmContent = replaceAll(options.current.asmContent, '<<copyright>>', options.current.ado.copyright);
                options.current.asmContent = replaceAll(options.current.asmContent, '<<license>>', options.current.ado.license);
                options.current.asmContent = replaceAll(options.current.asmContent, '<<which_file>>', options.current.ado.file);

                // inject settings
                if (fsx.existsSync(options.current.asmSettings)) {
                    options.current.asmContent = replaceAll(options.current.asmContent, '<<settings>>', JSON.stringify(fsx.readJSONSync(options.current.asmSettings)));
                    logger(0, 'settings',  options.current.asmSettings);
                } else {
                    options.current.asmContent = replaceAll(options.current.asmContent, '<<settings>>', '{}');
                }

                // inject config
                if (fsx.existsSync(options.current.asmConfig)) {
                    options.current.asmContent = replaceAll(options.current.asmContent, '<<config>>', JSON.stringify(fsx.readJSONSync(options.current.asmConfig)));
                    logger(0, 'config',  options.current.asmConfig);
                } else {
                    options.current.asmContent = replaceAll(options.current.asmContent, '<<config>>', '{}');
                }

                // inject functions
                if (fsx.existsSync(options.current.functions)) {
                    options.current.asmContent = replaceAll(options.current.asmContent, '<<asm_functions>>', `<!-- inject: ${options.current.functions} --> `);
                    options.current.asmContent = code.inject('./', options.current.asmContent);
                    logger(0, 'functions', options.current.functions); 
                } else {
                    options.current.asmContent = replaceAll(options.current.asmContent, '<<asm_functions>>', '// (not defined)');
                }
            };
            const finalizeAssemblyContent = () => {
                // support func
                const getNSFromName = (itemName) => {
                    let items = itemName.split('.');
                    if (items.length === 1) { 
                        return '(root)'; 
                    } else {
                        items.splice(items.length - 1, 1);
                        return items.join('.');
                    }
                };
                const getNSDesc = (nsName) => {
                    let nsInfoFile = './' + path.join(options.current.asmPath, nsName, `${nsName}.info`),
                        nsDesc = '';
                    if (fsx.existsSync(nsInfoFile)) { nsDesc = fsx.readFileSync(nsInfoFile, 'utf8').trim(); }
                    return nsDesc;
                };
                const addNS = (allNS, itemNames) => {
                    let nsName = '',
                        nsDesc = '';
                    for(let item of itemNames) {
                        nsName = getNSFromName(item);
                        if (!allNS.find(a => { return a.name === nsName })) { 
                            nsDesc = getNSDesc(nsName);
                            allNS.push({ name: nsName, desc: nsDesc }); 
                        }
                    }
                };
                const hierarchyAwareSort = (items, separator, propName) => {
                    if (items.length > 0) {
                        let sortedItems = [],
                            thisItem = null;
                        let justPaths = items.map(a => (a[propName].indexOf(separator) === -1 ? './' + a[propName] : a[propName]));
                        let sortedList = path_sort(justPaths, separator);
                        for(let thisName of sortedList) {
                            if (thisName.startsWith('./')) { thisName = thisName.substr(2); } // remove ./
                            thisItem = items.filter(a => { return a[propName] === thisName })[0]; // pick first
                            sortedItems.push(thisItem);
                        }
                        items = sortedItems;
                    } 
                    return items;
                };

                // sort docComponents by name
                options.current.docComponents.sort((a, b) => (a.name > b.name) ? 1 : -1); 

                // update ado for namespaces from types, resources and routes
                let ns = []; // {  name, desc }
                addNS(ns, options.current.ado.types.map(a => a.name));
                addNS(ns, options.current.ado.resources.map(a => a.name));
                addNS(ns, options.current.ado.routes.map(a => a.name));
                options.current.ado.ns = ns;

                // sort ns by name
                options.current.ado.ns.sort(); 

                // sort routes by index
                options.current.ado.routes.sort((a, b) => (a.index > b.index) ? 1 : -1); 

                // sort types and resources by ns + name
                options.current.ado.types = hierarchyAwareSort(options.current.ado.types, '.', 'name');
                options.current.ado.resources = hierarchyAwareSort(options.current.ado.resources, '.', 'name');

                // sort assets by folder+file name
                options.current.ado.assets = hierarchyAwareSort(options.current.ado.assets, '/', 'file');

                // inject ado
                options.current.asmContent = replaceAll(options.current.asmContent, '<<ado>>', JSON.stringify(options.current.ado));
            };
            const giveNamespaceAndNameToType = (content, nsName, typeName) => {
                // find and add typename and namespace to first type in file, if matches 
                // to auto add typeName, it can be written as:
                // note: quotes can be ' or ""
                // Class('', <whatever>)
                // Struct('', <whatever>)
                // Mixin('', <whatever>)
                // Enum('', <whatever>)
                // Interface('', <whatever>)
                let rex = /((Class)|(Struct)|(Mixin)|(Enum)|(Interface))\s*\(\s*(""|'')\s*\,/
                let mtc = content.match(rex);
                if (mtc) {
                    let middle = mtc[0];
                    let pre = content.substr(0, mtc.index) + `$$$('ns', '${nsName}');\n`; // using $$$, because one $ gets eaten in replace
                    let post = content.substr(mtc.index + middle.length + 1);
                    if (middle.indexOf('""') !== -1) { middle = middle.replace('""', "''"); }
                    content = pre + `\t\t` + middle.replace("''", `'${typeName}'`) + ' ' + post;
                }
                return content;
            };

            const injectTypes = (cb) => {
                if (options.current.ado.types.length === 0) { 
                    options.current.asmContent = replaceAll(options.current.asmContent, '<<asm_types>>', '// (not defined)');
                    cb(); return; 
                }
                
                // start
                logger(0, 'types', '');
        
                // append types
                let justData = [], // { name, type, desc }
                    thisFile = '',
                    allTypes = '',
                    fileInfo = {},
                    typeWrapper = (options.current.asyncTypeLoading ? code.templates.type_async : code.templates.type_sync);
                for(let nsFile of options.current.ado.types) {
                    thisFile = './' + nsFile.originalFile;
                    logger(1, '', nsFile.qualifiedName + ' (' + thisFile + ')');
        
                    // wrap type in type wrapper
                    // using injector way of injecting content, as this 
                    // does not mess with '$' issue, which otherwise by reading file
                    // and replacing content, cause problem
                    // more about the issue at: https://stackoverflow.com/questions/5297856/replaceall-in-javascript-and-dollar-sign
                    let content = replaceAll(typeWrapper, '<<asm_type>>', `<!-- inject: ${thisFile} -->`);
                    content = replaceAll(content, '<<file>>', thisFile);
                    content = code.inject('./', content);
                    content = replaceAll(content, '$(', '$$$('); // replace all messed-up calls with correct $$$( eventually becomes $$(
                    content = replaceAll(content, '$.', '$$$.'); // replace all messed-up calls with correct $$$. eventually becomes $$.
        
                    // associate type with namespace
                    content = giveNamespaceAndNameToType(content, nsFile.nsName, nsFile.typeName);

                    // process type injections, if any
                    content = code.inject(nsFile.nsPath, content);
        
                    // store for docs generation
                    options.current.docTypes[nsFile.qualifiedName] = content;

                    fileInfo = getFileInfo(thisFile, 'Type', content);
                    justData.push({
                        name: nsFile.qualifiedName,
                        type: fileInfo.type,
                        desc: fileInfo.desc
                    });

                    // append content to all list
                    allTypes += content;
                }
                options.current.ado.types = justData; // update types list

                // inject types
                if (options.current.asmContent.indexOf('<<asm_types>>') === -1) {
                    logger(1, '', 'omitted (no placeholder found)');
                } else {
                    options.current.asmContent = replaceAll(options.current.asmContent, '<<asm_types>>', allTypes);
                }
        
                // done
                cb();
            };  
            const injectResources = (cb, justData, allResources) => {
                justData = justData || []; // { name, type, desc }
                allResources = allResources || '';
                if (options.current.ado.resources.length === 0) { 
                    options.current.ado.resources = justData; // update resources list

                    // validate
                    if (options.current.asmContent.indexOf('<<asm_resources>>') === -1) {
                        if (allResources) {
                            logger(1, '', 'omitted (no placeholder found)');
                        }
                    } else {
                        // inject resources
                        options.current.asmContent = replaceAll(options.current.asmContent, '<<asm_resources>>', allResources || '// (not defined)');
                    }

                    // done
                    cb(); return; 
                }

                // define resource to process
                let nsFile = options.current.ado.resources.splice(0, 1)[0]; // pick from top
                let fileInfo = getFileInfo(nsFile.file, nsFile.ext, '', true); // true: extract known types since resource file names can also have special known types identifiers (View, Layout, Data, Style)
                justData.push({
                    name: nsFile.qualifiedName,
                    size: fileInfo.size,
                    type: fileInfo.type,
                    desc: fileInfo.desc
                });
                if (justData.length === 1) { logger(0, 'resources', ''); }
        
                logger(1, '', nsFile.qualifiedName + ' (./' + nsFile.file + ')'); 
        
                const afterMinify = (content) => {
                    let encodingType = '';
                    if (!content) {
                        if (options.utf8EncodeResourceTypes.indexOf(nsFile.ext) !== -1) {
                            content = fsx.readFileSync(nsFile.file, 'utf8');
                            encodingType = 'utf8;';
                        } else { // no encoding
                            content = fsx.readFileSync(nsFile.file);
                        }
                    } else {
                        encodingType = 'utf8;';
                    }
        
                    // base64 encoding before adding to file
                    content = Buffer.from(content).toString('base64');
                    encodingType += 'base64;';
        
                    // embed resource
                    let rdo = {
                        name: nsFile.qualifiedName,
                        encodingType: encodingType,
                        asmFile: options.current.ado.file,
                        file: './' + nsFile.file,
                        data: content
                    };
        
                    // wrap resource in resource wrapper
                    let thisRes = '';
                    thisRes = replaceAll(code.templates.resource, '<<asm_res>>', JSON.stringify(rdo));
                    thisRes = replaceAll(thisRes, '<<file>>', rdo.file);
        
                    // append content to all list
                    allResources += thisRes;

                    // pick next
                    injectResources(cb, justData, allResources);
                };
                const afterLint = () => {
                    // minify/read resource
                    if (options.minifyResources && !options.current.skipMinify && !options.current.skipMinifyThisAssembly) {
                        if (options.minifyTypes.indexOf(nsFile.ext) !== -1) {
                            if (options.minifyTypes.indexOf(nsFile.ext) !== -1) {
                                let p = null;
                                switch (nsFile.ext) {
                                    case 'js': p = minifyJS(nsFile.file); break;
                                    case 'css': p = minifyCSS(nsFile.file); break;
                                    case 'html': p = minifyHTML(nsFile.file); break;
                                }
                                if (p === null) {
                                    afterMinify();
                                } else {
                                    p.then(afterMinify).catch((err) => { throw err; });
                                }
                            } else {
                                afterMinify();
                            }
                        } else {
                            afterMinify();
                        }
                    } else {
                        afterMinify();
                    }
                };
        
                // lint resource
                if (options.lintResources) {
                    lintFile(nsFile.file).then(afterLint).catch((err) => { throw err; });
                } else {
                    afterLint();
                }
            };  
            const flattenRoutes = (cb, justData) => {
                justData = justData || [];
                if (options.current.ado.routes.length === 0) { 
                    options.current.ado.routes = justData;
                    delete options.current.__routes;
                    cb(); return; 
                }

                // define route to process
                let nsRoute = options.current.ado.routes.splice(0, 1)[0]; // pick from top
                if (!options.current.__routes) { logger(0, 'routes', ''); options.current.__routes = true; }
                logger(1, '', './' + nsRoute.file); 
                for(let route of nsRoute.data) {
                    justData.push(route); // add each route - this means, from vary many routes.json files in an assembly, all routes are flattened to one list
                }
        
                flattenRoutes(cb, justData); // pick next
            };                            
            const pack = (cb) => {
                options.current.stat = options.current.asmFileName + ' (' + Math.round(fsx.statSync(options.current.asm).size / 1024) + 'kb';
                
                let minFile = '';
                const afterGzip = () => {
                    options.current.stat += ')';
                    cb();
                };
                const afterMinify = () => {
                    // gzip
                    let gzFile = minFile + '.gz';
                    if (options.gzip && !options.current.skipMinify && !options.current.skipMinifyThisAssembly && fsx.existsSync(minFile)) {
                        gzipFile(minFile).then(() => {
                            options.current.stat += ', ' + Math.round(fsx.statSync(gzFile).size / 1024) + 'kb gzipped';
                            afterGzip();
                        }).catch((err) => { throw err; });
                    } else { // delete old existing
                        if (!options.fullBuild && fsx.existsSync(gzFile)) { fsx.removeSync(gzFile); }
                        afterGzip();
                    }
                };
                const afterLint = () => {
                    // minify
                    minFile = options.current.asm.replace('.js', '.min.js');
                    if (options.minify && !options.current.skipMinify && !options.current.skipMinifyThisAssembly) {
                        minifyFile(options.current.asm).then(() => {
                            options.current.stat += ', ' + Math.round(fsx.statSync(minFile).size / 1024) + 'kb minified';
                            afterMinify();
                        }).catch((err) => { throw err; });
                    } else { // delete old existing
                        if (!options.fullBuild && fsx.existsSync(minFile)) { fsx.removeSync(minFile); }
                        let mapFile = minFile + '.map';
                        if (!options.fullBuild && fsx.existsSync(mapFile)) { fsx.removeSync(mapFile); }
                        afterMinify();
                    }
                };
        
                // lint
                if (options.lint) {
                    lintFile(options.current.asm).then(afterLint).catch((err) => { throw err; });
                } else {
                    afterLint();
                }
            };      
            const createAssembly = () => {
                fsx.writeFileSync(options.current.asm, options.current.asmContent.trim(), 'utf8');
            };  
            const generateDocs = () => {
                if (!options.docs) { return; }

                // build docs
                docs.build();

                // clean
                options.current.docx = '';
                options.current.docTypes = {};
                options.current.docComponents = [];
            };

            // define assembly to process
            let asmFolder = options.current.assemblies.splice(0, 1)[0]; // pick from top
            if (asmFolder.startsWith('_')) { processAssemblies(done); return; } // ignore if starts with '_'
    
            // assembly (start)
            options.current.asmName = asmFolder;
            options.current.asmPath = './' + path.join(options.current.src, options.current.asmName);
            options.current.asm = './' + path.join(options.current.dest, options.current.asmName + '.js');
            options.current.asmDoc = options.current.asm.replace('.js', '.md');
            options.current.asmFileName = ('./' + path.join(options.current.dest, options.current.asmName) + '.js').replace(options.dest, '.');
            if (options.custom && options.profiles.current.omitRoot) {
                options.current.asmFileName = options.current.asmFileName.replace(options.profiles.current.destRoot, '');
            }
            options.current.asmMain = './' + path.join(options.current.src, options.current.asmName, 'index.js');
            options.current.asyncTypeLoading = true;
            options.current.functions = './' + path.join(options.current.src, options.current.asmName, 'functions.js');
            options.current.components = './' + path.join(options.current.src, options.current.asmName, 'components.js');
            options.current.asmSettings = './' + path.join(options.current.src, options.current.asmName, 'settings.json');
            options.current.asmConfig = './' + path.join(options.current.src, options.current.asmName, 'config.json');
            options.current.skipMinifyThisAssembly = (options.skipMinifyFor.indexOf(asmFolder) !== -1); // skip minify for this assembly, if this is a special file
            options.current.asmLupdate = null;
            options.current.asmContent = '';
            options.current.adoCache = path.join(options.cache, options.current.asmPath + '.json');
            options.current.docx = options.current.asmMain.replace('index.js', 'index.md');
            options.current.docTypes = {};
            options.current.docComponents = [];

            isBuildAssembly((cb) => {
                // assembly (start)
                logger(0, 'asm', asmFolder, true); 

                // append new ADO - Assembly Definition Object
                appendADO();

                // process namespaces under this assembly 
                options.current.namespaces = getFolders(options.current.asmPath, true);
                options.current.nsAssets = []; // this will be an array of arrays - each item contains an array of nsAssets - for each found (nsa) folder anywhere inside namespace folder (at any level inside there)
                processNamespaces(() => { 

                    // process assets of the assembly
                    options.current.ado.assets = collectAssets();
                    delete options.current.nsAssets; // nsAssets are merged in main assets by now
                    processAssets(() => {
                        // copy libs over assets (this will overwrite, if there are same name files in assets and libs)
                        copyLibs();

                        // copy locals over assets and libs inside 'locales' folder (this will overwrite, if there same name files in assets or libs under 'locales' folder)
                        copyLocales();
        
                        // copy root files
                        copyRootFiles();
        
                        // initialize assembly content
                        initializeAssemblyContent();
        
                        // inject types
                        injectTypes(() => {

                            // inject resources
                            injectResources(() => {

                                // flatten all collected routes to one list, so they can be sorted when being loaded
                                flattenRoutes(() => {

                                    // finalize assembly content
                                    finalizeAssemblyContent();

                                    // create assembly
                                    createAssembly();

                                    // lint, minify and gzip assembly
                                    pack(() => {
                                        // save ADO to cache
                                        saveADOToCache();

                                        // generate document
                                        generateDocs();

                                        // assembly (end)
                                        options.current.asmContent = '';
                                        logger(0, '==>', options.current.stat); 

                                        // done
                                        cb();
                                    });
                                });
                            });
                        });
                    });
                });
            }, (cb) => {
                // assembly (start)
                logger(0, 'asm', asmFolder, true); 

                // append ADO from cache
                appendADOFromCache();                

                // update stat (from existing file)
                options.current.stat = options.current.asmFileName + ' (' + Math.round(fsx.statSync(options.current.asm).size / 1024) + 'kb';
                let minFile = options.current.asm.replace('.js', '.min.js'),
                    gzFile = minFile + '.gz';
                if (fsx.existsSync(minFile)) {
                    options.current.stat += ', ' + Math.round(fsx.statSync(minFile).size / 1024) + 'kb minified';
                    if (fsx.existsSync(gzFile)) {
                        options.current.stat += ', ' + Math.round(fsx.statSync(gzFile).size / 1024) + 'kb gzipped';
                    }
                }
                options.current.stat += ') [no change, build skipped]';

                // assembly (end)
                logger(0, '==>', options.current.stat); 
                cb();
            });
        };

        // 3b: process sources
        const processSources = (done) => {
            if (options.sources.length === 0) { done(); return; }
    
            // support functions
            const createPreamble = () => {
                if (options.current.adosJSON.length === 0) { return; }
        
                logger(0, 'preamble', options.current.preamble.replace(options.dest, '.'), true);
                
                // build preamble lines
                let preamble_lines = '',
                    isFirst = true;
                for(let _ado of options.current.adosJSON) {
                    preamble_lines += (isFirst ? '' : '\t') + replaceAll(code.templates.preamble_line, '<<ado>>', JSON.stringify(_ado));
                    isFirst = false;
                }

                // create preamble content
                let preambleContent = replaceAll(code.templates.preamble, '<<path>>', options.current.dest.replace(options.dest, './'));
                preambleContent = replaceAll(preambleContent, '<<lupdate>>', new Date().toUTCString());
                preambleContent = replaceAll(preambleContent, '<<preamble_payload>>', preamble_lines);
                
                // write preamble file
                fsx.writeFileSync(options.current.preamble, preambleContent, 'utf8');
            };            

            // define source to process
            let source = options.sources.splice(0, 1)[0]; // pick from top
            let currentBuild = source;
            if (source.startsWith('_')) { processSources(done); return; } // ignore if starts with '_'
            if (options.custom) { source = path.join(options.profiles.current.root, source); }
    
            // source group (start)
            logger(0, 'group', `${source.replace(options.src, '.')} (start)`, true);  
            options.current = {};
            options.current.build = (options.custom ? currentBuild : '');
            options.current.src = options.custom? ('./' + path.join(options.src, source)) : source;
            options.current.dest = options.current.src.replace(options.src, options.dest);
            if (options.custom) {
                options.current.dest = options.current.dest.replace(options.dest , options.profiles.current.dest); 
                options.current.dest = options.current.dest.replace(options.profiles.current.root + '/', '');
            }
            options.current.adosJSON = [];
            options.current.preamble = './' + path.join(options.current.dest, 'preamble.js');
            options.current.skipMinify = options.custom ? options.profiles.current.skipMinify : false;
    
            // process assemblies under this group
            options.current.assemblies = getFolders(options.current.src, true);
            processAssemblies(() => {
                // create group preamble
                createPreamble();
    
                // source group (end)
                logger(0, 'group', `${source.replace(options.src, '.')} (end)`, true);  
                options.current = {};

                // process next source group
                processSources(done);
            });
        };

        // 3a: process profiles
        const processProfiles = (done) => {
            if (options.profiles.length === 0) { done(); return; } // when all done
    
            // support functions
            const getProfileTarget = (profileName) => {
                let theProfile = options.customConfig.profiles[profileName],
                    target = '';
                if (theProfile.dest && theProfile.dest !== '') {
                    if (theProfile.dest === '/') { 
                        target = options.dest;
                    } else if (theProfile.dest.startsWith('@')) { // move
                        target = theProfile.dest.substr(1); // remove @
                        target = getProfileTarget(target);
                        target = path.join(target, theProfile.root);
                    } else {
                        target = path.join(options.dest, theProfile.dest);
                    }
                } else {
                    target = './' + path.join(options.dest, (theProfile.root || profileName)); // if root is not defined, it means the folder name is same as profileName
                }
                return target;
            };
            const runPlugins = (cb) => {
                if (!options.custom) { cb(); return; }
        
                // expose functions for plugins
                options.funcs = {
                    minifyFile: minifyFile,
                    lintFile: lintFile,
                    gzipFile: gzipFile
                };
        
                const onDone = () => {
                    delete options.funcs;
                    cb();
                };
        
                let allPlugins = options.profiles.current.plugins ? options.profiles.current.plugins.slice() : [];
                const runPlugin = () => {
                    if (allPlugins.length === 0) { onDone(); return; }
                    
                    let plugin_name = allPlugins.shift(),
                        plugin_exec = null;
        
                    if (options.plugins[plugin_name]) { 
                        plugin_exec = options.plugins[plugin_name].exec; 
                        if (plugin_exec) {
                            plugin_exec(options.plugins[plugin_name].settings, runPlugin);
                        } else {
                            runPlugin(); // pick next
                        }
                    } else {
                        runPlugin(); // pick next
                    }
                };
        
                // start
                runPlugin();
            };              

            // define profile to process
            let profileItem = options.profiles.splice(0, 1)[0]; // pick from top
            options.profiles.current = Object.assign({}, options.customConfig.profiles[profileItem.profile]); // use a copy

            // set defaults for profile
            options.profiles.current.root = options.profiles.current.root || profileItem.profile;
            options.profiles.current.dest = getProfileTarget(profileItem.profile);
            options.profiles.current.destRoot = ('./' + options.profiles.current.dest).replace(options.dest, '');
            if (options.profiles.current.destRoot.startsWith('.//')) { options.profiles.current.destRoot = options.profiles.current.destRoot.replace('.//', '/') }
            options.profiles.current.skipMinify = (typeof options.profiles.current.skipMinify !== 'undefined' ? options.profiles.current.skipMinify : false);
            options.profiles.current.omitRoot = (typeof options.profiles.current.omitRoot !== 'undefined' ? options.profiles.current.omitRoot : false);
            options.profiles.current.modules = options.profiles.current.modules || [];
            options.profiles.current.bundles = options.profiles.current.bundles || [];
            options.profiles.current.copy = options.profiles.current.copy || [];
            options.profiles.current.minify = options.profiles.current.minify || [];
            options.profiles.current.flags = options.profiles.current.flags || null;
            options.profiles.current.build = options.profiles.current.build || [];
            
            // auto-define plugins
            // if options.profiles.current.plugins is defined as array
            //  it means use that as is
            // if not defined at all - or defined as comma delimited string of custom plugins
            //  it means add these custom plugins after inbuilt plugins
            let definedPlugins = [],
                customPlugins = [],
                autoPlugins = [];
            if (options.profiles.current.plugins) { // defined
                if (Array.isArray(options.profiles.current.plugins)) { // array
                    definedPlugins = options.profiles.current.plugins;
                } else if (typeof options.profiles.current.plugins === 'string') { // custom plugins
                    customPlugins = options.profiles.current.plugins.split(',');
                }
            } else {
                if (options.profiles.current.copy.length !== 0) { 
                    autoPlugins.push('copy_files'); 
                }
                if (typeof options.profiles.current.modules === 'boolean') { // server profile
                    if (options.profiles.current.modules === true) { // modules are needed
                        autoPlugins.push('node_modules');
                    }
                } else { // client profile 
                    if (options.profiles.current.modules.length !== 0) { // modules are needed
                        autoPlugins.push('web_modules');
                    }
                }
                if (options.profiles.current.minify.length !== 0) { 
                    autoPlugins.push('minify_files'); 
                }    
                if (options.profiles.current.flags) { 
                    autoPlugins.push('write_flags'); 
                }   
                if (options.profiles.current.bundles.length !== 0) { 
                    autoPlugins.push('create_bundle'); 
                }                                              
            }
            if (definedPlugins.length !== 0) {
                options.profiles.current.plugins = definedPlugins; // no auto
            } else {
                options.profiles.current.plugins = autoPlugins;
                for(let p of customPlugins) {
                    p = p.trim();
                    if (options.profiles.current.plugins.indexOf(p) === -1) { // add if not already added
                        options.profiles.current.plugins.push(p);
                    }
                }
            }
 
            // define source folders to process
            let srcList = [].concat(...options.profiles.current.build);
            options.sources = srcList;

            // profile (start)
            logger(0, 'profile', `${profileItem.profile} (start)`, true);  
            
            // process sources
            processSources(() => {

                // run plugins on processed profile files at destination
                runPlugins(() => {
                    
                    // profile (end)
                    logger(0, 'profile', `${profileItem.profile} (end)`, true); 
                    options.profiles.current = null;

                    // process next profile
                    processProfiles(done);
                });
            });
        };
    
        // 2: build process
        const startBuild = (done) => {
            // support functions
            const getPlugins = () => {
                // inbuilt plugins
                let plugins = {};
                for(let p in all_plugins) {
                    if (all_plugins.hasOwnProperty(p)) {
                        plugins[p] = {
                            name: p,
                            settings: all_plugins[p],
                            file: path.join(__dirname,  'plugins', p + '.js')
                        };
                        plugins[p].exec = require(plugins[p].file).exec;
                    }
                }

                // merge add custom plugins
                if (options.customConfig.plugins) {
                    for(let cp of options.customConfig.plugins) {
                        if (!plugins[cp.name]) { // add as is, if this is a custom-plugin
                            plugins[cp.name] = cp;
                            plugins[cp].exec = require(plugins[cp].file).exec;
                        } else { // just merge update settings
                            if (cp.settings) {
                                for(let s in cp.settings) {
                                    if (cp.settings.hasOwnProperty(s)) {
                                        plugins[cp.name].settings[s] = cp.settings[s];
                                    }
                                }
                            }
                        }
                   }
                }
                return plugins;
            };

            if (options.custom) { // custom build
                // define plugins
                options.plugins = getPlugins();
        
                // define profiles to process
                options.profiles = options.customConfig.build.slice();
                options.profiles.current = null;

                // process profiles
                processProfiles(() => {
                    done();
                });
            } else { // default build
                // define source folders to process
                let srcList = [];
                srcList.push(options.src); // source itself is the folder
                options.sources = srcList;
                
                // process sources
                processSources(() => {
                    done();
                });
            }
        };

        // 1: start
        startBuild(() => {
            // build main entry point of docs, if required
            docs.buildMain();

            // all done
            buildDone()
        });
    };

    // engine wrapper
    /**
     * @name flairBuild
     * @description Builds flair assemblies as per given configuration
     * @example
     *  flairBuild(options, cb)
     * @params
     *  options: object - build configuration object having following options:
     *              activeFlag: flag that needs to be marked as active in when flags are written (see write_flags.js for more info) - this is generally passed from command line as arg
     *              src: source folder root path
     *              dest: destination folder root path - where to copy built assemblies
     *              cache: temp folder root path - where all temp content is stored for caching or otherwise
     *              docs: if documentation to be generated for each built assembly 
     *                    doc annotations follow a subset of jsdocs syntax: https://jsdoc.app/
     *                    refer notes inside docs.annotations.types for supported symbol details for each type of document block
     *              docsConfig: documentation configuation options
     *              {
     *                  "oneDoc": true/false
     *                            default is true
     *                            if true, one '<assembly-name>.md file will be created for every assembly at the same place
     *                            where assembly is generated. This will skip those assemblies which are configured in "exclude"
     *                            if false, one '<assembly-name>' folder will be created under configured "dest" folder and all required docs will
     *                            be generated here underneath for the assembly
     *                            in addition to these, one 'assemblies.md' will also be generated to list all assemblies at the
     *                            root "dest" folder
     *                                  excluded assemblies will still be shown here, but without any hyperlink for next level documentation
     *                                  starting with assemblies.md, all files will have relative hyperlinks to navigate back and forth
     *                    "supressHeaderFooterInGeneratedDocs": true/false
     *                          this is considered only when oneDoc is false
     *                          if file header/footer is to be excluded in all generated docs, this will be useful when docs site is being
     *                          generated using custom theme and markdown content is being embedded in some themed area
     *                          default is false
     *                    "includeHeaderFooterInBundledDocs": true/true
     *                          this is considered only when oneDoc is false
     *                          if file header/footer is to be added in all docs that are being copied from (docs) folder of the assembly
     *                          this is useful when handwritten documents have to carry same look and feel as of generated docs
     *                          and when supressHeaderFooterInGeneratedDocs was set to false, to include header/footer -- in that case
     *                          these copied docs can also have same header/footer
     *                          default is true
     *                    "include": {
     *                          "components": true/false - if components documentation to be generated
     *                                  components are all files that are placed inside "(bundle)" folder under each assembly and
     *                                  for which injection placeholder is defined in index.js file of the assembly or inside components.js
     *                                  default is true
     *                          "namespaces": true/false - if namespaces documentation to be generated
     *                                  default is true
     *                          "types": true/false - if types documentation to be generated
     *                                  default is true
     *                          "resources": true/false - if resources documentation to be generated
     *                                  default is false
     *                          "assets": true/false - if assets documentation to be generated
     *                                  default is false
     *                          "routes": true/false - if routes documentation to be generated
     *                                  default is false
     *                     }
     *                      
     *                      docs will be generated for every (non-excluded) assembly in case oneDoc is false
     *                            'components.md', 'namespaces.md', 'types.md', 'references.md', 'resources.md', 'assets.md', 'routes.md'
     *                            for every namespace, one file will be generated as: '<namespace-name>.md'
     *                            for every component, one file will be generated as: '<component-name>.md'
     *                            for every type, one file will be generated as: '<type-name>.md'
     *                            for every reference, one file will be generated as: '<reference-name>.md'
     *                            
     *                  "exclude": [] - name of the assemblies which are not to be processed for documentation
     *                              excluded assemblies will still be listed in assemblies.md but without any hyperlink
     *                  "dest": "" - root folder name where to generate these documents, if "OneDoc" is false
     *                               default is: ./docs/content
     *                              when clean operation is running, this folder is deleted, so if files are to be placed under
     *                              main docs folder, it is important that this path refers to some internal docs content folder under main docs folder
     *                              where docs website's files may be present
     *                              In case different document versions are to be supported, "dest" path must be adjusted accordingly. e.g., "./docs/content/v1"
     *              }     
     *              custom: if custom control is needed for picking source and other files
     *                  true - all root level folders under 'src' will be treated as one individual assembly
     *                      Note: if folder name starts with '_', it is skipped
     *                  false - customization can be done using a config
     *              customConfig: custom folders configuration options file path (or object), having structure
     *              {
     *                  "build": [
     *                      {
     *                          "profile": - name of the profile to build
     *                          "dest": - relative path at destination folder where to copy distribution files of this profile
     *                                    "" - empty (or absence of this) means copy at destination root in same name folder as root of the profile
     *                                    "@profileName" - means copy at destination root under output of this given profile
     *                                    "somepath/thispath" - means output folder of this profile will be moved as this path with a rename of "thispath"
     *                      }
     *                  ],
     *                  "profiles": {
     *                      "<profileName>": {
     *                          "root": ""  - root folder name where source of this profile is kept - this is used for identification of content under dest folder only - not used for any prefixing with other paths in profile
     *                                        if this is absent or not defined, it is assumed to be same as profileName itself
     *                          "dest": "" - dest folder name where built/processed files are anchored under dest folder
     *                                      it can be:
     *                                          (empty) or absence of this, means, put it in same root folder name under dest
     *                                          / - to represents files to be placed directly under dest folder
     *                                          @<profileName> - to place files in same root folder name under dest folder of given profileName
     *                          "skipMinify": true/false 
     *                                      if true, minification for assemblies under this profile will be skipped, this is useful for server side assemblies
     *                                      default is false
     *                          "omitRoot": true/false
     *                                      if true, it will replace root folder name with "" when building assembly file path and name for preamble
     *                                      this is generally set to true for client installation, if client files are being served from inside server files
     *                                      default is false
     *                          "modules": [ ] - copy all specified "node_modules" to a root "modules" folder as is, - to handle some modules at client-side
     *                                           NOTE: unlike browserify, it does not check dependencies, therefore only those modules which work independently, are suited for this
     *                          "copy": [ ] - having path (relative to src path) to copy as is on dest folder
     *                          "minify": [ ] - having path (relative to src path) of files which need to be minified (at same place, same name .min.ext file will be created)
     *                          "build": [ ] - having path (relative to src path) to treat as assembly folder group
     *                                      all root level folders under each of these will be treated as one individual assembly
     *                                      Note: if folder name (of assembly folder under it) starts with '_', it is skipped
     *                      }
     *                  }
     *              }
     *              packaged: boolean - true, if whole build is being packaged as a module, false otherwise
     *                        This is forced to be false in custom build 
     *              fullBuild: true/false   - is full build to be done
     *              skipBumpVersion: true/false - if skip bump version with build
     *              suppressLogging: true/false  - if build time log is to be shown on terminal
     *              lint: true/false - if lint operation is to be executed
     *              lintConfig: lint configuration options file path (or object), having structure
     *              {
     *                  "js": { NOTE: Option configuration comes from: https://eslint.org/docs/user-guide/configuring AND https://eslint.org/docs/developer-guide/nodejs-api#cliengine
     *                  },
     *                  "css": { NOTE: Option configuration comes from: https://github.com/stylelint/stylelint/blob/0e378a7d31dcda0932f20ebfe61ff919ed1ddc42/docs/user-guide/configuration.md
     *                  },
     *                  "html": { NOTE: Option configuration comes from: https://www.npmjs.com/package/htmllint AND https://github.com/htmllint/htmllint/wiki/Options
     *                  }
     *              }
     *              lintTypes: - what all types to run linting on - ["js", "css", "html"]
     *              minify: true/false   - is minify to be run
     *              minifyConfig - minify configuration options file path (or object), having structure
     *              {
     *                  "js": { NOTE: Option configuration comes from: https://github.com/mishoo/UglifyJS2/tree/harmony
     *                  },
     *                  "css": { NOTE: Option configuration comes from: https://www.npmjs.com/package/clean-css
     *                  },
     *                  "html": { NOTE: Option configuration comes from: https://www.npmjs.com/package/html-minifier
     *                  }
     *              }
     *              minifyTypes: - what all types to run minification on - ["js", "css", "html"]
     *              generateJSSourceMap: true/false - if source map to be generated for js files
     *              gzip: true/false     - is gzip to be run
     *              gzipConfig - gzip configuration options file path (or object), having structure
     *              {
     *                  "all": {
     *                  },
     *                  "js": {
     *                  },
     *                  "css": {
     *                  },
     *                  "html": {
     *                  }
     *              }
     *                  NOTE: Option configuration comes from: https://nodejs.org/api/zlib.html#zlib_class_options AND https://www.zlib.net/manual.html
     *              gzipTypes: - what all types to run gzip on - ["js", "css", "html", "txt", "xml", "md", "json", "svg", "jpg", "jpeg", "gif", "png"]
     *              lintAssets: true/false     - is assets are to be run lint on
     *              minifyAssets: true/false     - is assets are to be minified
     *              gzipAssets: true/false     - is assets are to be gzipped
     *              lintResources: true/false   - if resources are to be linted before bundling
     *              minifyResources: true/false - if resources are to be minified before bundling
     *              utf8EncodeResourceTypes: for what type of resources utf8 encoding can be done - ["txt", "xml", "js", "md", "json", "css", "html", "svg"]
     *              deps: true/false
     *              depsConfig - dependencies pull/push configuration options file path (or object), having structure
     *              {
     *                  pre:[] - each item in here should have structure as: { src, dest }
     *                           NOTE:
     *                                src: can be a web url or a local file path (generally a web url to download an external dependency to embed)
     *                                dest: local file path (generally an embedded dependency)
     *                                exclude: {
     *                                      patterns: [] - file or folder name patterns, either full name or if ends with a *, checks start with, or if start with a *, checks for endsWith possibilities
     *                                      maps: - true/false - to exclude *.map files
     *                                      un-min: - true/false - to exclude *.js file, if a *.min.js exists for same file, that means only *.min.js will be copied, and not *.js of this file
     *                                }
     *                  post: [] - each item in here should have structure as: { src, dest }
     *                            NOTE:
     *                                src:  local file path (generally the built files)
     *                                dest: local file path (generally copied to some other local folder)
     *                                exclude: {
     *                                      patterns: [] - file or folder name patterns, either full name or if ends with a *, checks start with, or if start with a *, checks for endsWith possibilities
     *                                      maps: - true/false - to exclude *.map files
     *                                      un-min: - true/false - to exclude *.js file, if a *.min.js exists for same file, that means only *.min.js will be copied, and not *.js of this file
     *                                }
     *                  }
     *              preBuildDeps: true/false   - if before the start of assembly building, all local copies of external dependencies  need to be refreshed 
     *              postBuildDeps: true/false  - if after build update other local copies using the built files
     *              package: path of packageJSON file of the project
     *                  it picks project name, version and copyright information etc. from here to place on assembly
     * 
     *              NOTE: All local paths must be related to root of the project
     * 
     *              NOTE: How assembly folder looks like?
     *                    All types and resources must exists in namespaces, so conflict across assemblies is avoided
     *                    Each assembly level folder can have following structure underneath
     *                    <assembly folder>
     *                          index.js            - assembly initializer file
     *                              > assembly's header is added first
     *                              > assembly's self-registration code is added next
     *                                  > assembly's name is taken to be <assembly folder> name itself
     *                              > all assembly contents of all namespaces are added next
     *                              > content of this file is bundled at the last
     *                                  > this file may have some initialization code and treated as assembly load event handler
     *                              > when these assemblies are loaded, following happens:
     *                                  > assembly gets registered with flair, if not already registered via "preamble"
     *                                    (flair is always global, on server and on client)
     *                                  > if "flair" object is not available as global, it throws error
     *                          settings.json       - assembly's settings file, get embedded in assembly itself and is available as settings variable
     *                          <namespace folder>  - any other namespace folder is processed next
     *                              > this means, all folder under <assembly folder> are treated as namespace folders
     *                                with certain exclusions as:
     *                                > any folder name that starts with '_' is not processed
     *                              > namespaces even when nested, should exists at this level only
     *                                e.g., following are all valid namespace names
     *                                com.flair
     *                                com.flair.serialization
     *                                com.flair.aop
     *                              > unlike other systems, where the same would have been done like: (DON't DO FOLLOWING)
     *                                com
     *                                  flair
     *                                      aop
     *                                      serialization
     *                              > the reason former approach is chosen, is because it shows up all namespaces neatly under
     *                                <assembly folder>
     *                          (root)     - root namespace folder, is a special folder, that contains special members
     *                                       which are placed on root of the assembly namespace - i.e., assembly name itself is used as namespace
     *                                       (except in case of flair - where namespace is omitted altogether) 
     *                          (assets)   - assets folder
     *                                  > this special folder can be used to place all external assets like images, css, js, fonts, etc.
     *                                  > it can have any structure underneath
     *                                  > all files and folder under it, are copied to destination under <assembly folder> folder
     *                                  > which means, if an assembly has assets, in destination folder, it will look like:
     *                                      <assembly folder>.js        - the assembly file
     *                                      <assembly folder>.min.js    - the assembly file (minified)
     *                                      <assembly folder>/          - the assembly's assets folder content here under (this is created only if assets are defined)
     *                                  > note, '(assets)' folder itself is not copied, but all contents underneath are copied
     *                          (..)     - dest root folder
     *                                  > this special folder is used to put files at the root where assembly itself is being copied
     *                                  > this means, files from multiple assemblies can be placed at root and merged in same folder - may overwrite as well, (it will warn)
     *                          (locales)   - locales folder
     *                                  > this special folder can be used to place all localized translation files, as needed
     *                                  > it should have folders for each locale under it, the name of each locale folder should
     *                                    correspond to: https://www.metamodpro.com/browser-language-codes
     *                                  > Under each of these locale folders any number of JSON files can be placed having translated
     *                                    key:value pairs having structure:
     *                                    { "key": "keyName", "value": "translatedValue", ... }
     *                                  > the name of the JSON file can be anything
     *                                  > no processing of files happen whatsoever, files are copied as is
     *                                  > note, '(locales)' folder itself is not copied, but all contents underneath are copied
     *                                    inside 'locales' folder under (assets) folder at destination
     *                          (libs)   - libs folder
     *                                  > this special folder can be used to place all external third-party libraries, etc.
     *                                  > it can have any structure underneath
     *                                  > all files and folder under it, are copied to destination under <assembly folder> folder
     *                                    it copies over content of (assets) folder, so overwrite may happen, it will warn.
     *                                  > no processing of files happen whatsoever, files are copied as is
     *                                  > note, '(libs)' folder itself is not copied, but all contents underneath are copied
     *                          (bundle)   - bundled files' folder
     *                                  > this special folder can be used to place all files that are being bundled via injections inside index.js file
     *                                  > it can have any structure underneath
     *                                  > all files and folder under it, are skipped, unless they are referred via 
     *                                    <!-- inject: <file> --> pattern in any type or in index.js file
     *                          (docs)   - documents folder
     *                                  > this special folder can be used to place all readymade docs (.md) files 
     *                                  > it can have any structure underneath
     *                                  > this folder content will be copied as it under documentation destination folder
     *                                  > when 'docs' is true and 'oneDoc' is set to false
     * 
     *                          UNDER EACH NAMESPACED FOLDER:
     *                              Each namespace folder can take any structure and files can be placed in any which way
     *                              following types of files are processed as per associated rules:
     *                              _*              - any file name that starts with '_' is skipped
     *                              <_*>            - any folder name that starts with '_' is skipped all together
     *                              (nsa)           - this is a special folder called: namespaced assets
     *                                                content of this folder is merged with (assets) content at assembly level
     *                                                additionally ALL files under it are copied after prefixing their name with the namespace name
     *                                                so a file: (nsa)\views\Header.html --will go as--> (assets)\views\<namespaceName>.Header.html
     *                              *.js            - assumed to be flair types, following are rules associated with this
     *                                  > it will be looked for "<!-- inject: relative path here -->" pattern
     *                                    and defined js file will be injected in-place
     *                                  > it will be looked for "$$('ns', '(auto)');" OR '$$("ns", "(auto)");' patterns and
     *                                    current namespace (i.e., the namespace folder under which anywhere, this file is placed)
     *                                    will be replaced as: e.g., "$$('ns', '(auto)');" may become "$$('ns', 'com.flair.aop');"
     *                                  > it will look for following type name patterns as well:
     *                                    "Class('(auto)',", "Struct('(auto)',", "Mixin('(auto)',", "Enum('(auto)',", and "Interface('(auto)'," 
     *                                    'Class("(auto)",', 'Struct("(auto)",', 'Mixin("(auto)",', 'Enum("(auto)",', and 'Interface("(auto)",' 
     *                                    each of these, the '(auto)' or "(auto)" will be replaced with the actual file name of the file
     *                                  > for both namespace and type names, case-sensitive names will be used, as is, whatever is the naming
     *                                    of folder or file
     *                                  > if two files placed under different folder inside a namespace have same name, they will
     *                                    end up having same qualified name, so builder will throw for these cases
     *                                  > though flair supports writing multiple type definitions inside a single file, it will be
     *                                    a problem when '(auto)' of two types is resolved with same file name, so either do not 
     *                                    keep more than one type information in one file, or use '(auto)' only for one type and give fixed
     *                                    name to other type
     *                                  > each type will therefore can be accessed via flair.getType('<namespace>.<filename>') name
     *                                  > File name is now allowed to have any dots
     *                              *.res.[html|css|js|xml|txt|md|json|png|jpg|jpeg|gif|svg]  - resource files
     *                                  > all such files that starts with '.res.[*]' will be treated as resource and will be bundled
     *                                    as resource 
     *                                  > all resource files which are [txt|xml|js|md|json|css|html|svg] types (or any other types,
     *                                    as defined in utf8EncResFileTypes option setting) will be UTF8 encoded too
     *                                  > wether UTF8 encoded or not, resources are base64 encoded when they are added to assemblies
     *                                  > name of the resource file also takes the same namespace, under which folder it is placed
     *                                  > if two files placed under different folder inside a namespace have same name, they will
     *                                    end up having same qualified name, so builder will throw for these cases
     *                                  > if two different type of files (e.g., abc.res.css and abc.res.html) inside a namespace have same name, 
     *                                    they will end up having same qualified name, so builder will throw for these cases
     *                                  > each resource will therefore can be accessed via flair.getResource('<namespace>.<filename>') name
     *                                    Note: .res. will be removed from the file name
     *                                  > File name is now allowed to have any dots
     *                                  > html, css, xml, json, md are 5 special files that are not needed to have '.res.' in their file name to be treated as 
     *                                    resource, these are automatically be picked as resource - but in this case when they do not carry .res., their name is
     *                                    defined as: Header.html --is registered as--> '<namespaceName>.Header_html'
     *                                    while Header.res.html --will be registered as--> '<namespaceName.Header'
     *                             *.ast.[*] - in-place namespaced asset files
     *                                  > all files that ends with .ast.<ext> will be copied to assembly's root asset folder
     *                                  > name of these files is updated as 
     *                                    (1) .ast. is removed and 
     *                                    (2) namespace where these in-place assets are placed is prefixed to filename
     *                             *.[view|layout|style|data] - in-place namespaced known asset type files
     *                                  > all files that ends with .[view|layout|style|data].<ext> will be copied to assembly's root asset folder under special folders as:
     *                                      .view.* (generally .view.html) goes to (assets)/views/ folder
     *                                      .layout.* (generally .layout.html) goes to (assets)/layouts/ folder
     *                                      .style.* (generally .style.css) goes to (assets)/css/ folder
     *                                      .data.* (generally .data.json) goes to (assets)/data/ folder
     *                                  > name of these files is updated as 
     *                                    (1) .[view|layout|style|data]. is removed and 
     *                                    (2) namespace where these in-place known assets are placed is prefixed to filename
     *                          NOTE: Any other file, that does not map to identified types above are skipped,    
     *                                therefore files like *.spec.js or *.mjs, all are skipped 
     *                  
     *                  .info files:     
     *                      any [type/resource/asset] file can have same name info file (e.g., ./path/abc.js and ./abc.js.info)
     *                      all such info files are always ignored and never copied to destination folder
     *                      however the content of these info files are read for document generation, if required
     *                      any .info file is a text file and can contain content in following format:
     *                          <type> | <desc>  OR  <desc>
     *                      build engine automatically decipher type and desc, if possible else utilize information given in this file
     *                      if this file is present and has content, information from this file is used instead of auto-identification of type and desc
     * 
     *                  How assemblies are loaded?
     *                          Every assembly can be loaded like a normal module or javascript file.
     *                          If flair.js is not already loaded, it will throw an error or if loaded, it will register itself
     *                          with flair.
     *                          
     *                          At every root level a 'preamble.js' file is created that contains all meta
     *                          information about each assembly with assembly registration code.
     *                          
     *                          For seamless use of assemblies, instead of loading each assembly separately, only this preamble file
     *                          should be loaded. This ensures that when user needs a type, required assembly is automatically loaded
     *                          behind the scenes.
     * 
     *  cb: function - callback function
     * @returns void
     */ 
    const flairBuild = function(_options, cb) {
        const config = require('../../shared/options.js').config;

        // build options
        options = _options || {};
        options.package = options.package || './package.json';

        options.dest = options.dest || './dist';
        options.src = options.src || './src';
        options.cache = options.cache || './temp';

        options.docs = options.docs || false;
        options.docsConfig = config(options, 'build', 'docs');
        options.docsConfig.oneDoc = options.docsConfig.oneDoc !== undefined ? options.docsConfig.oneDoc : true;
        options.docsConfig.supressHeaderFooterInGeneratedDocs = options.docsConfig.supressHeaderFooterInGeneratedDocs !== undefined ? options.docsConfig.supressHeaderFooterInGeneratedDocs : false;
        options.docsConfig.includeHeaderFooterInBundledDocs = options.docsConfig.includeHeaderFooterInBundledDocs !== undefined ? options.docsConfig.includeHeaderFooterInBundledDocs : true;
        options.docsConfig.dest || './docs/content';
        options.docsConfig.exclude || [];
        options.docsConfig.include || {};
        options.docsConfig.include.components = options.docsConfig.include.components !== undefined ? options.docsConfig.include.components : true;
        options.docsConfig.include.namespaces = options.docsConfig.include.namespaces !== undefined ? options.docsConfig.include.namespaces : true;
        options.docsConfig.include.types = options.docsConfig.include.types !== undefined ? options.docsConfig.include.types : true;
        options.docsConfig.include.resources = options.docsConfig.include.resources !== undefined ? options.docsConfig.include.resources : true;
        options.docsConfig.include.assets = options.docsConfig.include.assets !== undefined ? options.docsConfig.include.assets : true;
        options.docsConfig.include.routes = options.docsConfig.include.routes !== undefined ? options.docsConfig.include.routes : true;
        
        options.custom = options.custom || false; 
        options.customConfig = config(options, 'build', 'custom');

        options.packaged = options.custom ? false : (options.packaged || false);
        
        options.fullBuild = options.fullBuild || false;
        options.quickBuild = (!options.fullBuild && options.quickBuild) || false;
        options.clean = options.clean !== undefined ? options.clean : true;
        options.skipBumpVersion = options.skipBumpVersion || false;
        options.suppressLogging = options.suppressLogging || false;

        options.lint = options.lint !== undefined ? options.lint : true;
        options.lintConfig = config(options, 'build', 'lint');
        options.lintTypes = options.lintTypes || ["js", "css", "html"];

        options.minify = options.minify !== undefined ? options.minify : true;
        options.minifyConfig = config(options, 'build', 'minify');
        options.minifyTypes = options.minifyTypes || ["js", "css", "html"];
        options.generateJSSourceMap = options.generateJSSourceMap !== undefined ? options.generateJSSourceMap : false;

        options.gzip = options.gzip || false;
        options.gzipConfig = config(options, 'build', 'gzip');
        options.gzipTypes = options.gzipTypes || ["js", "css", "html", "txt", "xml", "md", "json", "svg", "jpg", "jpeg", "gif", "png"];

        options.lintAssets = options.lintAssets || false;    
        options.minifyAssets = options.minifyAssets || false;    
        options.gzipAssets = options.gzipAssets || false;    

        options.lintResources = options.lintResources !== undefined ? options.lintResources : true;
        options.minifyResources = options.minifyResources !== undefined ? options.minifyResources : true;
        options.utf8EncodeResourceTypes = options.utf8EncodeResourceTypes || ["txt", "xml", "js", "md", "json", "css", "html", "svg"];

        options.deps = options.deps || false;
        options.depsConfig = config(options, 'build', 'deps');
        options.preBuildDeps = (options.depsConfig && options.preBuildDeps) || false;    
        options.postBuildDeps = (options.depsConfig && options.postBuildDeps) || false;

        // full-build vs quick build vs default build settings
        if (options.fullBuild) { // full build - ensure these things happen, if configured, even if turned off otherwise
            options.clean = true;
            options.lint = options.lintConfig ? true : false;
            options.minify = options.minifyConfig ? true : false;
            options.gzip = options.gzipConfig ? true : false;
            options.lintResources = options.lint && options.lintResources;
            options.minifyResources = options.minify && options.minifyResources;
            options.minifyAssets = options.minify && options.minifyAssets;
            options.gzipAssets = options.gzip && options.gzipAssets;
        } else if (options.quickBuild) { // quick build - suppress few things
            options.clean = false;
            options.lintResources = options.lint && options.lintResources;
            options.lintTypes = ['js']; // for quick builds run lint only for JS files
            options.minify = false;
            options.gzip = false;
            options.docs = false;
            options.minifyAssets = false;
            options.gzipAssets = false;
            options.minifyResources = false;
            options.preBuildDeps = false;
            options.skipBumpVersion = true;
        } // else whatever is set in build file

        // exclude files from being registered
        options.skipRegistrationsFor = [
        ];
        // exclude files from being added to preamble
        options.skipPreambleFor = [
            "flair"
        ];  
        // exclude files from being added to minified
        options.skipMinifyFor = [
        ];        

        // package json
        options.packageJSON = fsx.readJSONSync(path.resolve(options.package));

        // lint
        if (options.lint && options.lintConfig) {
            if (options.lintTypes.indexOf('js') !== -1) { // JS lint
                const CLIEngine = new require('eslint').CLIEngine            
                options.lintJS = new CLIEngine(options.lintConfig.js);
                options.eslintFormatter = options.lintJS.getFormatter();
            }
            if (options.lintTypes.indexOf('css') !== -1) { // CSS lint
                options.lintCSS = require('stylelint').lint;
            }
            if (options.lintTypes.indexOf('html') !== -1) { // HTML lint
                options.lintHTML = require('htmllint');
            }
        }

        // minify
        if (options.minify && options.minifyConfig) {
            if (options.minifyTypes.indexOf('js') !== -1) { // JS minifier
                options.minifyJS = require('uglify-es').minify;
            }
            if (options.minifyTypes.indexOf('css') !== -1) { // CSS minifier
                options.minifyCSS = require('clean-css');
            }
            if (options.minifyTypes.indexOf('html') !== -1) { // HTML minifier
                options.minifyHTML = require('html-minifier').minify;
            }        
        }

        // gzip
        if (options.gzip && options.gzipConfig) {
            options.zlib = require('zlib');
        }    

        // start
        logger(0, 'flairBuild', 'start ' + (options.fullBuild ? '(full)' : (options.quickBuild ? '(quick)' : '(default)')), true);

        // delete all dest files
        if (options.clean) {
            delAll(options.dest);
            delAll(options.cache);
            if (options.docs && !options.docsConfig.oneDoc) { delAll(options.docsConfig.dest); }
            logger(0, 'clean', 'done');
        }

        // bump version number
        bumpVersion();

        // build
        copyDeps(false, () => {
            build(() => {
                copyDeps(true, () => {
                    logger(0, 'flairBuild', 'end', true, true);
                    if (typeof cb === 'function') { cb(); } 
                });
            });
        });
    };
    
    // return
    return flairBuild;
});