const chalk = require('chalk');
const path = require('path');
const fsx = require('fs-extra');
const pathJoin = require('../../shared/modules/path_join');
const md2html = require('../../shared/modules/md2html').fragment;
const mdPage2html = require('../../shared/modules/md2html').page;
const MiniSearch = require('minisearch');
const copyDir = require('copy-dir');

// docs generation
exports.start = async function(options) {
    // initialize
    options.docs.json = getHome(options);

    // ensure docs root exists
    fsx.ensureDirSync(options.docs.dest.root);

    // copy themes folder as such, so default themes will be copied
    // even if there is any existing default themes, it will overwrite that
    let inbuiltThemes = require.resolve('../templates/docs/themes/default/index.json').replace('/default/index.json', ''); 
    copyDir.sync(inbuiltThemes, pathJoin(options.docs.dest.root, 'themes'), {
        utimes: true,
        mode: true,
        cover: true
    });

    // copy engine files at root/engine and mainfile at root
    let engineFile = require.resolve('../templates/docs/engine/index.html'),
        engineRoot = engineFile.replace('index.html', ''); 
    copyDir.sync(engineRoot, pathJoin(options.docs.dest.root, 'engine'), {
        utimes: true,
        mode: true,
        cover: true
    });
    fsx.copyFileSync(engineFile, pathJoin(options.docs.dest.root, 'index.html')); // copy at root, so gets loaded automatically
};
exports.build = async function(options, asm) {
    let asmDoc = getAsmHome(options, asm),
        homeDoc = options.docs.json,
        asmDocFile = `./${asm.name}/index.json`;

    // add asmDoc items
    asmDoc.items = [];
    writeGlobals(options, asm, asmDoc);
    writeComponents(options, asm, asmDoc);
    writeNamespacesAndTypes(options, asm, asmDoc);
    writeNonCodeAsmMember(options, asm, asmDoc, 'routes');
    writeNonCodeAsmMember(options, asm, asmDoc, 'resources');
    writeNonCodeAsmMember(options, asm, asmDoc, 'assets');
    writeNonCodeAsmMember(options, asm, asmDoc, 'libs');
    writeNonCodeAsmMember(options, asm, asmDoc, 'locales');
    writeNonCodeAsmMember(options, asm, asmDoc, 'config');
    writeNonCodeAsmMember(options, asm, asmDoc, 'settings');

    // write asmDocFile
    homeDoc.asms.push({ file: asmDocFile, name: asmDoc.name, type: asmDoc.memberType, desc: asmDoc.desc });
    writeFile(options, asm, asmDocFile, asmDoc);
};
exports.finish = async function(options) {
    // write assemblies
    writeAssemblies(options)

    // write examples
    writeExamples(options);

    // write tests
    writeTests(options);

    // write guides
    writeGuides(options);

    // write search
    if (options.docs.search.build) { writeSearch(options); }

    // (./content/flairjs/v1/en/index.json)
    writeLocaleHome(options);    

    // (./content/flairjs/v1/index.json)
    writeVersionHome(options);    

    // (./content/flairjs/index.json)
    writeCollectionHome(options);

    // (./index.json)
    writeDocsHome(options);

    // cleanup
    delete options.docs.json;
};

// content readers
const extractBlocks = (content) => {
    // credits: https://www.npmjs.com/package/jsdoc-regex
    // https://stackoverflow.com/questions/35905181/regex-for-jsdoc-comments
    let rx = new RegExp(/[ \t]*\/\*\*\s*\n([^*]*(\*[^/])?)*\*\//g); 

    return content.match(rx) || [];
};
const extractSymbols = (options, name, block) => {
    // NOTE: it will leave all unknown/unsupported symbols
    // known symbols and format types are:
    //
    // Type 1: @<symbol>
    // Supported: 
    //  @public | @private | @protected | @internal
    //  @abstract | @virtual | @override | @sealed
    //  @overload
    //  @static
    //  @async
    //  @flags
    //  @generator
    //  @readonly
    //  @ignore
    //  @type
    //  @optional
    //  @beta
    // 
    // Type 2: @<symbol> value
    //  @desc <desc>
    //  @extends <class-type>
    //  @deprecated <desc>
    //  @restricted <desc>
    //  @since <version>
    //  @seealso <desc>                                         [multiple allowed]
    //                                         
    // Type 3: @<symbol> value1, value2, ...
    //  @mixes <mixin-type>, <mixin-type>, ...
    //  @implements <interface-type>, <interface-type>, ...
    //  @conditional <cond1>, <cond2>, ...
    //
    // Type 4: @<symbol> { value1 } value2
    //  @returns {<type>/<type>} <desc> | @yields {<type>/<type>} <desc>
    //  @throws {<type>} <desc>                                 [multiple allowed]
    //
    // Type 5: @<symbol> { value1 } value2 - value3
    //  @param {<type>} <name> - <desc>                         [multiple allowed] - same name but different types can also be defined individually
    //  @prop {<type>} <name> - <desc>                          
    //  @const {<type>} <name> - <desc> 
    //  @item {<type>} <name> - <desc> 
    //  @spec {<file>} <name> - <desc> 
    //  @fiddle {<fiddleId>} <name> - <desc> 
    //  
    // Type 6: @<symbol> value1 - value2
    //  @func <name> - <desc>
    //  @event <name> - <desc>
    //
    // Type 7: @<symbol> \n multi-line value
    //  @remarks                                                
    //  @example
    //  @fiddle  
    //  @spec
    //  @param
    let lines = block.split('\n'),
        line = '',
        symbol = '',
        symbolData = '',
        symbolDataEx = '',
        items = [],
        idx = -1,
        isIgnore = false,
        isIgnoreBlock = false,
        symbols = {},
        type1 = ['type', 'flags', 'public', 'private', 'protected', 'internal', 'abstract', 'virtual', 'override', 'sealed', 'overload', 'optional', 'beta', 'static', 'async', 'generator', 'readonly', 'ignore'],
        type2 = ['desc', 'extends', 'deprecated', 'restricted', 'since', 'seealso'],
        type3 = ['mixes', 'implements', 'conditional'],
        type4 = ['returns', 'yields', 'throws'],
        type5 = ['param', 'prop', 'const', 'fiddle', 'item', 'spec'],
        type6 = ['func', 'event'],
        type7 = ['example', 'remarks', 'fiddle', 'spec', 'param'],
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
                    throw `Multiple instances of @${symbol} are not allowed. (${name}: ${block})`;
                }

                // get symbol data
                isIgnore = false;  
                symbolData = false;                      
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
                }
                if (type7.indexOf(symbol) !== -1) { // @<symbol> \n multi-line value
                    idx = i;
                    symbolDataEx = '';
                    while(true) {
                        idx++;
                        line = lines[idx].trim();
                        if (line !== '*/' && !line.startsWith('* @')) {
                            line = line.trim().substr(1); // trim then remove * - but don't trim after so indentation is kept as is
                            symbolDataEx += line + '\n';
                        } else {
                            i = idx - 1;
                            break;
                        }
                    }
                    // note: This may be in combination of type4, type5 or type6, means symbolData will be []
                    if (Array.isArray(symbolData)) {
                        symbolData.push(symbolDataEx); // in type4 and type6, this will be at [2] index while in type5 this will be at [3] index
                    } else {
                        symbolData = symbolDataEx;
                    }
                } else if (!symbolData) { // nothing else also matched 
                    // unsupported symbols can also be typos of supported symbols
                    // therefore, allow only predefined unsupported symbols - as custom symbols
                    if (options.docs.customSymbols.indexOf(symbol) !== -1) {
                        isIgnore = true;
                    } else {
                        throw `Documentation symbol '${symbol}' not supported. (${name})`;
                    }
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
    return {}; // empty block
};
const Annotation = function(symbols, type, name, typeOfType) {
    // All Known Symbols
    /** 
     * @type | @func <name> - <desc> | @prop {<type>} name - <desc> | @const {<value>} name - <desc> | @event <name> - <desc> | @item {<link>} name - <desc>
     * @desc <desc>                                             
     * @public | @private | @protected | @internal  
     * @abstract | @virtual | @override | @sealed                           
     * @overload                                                           
     * @static
     * @flags                                                              
     * @async | @generator  
     * @readonly                                                           
     * @extends <class-type>                                    
     * @mixes <mixin-type>, <mixin-type>, ...                   
     * @implements <interface-type>, <interface-type>, ...      
     * @param {<type>} <name> - <desc>                                      
     * @returns {<type>} <desc> | @yields {<type>} <desc>    
     * @throws {<type>} <desc> 
     * @optional    
     * @beta    
     * @conditional <cond1>, <cond2>, ... 
     * @deprecated <desc>                                       
     * @restricted <desc>                                       
     * @since <version>    
     * @remarks                                                 
     *      <multi-line markdown format desc>
     * @exmple                                                  
     *      <multi-line markdown format text and embedded code>
     * @spec {link} <name> - <desc>
     *      <multi-line markdown format desc>
     * @fiddle {<fiddleId>} <name> - <desc>
     *      <multi-line markdown format desc>
     * @seealso <desc>   
    */  

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
    // NOTE: Any <desc>, <type> or text must be written in plain text, html or markdown syntax.
    // Use only following markdown/html. Note: '(none)' means either no parallel exsts or even 
    // if exists, it is not recommended to use in this context.
    // 
    //  Headings: ####, #####, ###### / h4, h5, h6
    //  Italic: _text_ OR __text__ / <i>text</i>
    //  Bold: *text* OR **text** / <b>text</b>
    //  Strikethrough: ~~text~~ / <strike>text</strike>
    //  Lists: n, *, -, +,  / ol, ul
    //  Line breaks: two or more tariling spaces / <br/>
    //  Tables: / (none)
    //      | Tables        | Are           | Cool  |
    //      | ------------- |:-------------:| -----:|
    //      | col 3 is      | right-aligned | $1600 |
    //      | col 2 is      | centered      |   $12 |
    //      | zebra stripes | are neat      |    $1 |
    //  Blockquotes: > / <blockquote>text</blockquote>
    //  HL: --- / hl
    //  Image: ![text](link) / <img src="./path/file.ext"> <-- use dynamic path injections techniques using data-binding 
    //  Superscript: (none) / <sup>text</sup>
    //  Subscript: (none) / <sub>text</sub>
    //  Code: ```text``` / <code>text</code>
    //  Keyword: `text` / (none)
    //  Hyperlinks: [text](link) / <a href=""></a>
    //      links can be external or internal:
    //      - external: can refer to any external website
    //          href="https://google.com"
    //          - must start with https:// or http://
    //      - internal: can refer to any member of same/other assembly using following pattern:
    //          href="asmName|memberType:memberName::subMemberName~overloadNumber"
    //          asmName:
    //          - can be omitted, if referred member is of current assembly
    //              href="config:doSomething"
    //          - can be asmName, if referred member is of a different assembly
    //              href="flair.fabric|global:onStart"
    //          memberType:  
    //          - can be omitted, if referred member is a 'type'
    //              href="flair.server.IHost"
    //          - can be 'global', 'component', 'namespace', 'type', 'setting', 'config', 'resource', 'route', 'asset', 'lib', 'locale', 'test', 'guide', 'example'
    //              href="flair.fabric|namespace:flair.app"
    //          memberName:  
    //          - must be defined
    //              href="flair.client.ClientHost"
    //          - can be omitted only in member's own documentation when defining link of sub-members
    //            but in that case too sub-member name must follow scope-resolution operator '::'
    //              href="::start"
    //          - can also be omitted in sub-member's documentation when defining link of another sub-member of the same
    //            parent member. e.g., in flair.client.ClientHost::start, if following is found:
    //              href="::end" <-- this is same as: "flair.client.ClientHost::end"
    //          subMemberName:
    //          - must be defined, if referring to a member of the member - e.g., a property, constant, method or event
    //            if not defined, it will take to main page of the member
    //              href="flair.client.ClientHost::start" 
    //          - can be omitted in sub=member's own documentaton when referring to another overload of the same-submember
    //              href="~1". e.g., in flair.client.ClientHost::start, if following is found:
    //              href="~1" <-- this is same as: "flair.client.ClientHost::start~1"
    //          overloadNumber:
    //              - must be defined, if referring to a method member of the member and referring to a specific overload number
    //              - if not defined, and there are overloads, it will take to first overload method
    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////

    const defineSeeAlso = () => {
        let _seeAlso = symbols['seealso'] || []; // [desc]
        if (_seeAlso.length > 0) {
            ano.seealso = [];
            for(let item of _seeAlso) {
                ano.seealso.push(md2html(item));
            }
        }
    };
    const defineFiddle = () => {
        let _fiddle = symbols['fiddle'] || [];
        if (_fiddle.length > 0) {
            ano.fiddle = {
                id: _fiddle[0] || '',
                name: _fiddle[1] || '',
                desc: md2html(_fiddle[2] || ''),
                remarks: md2html(_fiddle[3] || ''),
            };
            if (!ano.fiddle.id) { throw `Fiddle id must be defined at @fiddle symbol. (${ano.name})`; }
            if (!ano.fiddle.name) { throw `Fiddle name must be defined at @fiddle symbol. (${ano.name})`; }
        }
    };
    const defineSpec = () => {
        let _spec = symbols['spec'] || [];
        if (_spec.length > 0) {
            ano.spec = {
                file: _spec[0] || '',
                name: _spec[1] || '',
                desc: md2html(_spec[2] || ''),
                remarks: md2html(_spec[3] || '')
            };
            if (!ano.spec.file) { throw `Spec file must be defined at @spec symbol. (${ano.name})`; }
            if (!ano.spec.name) { throw `Spec name must be defined at @spec symbol. (${ano.name})`; }
        }
    };
    const defineModifiers = () => {
        if (ano.isClass) {
            if (!ano.static) {
                if (symbols['abstract']) {
                    ano.modifiers.push('abstract');
                } else if (symbols['sealed']) {
                    ano.modifiers.push('sealed');
                }
            }
        } else {
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

            // readonly
            if (ano.isProperty && symbols['readonly']) { ano.modifiers.push('readonly'); }
        }
    };
    const defineParamsSignatureAndOverload = () => {
        let _params = symbols['param'] || [],
            p = null;
        for(let _p of _params) { // [ { type, name, desc } ]
            p = { 
                type: md2html(_p[0] || ''), 
                name: _p[1] || '', 
                desc: md2html(_p[2] || ''),
                remarks: md2html(_p[3] || '')
            };
            if (!p.type) { throw `Param type must be defined at @param symbol. (${ano.name})`; }
            if (!p.name) { throw `Param name must be defined at @param symbol. (${ano.name})`; }
            ano.params.push(p);
        }

        // signature
        let signatureTypesList = '';
        if (ano.params && ano.params.length > 0) {
            for(let p of ano.params) {
                if (signatureTypesList) { signatureTypesList += ', '; }
                signatureTypesList += p.type;
            }
            ano.signature = `${ano.name}(${signatureTypesList})`;
        } else {
            ano.signature = `${ano.name}()`;
        }

        // overload
        if (typeof ano.overload !== 'undefined') {    
            ano.overload = symbols['overload'] ? true : false;
            if (ano.overload) { ano.overloadId = ''; } // will be defined once we have all
        }        
    };
    const defineASyncAndGenerator = () => {
        // async, generator
        if (typeof ano.async !== 'undefined') {    
            ano.async = symbols['async'] ? true : false;
            if (!ano.async) {
                ano.generator = symbols['generator'] ? true : false;
            }
        }
    };
    const defineReturnsYieldsAndThrows = () => {
        // returns
        if (ano.isEvent || ano.isAnnotation) {
            ano.returns = {
                type: 'void',
                desc: ''
            };             
        } else {
            if (symbols['returns']) { 
                ano.returns = {
                    type: md2html(symbols['returns'][0] || ''),
                    desc: md2html(symbols['returns'][1]  || '')
                };
                if (!ano.returns.type) { throw `Return type must be defined at @returns symbol. It can be omitted altogether, if there is no return value. (${ano.name})`; }
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
                let _returns = ano.returns;
                ano.returns = {
                    type: _returns.type || 'Generator',
                    desc: md2html(_returns.desc || '')
                };
                if (!symbols['yields']) { throw `@yields must be defined for a generator function. (${ano.name})`; }
                ano.yields = {
                    type: md2html(symbols['yields'][0] || ''),
                    desc: md2html(symbols['yields'][1] || '')
                };
                if (!ano.yields.type) { throw `Yield type must be defined at @yields symbol. (${ano.name})`; }
            } else {
                ano.yields = null;
            }
        }

        // throws
        let _throws = symbols['throws'] || [], // { type, desc }
            e = null;
        if (_throws.length > 0) {
            for(let _e of _throws) { // [ [type, desc] ]
                e = { 
                    type: md2html(_e[0] || ''), 
                    desc: md2html(_e[1] || '')
                };
                if (!e.type) { throw `Exception type must be defined at @throws symbol. (${ano.name})`; }
                ano.throws.push(e);
            }
        }
    };

    // common for all
    /**
     * @desc <desc>                              
     * @deprecated <desc>                                       
     * @restricted <desc> 
     * @since <version>                                         
     * @remarks                                                 
     *      <multi-line markdown format desc>
     * @exmple                                                  
     *      <multi-line markdown format text and embedded code>
     * @fiddle {<fiddleId>} <name> - <desc>
     *      <multi-line markdown format desc>
     * @seealso <desc>  
    */      
    let ano = {
        name: name || '',
        memberType: '',
        scope: 'public',
        desc: md2html(symbols['desc'] || ''),
        deprecated: md2html(symbols['deprecated'] || ''),
        restricted: md2html(symbols['restricted'] || ''),
        since: md2html(symbols['since'] || ''),
        remarks: md2html(symbols['remarks'] || ''),
        example: md2html(symbols['example'] || '')
    };
    defineFiddle();
    defineSpec();
    defineSeeAlso();

    ////////////////////////////////////////////////////////////////
    // super-set of type/type-of-type relations
    //      if (isType === true) {
    //         switch(typeOfType) {
    //             case 'class':
    //             case 'struct':
    //             case 'enum':
    //             case 'mixin':
    //             case 'interface':
    //             case 'component':
    //             case 'annotation':
    //             case 'global':
    //             case 'home':
    //             case 'assembly':
    //             case 'globals':
    //             case 'components':
    //             case 'namespaces':
    //             case 'namespace':
    //             case 'types':
    //             case 'routes':
    //             case 'resources':
    //             case 'assets':
    //             case 'libs':
    //             case 'locales':
    //             case 'config':
    //             case 'settings':
    //             case 'tests':
    //             case 'guides':
    //             case 'examples':
    //         }
    //     } else if (isProperty) {
    //     } else if (isConstant) {
    //     } else if (isMethod) {
    //     } else if (isEvent) {
    //     } else if (isItem) {
    // }
    ////////////////////////////////////////////////////////////////

    // extended
    switch (type) {
        case 'type':
            // common for all type of types
            /** 
             * @type
            */     
            ano.isType = true;
            ano.typeOfType = typeOfType;

            // common for all main types (class, struct, enum, mixin, interface)
            /** 
             * @public | @internal
            */
            if (['class', 'struct', 'enum', 'mixin', 'interface'].indexOf(typeOfType) !== -1) {
                ano.scope = symbols['public'] || symbols['internal'] || 'public'; 

                // ns, justName
                let items = ano.name.split('.');
                if (items.length === 1) {
                    ano.ns = ''; // root namespace
                    ano.justName = name;
                } else {
                    ano.justName = items.splice(items.length - 1, 1)[0];
                    ano.ns = items.join('.');
                }
            }

            // common for non-code types
            /** 
             * @item <name> - <desc>
            */
            if (['routes', 'resources', 'assets', 'libs', 'locales', 'config', 'settings'].indexOf(typeOfType) !== -1) {
                ano.items = []; // [ { name, desc } ]
                ano.isAssemblyMember = true;
            } else if (['tests', 'guides', 'examples'].indexOf(typeOfType) !== -1) {
                ano.items = []; // [ { name, desc } ]
                ano.isHomeMember = true;
            }

            // type specific
            switch(typeOfType) {
                case 'class':
                    /** 
                     * @abstract | @sealed                           
                     * @static                                                              
                     * @extends <class-type>                                    
                     * @mixes <mixin-type>, <mixin-type>, ...                   
                     * @implements <interface-type>, <interface-type>, ...      
                    */
                    ano.isClass = true;
                    ano.memberType = 'Classes';
                    ano.static = symbols['static'] ? true : false;
                    ano.extends = symbols['extends'] || '';
                    ano.mixes = symbols['mixes'] || [];
                    ano.implements = symbols['implements'] || [];
                    ano.modifiers = [];
                    defineModifiers();
                    break;
                case 'struct':
                    /** 
                     * @static                                                              
                    */
                    ano.isStruct = true;
                    ano.memberType = 'Structs';
                    ano.static = symbols['static'] ? true : false;
                    break;
                case 'enum':
                    /** 
                     * @flags
                    */
                    ano.isEnum = true;
                    ano.memberType = 'Enums';
                    ano.flags = symbols['flags'] ? true : false;
                    break;
                case 'mixin':
                    /** 
                    */
                   ano.isMixin = true;
                   ano.memberType = 'Mixins';
                   break;
                case 'interface':
                    /** 
                    */
                    ano.isInterface = true;
                    ano.memberType = 'Interfaces';
                    break;
                case 'component':
                    /** 
                     * @async | @generator  
                     * @param {<type>} <name> - <desc>                                      
                     * @returns {<type>} <desc> | @yields {<type>} <desc>    
                     * @throws {<type>} <desc> 
                    */
                    ano.scope = symbols['public'] || symbols['internal'] || 'internal'; 
                    ano.isComponent = true;
                    ano.memberType = 'Components';
                    ano.params = []; // [ { type, name, desc } ]
                    ano.signature = '';
                    ano.async = false;
                    ano.generator = false;
                    ano.returns = { type: '', desc: '' };
                    ano.yields = { type: '', desc: '' };
                    ano.throws = []; // [ { type, desc } ]
                    defineParamsSignatureAndOverload();
                    defineASyncAndGenerator();
                    defineReturnsYieldsAndThrows();
                    break;
                case 'annotation':
                    /** 
                     * @param {<type>} <name> - <desc>                                      
                     * @throws {<type>} <desc> 
                    */
                    ano.scope = symbols['public'] || symbols['internal'] || 'public'; 
                    ano.isAnnotation = true;
                    ano.memberType = 'Annotations';
                    ano.params = []; // [ { type, name, desc } ]
                    ano.signature = '';
                    ano.throws = []; // [ { type, desc } ]
                    defineParamsSignatureAndOverload();
                    defineReturnsYieldsAndThrows();
                    break;
                case 'global':
                    /** 
                     * @async | @generator  
                     * @param {<type>} <name> - <desc>                                      
                     * @returns {<type>} <desc> | @yields {<type>} <desc>    
                     * @throws {<type>} <desc> 
                    */
                   ano.scope = symbols['public'] || symbols['internal'] || 'internal'; 
                   ano.isGlobal = true;
                   ano.memberType = 'Globals';
                   ano.params = []; // [ { type, name, desc } ]
                   ano.signature = '';
                   ano.async = false;
                   ano.generator = false;
                   ano.returns = { type: '', desc: '' };
                   ano.yields = { type: '', desc: '' };
                   ano.throws = []; // [ { type, desc } ]
                   defineParamsSignatureAndOverload();
                   defineASyncAndGenerator();
                   defineReturnsYieldsAndThrows();
                   break;
                case 'home':
                    /** 
                    */
                   ano.isHome = true;
                   ano.memberType = '';         // empty only for home type
                   break;
                case 'assembly':
                    /** 
                    */
                    ano.isAssembly = true;
                    ano.memberType = 'Assemblies';
                    break;
                case 'globals':
                    /** 
                    */
                    ano.isGlobals = true;
                    ano.memberType = 'Globals';
                    ano.name = 'Globals';
                    break;
                case 'components':
                    /** 
                    */
                    ano.isComponents = true;
                    ano.memberType = 'Components';
                    ano.name = 'Components';
                    break;
                case 'namespaces':
                    /** 
                    */
                    ano.isNamespaces = true;
                    ano.memberType = 'Namespaces';
                    ano.name = 'Namespaces';
                    break;
                case 'namespace':
                    /** 
                    */
                   ano.isNamespace = true;
                   ano.memberType = 'Namespaces';
                   break;
                case 'types':
                    /** 
                    */
                    ano.isTypes = true;
                    ano.memberType = 'Types';
                    ano.name = 'Types';
                    break;
            }
            break;
        case 'prop':
            /** 
             * @prop {<type>} name - <desc>
             * @public | @private | @protected
             * @abstract | @virtual | @override | @sealed                           
             * @static                                                              
             * @readonly                                                           
             * @optional
             * @conditional <cond1>, <cond2>, ... 
            */                  
            ano.isProperty = true;
            ano.isMember = true;
            ano.memberType = 'Properties';
            ano.type = md2html(symbols['prop'][0] || 'object');
            ano.name = symbols['prop'][1]; if(!ano.name) { throw `Property name must be defined at @prop symbol.`; }
            ano.desc = md2html((symbols['prop'][2] || '') + (symbols['desc'] ? '\n' + symbols['desc'] : ''));
            ano.scope = symbols['private'] || symbols['protected'] || symbols['public'] || 'public'; 
            ano.static = symbols['static'] ? true : false;
            ano.optional = symbols['optional'] ? true : false;
            ano.conditional = symbols['conditional'] || [];
            ano.modifiers = [];
            defineModifiers();
            break;      
        case 'const':
            /** 
             * @const {<type>} name - <desc>
             * @public | @private | @protected
             * @static                                                              
             * @optional
             * @conditional <cond1>, <cond2>, ... 
            */                  
            ano.isConstant = true;
            ano.isMember = true;
            ano.memberType = 'Constants';
            ano.type = md2html(symbols['const'][0] || 'object');
            ano.name = symbols['const'][1]; if(!ano.name) { throw `Constant name must be defined at @const symbol.`; }
            ano.desc = md2html((symbols['const'][2] || '') + (symbols['desc'] ? '\n' + symbols['desc'] : ''));
            ano.scope = symbols['private'] || symbols['protected'] || symbols['public'] || 'public'; 
            ano.static = symbols['static'] ? true : false;
            ano.optional = symbols['optional'] ? true : false;
            ano.conditional = symbols['conditional'] || [];
            break;  
        case 'item':
            /** 
             * @item name - <desc>
            */                  
            ano.isItem = true;
            ano.isMember = true;
            ano.memberType = 'Items';
            ano.link = symbols['item'][0]; if(!ano.link) { throw `Item link must be defined at @item symbol.`; }
            ano.name = symbols['item'][1]; if(!ano.name) { throw `Item name must be defined at @item symbol.`; }
            ano.desc = md2html((symbols['item'][2] || '') + (symbols['desc'] ? '\n' + symbols['desc'] : ''));
            break;                                     
        case 'func':
            /** 
             * @func <name> - <desc>
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
            */                  
            ano.isMethod = true;
            ano.isMember = true;
            ano.name = symbols['func'][0]; if(!ano.name) { throw `Function (method) name must be defined at @func symbol.`; }
            ano.desc = md2html((symbols['func'][1] || '') + (symbols['desc'] ? '\n' + symbols['desc'] : ''));
            ano.isConstructor = (ano.name === 'construct');
            ano.isDestructor = (ano.name === 'dispose');
            ano.memberType = (ano.isConstructor ? 'Constructors' : (ano.isDestructor ? 'Destructors' : 'Methods'))
            ano.scope = symbols['private'] || symbols['protected'] || symbols['public'] || 'public'; 
            ano.static = symbols['static'] ? true : false;
            ano.optional = symbols['optional'] ? true : false;
            ano.conditional = symbols['conditional'] || [];
            ano.modifiers = [];
            ano.overload = false;
            ano.overloadId = '';
            ano.params = []; // [ { type, name, desc } ]
            ano.signature = '';
            ano.async = false;
            ano.generator = false;
            ano.returns = { type: '',  desc: '' };
            ano.yields = { type: '', desc: '' };
            ano.throws = []; // [ { type, desc } ]            
            defineModifiers();
            defineParamsSignatureAndOverload();
            defineASyncAndGenerator();
            defineReturnsYieldsAndThrows();
            break;
        case 'event':
            /** 
             * @event <name> - <desc>
             * @public | @private | @protected  
             * @abstract | @virtual | @override | @sealed                           
             * @static                                                              
             * @param {<type>} <name> - <desc>   
             * @throws {<type>} <desc>                                    
             * @optional        
             * @conditional <cond1>, <cond2>, ... 
            */  
            // add
            ano.isEvent = true;
            ano.isMember = true;
            ano.memberType = 'Events';
            ano.name = symbols['event'][0]; if(!ano.name) { throw `Event name must be defined at @event symbol.`; }
            ano.desc = md2html((symbols['event'][1] || '') + (symbols['desc'] ? '\n' + symbols['desc'] : ''));
            ano.scope = symbols['private'] || symbols['protected'] || symbols['public'] || 'public'; 
            ano.static = symbols['static'] ? true : false;
            ano.optional = symbols['optional'] ? true : false;
            ano.conditional = symbols['conditional'] || [];
            ano.modifiers = [];
            ano.params = []; // [ { type, name, desc } ]
            ano.signature = '';
            ano.throws = []; // [ { type, desc } ]
            defineModifiers();
            defineParamsSignatureAndOverload();
            defineReturnsYieldsAndThrows();     
            break;
    }

    // all modifiers
    // update allModifiers to have one sequence of all special and regular modifiers
    ano.allModifiers = [];
    // 1: static
    // 2: <scope>
    // 3: async, generator
    // 4: everything else
    if(ano.static) { ano.allModifiers.push('static'); } 
    ano.allModifiers.push(ano.scope);
    if(ano.async) { ano.allModifiers.push('async'); }
    if(ano.generator) { ano.allModifiers.push('generator'); }
    if (ano.modifiers) { ano.allModifiers.push(...ano.modifiers); }

    return ano;
};
const symbolsToAnnotation = (symbols, name, type) => {
    let annotation = null;
    if (symbols['type']) {
        annotation = new Annotation(symbols, 'type', name, type);
    } else if (symbols['prop']) {
        annotation = new Annotation(symbols, 'prop');
    } else if (symbols['item']) {
        annotation = new Annotation(symbols, 'item');
    } else if (symbols['const']) {
        annotation = new Annotation(symbols, 'const');
    } else if (symbols['func']) {
        annotation = new Annotation(symbols, 'func');
    } else if (symbols['event']) {
        annotation = new Annotation(symbols, 'event');
    } else {
        // ignore the block
        // this is an alternate way of defining the @ignore, otherwise on a known block type
    }

    // return
    return annotation;
};
const buildAnnotationData = (options, asm, member, members, mainAnnotation, itemAnnotations, constAnnotations, propAnnotations, methodAnnotations, eventAnnotations) => {
    const addDocsInfo = (item, parent) => {
        // add docs info
        item.docs = {
            template: '',
            asm: {
                name: (asm ? asm.name : ''),
                link: (asm ? asm.name : '')
            },
            parent: {
                name: '',
                link: ''
            },
            self: '',
            members: ''
        };

        // add 
        if (item.isMember) { // prop, const, func, event, item
            item.docs.parent.name = parent.name;
            item.docs.parent.link = parent.docs.self;
            item.docs.self = `${parent.docs.members}/${item.name}`;
            item.docs.members = item.docs.self; // although there will be no members

            // special cases
            if (item.isMethod && item.overload && item.overloadId) { item.docs.self += '~' + item.overloadId; }

            // templates
            if (item.isProperty) {
                item.docs.template = 'prop';
            } else if (item.isMethod) {
                item.docs.template = 'func';
            } else if (item.isConstant) {
                item.docs.template = 'const';
            } else if (item.isEvent) {
                item.docs.template = 'event';
            } else if (item.isItem) {
                item.docs.template = `${parent.typeOfType}-item`; // routes-item, resources-item, assets-item, libs-item, locales-item, config-item, settings-item, tests-item, guides-item, examples-item
            } else {
                throw `Unknown member type. (${item.name}))`;
            }
        } else if (item.isType) {
            if (['class', 'struct', 'enum', 'mixin', 'interface'].indexOf(item.typeOfType) !== -1) {
                item.docs.template = item.typeOfType; // class, struct, enum, mixin, interface
                item.docs.parent.name = item.ns;
                item.docs.parent.link = `${asm.name}/namespaces/${parent.name || '(root)'}`;
                item.docs.self = `${asm.name}/types/${item.name}`;
                item.docs.members = item.docs.self;
            } else if (['component', 'annotation', 'global'].indexOf(item.typeOfType) !== -1) {
                item.docs.template = item.typeOfType; // component, annotation, global
                item.docs.parent.name = parent.memberType;
                item.docs.parent.link = parent.docs.self;
                item.docs.self = `${parent.docs.members}/${item.name}`;
                item.docs.members = item.docs.self;
            } else if (item.typeOfType === 'namespace') {
                item.docs.template = item.typeOfType; // namespace
                item.docs.parent.name = parent.memberType;
                item.docs.parent.link = parent.docs.self;
                item.docs.self = `${parent.docs.members}/${item.name}`;  
                item.docs.members = `${asm.name}/types`; // namespase members are inside types (same as below)     
            } else if (['globals', 'components', 'namespaces', 'types', 'routes', 'resources', 'assets', 'libs', 'locales', 'config', 'settings'].indexOf(item.typeOfType) !== -1) {
                item.docs.template = item.typeOfType; // globals, components, namespaces, types, routes, resources, assets, libs, locales, config, settings
                item.docs.self = `${asm.name}/${item.typeOfType}`; // /globals, /components, /namespaces, /types, /routes, /resources, /assets, /libs, /locales, /config, /settings
                item.docs.members = item.docs.self;
            } else if (item.typeOfType === 'assembly') {
                item.docs.template = item.typeOfType; // assembly
                item.docs.self = `${asm.name}`; // /asmName
                item.docs.members = item.docs.self;
            } else if (['tests', 'guides', 'examples'].indexOf(item.typeOfType) !== -1) {
                item.docs.template = item.typeOfType; // tests, guides, examples
                item.docs.self = `${item.typeOfType}`; // /tests, /guides, /examples
                item.docs.members = item.docs.self;
            } else if (item.typeOfType === 'home') {
                item.docs.template = ''; // home is served via home.html of theme
                item.docs.self = ``; // '/'
                item.docs.members = item.docs.self;
            } else {
                throw `Unknown type '${item.typeOfType}'. (${item.name}))`;
            }
        } else {
           throw `Unknown type. (${item.name}))`;
        }

        // define parent to be assembly, where parent is not defined
        if (!item.docs.parent.name && asm) {
            item.docs.parent.name = asm.name;
            item.docs.parent.link = `${asm.name}`;
        }
    };

    // build data
    let data = mainAnnotation;
    addDocsInfo(data, member);

    // sort all members
    itemAnnotations.sort(); // sort by name
    constAnnotations.sort(); // sort by name
    propAnnotations.sort(); // sort by name
    methodAnnotations.sort(); // sort by name
    eventAnnotations.sort(); // sort by name

    // note: validations here-under must match to
    // what validations are defined in type builder
    // for applicable types
    const defineItems = (host, memberType) => {
        data.items = [];
        data.name = memberType; // data (main annotation)'s name is same as memberType
        let item = null;
        for(let itemName of itemAnnotations) {
            // get
            item = members[itemName];

            // validations
            // none

            // define memberType
            item.memberType = memberType;

            // add docs info
            addDocsInfo(item, data);

            // add
            data.items.push(item);
        }
    };
    const defineConstants = (host) => {
        data.constants = [];
        let item = null;
        for(let itemName of constAnnotations) {
            // get
            item = members[itemName];

            // add docs info
            addDocsInfo(item, data);

            // validations
            switch(host) {
                case 'enum':
                case 'component':
                case 'annotation':
                case 'global':
                    // scope: always 'public'
                    if (item.scope !== 'public') { throw `Defined member scope is not supported in this type. (${data.name}.${item.name})`; }

                    // static: always 'true'
                    if (!item.static) { item.static = true; }
                    break;
                case 'struct':
                    // scope: always 'public'
                    if (item.scope !== 'public') { throw `Defined member scope is not supported in this type. (${data.name}.${item.name})`; }
                    break;
                case 'class':
                case 'mixin':
                    // no restrictions
                    break;
            }

            // add
            data.constants.push(item);
        }
    };
    const defineProperties = (host) => {
        data.properties = [];
        let item = null;
        for(let itemName of propAnnotations) {
            // get
            item = members[itemName];

            // add docs info
            addDocsInfo(item, data);

            // validations
            switch(host) {
                case 'component':
                case 'annotation':                    
                case 'global':
                    // scope: always 'public'
                    if (item.scope !== 'public') { throw `Defined member scope is not supported in this type. (${data.name}.${item.name})`; }

                    // static: always 'true'
                    if (!item.static) { item.static = true; }

                    // modifiers: only readonly can be defined
                    if (item.modifiers.length !== 0 && item.modifiers[0] !== 'readonly') { throw `Modifiers are not supported in this type. (${data.name}.${item.name})`; }

                    // optional: not supported
                    if (item.optional) { throw `Optional member definition is not supported in this type. (${data.name}.${item.name})`; }

                    // conditional: not supported
                    if (item.conditional.length !== 0) { throw `Conditional member definition is not supported in this type. (${data.name}.${item.name})`; }
                    break;
                case 'struct':
                    // scope: only public/private
                    if (item.scope !== 'public' && item.scope !== 'private') { throw `Defined member scope is not supported in this type. (${data.name}.${item.name})`; }

                    // modifiers: only readonly can be defined
                    if (item.modifiers.length !== 0 && item.modifiers[0] !== 'readonly') { throw `Modifiers are not supported in this type. (${data.name}.${item.name})`; }
                    break;
                case 'interface': 
                    // scope: always 'public'
                    if (item.scope !== 'public') { throw `Defined member scope is not supported in this type. (${data.name}.${item.name})`; }

                    // static: not supported
                    if (item.static) { throw `Static member definition is not supported in this type. (${data.name}.${item.name})`; }

                    // modifiers: not supported
                    if (item.modifiers.length !== 0) { throw `Modifiers are not supported in this type. (${data.name}.${item.name})`; }

                    // optional: not supported
                    if (item.optional) { throw `Optional member definition is not supported in this type. (${data.name}.${item.name})`; }

                    // conditional: not supported
                    if (item.conditional.length !== 0) { throw `Conditional member definition is not supported in this type. (${data.name}.${item.name})`; }
                    break;                    
                case 'class':
                case 'mixin':
                    // no restrictions
                    break;
                case 'interface':
            }                

            // add
            data.properties.push(item);
        }
    };
    const defineMethods = (host) => {
        data.methods = [];
        let items = null;
        for(let itemName of methodAnnotations) {
            // get
            items = members[itemName]; // array of method overloads or just one

            // validations for each item
            for(let item of items) {
                // add docs info
                addDocsInfo(item, data);

                switch(host) {
                    case 'component':
                    case 'annotation':                        
                    case 'global':
                        // scope: always 'public'
                        if (item.scope !== 'public') { throw `Defined member scope is not supported in this type. (${data.name}.${item.name} [${item.signature}])`; }

                        // static: always 'true'
                        if (!item.static) { item.static = true; }

                        // modifiers: not supported
                        if (item.modifiers.length !== 0) { throw `Modifiers are not supported in this type. (${data.name}.${item.name} [${item.signature}])`; }

                        // optional: not supported
                        if (item.optional) { throw `Optional member definition is not supported in this type. (${data.name}.${item.name} [${item.signature}])`; }

                        // conditional: not supported
                        if (item.conditional.length !== 0) { throw `Conditional member definition is not supported in this type. (${data.name}.${item.name} [${item.signature}])`; }
                        break;
                    case 'struct':
                        // scope: public/private
                        if (item.scope !== 'public' && item.scope !== 'private') { throw `Defined member scope is not supported in this type. (${data.name}.${item.name} [${item.signature}])`; }

                        // modifiers: not supported
                        if (item.modifiers.length !== 0) { throw `Modifiers are not supported in this type. (${data.name}.${item.name} [${item.signature}])`; }

                        // destructor cannot be defined
                        if (itemName === 'dispose') { throw `Destructors definition is not supported in this type. (${data.name}.${item.name} [${item.signature}])`; }
                        break;
                    case 'interface': 
                        // scope: always 'public'
                        if (item.scope !== 'public') { throw `Defined member scope is not supported in this type. (${data.name}.${item.name} [${item.signature}])`; }

                        // static: not supported
                        if (item.static) { throw `Static member definition is not supported in this type. (${data.name}.${item.name} [${item.signature}])`; }

                        // modifiers: not supported
                        if (item.modifiers.length !== 0) { throw `Modifiers are not supported in this type. (${data.name}.${item.name} [${item.signature}])`; }

                        // optional: not supported
                        if (item.optional) { throw `Optional member definition is not supported in this type. (${data.name}.${item.name} [${item.signature}])`; }

                        // conditional: not supported
                        if (item.conditional.length !== 0) { throw `Conditional member definition is not supported in this type. (${data.name}.${item.name} [${item.signature}])`; }

                        // throws: not supported
                        if (item.throws.length !== 0) { throw `Throws definition is not supported in this type. (${data.name}.${item.name} [${item.signature}])`; }

                        // constructor/destructor cannot be defined
                        if (itemName === 'construct') { throw `Constructor definition is not supported in this type. (${data.name}.${item.name} [${item.signature}])`; }
                        if (itemName === 'dispose') { throw `Destructors definition is not supported in this type. (${data.name}.${item.name} [${item.signature}])`; }
                        break;
                    case 'class':
                        // no restrictions
                        break;
                    case 'mixin':
                        // constructor/destructor cannot be defined
                        if (itemName === 'construct') { throw `Constructor definition is not supported in this type. (${data.name}.${item.name} [${item.signature}])`; }
                        if (itemName === 'dispose') { throw `Destructors definition is not supported in this type. (${data.name}.${item.name} [${item.signature}])`; }
                        break;
                } 
            }

            // add
            if (itemName === 'construct') {
                if (!data.constructors) { data.constructors = []; }
                data.constructors.push(...items);
            } else if (itemName === 'dispose') {
                if (!data.destructors) { data.destructors = []; }
                data.destructors.push(...items);
            } else {
                data.methods.push(...items);
            }
        }

        // sort by signature as there may be overloads
        if (data.constructors && data.constructors.length > 1) { data.constructors.sort((a, b) => (a.signature > b.signature) ? 1 : -1) }
        if (data.destructors && data.destructors.length > 1) { data.destructors.sort((a, b) => (a.signature > b.signature) ? 1 : -1) }
        if (data.methods.length > 1) { data.methods.sort((a, b) => (a.signature > b.signature) ? 1 : -1) }
    };
    const defineEvents = (host) => {
        data.events = [];
        let item = null;
        for(let itemName of eventAnnotations) {
            // get
            item = members[itemName]; // array of method overloads or just one

            // add docs info
            addDocsInfo(item, data);

            // validations
            switch(host) {
                case 'struct':
                    // scope: public/private
                    if (item.scope !== 'public' && item.scope !== 'private') { throw `Defined member scope is not supported in this type. (${data.name}.${item.name})`; }

                    // modifiers: not supported
                    if (item.modifiers.length !== 0) { throw `Modifiers are not supported in this type. (${data.name}.${item.name})`; }
                    break;
                case 'interface': 
                    // scope: always 'public'
                    if (item.scope !== 'public') { throw `Defined member scope is not supported in this type. (${data.name}.${item.name})`; }

                    // static: not supported
                    if (item.static) { throw `Static member definition is not supported in this type. (${data.name}.${item.name})`; }

                    // modifiers: not supported
                    if (item.modifiers.length !== 0) { throw `Modifiers are not supported in this type. (${data.name}.${item.name})`; }

                    // optional: not supported
                    if (item.optional) { throw `Optional member definition is not supported in this type. (${data.name}.${item.name})`; }

                    // conditional: not supported
                    if (item.conditional.length !== 0) { throw `Conditional member definition is not supported in this type. (${data.name}.${item.name})`; }

                    // throws: not supported
                    if (item.throws.length !== 0) { throw `Throws definition is not supported in this type. (${data.name}.${item.name})`; }
                    break;
                case 'class':
                case 'mixin':
                    // no restrictions
                    break;
            } 
            
            // add
            data.events.push(item);
        }
    };

    switch(data.typeOfType) {
        case 'enum':
            defineConstants('enum');
            break;
        case 'struct':
            defineConstants('struct');
            defineProperties('struct');
            defineMethods('struct');
            defineEvents('struct');
            break;
        case 'class':
            defineConstants('class');
            defineProperties('class');
            defineMethods('class');
            defineEvents('class');
            break;
        case 'mixin':
            defineConstants('mixin');
            defineProperties('mixin');
            defineMethods('mixin');
            defineEvents('mixin');
            break;
        case 'interface':
            defineProperties('interface');
            defineMethods('interface');
            defineEvents('interface');
            break;
        case 'component':
            defineConstants('component');
            defineProperties('component');
            defineMethods('component');
            break;
        case 'annotation':
            defineConstants('annotation');
            defineProperties('annotation');
            defineMethods('annotation');
            break;
        case 'global':
            defineConstants('global');
            defineProperties('global');
            defineMethods('global');
            break;
        case 'routes':
            defineItems(data.typeOfType, 'Routes');
            break;
        case 'resources':
            defineItems(data.typeOfType, 'Resources');
            break;
        case 'assets':
            defineItems(data.typeOfType, 'Assets');
            break;
        case 'libs':
            defineItems(data.typeOfType, 'Libraries');
            break;
        case 'locales':
            defineItems(data.typeOfType, 'Locales');
            break;
        case 'config':
            defineItems(data.typeOfType, 'Configurations');
            break;
        case 'settings':
            defineItems(data.typeOfType, 'Settings');
            break;
        case 'tests':
            defineItems(data.typeOfType, 'Tests');
            break;
        case 'guides':
            defineItems(data.typeOfType, 'Guides');
            break;
        case 'examples':
            defineItems(data.typeOfType, 'Examples');
            break;
        case 'home':
        case 'assembly':
        case 'globals':
        case 'components':
        case 'namespaces':
        case 'namespace':
        case 'types':
            // do nothing, no members
            break;
        default:
            // do nothing, no members
            break;
    }

    // return
    return data;
};
const getAnnotations = (options, asm, parent, content, name, type) => {
    let blocks = extractBlocks(content),
        mainAnnotation = null,
        members = {}, // annotation
        propAnnotations = [], // [name]
        itemAnnotations = [], // [name]
        constAnnotations = [], // [name]
        methodAnnotations = [], // [name]
        eventAnnotations = [], // [name]
        symbols = [],
        a = null;
    for(let block of blocks) { // process each block
        symbols = extractSymbols(options, name, block);
        a = symbolsToAnnotation(symbols, name, type);
        if (a) {
            if (a.isType) { // type
                if (mainAnnotation) { throw `Only one block can have @type symbol. (${a.name})`; }
                mainAnnotation = a;
            } else if (a.isProperty) { // member: property
                if (members[a.name]) { throw `Only one definition can exisit for a member. (${a.name})`; }
                members[a.name] = a; 
                propAnnotations.push(a.name);
            } else if (a.isItem) { // member: item
                if (members[a.name]) { throw `Only one definition can exisit for a member. (${a.name})`; }
                members[a.name] = a; 
                itemAnnotations.push(a.name);
            } else if (a.isConstant) { // member: constant
                if (members[a.name]) { throw `Only one definition can exisit for a member. (${a.name})`; }
                members[a.name] = a; 
                constAnnotations.push(a.name);
            } else if (a.isMethod) { // member: method
                if (methodAnnotations.indexOf(a.name) !== -1) { 
                    if(!a.overload) {
                        throw `Only one definition can exisit for a method unless defined as an overload. (${a.name})`; 
                    } else {
                        members[a.name].push(a);
                        // update overloadId to the index number of the overload, this way - at 0th position, there is no overloadId for next onwardss, its 1, 2, etc.
                        a.overloadId = (members[a.name].length -1).toString();
                    }
                } else {
                    if (members[a.name]) { throw `Only one definition can exisit for a member (unless its an overload method). (${a.name})`; }
                    members[a.name] = [a];
                    methodAnnotations.push(a.name);
                }
            } else if (a.isEvent) { // member: event
                if (members[a.name]) { throw `Only one definition can exisit for a member. (${a.name})`; }
                members[a.name] = a;
                eventAnnotations.push(a.name);
            }
        }
    }

    // build mainAnnotation if could not be found
    if (!mainAnnotation) {
        // create default
        mainAnnotation = new Annotation({}, 'type', name, type);
    }

    // build annotation data and return
    return buildAnnotationData(options, asm, parent, members, mainAnnotation, itemAnnotations, constAnnotations, propAnnotations, methodAnnotations, eventAnnotations);
};

// file writers
const getDest = (options, ...more) => {
    return pathJoin(options.docs.dest.root, options.docs.dest.content, options.package.name, options.docs.versions.current.name, options.docs.versions.current.locales.current, ...more);
};
const plainWrite = (options, file, data) => {
    fsx.ensureDirSync(path.dirname(file));
    fsx.writeJSONSync(file, data, { encoding: 'utf8', spaces: '\t' });
};
const writeFile = (options, asm, file, doc) => {
    // add to search
    if (options.docs.search.build) { addToSearch(options, asm, file, doc); }

    // write file
    let docFile = getDest(options, file);
    plainWrite(options, docFile, doc);
};
const writeMembers = (options, asm, file, members) => {
    let newList = [], // { file: '', name: '', type: '', desc: '' }
        memberFile = '',
        memberName = '',
        memberDisplayName = '';
    if (members.length > 0) {
        for(let member of members) {
            // special condition for overload-methods
            if (member.isMethod && member.overload && member.overloadId) {
                memberName = member.name + '~' + member.overloadId;
            } else {
                memberName = member.name;
            }

            // display name is always signature, if available
            memberDisplayName = member.signature || member.name;

            // extract list
            memberFile = file.replace('<member>', memberName);
            newList.push({ file: memberFile, name: memberDisplayName, type: member.memberType, desc: member.desc });
    
            // write member's own document
            writeFile(options, asm, memberFile, member);
        }
    }

    // return new (lean index) list
    return newList;
};
const writeNonCodeAsmMember = (options, asm, asmDoc, memberType) => {
    let asmMember = getNonCodeMember(options, asm, memberType),
        membersListDocFile = '',
        memberDocFile = '';
    if (asmMember.items.length > 0) { 
        membersListDocFile = `./${asm.name}/${asmMember.memberType.toLowerCase()}/index.json`;
        memberDocFile = `./${asm.name}/${asmMember.memberType.toLowerCase()}/<member>.json`;
        asmDoc.items.push({ file: membersListDocFile, name: asmMember.name, type: memberType, desc: asmMember.desc });
        asmMember.items = writeMembers(options, asm, memberDocFile, asmMember.items);
        writeFile(options, asm, membersListDocFile, asmMember);
    }
};
const writeGlobals = (options, asm, asmDoc) => {
    let globals = getGlobals(options, asm),
        membersListDocFile = `./${asm.name}/globals/index.json`,
        memberDocFile = `./${asm.name}/globals/<asm-member>.json`,
        subMemberDocFile = `./${asm.name}/globals/<asm-member>/<member>.json`,
        memberFile = '',
        subMemberFile = '',
        newList = [];
    if (globals.items.length > 0) {
        asmDoc.items.push({ file: membersListDocFile, name: globals.name, type: globals.memberType, desc: globals.desc });
        for(let global of globals.items) {
            // extract list
            memberFile = memberDocFile.replace('<asm-member>', global.name);
            subMemberFile = subMemberDocFile.replace('<asm-member>', global.name);
            newList.push({ file: memberFile, name: global.name, type: global.memberType, desc: global.desc });
    
            // write member specific docs
            global.items = [];
            global.items.push(...writeMembers(options, asm, subMemberFile, global.constants));
            global.items.push(...writeMembers(options, asm, subMemberFile, global.properties));
            if (global.constructors) { global.items.push(...writeMembers(options, asm, subMemberFile, global.constructors)); }
            global.items.push(...writeMembers(options, asm, subMemberFile, global.methods));
            if (global.destructors) { global.items.push(...writeMembers(options, asm, subMemberFile, global.destructors)); }

            // delete these
            delete global.constants;
            delete global.properties;
            delete global.constructors;
            delete global.methods;
            delete global.destructors;

            // write member file
            writeFile(options, asm, memberFile, global);
        }
    
        // update new list
        globals.items = newList;
        writeFile(options, asm, membersListDocFile, globals);
    }
};
const writeComponents = (options, asm, asmDoc) => {
    let components = getComponents(options, asm),
        membersListDocFile = `./${asm.name}/components/index.json`,
        memberDocFile = `./${asm.name}/components/<asm-member>.json`,
        subMemberDocFile = `./${asm.name}/components/<asm-member>/<member>.json`,
        memberFile = '',
        subMemberFile = '',
        newList = [];
    if (components.items.length > 0) {
        asmDoc.items.push({ file: membersListDocFile, name: components.name, type: components.memberType, desc: components.desc }); 
        for(let component of components.items) {
            // extract list
            memberFile = memberDocFile.replace('<asm-member>', component.name);
            subMemberFile = subMemberDocFile.replace('<asm-member>', component.name);
            newList.push({ file: memberFile, name: component.name, type: component.memberType, desc: component.desc });

            // write member specific docs
            switch(component.typeOfType) {
                case 'component':
                case 'annotation':
                    component.items = [];
                    component.items.push(...writeMembers(options, asm, subMemberFile, component.constants));
                    component.items.push(...writeMembers(options, asm, subMemberFile, component.properties));
                    if (component.constructors) { component.items.push(...writeMembers(options, asm, subMemberFile, component.constructors)); }
                    component.items.push(...writeMembers(options, asm, subMemberFile, component.methods));
                    if (component.destructors) { component.items.push(...writeMembers(options, asm, subMemberFile, component.destructors)); }
                    
                    // delete these
                    delete component.constants;
                    delete component.properties;
                    delete component.constructors;
                    delete component.methods;
                    delete component.destructors;                    
                    break;
            }

            // write member file
            writeFile(options, asm, memberFile, component);       
        }
    
        // update new list
        components.items = newList;
        writeFile(options, asm, membersListDocFile, components);
    }
};
const writeNamespacesAndTypes = (options, asm, asmDoc) => {
    let types = getTypes(options, asm),
        namespaces = getNamespaces(options, asm, types),
        membersListDocFile = `./${asm.name}/types/index.json`,
        memberDocFile = `./${asm.name}/types/<asm-member>.json`,
        subMemberDocFile = `./${asm.name}/types/<asm-member>/<member>.json`,
        memberFile = '',
        subMemberFile = '',
        newList = [];

    // namespaces
    if (namespaces.items.length > 0) {
        membersListDocFile = `./${asm.name}/namespaces/index.json`;
        memberDocFile = `./${asm.name}/namespaces/<asm-member>.json`;
        newList = [];
        asmDoc.items.push({ file: membersListDocFile, name: namespaces.name, type: namespaces.memberType, desc: namespaces.desc }); 

        for(let namespace of namespaces.items) {
            memberFile = memberDocFile.replace('<asm-member>', namespace.name);
            newList.push({ file: memberFile, name: namespace.name, type: namespace.memberType, desc: namespace.desc });
            writeFile(options, asm, memberFile, namespace); // direct writing, because no subdocuments to be generated for namespace members (i.e., types), as these will be generated below
        }

        // update new list
        namespaces.items = newList;
        writeFile(options, asm, membersListDocFile, namespaces);
    }
        
    // now types
    if (types.items.length > 0) {
        membersListDocFile = `./${asm.name}/types/index.json`;
        memberDocFile = `./${asm.name}/types/<asm-member>.json`;        
        newList = [];
        asmDoc.items.push({ file: membersListDocFile, name: types.name, type: types.memberType, desc: types.desc }); 

        for(let type of types.items) {
            // extract list
            memberFile = memberDocFile.replace('<asm-member>', type.name);
            subMemberFile = subMemberDocFile.replace('<asm-member>', type.name);
            newList.push({ file: memberFile, name: type.name, type: type.memberType, desc: type.desc });

            // write member specific docs
            type.items = [];
            switch(type.typeOfType) {
                case 'enum':
                    type.items.push(...writeMembers(options, asm, subMemberFile, type.constants));

                    // delete these
                    delete type.constants;                    
                    break;
                case 'struct':
                case 'class':
                case 'mixin':
                    type.items.push(...writeMembers(options, asm, subMemberFile, type.constants));
                    type.items.push(...writeMembers(options, asm, subMemberFile, type.properties));
                    if (type.constructors) { type.items.push(...writeMembers(options, asm, subMemberFile, type.constructors)); }
                    type.items.push(...writeMembers(options, asm, subMemberFile, type.methods));
                    if (type.destructors) { type.items.push(...writeMembers(options, asm, subMemberFile, type.destructors)); }
                    type.items.push(...writeMembers(options, asm, subMemberFile, type.events));

                    // delete these
                    delete type.constants;
                    delete type.properties;
                    delete type.constructors;
                    delete type.methods;
                    delete type.destructors;
                    delete type.events;                    
                    break;
                case 'interface':
                    type.items.push(...writeMembers(options, asm, subMemberFile, type.properties));
                    if (type.constructors) { type.items.push(...writeMembers(options, asm, subMemberFile, type.constructors)); }
                    type.items.push(...writeMembers(options, asm, subMemberFile, type.methods));
                    if (type.destructors) { type.items.push(...writeMembers(options, asm, subMemberFile, type.destructors)); }
                    type.items.push(...writeMembers(options, asm, subMemberFile, type.events));

                    // delete these
                    delete type.properties;
                    delete type.constructors;
                    delete type.methods;
                    delete type.destructors;
                    delete type.events;                    
                    break;
            }

            // write member file
            writeFile(options, asm, memberFile, type);            
        }
    
        // update new list
        types.items = newList;
        writeFile(options, asm, membersListDocFile, types);
    }
};
const writeSearch = (options) => {
    // https://lucaong.github.io/minisearch/

    // build search index
    let homeDoc = options.docs.json,
        searchDump = homeDoc.searchDump;
    delete homeDoc.searchDump;
    let miniSearch = new MiniSearch({
        idField: 'file',
        fields: ['name', 'desc'],
        storeFields: ['asm', 'name'],
        searchOptions: {
            boost: { name: 2 },
            fuzzy: 0.2
        }
    });
    miniSearch.addAll(searchDump);

    // data
    let data = miniSearch.toJSON();

    // file
    let file = getDest(options, homeDoc.search);

    // write
    plainWrite(options, file, data);
};
const writeAssemblies = (options) => {
    // data
    let homeDoc = options.docs.json,
        data = homeDoc.asms;

    if (data.length > 0) {
        // file
        homeDoc.asms = './assemblies.json'
        let file = getDest(options, homeDoc.asms);

        // write
        plainWrite(options, file, data);
    } else {
        delete homeDoc.asms;
    }
};
const writeTests = (options) => {
    // data
    let homeDoc = options.docs.json,
        data = homeDoc.tests;

    if (data.length > 0) {
        // file
        homeDoc.tests = './tests.json'
        let file = getDest(options, homeDoc.tests);

        // process each test
        let specFile = '',
            testFile = '',
            newList = [];
        for(let item of data.items) {
            // validate
            if (item.docs.asm) {
                specFile = pathJoin(options.build.src, item.docs.asm, 'tests', item.link);
            } else {
                specFile = pathJoin(options.build.src, 'tests', item.link);
            }
            if (!specFile.endsWith('.spec.js')) { throw `Must be a test specification. (${item.name}: ${item.link})`; }
            if (!fsx.existsSync(specFile)) { throw `Test specification (${item.link}) not found. (${item.name})`; }
            
            // push to list        
            newList.push({ 
                asm: item.docs.asm, 
                group: (item.docs.asm ? item.memberType : ''),
                name: item.name, 
                desc: item.desc
            }); 

            // load content in remarks as code
            if (item.remarks) { item.remarks += '\n'; }
            item.remarks += `<code>${fsx.readFileSync(specFile, 'utf8')}</code>`;

            // write file
            testFile = `${item.docs.self}.json`;
            plainWrite(options, testFile, item);
        }
        data.list = newList; // { asm: '', group: '', name: '', desc: '' }

        // write
        plainWrite(options, file, data);
    } else {
        delete homeDoc.tests;
    }
};
const writeExamples = (options) => {
    // data
    let homeDoc = options.docs.json,
        data = homeDoc.examples;

    if (data.length > 0) {        
        // file
        homeDoc.examples = './examples.json'
        let file = getDest(options, homeDoc.examples);

        // process each example
        let jsFiddleUrl = options.docs.fiddle.UrlTemplate.replace('<<userName>>', options.docs.fiddle.userName),
            exampleFile = '',
            newList = [];
        for(let item of data.items) {
            // push to list
            newList.push({ 
                asm: item.docs.asm, 
                group: (item.docs.asm ? item.memberType : ''),
                name: item.name,
                desc: item.desc
            }); 

            // update item link
            item.link = jsFiddleUrl.replace('<<fiddleId>>', item.link);

            // write file
            exampleFile = `${item.docs.self}.json`;
            plainWrite(options, exampleFile, item);
        }
        data.list = newList; // { asm: '', group: '', name: '', desc: '' }

        // write
        plainWrite(options, file, data);
    } else {
        delete homeDoc.examples;
    }
};
const writeGuides = (options) => {
    // data
    let homeDoc = options.docs.json,
        data = homeDoc.guides;

    if (data.length > 0) {                
        // file
        homeDoc.guides = './guides.json'
        let file = getDest(options, homeDoc.guides);

        // process each guide
        let mdFile = '',
            guideFile = '',
            newList = [];
        for(let item of data.items) {
            // validate
            if (item.docs.asm) {
                mdFile = pathJoin(options.build.src, item.docs.asm, 'guides', item.link);
            } else {
                mdFile = pathJoin(options.build.src, 'guides', item.link);
            }
            if (!mdFile.endsWith('.md')) { throw `Must be markdown file. (${item.name}: ${item.link})`; }
            if (!fsx.existsSync(mdFile)) { throw `Guide markdown (${item.link}) not found. (${item.name})`; }
            
            // push to list        
            newList.push({ 
                asm: item.docs.asm, 
                group: (item.docs.asm ? item.memberType : ''),
                name: item.name, 
                desc: item.desc
            }); 

            // load content of whole guide in remarks as is
            if (item.remarks) { item.remarks += '\n'; }
            item.remarks += fsx.readFileSync(mdFile, 'utf8');

            // write file
            guideFile = `${item.docs.self}.json`;
            plainWrite(options, guideFile, item);
        }
        data.list = newList; // { asm: '', group: '', name: '', desc: '' }

        // write
        plainWrite(options, file, data);
    } else {
        delete homeDoc.guides;
    }
};
const writeLocaleHome = (options) => {
    // data
    let data = options.docs.json;

    // file
    let file = getDest(options, 'index.json');

    // write
    plainWrite(options, file, data);
};
const writeVersionHome = (options) => {
    let currentVersionRoot = pathJoin(options.docs.dest.root, options.docs.dest.content, options.package.name, options.docs.versions.current.name || 'v1');

    const getLocales = () => {
        // get locales list
        let list = options.docs.versions.current.locales.list;
        if (list.length === 0) {
            list.push({ name: 'en', title: 'English' }); // by default give en
        }

        // add file info for each locale
        for(let item of list) { 
            item.root = pathJoin(currentVersionRoot, item.name),
            item.file =  pathJoin(currentVersionRoot, item.name, 'index.json'); 
        } // localized content's info file

        // return
        return list;
    };

    // data
    let data = {
        locales: {
            root: currentVersionRoot,
            list: getLocales(),
            current: options.docs.versions.current.locales.current || 'en'
        }
    };

    // file
    let file = pathJoin(currentVersionRoot, 'index.json');

    // write
    plainWrite(options, file, data);
};
const writeCollectionHome = (options, ) => {
    let currentCollectionRoot = pathJoin(options.docs.dest.root, options.docs.dest.content, options.package.name);

    const getVersions = () => {
        // get versions list
        let list = options.docs.versions.list;
        if (list.length === 0) {
            list.push({ name: 'v1', title: '1.x' }); // by default give v1
        }

        // add file info for each version
        for(let item of list) { 
            item.root = pathJoin(currentCollectionRoot, item.name),
            item.file =  pathJoin(currentCollectionRoot, item.name, 'index.json'); 
        } // version's locale info file

        // return
        return list;
    };
    const getCustomFiles = () => {
        let collectionIndexJson = pathJoin(options.build.src, 'docs', 'index.json');
        let custom = {
            files: {
                js: [],
                css: []
            },
            templates: {
                index: '',
                header: '',
                footer: ''
            }
        };        
        if (fsx.existsSync(collectionIndexJson)) {
            let json = fsx.readJSONSync(collectionIndexJson, 'utf8');

            // it is expected that index.json will define file in context of the docs root file
            // which means, it will add here any path before docs's own path in context of the package
            for(let js of json.js) { custom.files.js.push(pathJoin(currentCollectionRoot, js)); }
            for(let css of json.css) { custom.files.css.push(pathJoin(currentCollectionRoot, css)); }

            // package specific index file
            let templateFile = pathJoin(currentCollectionRoot, '', 'index');
            if (fsx.existsSync(templateFile)) { custom.templates.index = templateFile; }

            // package specific header/footer
            templateFile = pathJoin(currentCollectionRoot, 'html', 'header');
            if (fsx.existsSync(templateFile)) { custom.templates.header = templateFile; }
            templateFile = pathJoin(currentCollectionRoot, 'html', 'footer');
            if (fsx.existsSync(templateFile)) { custom.templates.footer = templateFile; }
        } 

        // return
        return custom;        
    };
    const getCollectionInfo = () => {
        let package = options.package;
        let info = {
            name: package.name || '',
            title: package.title || '',
            desc: package.description || '',
            copyright: package.copyright || '',
            license: package.license || '',
            version: package.version || ''
        };
        return info;
    };

    // data
    let data = {
        info: getCollectionInfo(),
        versions: {
            root: currentCollectionRoot,
            list: getVersions(),
            current: options.docs.versions.current.name || 'v1'
        },
        pages: {},
        custom: getCustomFiles()
    };

    // copy default docs folder of this package at collection home as well
    // except index.json (as that is processed above already)
    let docs = pathJoin(options.build.src, 'docs');
    if(fsx.pathExistsSync(docs)) {
        let pageName = '',
            pageFile = '';
        copyDir.sync(docs, currentCollectionRoot, {
            utimes: true,
            mode: true,
            cover: true,
            filter: function(stat, filepath){
                // do not want copy index.json file
                if(stat === 'file' && path.basename(filepath) === 'index.json') {
                  return false;
                }

                // convert md pages to html here
                // and add to list, so they can be loaded using 
                // page load technique of engine
                if (path.extname(filepath) === '.md') {
                    pageName = path.basename(filepath).replace('.md', '');
                    pageFile = './' + filepath;
                    pageFile = pathJoin(currentCollectionRoot, pageFile.replace(docs, '')).replace('.md', '.html');
                    data.pages[pageName] = pageFile;
                    fsx.writeFileSync(pageFile, mdPage2html(fsx.readFileSync(filepath, 'utf8')), 'utf8');
                    return false; // since copied the html version
                }

                // copy
                return true;
              }
        });
    }

    // file
    let file = pathJoin(currentCollectionRoot, 'index.json')

    // write
    plainWrite(options, file, data);
};
const writeDocsHome = (options) => {
    // theme
    let themeRoot = pathJoin(options.docs.dest.root, 'themes', options.docs.theme || 'default'),
        collectionsRoot = pathJoin(options.docs.dest.root, options.docs.dest.content);

    const getThemeFile = (type, file) => {
        file = pathJoin(themeRoot, type, file);
        if (!fsx.existsSync(file)) { 
            file = pathJoin(options.docs.dest.root, 'themes', 'default', type, file);
            if (!fsx.existsSync(file)) { throw `Theme file missing from default theme. (./${type}/${file})`; }
         }
         return file;
    };
    const getThemeTemplate = (file) => { return getThemeFile('html', file + '.html'); }
    const getThemeFilesToLoad = () => {
        let json = fsx.readJSONSync(getThemeFile('', 'index.json'), 'utf8'),
        data = {
            js: [],
            css: []
        };

        // it is expected that index.json will define file in context of the theme root file
        // which means, it will add here any path before theme's own path
        for(let js of json.js) { data.js.push(getThemeFile('', js)); }
        for(let css of json.css) { data.css.push(getThemeFile('', css)); }

        // return
        return data;
    };
    const getCollections = () => {
        // get packages list
        let list = options.docs.packages;
        if (list.length === 0) {
            list.push({ name: options.package.name, title: options.package.title }); // by default give current package nane, if not defined
        }
        
        // add file info for each package
        for(let item of list) { 
            item.root = pathJoin(collectionsRoot, item.name),
            item.file = pathJoin(collectionsRoot, item.name, 'index.json'); 
        }

        // return
        return list;
    };
    const getThemeData = () => {
        return {
            root: themeRoot,
            files: getThemeFilesToLoad(),
            templates: {
                index: getThemeTemplate('index'),
                header: getThemeTemplate('header'),
                footer: getThemeTemplate('footer'),
                
                assembly: getThemeTemplate('assembly'),
                search: getThemeTemplate('search'),
                '404': getThemeTemplate('404'),

                globals: getThemeTemplate('globals'),
                global: getThemeTemplate('global'),

                components: getThemeTemplate('components'),
                component: getThemeTemplate('component'),
                annotation: getThemeTemplate('annotation'),

                namespaces: getThemeTemplate('namespaces'),
                namespace: getThemeTemplate('namespace'),
                
                types: getThemeTemplate('types'),
                class: getThemeTemplate('class'),
                interface: getThemeTemplate('interface'),
                mixin: getThemeTemplate('mixin'),
                struct: getThemeTemplate('struct'),
                enum: getThemeTemplate('enum'),

                const: getThemeTemplate('const'),
                prop: getThemeTemplate('prop'),
                event: getThemeTemplate('event'),
                func: getThemeTemplate('func'),

                config: getThemeTemplate('config'),
                'config-item': getThemeTemplate('config-item'),
                settings: getThemeTemplate('settings'),
                'settings-item': getThemeTemplate('settings-item'),
                
                resources: getThemeTemplate('resources'),
                'resources-item': getThemeTemplate('resources-item'),
                routes: getThemeTemplate('routes'),
                'routes-item': getThemeTemplate('routes-item'),
                
                assets: getThemeTemplate('assets'),
                'assets-item': getThemeTemplate('assets-item'),
                libs: getThemeTemplate('libs'),
                'libs-item': getThemeTemplate('libs-item'),
                locales: getThemeTemplate('locales'),
                'locales-item': getThemeTemplate('locales-item'),

                examples: getThemeTemplate('examples'),
                'examples-item': getThemeTemplate('examples-item'),
                guides: getThemeTemplate('guides'),
                'guides-item': getThemeTemplate('guides-item'),
                tests: getThemeTemplate('tests'),
                'tests-item': getThemeTemplate('tests-item')
            }
        };
    };

    // data
    let data = {
        builder: {
            name: options.buildInfo.name,
            version: options.buildInfo.version
        },         
        collections: {
            root: collectionsRoot,
            list: getCollections(),
            current: options.package.name // always current one
        },
        theme: getThemeData()
    };

    // file
    let file = pathJoin(options.docs.dest.root, 'index.json');

    // write
    plainWrite(options, file, data);
};

// content organizers
const getContent = (options, member) => {
    // read docs.info
    let file = pathJoin(member, options.build.assembly.files.docsinfo);
    if (fsx.existsSync(file)) { return fsx.readFileSync(file, 'utf8').trim(); }
    return '';
};
const getHome = function(options) {
    // get content
    let content = getContent(options, options.build.src); // docs.info at source root folder

    // get data
    let data = getAnnotations(options, null, null, content, options.package.title, 'home');

    // assemblies
    data.asms = []; // { file: '', name: '', type: '', desc: '' }
    
    // examples (from root)
    content = getContent(options, pathJoin(options.build.src, 'examples'));
    data.examples = getAnnotations(options, null, null, content, options.package.title, 'examples');

    // tests (from root)
    content = getContent(options, pathJoin(options.build.src, 'tests'));
    data.tests = getAnnotations(options, null, null, content, options.package.title, 'tests');

    // guides (from root)
    content = getContent(options, pathJoin(options.build.src, 'guides'));
    data.guides = getAnnotations(options, null, null, content, options.package.title, 'guides');

    // search
    if (options.docs.search.build) {
        data.search = './search.json';
        data.searchDump = []; // this will be deleted at the end
    }

    // return
    return data;    
};
const getAsmHome = function(options, asm) {
    // asm examples (push to homeDoc)
    let homeDoc = options.docs.json;
    let content = getContent(options, pathJoin(asm.src, options.build.assembly.folders.examples));
    let examples = getAnnotations(options, asm, null, content, asm.name, 'examples'); 
    // note: any header info of this document is discarded and actually not required, since there is 
    // no assembly specific examples page
    // therefore just reading items and the header part is discarded here
    homeDoc.examples.items.push(...examples.items); 

    // asm tests (push to homeDoc)
    content = getContent(options, pathJoin(asm.src, options.build.assembly.folders.tests));
    let tests = getAnnotations(options, asm, null, content, asm.name, 'tests');
    // note: any header info of this document is discarded and actually not required, since there is 
    // no assembly specific tests page
    // therefore just reading items and the header part is discarded here
    homeDoc.tests.items.push(...tests.items);
   
    // asm guides (push to homeDoc)
    content = getContent(options, pathJoin(asm.src, options.build.assembly.folders.guides));
    let guides = getAnnotations(options, asm, null, content, asm.name, 'guides');
    // note: any header info of this document is discarded and actually not required, since there is 
    // no assembly specific guides page
    // therefore just reading items and the header part is discarded here
    homeDoc.guides.items.push(...guides.items);    
        
    // get content
    content = getContent(options, asm.src); // docs.info at asm root folder

    // get data
    let data = getAnnotations(options, asm, null, content, asm.name, 'assembly');

    // return
    return data;    
};
const getNonCodeMember = function(options, asm, memberType) {
    // routes, resources, assets, libs, locales, config, settings, tests, guides, examples
    // get content
    let memberFolderKey = memberType, // folder key in options.build.assembly.folders.<key> is same as memberType
        content = getContent(options, asm.folders[memberFolderKey]);

    // get data
    let data = getAnnotations(options, asm, null, content, '', memberType);
    
    // return
    return data;
};
const getGlobals = function(options, asm) {
    // get content
    let content = getContent(options, asm.folders.globals);

    // get data
    let data = getAnnotations(options, asm, null, content, '', 'globals');

    // add items
    let item = null;
    data.items = [];
    for(let global of asm.globals) {
        item = getAnnotations(options, asm, data, global.content, global.name, 'global');
        if (item.fiddle) { addToExample(options, asm, item); }
        if (item.spec) { addToTests(options, asm, item); }
        data.items.push(item);
    }

    // return
    return data;
};
const getComponents = function(options, asm) {
    // get content
    let content = getContent(options, asm.folders.components);    

    // get data
    let data = getAnnotations(options, asm, null, content, '', 'components');

    // add items
    let item = null;
    data.items = [];
    for(let comp of asm.components) {
        item = getAnnotations(options, asm, data, comp.content, comp.name, comp.type);
        if (item.fiddle) { addToExample(options, asm, item); }
        if (item.spec) { addToTests(options, asm, item); }
        data.items.push(item);
    }

    // return
    return data;
};
const getNamespaces = function(options, asm, types) {
    // get same content as for types
    let content = getContent(options, asm.folders.types);

    // get data
    let data = getAnnotations(options, asm, null, content, '', 'namespaces');

    // add items (namespaces)
    let file = '',
        _types = null,
        item = null,
        typeMemberDocFile = `./${asm.name}/types/<asm-member>.json`;
    data.items = [];
    for(let ns of asm.ado.ns) {
        // get ns content (read ns.info)
        content = '';
        file = pathJoin(pathJoin(asm.folders.types, ns.n), options.build.assembly.files.nsinfo);
        if (fsx.existsSync(file)) { content = fsx.readFileSync(file, 'utf8').trim(); }        
        item = getAnnotations(options, asm, data, content, ns.n || '(root)', 'namespace');

        // add items (types of this namespace)
        item.items = [];
        _types = types.items.filter(type => type.ns === ns.n);
        for (let _type of _types) {
            file = typeMemberDocFile.replace('<asm-member>', _type.name);
            item.items.push({ file: file, name: _type.name, type: _type.memberType, desc: _type.desc });
        }

        // add
        data.items.push(item);
    }

    // return
    return data;
};
const getTypes = function(options, asm) {
    // get content
    let content = getContent(options, asm.folders.types);

    // get data
    let data = getAnnotations(options, asm, null, content, '', 'types');

    // add items (types)
    let item = null;
    data.items = [];
    for(let type of asm.types) {
        item = getAnnotations(options, asm, data, type.content, type.qualifiedName, type.type);
        if (item.fiddle) { addToExample(options, asm, item); }
        if (item.spec) { addToTests(options, asm, item); }
        data.items.push(item);
    }

    // return
    return data;
};

// search data
const addToSearch = (options, asm, file, item) => {
    let homeDoc = options.docs.json,
        searchDump = homeDoc.searchDump;
        desc = '',
        asmName = (asm ? asm.name : '');

    // build desc
    // to increse the searchbase, more fields can be added in here
    desc = item.desc;
    desc += '\n' + item.remarks;
    if (item.fiddle) {
        desc += '\n' + item.fiddle.name;
        desc += '\n' + item.fiddle.desc;
        desc += '\n' + item.fiddle.remarks;
    }

    // add to search dump
    searchDump.push({
        asm: asmName, 
        file: file, 
        name: item.name, 
        desc: item.desc 
    });
};

// examples data
const addToExample = (options, asm, item) => {
    // create a temp annotation
    let content = `
    /** 
     * @type
    */
    
    /** 
     * @item {${item.fiddle.id}} ${item.fiddle.name} - ${item.fiddle.desc}
     * @remarks
     * ${item.fiddle.remarks}
    */
    `;
    let examples = getAnnotations = (options, asm, item, content, '', '');

    
    // push to homeDoc
    let homeDoc = options.docs.json
    homeDoc.examples.items.push(...examples.items);
};

// tests data
const addToTests = (options, asm, item) => {
    // create a temp annotation
    let content = `
    /** 
     * @type
    */
    
    /** 
     * @item {${item.spec.file}} ${item.spec.name} - ${item.spec.desc}
     * @remarks
     * ${item.spec.remarks}
    */
    `;
    let tests = getAnnotations = (options, asm, item, content, '', '');

    
    // push to homeDoc
    let homeDoc = options.docs.json
    homeDoc.tests.items.push(...tests.items);
};