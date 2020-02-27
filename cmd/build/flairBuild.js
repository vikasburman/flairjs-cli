/**
 * flairBuild
 * v1
 */
(function(root, factory) {
    'use strict';

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
})(this, function() {
    'use strict';

    // includes
    const rrd = require('recursive-readdir-sync'); 
    const junk = require('junk');
    const copyDir = require('copy-dir');
    const path = require('path');
    const fsx = require('fs-extra');
    const del = require('del');
    const path_sort = require('path-sort');

    // asm build info
    const buildInfo = {
        name: 'flairBuild',
        version: '1',
        format: 'fasm',
        formatVersion: '1',
        contains: [
            'init',         // index.js is bundled outside closure, which can have injected dependencies
            'func',         // functions.js is bundled in closure, which can have local closure functions as well as a special named function 'onLoadComplete'
            'type',         // types are embedded
            'vars',         // flair variables are made available in a closure where types are bundled
            'reso',         // resources are bundled
            'asst',         // assets are processed and their names are added in ado
            'rout',         // routes are collected, and added in ado
            'docs',         // docs generation processed
            'sreg'          // selfreg code is bundled
        ]
    };    

    // templates
    const asm_module = fsx.readFileSync(path.join(__dirname, 'templates', 'asm_module.js'), 'utf8')
    const asm_preamble = fsx.readFileSync(path.join(__dirname, 'templates', 'asm_preamble.js'), 'utf8');
    const asm_preamble_line = fsx.readFileSync(path.join(__dirname, 'templates', 'asm_preamble_line.js'), 'utf8');
    const asm_resource = fsx.readFileSync(path.join(__dirname, 'templates', 'asm_resource.js'), 'utf8');
    const asm_type_async = fsx.readFileSync(path.join(__dirname, 'templates', 'asm_type_async.js'), 'utf8');
    const asm_type_sync = fsx.readFileSync(path.join(__dirname, 'templates', 'asm_type_sync.js'), 'utf8');
    const asm_doc_header = fsx.readFileSync(path.join(__dirname, 'templates', 'asm_doc_header.md'), 'utf8');
    const asm_doc_footer = fsx.readFileSync(path.join(__dirname, 'templates', 'asm_doc_footer.md'), 'utf8');
    const asm_doc_assembly = fsx.readFileSync(path.join(__dirname, 'templates', 'asm_doc_assembly.md'), 'utf8');
    const asm_doc_resources = fsx.readFileSync(path.join(__dirname, 'templates', 'asm_doc_resources.md'), 'utf8');
    const asm_doc_assets = fsx.readFileSync(path.join(__dirname, 'templates', 'asm_doc_assets.md'), 'utf8');
    const asm_doc_routes = fsx.readFileSync(path.join(__dirname, 'templates', 'asm_doc_routes.md'), 'utf8');
    const asm_doc_ns = fsx.readFileSync(path.join(__dirname, 'templates', 'asm_doc_ns.md'), 'utf8');
    const asm_doc_types = fsx.readFileSync(path.join(__dirname, 'templates', 'asm_doc_types.md'), 'utf8');
    const asm_doc_extra = fsx.readFileSync(path.join(__dirname, 'templates', 'asm_doc_extra.md'), 'utf8');

    // plugins
    const all_plugins = {
        node_modules: { cmd: "yarn install --prod" },
        web_modules: {},
        copy_files: {},
        minify_files: { gzip: true },
        write_flags: { defaultFlag: "dev" },
        create_bundle: { minify: true, gzip: true }
    };

    // support functions
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
    const injector = (base, content) => {
        // Unescaped \s*([\(\)\w@_\-.\\\/]+)\s*
        const FILENAME_PATTERN = '\\s*([\\(\\)\\w@_\\-.\\\\/]+)\\s*';
        const FILENAME_MARKER = '<filename>';
        const DEFAULT_PATTERN = '<!--\\s*inject:<filename>-->';
    
        const injectPattern = '^([ \\t]*)(.*?)' + DEFAULT_PATTERN.replace(FILENAME_MARKER, FILENAME_PATTERN);
        const regex = new RegExp(injectPattern, 'm');
        let fileName, textBefore, whitespace, currMatch, match;
    
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
            content = content.replace(match, function () { return injectContent })
        }
        
        return content;
    };
    const bump = (options) => {
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
        
        options.logger(0, 'version', newVer);
    };
    const copyDeps = (isPost, options, done) => {
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
    const jsdocs2md = {
        annotations: {
            TypeAnnotation: function(symbols, typeName, typeType, typeDesc) {
                /** 
                 * @type <desc>                                             [mandatory]
                 * @public                                                  [optional]
                 * @abstract | @sealed                                      [optional]
                 * @static                                                  [optional]
                 * @extends <class-type>                                    [optional]
                 * @mixes <mixin-type>, <mixin-type>, ...                   [optional]
                 * @implements <interface-type>, <interface-type>, ...      [optional]
                 * @deprecated <desc>                                       [optional]
                 * @since <version>                                         [optional]
                 * @remarks                                                 [optional]
                 *      <multi-line markdown format desc>
                 * @exmple                                                  [optional]
                 *      <multi-line markdown format text and embedded code>
                */
                let ano = {
                    isType: true,
                    isClass: false,
                    isInterface: false,
                    isMixin: false,
                    isStruct: false,
                    isEnum: false,
                    type: '',
                    desc: '',
                    name: '',
                    justName: '',
                    ns: '',
                    scope: 'public',
                    static: false,
                    modifiers: [],
                    extends: '',
                    mixes: [],
                    implements: [],
                    deprecated: '',
                    since: '',
                    remarks: '',
                    example: ''
                };

                // type
                switch(typeType) {
                    case 'class': ano.type = 'Class'; ano.isClass = true; break;
                    case 'interface': ano.type = 'Interface'; ano.isInterface = true; break;
                    case 'mixin': ano.type = 'Mixin'; ano.isMixin = true; break;
                    case 'struct': ano.type = 'Structure'; ano.isStruct = true; break;
                    case 'enum': ano.type = 'Enum'; ano.isEnum = true; break;
                    default:
                        throw `Unknown type definition. ${typeType}`;
                }
                
                // name, desc
                ano.name = typeName;
                ano.desc = typeDesc || symbols['type'];

                // ns, justName
                let items = typeName.split('.');
                if (items.length === 1) {
                    ano.ns = '(root)';
                    ano.justName = typeName;
                } else {
                    ano.justName = items.splice(items.length - 1, 1)[0];
                    ano.ns = items.join('.');
                }

                // static, modifiers, extends, mixes, implements
                ano.static = symbols['static'] ? true : false;
                if (!ano.static) {
                    if (symbols['abstract']) {
                        ano.modifiers.push('abstract');
                    } else if (symbols['sealed']) {
                        ano.modifiers.push('sealed');
                    }
                    ano.extends = symbols['extends'] || '';
                    ano.mixes = symbols['mixes'] || [];
                    ano.implements = symbols['implements'] || [];
                }

                // since, deprecated
                ano.deprecated = symbols['deprecated'] || '';
                if (!ano.deprecated) {
                    ano.since = symbols['since'] || '';
                }

                // others
                ano.scope = 'public'; // till the time more scopes are supported for types
                ano.remarks = symbols['remarks'] || '';
                ano.example = symbols['example'] || '';

                return ano;
            },
            PropertyAnnotation: function(symbols) {
                /** 
                 * @prop {<type>} name - <desc>                                         [mandatory]
                 * @public | @private | @private-set| @protected | @protected-set       [optional][default: public]
                 * @abstract | @virtual | @override | @sealed                           [optional]
                 * @static                                                              [optional]
                 * @readonly                                                            [optional]
                 * @optional                                                            [optional]
                 * @conditional <cond1>, <cond2>, ...                                   [optional]
                 * @deprecated <desc>                                                   [optional]
                 * @since <version>                                                     [optional]
                 * @remarks                                                             [optional]
                 *      <multi-line markdown format desc> 
                 * @exmple                                                              [optional]
                 *      <multi-line markdown format text and embedded code>
                */
               let ano = {
                    isMember: true,
                    isProperty: true,
                    type: '',
                    name: '',
                    desc: '',
                    scope: 'public',
                    modifiers: [],
                    static: false,
                    readonly: false,
                    optional: false,
                    conditional: [],
                    deprecated: '',
                    since: '',
                    remarks: '',
                    example: ''
                };

                // type, name, desc
                ano.type = symbols['prop'][0] || 'object';
                ano.name = symbols['prop'][1]; if(!ano.name) { throw `Document block must carry prop name at @prop symbol.`; }
                ano.desc = symbols['prop'][2];

                // scope
                if (symbols['public']) {
                    ano.scope = 'public';
                } else if (symbols['protected-set']) {
                    ano.scope = 'public (get), protected (set))';
                } else if (symbols['protected']) {
                    ano.scope = 'protected';
                } else if (symbols['private-set']) {
                    ano.scope = 'public (get), private (set))';
                } else if (symbols['private']) {
                    ano.scope = 'private';
                } else {
                    ano.scope = 'public';
                }

                // static, modifiers
                ano.static = symbols['static'] ? true : false;
                if (!ano.static) {
                    if (symbols['abstract']) {
                        ano.modifiers.push('abstract');
                    } else if (symbols['virtual']) {
                        ano.modifiers.push('virtual');
                    } else if (symbols['override']) {
                        ano.modifiers.push('override');
                        if (symbols['sealed']) { ano.modifiers.push('sealed'); }
                    }
                }

                // since, deprecated
                ano.deprecated = symbols['deprecated'] || '';
                if (!ano.deprecated) {
                    ano.since = symbols['since'] || '';
                }

                // others
                ano.readonly = symbols['readonly'] ? true : false;
                ano.optional = symbols['optional'] ? true : false;
                ano.conditional = symbols['conditional'] || [];
                ano.remarks = symbols['remarks'] || '';
                ano.example = symbols['example'] || '';
                
                return ano;
            },
            MethodAnnotation: function(symbols) {
                /** 
                 * @func <name> - <desc>                                                [mandatory]
                 * @overload                                                            [optional, mandatory only when there are same name methods]
                 * @public | @private | @protected                                      [optional][default: public]
                 * @abstract | @virtual | @override | @sealed                           [optional]
                 * @static                                                              [optional]
                 * @async                                                               [optional]
                 * @generator                                                           [optional]
                 * @optional                                                            [optional]
                 * @conditional <cond1>, <cond2>, ...                                   [optional]
                 * @deprecated <desc>                                                   [optional]
                 * @since <version>                                                     [optional]
                 * @param {<type>} <name> - <desc>                                      [optional]
                 * @returns {<type>} <desc> | @yields {<type>} <desc>                   [optional][default: void]
                 * @throws {<type>} <desc>                                              [optional]
                 * @remarks                                                             [optional]
                 *      <multi-line markdown format desc>
                 * @exmple                                                              [optional]
                 *      <multi-line markdown format text and embedded code>
                */
               let ano = {
                    isMember: true,
                    isMethod: true,
                    name: '',
                    desc: '',
                    scope: 'public',
                    modifiers: [],
                    static: false,
                    async: false,
                    overload: false,
                    optional: false,
                    conditional: [],
                    deprecated: '',
                    since: '',
                    params: [], // [ { type, name, desc } ]
                    signature: '',
                    generator: false,
                    returns: {
                        type: '',
                        desc: ''
                    },
                    yields: {
                        type: '',
                        desc: ''
                    },
                    throws: [], // [ { type, desc } ]
                    remarks: '',
                    example: ''
                };  

                // name, desc
                ano.name = symbols['func'][0]; if(!ano.name) { throw `Document block must carry func name at @func symbol.`; }
                ano.desc = symbols['func'][1];

                // scope
                if (symbols['public']) {
                    ano.scope = 'public';
                } else if (symbols['protected']) {
                    ano.scope = 'protected';
                } else if (symbols['private']) {
                    ano.scope = 'private';
                } else {
                    ano.scope = 'public';
                }

                // static, modifiers
                ano.static = symbols['static'] ? true : false;
                if (!ano.static) {
                    if (symbols['abstract']) {
                        ano.modifiers.push('abstract');
                    } else if (symbols['virtual']) {
                        ano.modifiers.push('virtual');
                    } else if (symbols['override']) {
                        ano.modifiers.push('override');
                        if (symbols['sealed']) { ano.modifiers.push('sealed'); }
                    }
                }

                // params, signature
                ano.params = symbols['param'] || [];
                if (ano.params.length > 0) {
                    let types = '';
                    for(let p of ano.params) { // [ [type, name, desc] ]
                        if (types) { types += ', '; }
                        if (!p[0]) { throw `Param type must be defined at @param symbol. (${ano.name})`; }
                        types += p[0];
                    }
                    ano.signature = `${ano.name}(${types})`;
                } else {
                    ano.signature = `${ano.name}()`;
                }

                // generator, returns, yields
                ano.generator = symbols['generator'] ? true : false;
                if (ano.generator) {
                    ano.returns = {
                        type: 'Generator',
                        desc: ''                
                    };
                    if (!symbols['yields']) { throw `Document block must carry @yields symbol for a generator function. (${ano.name})`; }
                    ano.yields = {
                        type: symbols['yields'][0],
                        desc: symbols['yields'][1]
                    };
                    if (!ano.yields.type) { throw `Document block must carry yield type at @yields symbol. (${ano.name})`; }
                } else {
                    ano.yields = null;
                    if (symbols['returns']) { 
                        ano.returns = {
                            type: symbols['returns'][0],
                            desc: symbols['returns'][1]
                        };
                        if (!ano.returns.type) { throw `Document block must carry return type at @returns symbol or omit the @returns symbol, if there is no return value. (${ano.name})`; }
                    } else {
                        ano.returns = {
                            type: 'void',
                            desc: ''
                        };         
                    }
                }

                // throws
                ano.throws = symbols['throws'] || [];
                if (ano.throws.length > 0) {
                    for(let e of ano.throws) { // [ [type, desc] ]
                        if (!e[0]) { throw `Exception type must be defined at @throws symbol. (${ano.name})`; }
                    }
                }

                // since, deprecated
                ano.deprecated = symbols['deprecated'] || '';
                if (!ano.deprecated) {
                    ano.since = symbols['since'] || '';
                }

                // others
                ano.async = symbols['async'] ? true : false;
                ano.overload = symbols['overload'] ? true : false;
                ano.optional = symbols['optional'] ? true : false;
                ano.conditional = symbols['conditional'] || [];
                ano.remarks = symbols['remarks'] || '';
                ano.example = symbols['example'] || '';
                
                return ano;
            },    
            EventAnnotation: function(symbols) {
                /** 
                 * @event <name> - <desc>                                               [mandatory]
                 * @public | @private | @protected                                      [optional][default: public]
                 * @abstract | @virtual | @override | @sealed                           [optional]
                 * @optional                                                            [optional]
                 * @conditional <cond1>, <cond2>, ...                                   [optional]
                 * @deprecated <desc>                                                   [optional]
                 * @since <version>                                                     [optional]
                 * @param {<type>} <name> - <desc>                                      [optional]
                 * @remarks                                                             [optional]
                 *      <multi-line markdown format desc>
                 * @exmple                                                              [optional]
                 *      <multi-line markdown format text and embedded code> 
                */
               let ano = {
                    isMember: true,
                    isEvent: true,
                    name: '',
                    desc: '',
                    scope: 'public',
                    modifiers: [],
                    optional: false,
                    conditional: [],
                    deprecated: '',
                    since: '',
                    params: [], // [ { type, name, desc } ]
                    signature: '',
                    remarks: '',
                    example: ''
                };  

                // name, desc
                ano.name = symbols['event'][0]; if(!ano.name) { throw `Document block must carry event name at @event symbol.`; }
                ano.desc = symbols['event'][1];

                // scope
                if (symbols['public']) {
                    ano.scope = 'public';
                } else if (symbols['protected']) {
                    ano.scope = 'protected';
                } else if (symbols['private']) {
                    ano.scope = 'private';
                } else {
                    ano.scope = 'public';
                }

                // modifiers
                if (symbols['abstract']) {
                    ano.modifiers.push('abstract');
                } else if (symbols['virtual']) {
                    ano.modifiers.push('virtual');
                } else if (symbols['override']) {
                    ano.modifiers.push('override');
                    if (symbols['sealed']) { ano.modifiers.push('sealed'); }
                }

                // params, signature
                ano.params = symbols['param'] || [];
                if (ano.params.length > 0) {
                    let types = '';
                    for(let p of ano.params) { // [ [type, name, desc] ]
                        if (types) { types += ', '; }
                        if (!p[0]) { throw `Param type must be defined at @param symbol. (${ano.name})`; }
                        types += p[0];
                    }
                    ano.signature = `${ano.name}(${types})`;
                } else {
                    ano.signature = `${ano.name}()`;
                }

                // since, deprecated
                ano.deprecated = symbols['deprecated'] || '';
                if (!ano.deprecated) {
                    ano.since = symbols['since'] || '';
                }

                // others
                ano.optional = symbols['optional'] ? true : false;
                ano.conditional = symbols['conditional'] || [];
                ano.remarks = symbols['remarks'] || '';
                ano.example = symbols['example'] || '';

                return ano;
            }     
        },
        grepSegments: (code) => {
            // credits: https://www.npmjs.com/package/jsdoc-regex
            // https://stackoverflow.com/questions/35905181/regex-for-jsdoc-comments
            let rx = new RegExp(/[ \t]*\/\*\*\s*\n([^*]*(\*[^/])?)*\*\//g); 

            return code.match(rx);
        },
        parseSegment: (segment, typeName, typeType, typeDesc) => {
            // NOTE: it will leave all unknown/unsupported symbols
            // known symbols and format types are:
            //
            // Type 1: @<symbol>
            // Supported: 
            //  @public | @private |  @private-set | @protected | @protected-set
            //  @abstract | @virtual | @override | @sealed
            //  @overload
            //  @optional
            //  @static
            //  @async
            //  @generator
            //  @readonly
            // 
            // Type 2: @<symbol> value
            //  @type <desc>
            //  @extends <class-type>
            //  @deprecated <desc>
            //  @since <version>
            //                                         
            // Type 3: @<symbol> value1, value2, ...
            //  @mixes <mixin-type>, <mixin-type>, ...
            //  @implements <interface-type>, <interface-type>, ...
            //
            // Type 4: @<symbol> { value1 } value2
            //  @returns {<type>} <desc> | @yields {<type>} <desc>
            //  @throws {<type>} <desc>                                 [multiple allowed]
            //
            // Type 5: @<symbol> { value1 } value2 - value3
            //  @param {<type>} <name> - <desc>                         [multiple allowed]
            //  @prop {<type>} <name> - <desc>
            //  
            // Type 6: @<symbol> value1 - value2
            //  @func <name> - <desc>
            //  @event <name> - <desc>
            //
            // Type 7: @<symbol> \n multi-line value
            //  @remarks                                                
            //  @example                                                
            let lines = segment.split('\n'),
                line = '',
                symbol = '',
                symbolData = '',
                items = [],
                idx = -1,
                isIgnore = false,
                annotation = null,
                symbols = {},
                type1 = ['public', 'private', 'private-se', 'protected', 'protected-set', 'abstract', 'virtual', 'override', 'sealed', 'overload', 'optional', 'static', 'async', 'generator', 'readonly'],
                type2 = ['type', 'extends', 'deprecated', 'since'],
                type3 = ['mixes', 'implements'],
                type4 = ['returns', 'yields', 'throws'],
                type5 = ['param', 'prop'],
                type6 = ['func', 'event'],
                type7 = ['example', 'remarks'],
                multiInstance = ['param', 'throws'];
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

                        // multi instance error check
                        if (symbols[symbol] && multiInstance.indexOf(symbol) === -1) {
                            throw `Multiple instances of @${symbol} are not allowed. (${segment})`;
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

            // build right type of annotation from segment
            if (symbols['type']) {
                annotation = new jsdocs2md.annotations.TypeAnnotation(symbols, typeName, typeType, typeDesc);
            } else if (symbols['prop']) {
                annotation = new jsdocs2md.annotations.PropertyAnnotation(symbols); 
            } else if (symbols['func']) {
                annotation = new jsdocs2md.annotations.MethodAnnotation(symbols);
            } else if (symbols['event']) {
                annotation = new jsdocs2md.annotations.EventAnnotation(symbols);
            } else {
                //throw `Documentation block could not be idenfied. One of @type/@prop/@func/@event symbols must be added in every block.`;
            }

            // return
            return annotation;
        }, 
        getAnnotations: (name, type, desc, code) => {
            // process each segment
            let segments = jsdocs2md.grepSegments(code),
                typeAnnotation = null,
                memberName = {}, // annotation
                propAnnotations = [], // [name]
                methodAnnotations = [], // [name]
                eventAnnotations = [], // [name]
                a = null,
                annotations = {
                    type: null,
                    members: 0,
                    constructors: [],
                    destructors: [],                    
                    properties: [],
                    methods: [],
                    events: []
                };
            for(let segment of segments) {
                a = jsdocs2md.parseSegment(segment, name, type, desc);
                if (a) {
                    if (a.isType) { // type
                        if (typeAnnotation) { throw `Only one block can have @type symbol. (${a.name})`; }
                        typeAnnotation = a;
                    } else if (a.isMember && a.isProperty) { // member: property
                        if (memberName[a.name]) { throw `Only one definition can exisit for a member. (${a.name})`; }
                        memberName[a.name] = a; 
                        propAnnotations.push(a.name);
                    } else if (a.isMember && a.isMethod) { // member: method
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
                    } else if (a.isMember && a.isEvent) { // member: event
                        if (memberName[a.name]) { throw `Only one definition can exisit for a member. (${a.name})`; }
                        memberName[a.name] = a;
                        eventAnnotations.push(a.name);
                    }
                }
            }
            if (!typeAnnotation) { 
                throw `There must be at least one block carrying @type symbol.`; 
            }

            // define render ready annotations structure
            // type
            annotations.type = typeAnnotation;

            // properties
            propAnnotations.sort(); // sort by name
            for(let propName of propAnnotations) {
                annotations.properties.push(memberName[propName]);
                annotations.members++;
            }

            // methods
            methodAnnotations.sort(); // sort by name
            for(let methodName of methodAnnotations) {
                if (methodName === 'construct') { // constructor
                    annotations.constructors.push(...memberName[methodName]);
                    annotations.members++;
                } else if (methodName === 'dispose') { // destructor
                    annotations.destructors.push(...memberName[methodName]);
                    annotations.members++;
                } else { // others
                    annotations.methods.push(...memberName[methodName]);
                    annotations.members++;
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
                annotations.members++;
            }

            return annotations;
        }, 
        sections: {
            support: {
                getId: (name, sig) => {
                    sig = sig.replace('(', '.').replace(')', '.');
                    sig = replaceAll(sig, ', ', '.');
                    return name + '.' + sig;
                },
                getMembersId: (name) => {
                    return name + ':' + 'members';
                },
                getNameAndLink: (typeName, memberName) => {
                    let section = '';
                    const support = jsdocs2md.sections.support;
                    
                    section += `\n\n<span id="${support.getId(typeName, memberName)}"><a href="#${support.getMembersId(typeName)}">**${memberName}**</a></span>`;

                    return section;
                },
                getDesc: (ano, isAddType) => {
                    let section = '';

                    if (ano.desc) {
                        if (isAddType) {
                            section += `> \` ${ano.type} \` &nbsp; ${ano.desc}\n`;
                        } else {
                            section += `> ${ano.desc}\n`;
                        }
                        section += `>\n`;
                    }

                    return section;
                },
                getScopeAndOthers: (ano, isStatic, isAsync, isGenerator) => {
                    let section = '';

                    section += ` [${ano.scope}`;
                    if (isStatic && ano.static) { section += `, static`; }
                    if (isAsync && ano.async) { section += `, async`; }
                    if (isGenerator && ano.generator) { section += `, generator`; }
                    section += '] &nbsp; ';

                    return section;
                },
                getModifiers: (ano) => {
                    let section = '';

                    if (ano.modifiers.length > 0) {
                        section += `_modifiers_ [${ano.modifiers.join(', ')}]`;
                    }    
                    section += '\n';

                    return section;
                },
                getParams: (ano) => {
                    let section = '';

                    if (ano.params.length > 0) {
                        section += `> **Parameters**\n`;
                        section += `>\n`;
                        for(let p of ano.params) {
                            section += `> * ${p[1]} &nbsp; \` ${p[0]} \` &nbsp; ${p[2]}\n`;
                        }
                        section += `>\n`;
                    }

                    return section;
                },
                getReturns: (ano) => {
                    let section = '';

                    section += '> **Returns**\n';
                    section += `>\n`;
                    section += `> \` ${ano.returns.type} \` &nbsp; ${ano.returns.desc}\n`;
                    section += `>\n`;

                    return section;
                },
                getYields: (ano) => {
                    let section = '';

                    if (ano.generator && ano.yields) {
                        section += '> **Yields** \n>\n';
                        section += `> \` ${ano.yields.type} \` &nbsp; ${ano.yields.desc}\n`;
                        section += `>\n`;
                    }

                    return section;
                },                
                getExceptions: (ano) => {
                    let section = '';
                    
                    if(ano.throws.length > 0) {
                        section += `> **Exceptions**\n`;
                        section += `>\n`;
                        for(let t of ano.throws) {
                            section += `> * \` ${t[0]} \` &nbsp; ${t[1]}\n`;
                        }
                        section += `>\n`;
                    }

                    return section;
                },
                getRemarks: (ano) => {
                    let section = '';

                    if (ano.remarks) {
                        section += '> **Remarks**\n';
                        section += `>\n`;
                        ano.remarks = '> ' + ano.remarks;
                        section += replaceAll(ano.remarks, '\n', '\n> ');
                        section += `>\n`;
                    }                    

                    return section;
                },
                getExample: (ano) => {
                    let section = '';

                    if (ano.example) {
                        section += '> **Example**\n';
                        section += `>\n`;
                        ano.example = '> ' + ano.example;
                        section += replaceAll(ano.example, '\n', '\n> ');
                        section += `>\n`;
                    }  

                    return section;
                },
                getAdditionalInfo: (type, ano) => {
                    let section = '';

                    if ((type === 'Interface' && ano.optional) || ano.conditional.length > 0 || ano.deprecated || ano.since) {
                        section += '> **Additional Information**\n';
                        section += `>\n`;
                        section += ano.since ? `> * _Since:_ ${ano.since}\n` : '';
                        section += ano.deprecated ? `> * _Deprecated:_ ${ano.deprecated}\n` : '';
                        section += ano.optional ? `> * _Optional:_ This member is optional and interface's compliance will pass even if this member is not implemented by the class.\n` : '';
                        section += ano.conditional.length > 0 ? `> * _Conditional:_ This member is conditional and will be present only when all of the following runtime environmental conditions are met.\n` + `> ${ano.conditional.join(', ')}\n` : '';
                        section += `>\n`;
                    }   

                    return section;                    
                }
            },            
            header: (ano) => {
                let section = '';

                // name and link
                section += `</br>\n<h3 id="${ano.type.name}"><a href="#types">${ano.type.name}</a></h3>\n\n`;
                
                // type
                section += `\`${ano.type.type}\``;

                // scope, static
                section += ` [${ano.type.scope}`
                if (ano.type.static) { section += `, static`; }
                section += '] &nbsp; ';

                // modifiers
                if (ano.type.modifiers.length > 0) {
                    section += `_modifiers_ [${ano.type.modifiers.join(', ')}]`;
                }

                // extends, mixes, implements
                if (ano.type.extends || ano.type.mixes.length > 0 || ano.type.implements.length > 0) {
                    section += '\n\n';
                    if (ano.type.extends) { 
                        section += `_extends_ <a href="${ano.type.extends}">${ano.type.extends}</a> &nbsp; `;
                    }
                    if (ano.type.mixes.length > 0) {
                        section += `_mixes_ `;
                        let i = -1;
                        for(let mix of ano.type.mixes) {
                            i++;
                            if (i > 0) { section += ', '; }
                            section += `<a href="#${mix}">${mix}</a>`;
                        }  
                        section += ` &nbsp; `;
                    }
                    if (ano.type.implements.length > 0) {
                        section += `_implements_ `;
                        let i = -1;
                        for(let im of ano.type.implements) {
                            i++;
                            if (i > 0) { section += ', '; }
                            section += `<a href="#${im}">${im}</a>`;
                        }  
                        section += ` &nbsp; `;
                    }                    
                }

                // line
                section += `\n\n***\n\n`;

                return section;
            },
            desc: (ano) => {
                let section = '';

                // desc
                if (ano.type.desc) {
                    section += `${ano.type.desc}`;
                    section += '\n\n';
                }

                return section;
            },
            members: (ano) => {
                let section = '';

                // members
                if (ano.members > 0) {
                    const support = jsdocs2md.sections.support;

                    section += '\n\n';
                    section += `<span id="${support.getMembersId(ano.type.name)}">**Members**</span>\n\n`;
                    section += `Name | Description\n`;
                    section += `:---|:---\n`;

                    // constructors
                    if (ano.constructors.length > 0) {
                        section += `**Constructors** | \n`;
                        for (let ano_c of ano.constructors) {
                            section += `<a href="#${support.getId(ano.type.name, ano_c.signature)}">${ano_c.signature}</a>`;
                            section += `| ${ano_c.desc}\n`;
                        }
                    }

                    // destructors
                    if (ano.destructors.length > 0) {
                        section += `**Destructors** | \n`;
                        for (let ano_d of ano.destructors) {
                            section += `<a href="#${support.getId(ano.type.name, ano_d.signature)}">${ano_d.signature}</a>`;
                            section += `| ${ano_d.desc}\n`;
                        }
                    }

                    // properties
                    if (ano.properties.length > 0) {
                        section += `**Properties** | \n`;
                        for (let ano_p of ano.properties) {
                            section += `<a href="#${support.getId(ano.type.name, ano_p.name)}">${ano_p.name}</a>` + (ano_p.static ? ' &nbsp; ` static `': '');
                            section += `| ${ano_p.desc}\n`;
                        }
                    }

                    // functions
                    if (ano.methods.length > 0) {
                        section += `**Functions** | \n`;
                        for (let ano_m of ano.methods) {
                            section += `<a href="#${support.getId(ano.type.name, ano_m.signature)}">${ano_m.signature}</a>` + (ano_m.static ? ' &nbsp; ` static `' : '');
                            section += `| ${ano_m.desc}\n`;
                        }
                    }

                    // events
                    if (ano.events.length > 0) {
                        section += `**Events** | \n`;
                        for (let ano_e of ano.events) {
                            section += `<a href="#${support.getId(ano.type.name, ano_e.signature)}">${ano_e.signature}</a>`;
                            section += `| ${ano_e.desc}\n`;
                        }
                    }
                }
               
                return section;
            },
            details: (ano) => {
                let section = '';

                // remarks
                if (ano.type.remarks) {
                    section += '\n\n';
                    section += '**Remarks**\n\n';
                    section += ano.type.remarks;
                }

                // example
                if (ano.type.example) {
                    section += '\n\n';
                    section += '**Example**\n\n';
                    section += ano.type.example;
                }

                return section;
            },
            constructors: (ano) => {
                let section = '';

                if (ano.constructors.length > 0) {
                    const support = jsdocs2md.sections.support;

                    section += '\n\n**Constructors**\n\n';
                    for (let ano_c of ano.constructors) {
                        section += support.getNameAndLink(ano.type.name, ano_c.signature); // name and link
                        section += support.getScopeAndOthers(ano_c); // scope
                        section += support.getModifiers(ano_c); // modifiers
                        section += support.getDesc(ano_c); // desc
                        section += support.getParams(ano_c); // params
                        section += support.getExceptions(ano_c); // throws
                        section += support.getRemarks(ano_c); // remarks
                        section += support.getExample(ano_c); // example
                        section += support.getAdditionalInfo(ano.type.type, ano_c); // additional information
                    }
                }

                return section;
            },
            destructors: (ano) => {
                let section = '';

                if (ano.destructors.length > 0) {
                    const support = jsdocs2md.sections.support;

                    section += '\n\n**Destructors**\n\n';
                    for (let ano_d of ano.destructors) {
                        section += support.getNameAndLink(ano.type.name, ano_d.signature); // name and link
                        section += support.getScopeAndOthers(ano_d); // scope
                        section += support.getModifiers(ano_d); // modifiers
                        section += support.getDesc(ano_d); // desc
                        section += support.getParams(ano_d); // params
                        section += support.getExceptions(ano_d); // throws
                        section += support.getRemarks(ano_d); // remarks
                        section += support.getExample(ano_d); // example
                        section += support.getAdditionalInfo(ano.type.type, ano_d); // additional information
                    }
                }

                return section;
            },    
            properties: (ano) => {
                let section = '';

                if (ano.properties.length > 0) {
                    const support = jsdocs2md.sections.support;

                    section += '\n\n**Properties**\n\n';
                    for (let ano_p of ano.properties) {
                        section += support.getNameAndLink(ano.type.name, ano_p.name); // name and link
                        section += support.getScopeAndOthers(ano_p, true); // scope, static
                        section += support.getModifiers(ano_p); // modifiers
                        section += support.getDesc(ano_p, true); // type, desc
                        section += support.getRemarks(ano_p); // remarks
                        section += support.getExample(ano_p); // example
                        section += support.getAdditionalInfo(ano.type.type, ano_p); // additional information
                    }
                }

                return section;
            },  
            methods: (ano) => {
                let section = '';

                if (ano.methods.length > 0) {
                    const support = jsdocs2md.sections.support;

                    section += '\n\n**Functions**\n\n';
                    for (let ano_m of ano.methods) {
                        section += support.getNameAndLink(ano.type.name, ano_m.signature); // name and link
                        section += support.getScopeAndOthers(ano_m, true, true, true); // scope, static, async, generator
                        section += support.getModifiers(ano_m); // modifiers
                        section += support.getDesc(ano_m); // desc
                        section += support.getParams(ano_m); // params
                        section += support.getReturns(ano_m); // returns
                        section += support.getYields(ano_m); // yields
                        section += support.getExceptions(ano_m); // throws
                        section += support.getRemarks(ano_m); // remarks
                        section += support.getExample(ano_m); // example
                        section += support.getAdditionalInfo(ano.type.type, ano_m); // additional information
                    }
                }

                return section;
            },  
            events: (ano) => {
                let section = '';

                if (ano.events.length > 0) {
                    const support = jsdocs2md.sections.support;

                    section += '\n\n**Events**\n\n';
                    for (let ano_e of ano.events) {
                        section += support.getNameAndLink(ano.type.name, ano_e.signature); // name and link
                        section += support.getScopeAndOthers(ano_e); // scope
                        section += support.getModifiers(ano_e); // modifiers
                        section += support.getDesc(ano_e); // desc
                        section += support.getParams(ano_e); // params
                        section += support.getRemarks(ano_e); // remarks
                        section += support.getExample(ano_e); // example
                        section += support.getAdditionalInfo(ano.type.type, ano_e); // additional information
                    }
                }

                return section;
            },   
            footer: (ano) => {
                let section = '';

                // remarks
                if (ano.type.deprecated || ano.type.since) {
                    section += '\n\n';
                    section += '**Additional Information**\n\n';
                    section += ano.type.since ? `* _Since:_ ${ano.type.since}` : '';
                    section += ano.type.deprecated ? `* _Deprecated:_ ${ano.type.deprecated}` : '';
                }

                // line
                section += `\n\n`;

                return section;
            }                                                       
        },
        render: (ano) => {
            // render supports jsdoc (https://jsdoc.app/) style documentation with some changed and some similar meaning symbols
            // Refer comments inside: TypeAnnotation, PropertyAnnotation, MethodAnnotation, EventAnnotation for exact details of supported symbols
 
            // render sections
            let doc = '';
            doc += jsdocs2md.sections.header(ano);
            doc += jsdocs2md.sections.desc(ano);
            doc += jsdocs2md.sections.members(ano);
            doc += jsdocs2md.sections.details(ano);
            doc += jsdocs2md.sections.constructors(ano);
            doc += jsdocs2md.sections.destructors(ano);
            doc += jsdocs2md.sections.properties(ano);
            doc += jsdocs2md.sections.methods(ano);
            doc += jsdocs2md.sections.events(ano);
            doc += jsdocs2md.sections.footer(ano);

            // return
            return doc;
        }
    };
    const asm2md = {
        render: {
            header: (options) => {
                let section = asm_doc_header;

                section = replaceAll(section, '<<title>>',  options.packageJSON.title);
                section = replaceAll(section, '<<repo>>',  options.packageJSON.link || options.packageJSON.repository.url || '');
                section = replaceAll(section, '<<desc>>',  options.current.ado.desc);
                section = replaceAll(section, '<<copyright>>', options.current.ado.copyright.replace('(C)', '&copy;').replace('(c)', '&copy;'));
                section = replaceAll(section, '<<license>>', options.current.ado.license || 'undefined license');

                return section;
            },
            assembly: (options) => {
                let section = asm_doc_assembly;

                section = replaceAll(section, '<<asm>>', options.current.ado.name);
                section = replaceAll(section, '<<version>>', options.current.ado.version);
                section = replaceAll(section, '<<lupdate>>', options.current.ado.lupdate);

                // file list
                let jsFile = options.current.asm.replace(options.current.dest + '/', ''),
                    minFile = options.current.asm.replace('.js', '.min.js'),
                    gzFile = options.current.asm.replace('.js', '.min.js.gz');
                let fileList = `[${jsFile}](./${jsFile})`;
                fileList += ' (' + Math.round(fsx.statSync(options.current.asm).size / 1024) + 'k';
                if (fsx.existsSync(minFile)) {
                    fileList += ', ' + Math.round(fsx.statSync(minFile).size / 1024) + `k [minified](${minFile})`;
                }
                if (fsx.existsSync(gzFile)) {
                    fileList += ', ' + Math.round(fsx.statSync(gzFile).size / 1024) + `k [gzipped](${gzFile})`;
                }
                fileList += ')';
                section = replaceAll(section, '<<file_list>>', fileList);

                // availableSections
                let availableSections = '[Namespaces](#namespaces)';
                if (options.current.ado.types.length > 0) { availableSections += ' &nbsp;||&nbsp; [Types](#types)'; }
                if (options.current.ado.resources.length > 0) { availableSections += ' &nbsp;||&nbsp; [Resources](#resources)'; }
                if (options.current.ado.assets.length > 0) { availableSections += ' &nbsp;||&nbsp; [Assets](#assets)'; }
                if (options.current.ado.routes.length > 0) { availableSections += ' &nbsp;||&nbsp; [Routes](#routes)'; }
                section = section.replace('<<sections>>', availableSections);

                return section;
            },
            ns: (options) => {
                let section = asm_doc_ns;

                if (options.current.ado.ns.length > 0) {
                    let nsList = '';
                    for(let thisNS of options.current.ado.ns) {
                        nsList += '<<name>> | <<desc>>'
                            .replace('<<name>>', thisNS.name)
                            .replace('<<desc>>', thisNS.desc + '\n');
                    }
                    section = section.replace('<<list>>', nsList);
                } else {
                    section = '';
                }

                return section;
            },
            types: (options) => {
                let section = asm_doc_types;

                const processMembers = (ary, isStatic) => {
                    let _list = '',
                        _api = '';

                    // list
                    for (let o of ary) {
                        _list += `<a href="#<<name>>"><<name>></a>${(isStatic && o.type.static ? ' &nbsp; \` static \`': '')} | <<desc>>`
                        .replace('<<name>>', o.type.name).replace('<<name>>', o.type.name)
                        .replace('<<desc>>', o.type.desc) + '\n';
                        
                        // api
                        _api += jsdocs2md.render(o);
                    }
                    
                    return { list: _list, api: _api };
                };

                if (options.current.ado.types.length > 0) {
                    let tyList = '',
                        tyApi = '',
                        tyCode = '',
                        rslt = null,
                        ano = null,
                        _class = [],
                        _interface = [],
                        _mixin = [],
                        _struct = [],
                        _enum = [];
                    for(let thisTyp of options.current.ado.types) {
                        ano =jsdocs2md.getAnnotations(thisTyp.name, thisTyp.type, thisTyp.desc, options.current.docTypes[thisTyp.name]);
                        if (ano.type.isClass) {
                            _class.push(ano);
                        } else if (ano.type.isInterface) {
                            _interface.push(ano);
                        } else if (ano.type.isMixin) {
                            _mixin.push(ano);
                        } else if (ano.type.isStruct) {
                            _struct.push(ano);
                        } else if (ano.type.isEnum) {
                            _enum.push(ano);
                        }
                    }

                    if (_class.length > 0) {
                        tyList += '**Classes** | \n';
                        rslt = processMembers(_class, true);
                        tyList += rslt.list; tyApi += rslt.api;
                    }

                    if (_interface.length > 0) {
                        tyList += '**Interfaces** | \n';
                        rslt = processMembers(_interface);
                        tyList += rslt.list; tyApi += rslt.api;
                    }

                    if (_mixin.length > 0) {
                        tyList += '**Mixins** | \n';
                        rslt = processMembers(_mixin);
                        tyList += rslt.list; tyApi += rslt.api;
                    }       
                    
                    if (_struct.length > 0) {
                        tyList += '**Structures** | \n';
                        rslt = processMembers(_struct);
                        tyList += rslt.list; tyApi += rslt.api;
                    }           
                    
                    if (_enum.length > 0) {
                        tyList += '**Enums** | \n';
                        rslt = processMembers(_enum);
                        tyList += rslt.list; tyApi += rslt.api;
                    }                       

                    section = section.replace('<<list>>', tyList).replace('<<api>>', tyApi);
                } else {
                    section = '';
                }

                return section;
            },
            resources: (options) => {
                let section = asm_doc_resources;

                if (options.current.ado.resources.length > 0) {
                    let resList = '',
                        resType = '',
                        resSize = '';
                    for(let thisRes of options.current.ado.resources) {
                        resType = (thisRes.type ? ` &nbsp; \` ${thisRes.type} \`` : '');
                        resSize = (thisRes.size && thisRes.size !== '0k' && thisRes.size !== '1k' ? ` &nbsp; \` ${thisRes.size} \`` : ''); // size is shown for >1k resources
                        resList += '<<name>> | <<desc>>'
                            .replace('<<name>>', thisRes.name + resType + resSize)
                            .replace('<<desc>>', thisRes.desc || '&nbsp;') + '\n';
                    }
                    section = section.replace('<<list>>', resList);
                } else {
                    section = '';
                }

                return section;
            },
            assets: (options) => {
                let section = asm_doc_assets;

                if (options.current.ado.assets.length > 0) {
                    let basePath = options.current.asm.replace(options.current.dest + '/', '').replace('.js', '');
                    let astList = '',
                        mainFile = '',
                        baseFile = '',
                        thisAst = {},
                        fileSize = 0,
                        fileType = '',
                        fileExt = '',
                        astPath = options.current.asm.replace('.js', '/');
                    for(let thisAst of options.current.ado.assets) {
                        baseFile = thisAst.file.replace('{.min}', '');
                        mainFile = astPath + baseFile;
                        fileExt = path.extname(thisAst.file).substr(1);
                        fileSize = Math.round(fsx.statSync(mainFile).size / 1024);
                        fileSize = (fileSize > 5 ? ` &nbsp; \` ${fileSize}k \`` : ''); // only assets >5k are shown size 
                        fileType = (thisAst.type === fileExt ? '' : ` &nbsp; \` ${thisAst.type} \``); // file type is shown only where it is a known file type or user defined, which is different from file extension
                        astList += '<<name>> | <<desc>>'
                                    .replace('<<name>>', `[${baseFile}](./${basePath}/${thisAst.file}) ${fileType} ${fileSize}`)
                                    .replace('<<desc>>', thisAst.desc + '\n');
                    }
                    section = section.replace('<<list>>', astList);
                    section = replaceAll(section, '<<base>>', './' + basePath + '/');
                } else {
                    section = '';
                }

                return section;
            },
            routes: (options) => {
                let section = asm_doc_routes;

                if (options.current.ado.routes.length > 0) {
                    let rtList = '',
                        verbs = '';
                    for(let thisRoute of options.current.ado.routes) {
                        verbs = '';
                        for (let v of thisRoute.verbs) { verbs += ` \` ${v} \` `; }
                        
                        rtList += '<<name>> | <<route>> | <<desc>>'
                            .replace('<<name>>', thisRoute.name)
                            .replace('<<route>>', `{${thisRoute.mount}} ${thisRoute.path} &nbsp; ${verbs}`)
                            .replace('<<desc>>', thisRoute.desc + '\n');
                    }
                    section = section.replace('<<list>>', rtList);
                } else {
                    section = '';
                }

                return section;
            },
            extra: (options) => {
                let section = asm_doc_extra;

                if (fsx.existsSync(options.current.docx)) {
                    section = section.replace('<<extra>>', fsx.readFileSync(options.current.docx, 'utf8'));
                } else {
                    section = '';
                }

                return section;
            },
            footer: (options) => {
                let section = asm_doc_footer;

                section = replaceAll(section, '<<engine>>', options.current.ado.builder.name);
                section = replaceAll(section, '<<engine_ver>>', options.current.ado.builder.version);
                section = replaceAll(section, '<<format>>', options.current.ado.builder.format);
                section = replaceAll(section, '<<format_ver>>', options.current.ado.builder.formatVersion);
                
                return section;
            }
        }
    };

    // core engine
    const build = async (options, buildDone) => {
        // logging
        const logger = options.logger

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

        // markdown
        const buildMD = (options) => {
            let docs = '';
    
            // assemble document
            docs += asm2md.render.header(options);
            docs += asm2md.render.assembly(options);
            docs += asm2md.render.ns(options);
            docs += asm2md.render.types(options);
            docs += asm2md.render.resources(options);
            docs += asm2md.render.assets(options);
            docs += asm2md.render.routes(options);
            docs += asm2md.render.extra(options);
            docs += asm2md.render.footer(options);
    
            // clear
            asm2md.annotations = [];
    
            // return
            return docs;
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
            if (['(assets)', '(libs)', '(locales)','(bundle)', '(..)'].indexOf(nsFolder) !== -1) { processNamespaces(done); return; } // skip special folders at namespace level
    
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
                    };
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
                        } else { // try to get type and desc automatically - it looks for first occurance of Interface, Class, etc. and any @type before that place for desc
                            // flairTypes = ['class', 'enum', 'interface', 'mixin', 'struct'],
                            let foundAt = typeContent.indexOf('Class(');
                            if (foundAt !== -1) { 
                                info.type = 'class' 
                            } else {
                                foundAt = typeContent.indexOf('Interface(');
                                if (foundAt !== -1) { 
                                    info.type = 'interface' 
                                } else {
                                    foundAt = typeContent.indexOf('Mixin(');
                                    if (foundAt !== -1) { 
                                        info.type = 'mixin' 
                                    } else {
                                        foundAt = typeContent.indexOf('Enum(');
                                        if (foundAt !== -1) { 
                                            info.type = 'enum' 
                                        } else {
                                            foundAt = typeContent.indexOf('Struct(');
                                            if (foundAt !== -1) { 
                                                info.type = 'struct' 
                                            } 
                                        } 
                                    }                                    
                                }
                            }
                            if (foundAt !== -1) { // found at some level
                                typeContent = typeContent.substr(0, foundAt); // pick all content before we found start of definition
                                foundAt = typeContent.indexOf('@type'); // @type length = 5
                                if (foundAt !== -1) {
                                    typeContent = typeContent.substr(foundAt + 5); // pick after @type
                                    typeContent = typeContent.substr(0, typeContent.indexOf('\n')).trim();
                                    info.desc = typeContent;
                                } 
                            }
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
                    options.current.asmContent = asm_module; // template
                    options.current.asyncTypeLoading = true;
                }

                // process file injections
                options.current.asmContent = injector(options.current.asmPath, options.current.asmContent); 

                // replace payload placeholders and injections
                options.current.asmContent = replaceAll(options.current.asmContent, '<<asm_payload>>', '<!-- inject: ./templates/asm_payload.js -->');
                options.current.asmContent = injector(__dirname, options.current.asmContent); 

                // replace placeholders
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

                // inject global functions
                if (fsx.existsSync(options.current.functions)) {
                    options.current.asmContent = replaceAll(options.current.asmContent, '<<asm_functions>>', `<!-- inject: ${options.current.functions} --> `);
                    options.current.asmContent = injector('./', options.current.asmContent);
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

                // update ado for namespaces from types, resources and routes
                let ns = []; // {  name, desc }
                addNS(ns, options.current.ado.types.map(a => a.name));
                addNS(ns, options.current.ado.resources.map(a => a.name));
                addNS(ns, options.current.ado.routes.map(a => a.name));
                options.current.ado.ns = ns;

                // sort nsby name
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
                    typeWrapper = (options.current.asyncTypeLoading ? asm_type_async : asm_type_sync);
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
                    content = injector('./', content);
                    content = replaceAll(content, '$(', '$$$('); // replace all messed-up calls with correct $$$( eventually becomes $$(
                    content = replaceAll(content, '$.', '$$$.'); // replace all messed-up calls with correct $$$. eventually becomes $$.
        
                    // associate type with namespace
                    content = giveNamespaceAndNameToType(content, nsFile.nsName, nsFile.typeName);

                    // process type injections, if any
                    content = injector(nsFile.nsPath, content);
        
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
                    thisRes = replaceAll(asm_resource, '<<asm_res>>', JSON.stringify(rdo));
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
                    if (options.gzip && !options.current.skipMinify && !options.current.skipMinifyThisAssembly) {
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

                let asmDocContent = buildMD(options);
                fsx.writeFileSync(options.current.asmDoc, asmDocContent.trim(), 'utf8');
                options.current.docx = '';
                options.current.docTypes = {};
                logger(0, 'doc', options.current.asmDoc);
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
            options.current.asmSettings = './' + path.join(options.current.src, options.current.asmName, 'settings.json');
            options.current.asmConfig = './' + path.join(options.current.src, options.current.asmName, 'config.json');
            options.current.skipMinifyThisAssembly = (options.skipMinifyFor.indexOf(asmFolder) !== -1); // skip minify for this assembly, if this is a special file
            options.current.asmLupdate = null;
            options.current.asmContent = '';
            options.current.adoCache = path.join(options.cache, options.current.asmPath + '.json');
            options.current.docx = options.current.asmMain.replace('index.js', 'index.md');
            options.current.docTypes = {};

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
                    preamble_lines += (isFirst ? '' : '\t') + replaceAll(asm_preamble_line, '<<ado>>', JSON.stringify(_ado));
                    isFirst = false;
                }

                // create preamble content
                let preambleContent = replaceAll(asm_preamble, '<<path>>', options.current.dest.replace(options.dest, './'));
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
                            plugin_exec(options.plugins[plugin_name].settings, options, runPlugin);
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
     *                    doc annotations must follow jsdocs syntax: https://jsdoc.app/
     *                    read more here: https://www.npmjs.com/package/jsdoc-to-markdown
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
    const flairBuild = function(options, cb) {
        const config = require('../../shared/options.js').config;

        // build options
        options = options || {};
        options.package = options.package || './package.json';

        options.dest = options.dest || './dist';
        options.src = options.src || './src';
        options.cache = options.cache || './temp';

        options.docs = options.docs || false;
    
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

        // logger
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
        options.logger = logger;

        // start
        logger(0, 'flairBuild', 'start ' + (options.fullBuild ? '(full)' : (options.quickBuild ? '(quick)' : '(default)')), true);

        // delete all dest files
        if (options.clean) {
            delAll(options.dest);
            delAll(options.cache);
            logger(0, 'clean', 'done');
        }

        // bump version number
        bump(options);

        // build
        copyDeps(false, options, () => {
            build(options, () => {
                copyDeps(true, options, () => {
                    logger(0, 'flairBuild', 'end', true, true);
                    if (typeof cb === 'function') { cb(); } 
                });
            });
        });
    };
    
    // return
    return flairBuild;
});