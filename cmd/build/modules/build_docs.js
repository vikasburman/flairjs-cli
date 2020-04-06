const chalk = require('chalk');
const path = require('path');
const fsx = require('fs-extra');
const pathJoin = require('../../shared/modules/path_join');
const md2html = require('../../shared/modules/md2html').fragment;
const mdPage2html = require('../../shared/modules/md2html').page;
const replaceAll = require('../../shared/modules/replace_all');
const MiniSearch = require('minisearch');
const copyDir = require('copy-dir');
const minify = require('./minify');
const getFolders = require('../../shared/modules/get_folders');
const deepMerge = require('../../shared/modules/merge_objects');
const kinds = require('./kinds');

// generation steps
exports.start = async (options) => {
    // temp place to hold values for the duration of steps
    options.docs.temp = {};

    // ensure docs root exists
    fsx.ensureDirSync(options.docs.dest.root);

    // init all locales
    initLocales(options);

    // write themes
    await writeThemes(options);

    // write engine
    await writeEngine(options);

    // write docs
    await writeDocs(options);

    // init for default locale
    initLocale(options, options.l10n.default);

    // init package (in context of default locale)
    initPackage(options);
};
exports.build = async (options, asm) => {
    // write asm docs
    await writeAsm(options, asm);

    // add to localized docs generation queue 
    options.docs.temp.asms.push(asm);
};
exports.finish = async (options) => {
    // write package
    await writePackage(options);

    // run for each locale again
    let locSrc = getDest(options),
        locDest = '';
    for(let locale of options.l10n.current) {
        if (locale !== options.l10n.default) { // skip for default, which is already written
            // use only if this locale is configured for documents generation
            if (options.docs.l10n.current.indexOf(locale) === -1) { continue; }

            // init for this locale
            initLocale(options, locale);

            // copy whole default-locale folder as is
            // NOTE: since getDest always pick initialized locale, hence locSrc refers to default
            // and calling it again now (after reinit above) it gives the new one
            if (options.docs.l10n.copyDefault) {
                locDest = getDest(options);
                copyDir.sync(locSrc, locDest, {
                    utimes: true,
                    mode: true,
                    cover: true
                });
            }

            // init package (in context of this locale)
            initPackage(options);

            // process docs for each assembly in que (in context of this locale)
            for(let asm of options.docs.temp.asms) {
                // write asm docs
                await writeAsm(options, asm);
            }

            // write package (in context of this locale)
            await writePackage(options);
        }
    }

    // cleanup
    delete options.docs.temp;    
};

// support
const getSrc = (options, ...more) => {
    if (options.docs.temp.locale === options.l10n.default) {
        return pathJoin(options.build.src, ...more);
    } else {
        return pathJoin(options.l10n.src, ...more);
    }
};
const getDest = (options, ...more) => {
    return pathJoin(options.docs.dest.root, 
                    options.docs.dest.content, 
                    options.package.name, 
                    options.docs.versions.current.name, 
                    options.docs.temp.locale, 
                    ...more);
};
const getString = (options, name) => {
    return options.docs.temp.strings.names[name] || `<${name}>`;
};
const getContent = (options, ...more) => {
    // read given info file, and if not present, return a temp content
    let content = `
    /** 
     * @type
    */
    `,
    file = getSrc(options, ...more);
    if (fsx.existsSync(file)) { content = fsx.readFileSync(file, 'utf8').trim(); }
    return content;
};
const getContentFromCode = (options, file, code) => {
    // in default locale case and in absence of a localized version of the file 
    // (having only documentation blocks, not actual code), 
    // original documentation blocks will be used, if configured
    let content = '';
    if (options.docs.temp.locale !== options.l10n.default) {
        // look for same file under l10n folder
        file = file.filename.replace(options.build.src, options.l10n.src);
        if (fsx.existsSync(file)) {
            content = fsx.readFileSync(file, 'utf8');
        } else {
            if (options.docs.l10n.copyDefault) {
                content = code;
            } else {
                content = `
                /** 
                 * @type
                */
                `;
            }            
        }
    } else {
        content = code;
    }
    return content;
};
const plainWrite = (options, file, data) => {
    fsx.ensureDirSync(path.dirname(file));
    fsx.writeJSONSync(file, data, { encoding: 'utf8', spaces: '\t' });
};
const writeMembers = (options, data, ...more) => {
    const writeSpecificMember = (members, group) => {
        let items = [],
            file = '',
            moreCopy = null;
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
    
                // add to items
                addToItems(options, items, member, group);

                // write
                moreCopy = [...more];
                moreCopy.push(`${member.name}.json`);
                file = getDest(options, ...moreCopy);
                plainWrite(options, file, member);
            }
        }
    
        // return
        return items;
    };

    // members
    data.items = [];
    if (data.constants) { data.items.push(...writeSpecificMember(data.constants, getString(options, 'constants'))); delete data.constants; }
    if (data.properties) { data.items.push(...writeSpecificMember(data.properties, getString(options, 'properties'))); delete data.properties; }
    if (data.constructors) { data.items.push(...writeSpecificMember(data.constructors, getString(options, 'constructors'))); delete data.constructors; }
    if (data.methods) { data.items.push(...writeSpecificMember(data.methods, getString(options, 'methods'))); delete data.methods; }
    if (data.destructors) { data.items.push(...writeSpecificMember(data.destructors, getString(options, 'destructors'))); delete data.destructors; }
    if (data.events) { data.items.push(...writeSpecificMember(data.events, getString(options, 'events'))); delete data.events; }
};
const addToItems = (options, items, data, group) => {
    items.push({ link: data.docs.self, name: data.name, group: group, desc: data.desc });
};
const addToSearch = (options, item) => {
    if (!options.docs.search.build) { return; }

    let packageData = options.docs.temp.json,
        searchDump = options.docs.temp.search;

    const addMember = (member, isAddExample) => {
        let text = '';
        text += member.name;
        text += '\n' + member.desc;
        text += '\n' + member.remarks;
        if (isAddExample) { text += '\n' + member.example; }
        return text;
    };
    const addSpecificMemberType = (members, isAddExample) => {
        let text = '';
        for(let member of members) {
            text += '\n' + addMember(member, isAddExample);
        }
        return text;
    };
    const addMembers = (isAddExample) => {
        let text = '';
        if (item.constants) { text += '\n' + addSpecificMemberType(item.constants, isAddExample); }
        if (item.properties) { text += '\n' + addSpecificMemberType(item.properties, isAddExample); }
        if (item.constructors) { text += '\n' + addSpecificMemberType(item.constructors, isAddExample); }
        if (item.methods) { text += '\n' + addSpecificMemberType(item.methods, isAddExample); }
        if (item.destructors) { text += '\n' + addSpecificMemberType(item.destructors, isAddExample); }
        if (item.events) { text += '\n' + addSpecificMemberType(item.events, isAddExample); }
        return text;
    };

    // build desc
    switch(options.docs.search.depth) {
        case 0: // name, desc
            desc = item.desc;
            break;
        case 1: // name, desc, remarks
            desc = item.desc;
            desc += '\n' + item.remarks;
            break;
        case 2: // name, desc, remarks, members (name, desc, remarks)
            desc = item.desc;
            desc += '\n' + item.remarks;
            desc += '\n' + addMembers();
            break;
        case 3: // name, desc, remarks, examples, members (name, desc, remarks, examples)
            desc = item.desc;
            desc += '\n' + item.remarks;
            desc += '\n' + addMembers(true);
            desc += + '\n' + item.example;
            break;
    }

    // add to search dump
    searchDump.push({
        link: item.docs.self, 
        asm: item.docs.asm.name,
        parent: item.docs.parent.name,
        name: item.name, 
        desc: item.desc 
    });
};

// docs to annotation
const extractBlocks = (content) => {
    // credits: https://www.npmjs.com/package/jsdoc-regex
    // https://stackoverflow.com/questions/35905181/regex-for-jsdoc-comments
    let rx = new RegExp(/[ \t]*\/\*\*\s*\n([^*]*(\*[^/])?)*\*\//g); 

    return content.match(rx) || [];
};
const extractSymbols = (options, name, block) => {
    // NOTE: it will leave all unknown/unsupported symbols
    // lheavily inspired from jsdocs approach
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
    //  @optional
    //  @beta
    //  @type
    // 
    // Type 2: @<symbol> value
    //  @desc <desc>
    //  @extends <class-type>
    //  @deprecated <desc>
    //  @restricted <desc>
    //  @since <version>
    //  @see <desc>                                             [multiple allowed]
    //  @fiddle <fiddleId>
    //  @group <name>
    //  @link <item link>
    //                                         
    // Type 3: @<symbol> value1, value2, ...
    //  @mixes <mixin-type>, <mixin-type>, ...
    //  @implements <interface-type>, <interface-type>, ...
    //  @conditional <cond1>, <cond2>, ...
    //
    // Type 4: @<symbol> { value1 } value2
    //  @returns {<type>/<type>/...} <desc>                                
    //  @yields {<type>/<type>/...} <desc>                                 
    //  @resolves {<type>/<type>/...} <desc>                               
    //  @throws {<type>} <desc>                                 [multiple allowed]
    //
    // Type 5: @<symbol> { value1 } value2 - value3
    //  @param {<type>} <name> - <desc>                         [multiple allowed]
    //  @prop {<type>} <name> - <desc>                          
    //  @const {<type>} <name> - <desc> 
    //  
    // Type 6: @<symbol> value1 - value2
    //  @func <name> - <desc>
    //  @event <name> - <desc>
    //  @item <name> - <desc> 
    //
    // Type 7: @<symbol> \n multi-line value
    //  @remarks                                                
    //  @example
    //  @param
    //  @returns
    //  @yields
    //  @resolves
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
        type2 = ['desc', 'extends', 'deprecated', 'restricted', 'since', 'see', 'fiddle', 'group', 'link'],
        type3 = ['mixes', 'implements', 'conditional'],
        type4 = ['returns', 'yields', 'throws', 'resolves'],
        type5 = ['param', 'prop', 'const'],
        type6 = ['func', 'event', 'item'],
        type7 = ['example', 'remarks', 'param', 'returns', 'yields', 'resolves'],
        multiInstance = ['param', 'see', 'throws'];
   
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
const Annotation = function(symbols, kind, name) {
    // All Known Symbols
    /** 
     * @type <name> - <desc> | @func <name> - <desc> | @prop {<type>} name - <desc> | @const {<value>} name - <desc> | @event <name> - <desc> | @item name - <desc>
     * @group <group-name>
     * @link <link>
     * @desc <desc>                                             
     * @public | @private | @protected | @internal  
     * @abstract | @virtual | @override | @sealed                           
     * @overload                                                           
     * @static
     * @flags                                                              
     * @async
     * @generator  
     * @readonly                                                           
     * @extends <class-type>                                    
     * @mixes <mixin-type>, <mixin-type>, ...                   
     * @implements <interface-type>, <interface-type>, ...      
     * @param {<type>} <name> - <desc>   
     *       <multi-line markdown format desc>                                   
     * @returns {<type>} <desc>
     *       <multi-line markdown format desc>
     * @yields {<type>} <desc>   
     *       <multi-line markdown format desc> 
     * @resolves {<type>} <desc>    
     *       <multi-line markdown format desc>
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
     * @fiddle <fiddleId>
     * @see <desc>   
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
    //  links can be external or internal:
    //      - external: can refer to any external website
    //          href="https://www.google.com"
    //          - must start with https:// or http://
    //      - internal: can refer to any member of same/other assembly using following pattern:
    //          [asmName[@collectionName]://][asmMemberType/][asmMemberName[::memberName[~overloadNumber]]]
    //          collectionName:
    //          - can be omitted, if required members is part of same collection
    //          - can be collectionName, if referred member is of a different collection
    //          asmName:
    //          - can be omitted, if referred member is of current assembly
    //          - can be asmName, if referred member is of a different assembly
    //          asmMemberType/collectionMemberType:  
    //          - can be omitted, if referred member is a 'type'
    //          - can be 'globals', 'components', 'namespaces', 'types', 'settings', 'config', 'resources', 'routes', 'assets', 'libs', 'locales',
    //            'api', 'guides', 'examples', 'pages'
    //          asmMemberName/collectionMemberName:
    //          - if not defined, it will refer to the list page of asmMemberType
    //          - when, defined should be qualified name
    //          - can be omitted in own documentation when defining ::memberName (note, :: is mandatory here too)
    //          - can be omitted in memberName's documentation when defining link of another memberName of the same
    //            asmMemberName
    //          memberName:
    //          - must be defined, if referring to a member of the asmMember - e.g., a property, constant, method or event
    //            if not defined, it will refer to main page of the asmMember
    //          - can be omitted in own documentaton when referring to another overload of the same memberName
    //          overloadNumber:
    //          - must be defined, if referring to a method member of the memberName and referring to a specific overload
    //          - if not defined, and there are overloads, it will take to first overload method
    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////

    const defineSeeAlso = () => {
        let _seeAlso = symbols['see'] || []; // [desc]
        if (_seeAlso.length > 0) {
            ano.see = [];
            for(let item of _seeAlso) {
                ano.see.push(md2html(item));
            }
        }
    };
    const defineModifiers = () => {
        if (ano.kind === kinds.class) {
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
            if (ano.kind === kinds.property && symbols['readonly']) { ano.modifiers.push('readonly'); }
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
            if (ano.params.findIndex(a => a.name === p.name) !== -1) { throw `Duplicate param names (${p.name}) are not allowed at @param symbol. (${ano.name})`; }
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
        // async
        if (typeof ano.async !== 'undefined') {    
            ano.async = symbols['async'] ? true : false;
        }

        // generator
        if (typeof ano.generator !== 'undefined') {    
            ano.generator = symbols['generator'] ? true : false;
        }
    };
    const defineReturnsYieldsResolvesAndThrows = () => {
        // returns
        if ([kinds.event, kinds.annotation].indexOf(ano.kind) !== -1) {
            ano.returns = null;
        } else {
            if (symbols['returns']) { 
                ano.returns = {
                    type: md2html(symbols['returns'][0] || ''),
                    desc: md2html(symbols['returns'][1]  || ''),
                    remarks: md2html(symbols['returns'][2]  || '')
                };
                if (!ano.returns.type) { throw `Return type must be defined at @returns symbol. It can be omitted altogether, if there is no return value. (${ano.name})`; }
            } else {
                ano.returns = null;
            }
        }

        // yields
        if (typeof ano.generator !== 'undefined') {
            if (ano.generator) {
                if (!symbols['yields']) { throw `@yields must be defined for a generator function. (${ano.name})`; }
                ano.yields = {
                    type: md2html(symbols['yields'][0] || ''),
                    desc: md2html(symbols['yields'][1] || ''),
                    remarks: md2html(symbols['yields'][2] || '')
                };
                if (!ano.yields.type) { throw `Yield type must be defined at @yields symbol. (${ano.name})`; }
            } else {
                delete ano.yields;
            }
        }

        // resolves
        if (typeof ano.async !== 'undefined') {
            if (ano.async) {
                if (!symbols['resolves']) { throw `@resolves must be defined for an async function. (${ano.name})`; }
                ano.resolves = {
                    type: md2html(symbols['resolves'][0] || ''),
                    desc: md2html(symbols['resolves'][1] || ''),
                    remarks: md2html(symbols['resolves'][2] || '')
                };
                if (!ano.resolves.type) { throw `Resolve type must be defined at @resolves symbol. (${ano.name})`; }
            } else {
                delete ano.resolves;
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
     * @fiddle <fiddleId>
     * @see <desc>  
    */      
    let ano = {
        name: name,
        kind: kind,
        scope: 'public',
        desc: md2html(symbols['desc'] || ''),               // ideally, this should not have any hyperlinks, because dl() will base the link wrongly on list pages - where same desc is used
        deprecated: md2html(symbols['deprecated'] || ''),
        restricted: md2html(symbols['restricted'] || ''),
        beta: (symbols['beta'] ? true : false),
        since: md2html(symbols['since'] || ''),
        remarks: md2html(symbols['remarks'] || ''),
        example: md2html(symbols['example'] || ''),
        fiddle: symbols['fiddle'] || ''
    };
    defineSeeAlso();

    // common for all top level types
    /** 
     * @type
    */   

    // kind based structure
    if ([kinds.package, kinds.assembly, kinds.api].indexOf(kind) !== -1) {
        // items
        ano.items = [];
    } else if ([kinds.globals, kinds.components, kinds.types].indexOf(kind) !== -1) {
        // items
        ano.items = [];
    } else if ([kinds.global, kinds.component, kinds.annotation].indexOf(kind) !== -1) {
        // common for all main types (class, struct, enum, mixin, interface)
        /** 
         * @public | @internal
        */
       
        // scope
        ano.scope = symbols['public'] || symbols['internal'] || 'internal'; 

        // kind specific
        switch(kind) {
            case kinds.global:
            case kinds.component: 
                // NOTE: same both for global and component kinds
                /** 
                 * @async
                 * @generator  
                 * @param {<type>} <name> - <desc>                                      
                 * @returns {<type>} <desc>
                 * @resolves {<type>} <desc>
                 * @yields {<type>} <desc>    
                 * @throws {<type>} <desc> 
                */
                ano.async = false;
                ano.generator = false;
                ano.params = [];
                ano.signature = '';
                ano.returns = {};
                ano.resolves = {};
                ano.yields = {};
                ano.throws = [];
                defineParamsSignatureAndOverload();
                defineASyncAndGenerator();
                defineReturnsYieldsResolvesAndThrows();
                break;                
            case kinds.annotation:
                /** 
                 * @param {<type>} <name> - <desc>                                      
                 * @throws {<type>} <desc> 
                */
                ano.params = [];
                ano.signature = '';
                ano.throws = [];
                defineParamsSignatureAndOverload();
                defineReturnsYieldsResolvesAndThrows();
                break;                
        }
    } else if ([kinds.class, kinds.struct, kinds.enum, kinds.mixin, kinds.interface].indexOf(kind) !== -1) {
        // common for all main types (class, struct, enum, mixin, interface)
        /** 
         * @public | @internal
        */

        // scope
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
        
        // kind specific
        switch(kind) {
            case kinds.class:
                /** 
                 * @abstract | @sealed                           
                 * @static                                                              
                 * @extends <class-type>                                    
                 * @mixes <mixin-type>, <mixin-type>, ...                   
                 * @implements <interface-type>, <interface-type>, ...      
                */
                ano.modifiers = [];
                defineModifiers();
                ano.static = symbols['static'] ? true : false;
                ano.extends = symbols['extends'] || '';
                ano.mixes = symbols['mixes'] || [];
                ano.implements = symbols['implements'] || [];
                break;                
            case kinds.struct:
                /** 
                 * @static                                                              
                */
                ano.static = symbols['static'] ? true : false;
                break;                
            case kinds.enum:
                /** 
                 * @flags
                */
                ano.flags = symbols['flags'] ? true : false;
                break;                
            case kinds.mixin:
                // nothing specific
                break;
            case kinds.interface:
                // nothing specific
                break;
        }
    } else if ([kinds.property, kinds.constant, kinds.method, kinds.event].indexOf(kind) !== -1) {
        // common for these types
        /** 
         * @public | @private | @protected
         * @static                                                              
         * @optional
         * @conditional <cond1>, <cond2>, ... 
        */
        ano.scope = symbols['private'] || symbols['protected'] || symbols['public'] || 'public'; 
        ano.static = symbols['static'] ? true : false;
        ano.optional = symbols['optional'] ? true : false;
        ano.conditional = symbols['conditional'] || [];

        if ([kinds.property, kinds.method, kinds.event].indexOf(kind) !== -1) {
            // common for these
            /** 
             * @abstract | @virtual | @override | @sealed                           
            */              
            ano.modifiers = [];
            defineModifiers();
        }

        // kind specific
        switch(kind) {
            case kinds.constant:
                /** 
                 * @const {<type>} name - <desc>
                */                  
                ano.type = md2html(symbols['const'][0] || 'object');
                ano.name = symbols['const'][1]; if(!ano.name) { throw `Constant name must be defined at @const symbol.`; }
                ano.desc = md2html((symbols['const'][2] || '') + (symbols['desc'] ? '\n' + symbols['desc'] : ''));
                break;                
            case kinds.property:
                /** 
                 * @prop {<type>} name - <desc>
                 * @readonly                                                           
                */                  
                ano.type = md2html(symbols['prop'][0] || 'object');
                ano.name = symbols['prop'][1]; if(!ano.name) { throw `Property name must be defined at @prop symbol.`; }
                ano.desc = md2html((symbols['prop'][2] || '') + (symbols['desc'] ? '\n' + symbols['desc'] : ''));
                break;
            case kinds.method:
                /** 
                 * @func <name> - <desc>
                 * @overload                                                           
                 * @async | @generator  
                 * @param {<type>} <name> - <desc>                                      
                 * @returns {<type>} <desc>
                 * @resolves {<type>} <desc>
                 * @yields {<type>} <desc>    
                 * @throws {<type>} <desc> 
                */                  
                ano.name = symbols['func'][0]; if(!ano.name) { throw `Function (method) name must be defined at @func symbol.`; }
                ano.desc = md2html((symbols['func'][1] || '') + (symbols['desc'] ? '\n' + symbols['desc'] : ''));
                ano.isConstructor = (ano.name === 'construct');
                ano.isDestructor = (ano.name === 'dispose');
                ano.overload = false;
                ano.overloadId = '';
                ano.params = [];
                ano.signature = '';
                ano.async = false;
                ano.generator = false;
                ano.returns = {};
                ano.resolves = {};
                ano.yields = {};
                ano.throws = [];
                defineParamsSignatureAndOverload();
                defineASyncAndGenerator();
                defineReturnsYieldsResolvesAndThrows();
                break;                
            case kinds.event:
                /** 
                 * @event <name> - <desc>
                 * @param {<type>} <name> - <desc>   
                 * @throws {<type>} <desc>                                    
                */  
                ano.name = symbols['event'][0]; if(!ano.name) { throw `Event name must be defined at @event symbol.`; }
                ano.desc = md2html((symbols['event'][1] || '') + (symbols['desc'] ? '\n' + symbols['desc'] : ''));
                ano.params = []; 
                ano.signature = '';
                ano.throws = [];
                defineParamsSignatureAndOverload();
                defineReturnsYieldsResolvesAndThrows();     
                break;
        }
    } else if ([kinds.guides, kinds.examples, kinds.pages, kinds.namespaces, kinds.routes, kinds.assets, kinds.resources, kinds.libs, kinds.configs, kinds.settings].indexOf(kind) !== -1) {
        // items
        ano.items = [];

        // itemKind 
        switch(kind) {
            case kinds.guides: ano.itemKind = kinds.guide; break;
            case kinds.examples: ano.itemKind = kinds.example; break;
            case kinds.pages: ano.itemKind = kinds.page; break;
            case kinds.namespaces: ano.itemKind = kinds.namespace; break; 
            case kinds.routes: ano.itemKind = kinds.route; break; 
            case kinds.assets: ano.itemKind = kinds.asset; break;
            case kinds.resources: ano.itemKind = kinds.resource; break; 
            case kinds.libs: ano.itemKind = kinds.lib; break;
            case kinds.configs: ano.itemKind = kinds.config; break;
            case kinds.settings: ano.itemKind = kinds.setting; break;
        }
    } else if ([kinds.guide, kinds.example, kinds.page, kinds.namespace, kinds.route, kinds.asset, kinds.resource, kinds.lib, kinds.config, kinds.setting].indexOf(kind) !== -1) {
        /** 
         * @item name - <desc>
         * @group <group-name>
         * @link <link>
        */                  
        ano.name = symbols['item'][0]; if(!ano.name) { throw `Item name must be defined at @item symbol.`; }
        ano.desc = md2html((symbols['item'][1] || '') + (symbols['desc'] ? '\n' + symbols['desc'] : ''));
        ano.group = symbols['group'] || '';
        ano.link = symbols['link'] || '';

        if (kind === kinds.guide) {
            // guide
            ano.guide = ''; // will be loaded with guide content

        } else if (kind === kinds.page) {  
            // html, js and css content
            ano.html = '';
            ano.css = '';
            ano.js = '';
        }
    } else {
        // unknown kind
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
const symbolsToAnnotation = (symbols, kind, name) => {
    let annotation = null;
    if (symbols['type']) {
        if (!name) { throw `Name must be provided for type.`; }
        if (!kind) { throw `Specific kind must be provided. (${name})`; }
        annotation = new Annotation(symbols, kind, name);
    } else if (symbols['const']) {
        annotation = new Annotation(symbols, kinds.constant);
    } else if (symbols['prop']) {
        annotation = new Annotation(symbols, kinds.property);
    } else if (symbols['func']) {
        annotation = new Annotation(symbols, kinds.method);
    } else if (symbols['event']) {
        annotation = new Annotation(symbols, kinds.event);
    } else if (symbols['item']) {
        if (!kind) { throw `Specific kind must be provided for item.`; }
        annotation = new Annotation(symbols, kind);
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

        // common template for all
        item.docs.template = 'content';

        switch(item.kind) {
            case kinds.package:
                item.docs.self = ``; // '/'
                item.docs.members = item.docs.self;
                break;
            case kinds.assembly:
                item.docs.self = `${asm.name}`;
                item.docs.members = item.docs.self;
                break;
            case kinds.api:
            case kinds.guides:
            case kinds.examples:
            case kinds.pages:
                item.docs.self = `${item.kind}`; // /api, /guides, /examples, /pages
                item.docs.members = item.docs.self;
                break;
            case kinds.constant:
            case kinds.property:
            case kinds.method:
            case kinds.event:
            case kinds.guide:
            case kinds.example:
            case kinds.page:
            case kinds.route:
            case kinds.asset:
            case kinds.resource:
            case kinds.lib:
            case kinds.config:
            case kinds.setting:
                item.docs.parent.name = parent.name;
                item.docs.parent.link = parent.docs.self;
                item.docs.self = `${parent.docs.members}/${item.name}`;
                item.docs.members = item.docs.self;
                if (item.kind === kinds.method && item.overload && item.overloadId) { item.docs.self += '~' + item.overloadId; }
                break;
            case kinds.namespace:
                item.docs.parent.name = parent.memberType;
                item.docs.parent.link = parent.docs.self;
                item.docs.self = `${parent.docs.members}/${item.name}`;  
                item.docs.members = `${asm.name}/${kinds.types}`; // namespase members are inside types (same as below)     
                break;
            case kinds.class:
            case kinds.struct:
            case kinds.enum:
            case kinds.mixin:
            case kinds.interface:
                item.docs.parent.name = item.ns;
                item.docs.parent.link = `${asm.name}/${kinds.namespaces}/${parent.name || '(root)'}`;
                item.docs.self = `${asm.name}/${kinds.types}/${item.name}`;
                item.docs.members = item.docs.self;
                break;
            case kinds.component:
            case kinds.annotation:
            case kinds.global:
                item.docs.parent.name = parent.memberType;
                item.docs.parent.link = parent.docs.self;
                item.docs.self = `${parent.docs.members}/${item.name}`;
                item.docs.members = item.docs.self;
                break;
            case kinds.globals:
            case kinds.components:
            case kinds.namespaces:
            case kinds.types:
            case kinds.routes:
            case kinds.resources:
            case kinds.assets:
            case kinds.libs:
            case kinds.configs:
            case kinds.settings:
                item.docs.self = `${asm.name}/${item.kind}`; // /globals, /components, /namespaces, /types, /routes, /resources, /assets, /libs, /configs, /settings
                item.docs.members = item.docs.self;
                break;
            default:
                throw `Unknown type '${item.kind}'. (${item.name})`;
                break;
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
    const defineItems = (kind) => {
        data.items = [];
        let item = null;
        for(let itemName of itemAnnotations) {
            // get
            item = members[itemName];

            // validations
            // none

            // add docs info
            addDocsInfo(item, data);

            // add
            data.items.push(item);
        }
    };
    const defineConstants = (kind) => {
        data.constants = [];
        let item = null;
        for(let itemName of constAnnotations) {
            // get
            item = members[itemName];

            // add docs info
            addDocsInfo(item, data);

            // validations
            switch(kind) {
                case kinds.enum:
                case kinds.component:
                case kinds.annotation:
                case kinds.global:
                    // scope: always 'public'
                    if (item.scope !== 'public') { throw `Defined member scope is not supported in this type. (${data.name}.${item.name})`; }

                    // static: always 'true'
                    if (!item.static) { item.static = true; }
                    break;
                case kinds.struct:
                    // scope: always 'public'
                    if (item.scope !== 'public') { throw `Defined member scope is not supported in this type. (${data.name}.${item.name})`; }
                    break;
                case kinds.class:
                case kinds.mixin:
                    // no restrictions
                    break;
            }

            // add
            data.constants.push(item);
        }
    };
    const defineProperties = (kind) => {
        data.properties = [];
        let item = null;
        for(let itemName of propAnnotations) {
            // get
            item = members[itemName];

            // add docs info
            addDocsInfo(item, data);

            // validations
            switch(kind) {
                case kinds.component:
                case kinds.annotation: 
                case kinds.global:
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
                case kinds.struct:
                    // scope: only public/private
                    if (item.scope !== 'public' && item.scope !== 'private') { throw `Defined member scope is not supported in this type. (${data.name}.${item.name})`; }

                    // modifiers: only readonly can be defined
                    if (item.modifiers.length !== 0 && item.modifiers[0] !== 'readonly') { throw `Modifiers are not supported in this type. (${data.name}.${item.name})`; }
                    break;
                case kinds.interface:
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
                case kinds.class:
                case kinds.mixin:
                    // no restrictions
                    break;
            }                

            // add
            data.properties.push(item);
        }
    };
    const defineMethods = (kind) => {
        data.methods = [];
        let items = null;
        for(let itemName of methodAnnotations) {
            // get
            items = members[itemName]; // array of method overloads or just one

            // validations for each item
            for(let item of items) {
                // add docs info
                addDocsInfo(item, data);

                switch(kind) {
                    case kinds.component:
                    case kinds.annotation:
                    case kinds.global:
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
                    case kinds.struct:
                        // scope: public/private
                        if (item.scope !== 'public' && item.scope !== 'private') { throw `Defined member scope is not supported in this type. (${data.name}.${item.name} [${item.signature}])`; }

                        // modifiers: not supported
                        if (item.modifiers.length !== 0) { throw `Modifiers are not supported in this type. (${data.name}.${item.name} [${item.signature}])`; }

                        // destructor cannot be defined
                        if (itemName === 'dispose') { throw `Destructors definition is not supported in this type. (${data.name}.${item.name} [${item.signature}])`; }
                        break;
                    case kinds.interface:
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
                    case kinds.class:
                        // no restrictions
                        break;
                    case kinds.mixin:
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
    const defineEvents = (kind) => {
        data.events = [];
        let item = null;
        for(let itemName of eventAnnotations) {
            // get
            item = members[itemName]; // array of method overloads or just one

            // add docs info
            addDocsInfo(item, data);

            // validations
            switch(kind) {
                case kinds.struct:
                    // scope: public/private
                    if (item.scope !== 'public' && item.scope !== 'private') { throw `Defined member scope is not supported in this type. (${data.name}.${item.name})`; }

                    // modifiers: not supported
                    if (item.modifiers.length !== 0) { throw `Modifiers are not supported in this type. (${data.name}.${item.name})`; }
                    break;
                case kinds.interface:
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
                case kinds.class:
                case kinds.mixin:
                    // no restrictions
                    break;
            } 
            
            // add
            data.events.push(item);
        }
    };
       
    switch(data.kind) {
        case kinds.enum:
            defineConstants(data.kind);
            break;
        case kinds.struct:
        case kinds.class:
        case kinds.mixin:
            defineConstants(data.kind);
            defineProperties(data.kind);
            defineMethods(data.kind);
            defineEvents(data.kind);
            break;
        case kinds.interface:
            defineProperties(data.kind);
            defineMethods(data.kind);
            defineEvents(data.kind);
            break;
        case kinds.component:
        case kinds.annotation:
        case kinds.global:
            defineConstants(data.kind);
            defineProperties(data.kind);
            defineMethods(data.kind);
            break;
        case kinds.guides:
        case kinds.examples:
        case kinds.pages:
        case kinds.namespaces:
        case kinds.routes:
        case kinds.assets:
        case kinds.resources:
        case kinds.libs:
        case kinds.configs:
        case kinds.settings:
            defineItems(data.kind);
        default:
            // do nothing for other kinds
            break;
    }

    // return
    return data;
};
const getAnnotations = (options, asm, parent, content, name, kind) => {
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
        // NOTE: it is assumed that @type symbol block will always be defined as first block
        // hence mainAnnotation will be found first
        if (!mainAnnotation) {
            a = symbolsToAnnotation(symbols, kind, name); // pass name and kind for main annotation only
        } else {
            a = symbolsToAnnotation(symbols, mainAnnotation.itemKind); 
        }
        if (a) {
            switch(a.kind) {
                case kinds.constant:
                    if (members[a.name]) { throw `Only one definition can exisit for a member. (${a.name})`; }
                    members[a.name] = a; 
                    constAnnotations.push(a.name);
                    break;
                case kinds.property:
                    if (members[a.name]) { throw `Only one definition can exisit for a member. (${a.name})`; }
                    members[a.name] = a; 
                    propAnnotations.push(a.name);
                    break;
                case kinds.method:
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
                    break;                        
                case kinds.event:
                    if (members[a.name]) { throw `Only one definition can exisit for a member. (${a.name})`; }
                    members[a.name] = a;
                    eventAnnotations.push(a.name);
                    break;
                case kinds.guide:
                case kinds.example:
                case kinds.page:
                case kinds.route:
                case kinds.asset:
                case kinds.resource:
                case kinds.lib:
                case kinds.config:
                case kinds.setting:
                case kinds.namespace:
                    if (members[a.name]) { throw `Only one definition can exisit for a member. (${a.name})`; }
                    members[a.name] = a; 
                    itemAnnotations.push(a.name);
                    break;
                case kinds.package:
                case kinds.assembly:
                case kinds.api:
                case kinds.class:
                case kinds.struct:
                case kinds.enum:
                case kinds.mixin:
                case kinds.interface:
                case kinds.component:
                case kinds.annotation:
                case kinds.global:
                case kinds.guides:
                case kinds.examples:
                case kinds.pages:
                case kinds.globals:
                case kinds.components:
                case kinds.namespaces:
                case kinds.types:
                case kinds.routes:
                case kinds.resources:
                case kinds.assets:
                case kinds.libs:
                case kinds.configs:
                case kinds.settings:
                    if (mainAnnotation) { throw `Only one block can have @type symbol. (${a.name})`; }
                    mainAnnotation = a;
                    break;
                default:
                    throw `Unknown type. (${a.name})`;
                    break;
            }
        }
    }

    // build default mainAnnotation if could not be found
    if (!mainAnnotation) { mainAnnotation = new Annotation({}, kind, name); }

    // build annotation data and return
    return buildAnnotationData(options, asm, parent, members, mainAnnotation, itemAnnotations, constAnnotations, propAnnotations, methodAnnotations, eventAnnotations);
};

// docs
const writeThemes = async (options) => {
    // copy themes folder as such, so default themes will be copied
    // even if there is any existing default themes, it will overwrite that
    let inbuiltThemes = require.resolve('../templates/docs/themes/default/index.json').replace('/default/index.json', ''); 
    copyDir.sync(inbuiltThemes, pathJoin(options.docs.dest.root, 'themes'), {
        utimes: true,
        mode: true,
        cover: true
    });

    // copy default favicon.png at root
    let favicon = pathJoin(inbuiltThemes, 'images', 'favicon.png');
    fsx.copyFileSync(favicon, pathJoin(options.docs.dest.root, 'favicon.png'));    
};
const writeEngine = async (options) => {
    // copy engine files at root/engine, except known files
    let engineFile = require.resolve('../templates/docs/engine/index.html'),
        engineRoot = engineFile.replace('index.html', ''); 
    copyDir.sync(engineRoot, pathJoin(options.docs.dest.root, 'engine'), {
        utimes: true,
        mode: true,
        cover: true, 
        filter: (stat, filepath) => {
            // do not copy these files
            if(stat === 'file') {
                if (['index.html', 'flairDocs.js'].indexOf(path.basename(filepath)) !== -1) {
                    return false;
                }
            }
            return true;
        }
    });

    // copy flairDocs.js at root as flairDocs.min.js
    let flairDocs = pathJoin(engineRoot, 'js', 'flairDocs.js'),
        content = fsx.readFileSync(flairDocs, 'utf8');
    minifiedContent = await minify.jsContent(options, content);
    fsx.writeFileSync(pathJoin(options.docs.dest.root, 'engine', 'js', 'flairDocs.js'), content, 'utf8');
    fsx.writeFileSync(pathJoin(options.docs.dest.root, 'engine', 'js', 'flairDocs.min.js'), minifiedContent.code, 'utf8');

    // customize index.html's copy (at root)
    let engineContent = fsx.readFileSync(engineFile, 'utf8');
    engineContent = replaceAll(engineContent, '<<title>>', options.package.title || '');
    engineContent = replaceAll(engineContent, '<<desc>>', options.package.description || '');
    if (options.docs.favicon) {
        engineContent = replaceAll(engineContent, '<<favicon_start>>', "");
        engineContent = replaceAll(engineContent, '<<favicon>>', options.docs.favicon);
        engineContent = replaceAll(engineContent, '<<favicon_end>>', "");
    } else {
        engineContent = replaceAll(engineContent, '<<favicon_start>>', "<!--");
        engineContent = replaceAll(engineContent, '<<favicon>>', "");
        engineContent = replaceAll(engineContent, '<<favicon_end>>', "-->");
    }
    if (options.docs.ga) {
        engineContent = replaceAll(engineContent, '<<ga_start>>', "");
        engineContent = replaceAll(engineContent, '<<ga>>', options.docs.ga);
        engineContent = replaceAll(engineContent, '<<ga_end>>', "");
    } else {
        engineContent = replaceAll(engineContent, '<<ga_start>>', "<!--");
        engineContent = replaceAll(engineContent, '<<ga>>', "");
        engineContent = replaceAll(engineContent, '<<ga_end>>', "-->");
    }    
    fsx.writeFileSync(pathJoin(options.docs.dest.root, 'index.html'), engineContent, 'utf8'); // keep at root, so gets loaded automatically    
};
const writeDocs = async (options) => {
    const getThemeData = () => {
        // theme template
        let theTheme = (options.docs.theme || 'default'),
            themeRoot = pathJoin(options.docs.dest.root, 'themes', theTheme),
            template = pathJoin(themeRoot, 'index.html');
        if (!fsx.existsSync(template)) { throw `Theme file missing. (${template})`; }
        template = template.replace(options.docs.dest.root, '.');

        // theme js/css files
        let json = fsx.readJSONSync(pathJoin(themeRoot, 'index.json'), 'utf8');
            files = {
                js: [],
                css: []
            };
        // it is expected that index.json will define file in context of the theme root file
        // which means, it will add here any path before theme's own path
        for(let js of json.js) { files.js.push(pathJoin('./themes', theTheme, js)); }
        for(let css of json.css) { files.css.push(pathJoin('./themes', theTheme, css)); }

        // theme data
        let theme = {
            files: files,
            template: template,
            root: pathJoin('./themes', theTheme),
            fragments: pathJoin('./themes', theTheme, 'fragments')
        };

        // return
        return theme;
    };
    const getPackages = () => {
        let currentPackage = options.package.name;
        let currentVersion = options.docs.versions.current.name || 'v1';
        let currentVersionTitle = options.docs.versions.current.title || '1.x';

        const addUpdateCurrentLocales = (verItem) => {
            verItem.locales = verItem.locales || {};
            verItem.locales.list = verItem.locales.list || [];
            verItem.locales.default = verItem.locales.default || options.l10n.default || 'en';
            for(let loc of options.l10n.current) {
                if (verItem.locales.list.length === 0 || verItem.locales.list.indexOf(loc) === -1) {
                    verItem.locales.list.push(loc);
                }
            }
            return verItem;
        };
        const addUpdateCurrentVersion = (item) => {
            item.versions = item.versions || {};
            item.versions.list = item.versions.list || [];
            item.versions.default = item.versions.default || options.docs.versions.default || currentVersion;
            if (item.versions.list.length === 0 || item.versions.list.findIndex(item => item.name === currentVersion) === -1) {
                item.versions.list.push({ name: currentVersion, title: currentVersionTitle });
            } 
            return item;
        };        

        // process whole list of packages
        let list = options.docs.packages.list;
        if (list.length === 0 || list.findIndex(item => item.name === currentPackage) === -1) { // by default add current package
            list.push({ name: currentPackage });
        }
        
        // add missing info for each package, version, locale
        let localesListX = [];
        for(let item of list) { 
            if (item.name === currentPackage) { // for current package, ensure current version is added
                item = addUpdateCurrentVersion(item);
            }
            for(let verItem of item.versions.list) {
                if (item.name === currentPackage && verItem.name === currentVersion) { // for current package's current version, ensure current locales are added
                    verItem = addUpdateCurrentLocales(verItem);
                }

                // expand locales list
                localesListX = [];
                for(let loc of verItem.locales.list) {
                    localesListX.push({
                        name: loc,
                        title: (options.l10n.locales[loc] ? options.l10n.locales[loc].title : loc),
                        display: (options.l10n.locales[loc] ? options.l10n.locales[loc].display : loc),
                        rtl: (options.l10n.locales[loc] ? options.l10n.locales[loc].rtl : false),
                        root: pathJoin('./' + options.docs.dest.content, item.name, verItem.name, loc),
                        file: 'index.json'
                    });
                }
                verItem.locales.list = localesListX;
            }          
        }

        // return
        return list;
    };

    // data
    let data = {
        builder: {
            name: options.buildInfo.name,
            version: options.buildInfo.version
        },         
        packages: {
            list: getPackages(),
            default: options.docs.packages.default || options.package.name
        },
        theme: getThemeData()
    };

    // write (./index.json)
    let file = pathJoin(options.docs.dest.root, 'index.json');
    plainWrite(options, file, data);
};

// locales
const initLocales = (options) => {
    // ensure default locale
    if (options.l10n.current.length === 0) { options.l10n.current = ['en']; };
    if (!options.l10n.default || options.l10n.current.indexOf(options.l10n.default) === -1) { options.l10n.default = options.l10n.current[0]; }

    // store all asms for rebuilding at the end once for each locale
    options.docs.temp.asms = [];
};
const initLocale = (options, locale) => {
    // set locale
    options.docs.temp.locale = locale;

    // load strings file of correct locale over inbuilt default strings
    let defaultStrings = fsx.readJsonSync(require.resolve('../templates/docs/engine/strings.json'), 'utf8'),
        file = getSrc(options, 'docs', 'strings.json'),
        strings = defaultStrings, 
        locStrings = null;
    if (fsx.existsSync(file)) {
        locStrings = fsx.readJSONSync(file, 'utf8');
        strings = deepMerge(locStrings, defaultStrings);
    }
    options.docs.temp.strings = strings;
};

// package
const initPackage = (options) => {
    // search dump
    options.docs.temp.search = [];

    // package
    options.docs.temp.json = getPackage(options);
};
const getPackage = (options) => {
    // package home (./docs/package.info)
    let content = getContent(options, 'docs', 'package.info');
    let data = getAnnotations(options, null, null, content, options.docs.temp.strings.packages[options.package.name] || options.package.title, kinds.package);

    // static items definition is not supported in this info
    // therefore overwrite with empty, in case it was defined,
    // so dynamic info can be added
    data.items = [];

    // info
    data.info = {
        name: options.package.name,
        title: options.docs.temp.strings.packages[options.package.name] || options.package.title,
        copyright: options.package.copyright || '',
        license: options.package.license || '',
        version: options.package.version || '',
    };

    // members
    data.api = getAPI(options);
    data.examples = getExamples(options);
    data.guides = getGuides(options);
    data.pages = getPages(options);

    // search
    data.search = (options.docs.search.build ? './search.json' : '');

    // strings
    data.strings = './strings.json';
    
    // add to search
    addToSearch(options, data);

    // return
    return data;    
};
const writePackage = async (options) => {
    // docs root
    // copy default docs folder of this package at package home
    // except *.info files
    let srcDocs = getSrc(options, 'docs'),
        destDocs = getDest(options);
    if (fsx.pathExistsSync(srcDocs)) {
        copyDir.sync(srcDocs, destDocs, {
            utimes: true,
            mode: true,
            cover: true,
            filter: (stat, filepath) => {
                // do not copy *.info files
                if (stat === 'file' && path.extname(filepath) === '.info') { return false; }

                // do not copy special folders
                if(filepath.startsWith(path.join(srcDocs, 'guides')) ||
                   filepath.startsWith(path.join(srcDocs, 'pages'))) { // used path.join instead of pathJoin on purpose
                    return false;
                }
  
                return true;
              }
        });
    }

    // members
    writeAPI(options);
    writeExamples(options);
    writeGuides(options);
    writePages(options);

    // search
    writeSearch(options);

    // strings
    writeStrings(options);

    // data
    let data = options.docs.temp.json;

    // package itself
    file = getDest(options, 'index.json');
    plainWrite(options, file, data);
};
const getAPI = (options) => {
    // api home (./docs/api.info)
    let content = getContent(options,'docs', 'api.info');
    let data = getAnnotations(options, null, null, content, getString(options, 'api'), kinds.api);

    // static items definition is not supported in this info
    // therefore overwrite with empty, in case it was defined,
    // so dynamic info can be added
    data.items = [];

    // add to search
    addToSearch(options, data);

    // return
    return data;
};
const writeAPI = (options) => {
    // data
    let packageData = options.docs.temp.json,
        data = packageData.api;
    delete packageData.api;

    if (data.items.length > 0) { // some api exist
        // package items
        addToItems(options, packageData.items, data, getString(options, 'members'));

        // write
        let file = getDest(options, 'api.json');
        plainWrite(options, file, data);
    }
};
const getExamples = (options) => {
    // examples (./docs/examples.info)
    let content = getContent(options, 'docs', 'examples.info');
    let data = getAnnotations(options, null, null, content, getString(options, 'examples'), kinds.examples);

    // static items definition is supported in this info
    // should be written as:
    // @item <name> - <desc>
    // @link <fiddleId>
    // @group <group name>

    // add to search
    addToSearch(options, data);

    // return
    return data;
};
const writeExamples = (options) => {
    // data
    let packageData = options.docs.temp.json,
        data = packageData.examples,
        file = '';
    delete packageData.examples;

    if (data.items.length > 0) { // some examples exist 
        // package items
        addToItems(options, packageData.items, data, getString(options, 'members'));

        // process each example
        let jsFiddleUrl = options.docs.fiddle.urlTemplate.replace('<<userName>>', options.docs.fiddle.userName),
            items = [];
        for(let item of data.items) {
            // update item link
            item.link = jsFiddleUrl.replace('<<fiddleId>>', item.link);

            // item's items
            addToItems(options, items, item, item.group);  // examples can be grouped using @group symbol

            // write
            file = getDest(options, 'examples', `${item.name}.json`);
            plainWrite(options, file, item);
        }
        data.items = items;

        // write
        file = getDest(options, 'examples.json');
        plainWrite(options, file, data);
    }
};
const getGuides = (options) => {
    // guides (./docs/guides.info)
    let content = getContent(options, 'docs', 'guides.info');
    let data = getAnnotations(options, null, null, content, getString(options, 'guides'), kinds.guides);

    // static items definition is supported in this info
    // should be written as:
    // @item <name> - <desc>
    // @link { <./path/file.md> } <-- path should be in relation to ./guides folder (excluding ./guides itself)
    // @group <group name>

    // add to search
    addToSearch(options, data);

    // return
    return data;
};
const writeGuides = (options) => {
    // data
    let packageData = options.docs.temp.json,
        data = packageData.guides,
        file = '';
    delete packageData.guides;

    if (data.items.length > 0) { // some guides exist 
        // package items
        addToItems(options, packageData.items, data, getString(options, 'members'));

        // process each guide
        let mdFile = '',
            items = [];
        for(let item of data.items) {
            // validate
            mdFile = pathJoin(options.build.src, 'docs', 'guides', item.link);
            if (!mdFile.endsWith('.md')) { throw `Must be markdown file. (${item.name}: ${item.link})`; }
            if (!fsx.existsSync(mdFile)) { throw `Guide markdown (${item.link}) not found. (${item.name})`; }

            // load content of whole guide
            item.guide = mdPage2html(fsx.readFileSync(mdFile, 'utf8'));
            
            // item's items
            addToItems(options, items, item, item.group);  // guides can be grouped using @group symbol

            // write
            file = getDest(options, 'guides', `${item.name}.json`);
            plainWrite(options, file, item);
        }
        data.items = items;

        // write
        file = getDest(options, 'guides.json');
        plainWrite(options, file, data);
    }
};
const getPages = (options) => {
    // pages (./docs/pages.info)
    let content = getContent(options, 'docs', 'pages.info');
    let data = getAnnotations(options, null, null, content, getString(options, 'pages'), kinds.pages);

    // static items definition is supported in this info
    // should be written as:
    // @item <name> - <desc>
    //      each page name must exists in same name folder under ./pages as: ./pages/<name>/index.html (alongside index.js and index.css can also exists if need be and will be processed)
    // @group <group name>

    // add to search
    addToSearch(options, data);

    // return
    return data;
};
const writePages = (options) => {
    // data
    let packageData = options.docs.temp.json,
        data = packageData.pages,
        file = '';
    delete packageData.pages;

    if (data.items.length > 0) { // some pages exist 
        // package items
        addToItems(options, packageData.items, data, getString(options, 'members'));

        // process each page
        let htmlFile = '',
            jsFile = '',
            cssFile = '',
            items = [];
        for(let item of data.items) {
            // validate
            htmlFile = pathJoin(options.build.src, 'docs', 'pages', item.name, 'index.html');
            if (!fsx.existsSync(htmlFile)) { throw `Page not found. (${item.name})`; }
            
            // load content of whole html, associated js and css
            // for any required images etc, either put in root docs folder or embedd using css techniques
            item.html = fsx.readFileSync(htmlFile, 'utf8');
            jsFile = htmlFile.replace('.html', '.js');
            if (!fsx.existsSync(jsFile)) { item.js = fsx.readFileSync(jsFile, 'utf8'); }
            cssFile = htmlFile.replace('.html', '.css');
            if (!fsx.existsSync(cssFile)) { item.css = fsx.readFileSync(cssFile, 'utf8'); }

            // item's items
            addToItems(options, items, item, item.group); // pages can be grouped using @group symbol

            // write file
            file = getDest(options, 'pages', `${item.name}.json`);
            plainWrite(options, file, item);
        }
        data.items = items;

        // write
        file = getDest(options, 'pages.json');
        plainWrite(options, file, data);
    }
};
const writeSearch = (options) => {
    if (!options.docs.search.build) { return; }

    // https://lucaong.github.io/minisearch/

    // build search index
    let packageData = options.docs.temp.json,
        searchDump = options.docs.temp.search,
        file = '';
    let searchIndexOptions = {
        idField: 'link',
        fields: ['name', 'desc'],
        storeFields: ['asm', 'name'],
        searchOptions: {
            boost: { name: 2 },
            fuzzy: 0.2
        }
    };
    let miniSearch = new MiniSearch(searchIndexOptions);
    miniSearch.addAll(searchDump);

    // data
    let data = {
        options: searchIndexOptions,
        index: miniSearch.toJSON()
    };

    // write
    file = getDest(options, packageData.search);
    plainWrite(options, file, data);
};
const writeStrings = (options) => {
    let packageData = options.docs.temp.json,
        file = '';

    // data 
    // pick strings of current locale
    let data = options.docs.temp.strings;

    // write
    file = getDest(options, packageData.strings);
    plainWrite(options, file, data);
};

// assembly
const getAsm = (options, asm) => {
    // asm (./docs/assembly.info)
    let content = getContent(options, asm.src, 'docs', 'assembly.info');
    let data = getAnnotations(options, asm, null, content, asm.name, kinds.assembly);

    // static items definition is not supported in this info
    // therefore overwrite with empty, in case it was defined,
    // so dynamic info can be added
    data.items = [];

    // members
    data.globals = getGlobals(options, asm);
    data.components = getComponents(options, asm);
    data.namespaces = getNamespaces(options, asm);
    data.types = getTypes(options, asm);
    data.assets = getAssets(options, asm);
    data.resources = getResources(options, asm);
    data.routes = getRoutes(options, asm);
    data.libs = getLibs(options, asm);
    data.configs = getConfigs(options, asm);
    data.settings = getSettings(options, asm);

    // add to search
    addToSearch(options, data);    

    // return
    return data;    
};
const writeAsm = async (options, asm) => {
    // data
    let packageData = options.docs.temp.json,
        data = getAsm(options, asm),
        file = '';

    // add items
    writeGlobals(options, asm, data);
    writeComponents(options, asm, data);
    writeNamespaces(options, asm, data);
    writeTypes(options, asm, data);
    writeAssets(options, asm, data);
    writeResources(options, asm, data);
    writeRoutes(options, asm, data);
    writeLibs(options, asm, data);
    writeConfigs(options, asm, data);
    writeSettings(options, asm, data);

    // api items
    addToItems(options, packageData.api.items, data, getString(options, 'members'));

    // write
    file = getDest(options, asm.name, 'index.json');
    plainWrite(options, file, data);
};
const getGlobals = (options, asm) => {
    // ./docs/globals.info
    let content = getContent(options, asm.src, 'docs', 'globals.info');
    let data = getAnnotations(options, asm, null, content, getString(options, 'globals'), kinds.globals);
        
    // static items definition is not supported in this info
    // therefore overwrite with empty, in case it was defined,
    // so dynamic info can be added
    data.items = [];

    // add items
    let item = null;
    for(let global of asm.globals) {
        content = getContentFromCode(options, global.file, global.content);
        item = getAnnotations(options, asm, data, content, global.name, kinds.global);
        data.items.push(item);

        // add to search
        addToSearch(options, item);        
    }

    // add to search
    addToSearch(options, data);

    // return
    return data;
};
const writeGlobals = (options, asm, asmData) => {
    let data = asmData.globals,
        items = [],
        file = '';
    delete asmData.globals;

    if (data.items.length > 0) { // some globals are defined
        // asm items
        addToItems(options, asmData.items, data, getString(options, 'members'));

        // process global's members
        for(let item of data.items) {
            // global's members
            writeMembers(options, item, asm.name, 'globals', item.name);

            // globals items
            addToItems(options, items, item, item.group); // globals can be grouped using @group symbol

            // write
            file = getDest(options, asm.name, 'globals', `${item.name}.json`);
            plainWrite(options, file, item);
        }
        data.items = items;
    
        // write
        file = getDest(options, asm.name, 'globals.json');
        plainWrite(options, file, data);
    }
};
const getComponents = (options, asm) => {
    // ./docs/components.info
    let content = getContent(options, asm.src, 'docs', 'components.info');
    let data = getAnnotations(options, asm, null, content, getString(options, 'components'), kinds.components);

    // static items definition is not supported in this info
    // therefore overwrite with empty, in case it was defined,
    // so dynamic info can be added
    data.items = [];

    // add items
    let item = null;
    for(let comp of asm.components) {
        content = getContentFromCode(options, comp.file, comp.content);
        item = getAnnotations(options, asm, data, content, comp.name, comp.type);
        data.items.push(item);

        // add to search
        addToSearch(options, item);          
    }

    // add to search
    addToSearch(options, data);    

    // return
    return data;
};
const writeComponents = (options, asm, asmData) => {
    let data = asmData.components,
        items = [],
        file = '',
        group = '';
    delete asmData.components;

    if (data.items.length > 0) { // some components are defined
        // asm items
        addToItems(options, asmData.items, data, getString(options, 'members'));

        // process component's members
        for(let item of data.items) {
            // kind based processing
            switch(item.kind) {
                case 'component': group = getString(options, 'components'); break;
                case 'annotation': group = getString(options, 'annotations'); break; 
            };

            // component's members
            writeMembers(options, item, asm.name, 'components', item.name);

            // components' items
            addToItems(options, items, item, group); // component's group is fixed and therefore @group is ignored

            // write
            file = getDest(options, asm.name, 'components', `${item.name}.json`);
            plainWrite(options, file, item);     
        }
        data.items = items;
    
        // write
        file = getDest(options, asm.name, 'components.json');
        plainWrite(options, file, data);
    }
};
const getNamespaces = (options, asm) => {
    // ./docs/namespaces.info
    let content = getContent(options, 'docs', 'namespaces.info');
    let data = getAnnotations(options, asm, null, content, getString(options, 'namespaces'), kinds.namespaces);

    // static items definition is supported in this info
    // should be written as:
    // @item <name> - <desc>
    // @group <group name>

    // add to search
    addToSearch(options, data);  

    // return
    return data;
};
const writeNamespaces = (options, asm, asmData) => {
    // data
    let data = asmData.namespaces,
        items = [],
        file = '';
    delete asmData.namespaces;

    if (data.items.length > 0) { // some namespaces are defined
        // asm items
        addToItems(options, asmData.items, data, getString(options, 'members'));        

        // process each namespace
        for(let item of data.items) {
            // namespaces' items
            addToItems(options, items, item, item.group); // namespaces can be grouped using @group

            // write
            file = getDest(options, asm.name, 'namespaces', `${item.name}.json`);
            plainWrite(options, file, item);
        }
    }
    data.items = items;

    // write
    file = getDest(options, asm.name, 'namespaces.json');
    plainWrite(options, file, data);
};
const getTypes = (options, asm) => {
    // ./docs/types.info
    let content = getContent(options, 'docs', 'types.info');
    let data = getAnnotations(options, asm, null, content, getString(options, 'types'), kinds.types);

    // static items definition is not supported in this info
    // therefore overwrite with empty, in case it was defined,
    // so dynamic info can be added
    data.items = [];

    // add items
    let item = null;
    for(let type of asm.types) {
        content = getContentFromCode(options, type.file, type.content);
        item = getAnnotations(options, asm, data, content, type.qualifiedName, type.type);
        data.items.push(item);

        // add to search
        addToSearch(options, item);
    }

    // add to search
    addToSearch(options, data);  

    // return
    return data;
};
const writeTypes = (options, asm, asmData) => {
    let data = asmData.types,
        items = [],
        file = '',
        group = '';
    delete asmData.types;

    if (data.items.length > 0) { // some types are defined
        // asm items
        addToItems(options, asmData.items, data, getString(options, 'members'));

        // process types's members
        for(let item of data.items) {
            // kind based processing
            switch(item.kind) {
                case 'enum': group = getString(options, 'enums'); break;
                case 'struct': group = getString(options, 'structs'); break;
                case 'class': group = getString(options, 'classes'); break;
                case 'mixin': group = getString(options, 'mixins'); break;
                case 'interface': group = getString(options, 'interfaces'); break;
            };

            // types's members
            writeMembers(options, item, asm.name, 'types', item.name);

            // types' items
            addToItems(options, items, item, group); // types's group is fixed and therefore @group is ignored

            // write
            file = getDest(options, asm.name, 'types', `${item.name}.json`);
            plainWrite(options, file, item);     
        }
        data.items = items;
    
        // write
        file = getDest(options, asm.name, 'types.json');
        plainWrite(options, file, data);
    }
};
const getAssets = (options, asm) => {
    // ./docs/assets.info
    let content = getContent(options, asm.src, 'docs', 'assets.info');
    let data = getAnnotations(options, asm, null, content, getString(options, 'assets'), kinds.assets);
       
    // static items definition is supported in this info
    // should be written as:
    // @item <name> - <desc> <-- name for asset item would be path/file of the asset (this must be exact path/file name under <asm>_files/ folder as it would finally exists)
    // @group <group name>

    // add to search
    addToSearch(options, data);  

    // return
    return data;
};
const writeAssets = (options, asm, asmData) => {
    // data
    let data = asmData.assets,
        items = [],
        file = '';
    delete asmData.assets;

    if (data.items.length > 0) { // some assets are defined
        // asm items
        addToItems(options, asmData.items, data, getString(options, 'members'));        

        // process each asset
        for(let item of data.items) {
            // assets' items
            addToItems(options, items, item, item.group); // assets can be grouped using @group

            // write
            file = getDest(options, asm.name, 'assets', `${item.name}.json`);
            plainWrite(options, file, item);
        }
    }
    data.items = items;

    // write
    file = getDest(options, asm.name, 'assets.json');
    plainWrite(options, file, data);
};
const getResources = (options, asm) => {
    // ./docs/resources.info
    let content = getContent(options, asm.src, 'docs', 'resources.info');
    let data = getAnnotations(options, asm, null, content, getString(options, 'resources'), kinds.resources);
        
    // static items definition is supported in this info
    // should be written as:
    // @item <name> - <desc> <-- name for resource item would be path/file of the resource (this must be exact path/file which enduser should use to fetch resource)
    // @group <group name>

    // add to search
    addToSearch(options, data);  

    // return
    return data;
};
const writeResources = (options, asm, asmData) => {
    // data
    let data = asmData.resources,
        items = [],
        file = '';
    delete asmData.resources;

    if (data.items.length > 0) { // some resources are defined
        // asm items
        addToItems(options, asmData.items, data, getString(options, 'members'));        

        // process each resource
        for(let item of data.items) {
            // resources' items
            addToItems(options, items, item, item.group); // resources can be grouped using @group

            // write
            file = getDest(options, asm.name, 'resources', `${item.name}.json`);
            plainWrite(options, file, item);
        }
    }
    data.items = items;

    // write
    file = getDest(options, asm.name, 'resources.json');
    plainWrite(options, file, data);
};
const getRoutes = (options, asm) => {
    // ./docs/routes.info
    let content = getContent(options, asm.src, 'docs', 'routes.info');
    let data = getAnnotations(options, asm, null, content, getString(options, 'routes'), kinds.routes);
       
    // static items definition is supported in this info
    // should be written as:
    // @item <name> - <desc>
    // @group <group name>

    // add to search
    addToSearch(options, data);  

    // return
    return data;
};
const writeRoutes = (options, asm, asmData) => {
    // data
    let data = asmData.routes,
        items = [],
        file = '';
    delete asmData.routes;

    if (data.items.length > 0) { // some routes are defined
        // asm items
        addToItems(options, asmData.items, data, getString(options, 'members'));        

        // process each route
        for(let item of data.items) {
            // routes' items
            addToItems(options, items, item, item.group); // routes can be grouped using @group

            // write
            file = getDest(options, asm.name, 'routes', `${item.name}.json`);
            plainWrite(options, file, item);
        }
    }
    data.items = items;

    // write
    file = getDest(options, asm.name, 'routes.json');
    plainWrite(options, file, data);
};
const getLibs = (options, asm) => {
    // ./docs/libs.info
    let content = getContent(options, asm.src, 'docs', 'libs.info');
    let data = getAnnotations(options, asm, null, content, getString(options, 'libs'), kinds.libs);
    
    // static items definition is supported in this info
    // should be written as:
    // @item <name> - <desc> <-- name for lib item would be path/file of the lib (this must be exact path/file name under <asm>_files/ folder as it would finally exists (including the 'libs' folder))
    // @group <group name>

    // add to search
    addToSearch(options, data);  

    // return
    return data;
};
const writeLibs = (options, asm, asmData) => {
    // data
    let data = asmData.libs,
        items = [],
        file = '';
    delete asmData.libs;

    if (data.items.length > 0) { // some libs are defined
        // asm items
        addToItems(options, asmData.items, data, getString(options, 'members'));        

        // process each lib
        for(let item of data.items) {
            // libs' items
            addToItems(options, items, item, item.group); // libs can be grouped using @group

            // write
            file = getDest(options, asm.name, 'libs', `${item.name}.json`);
            plainWrite(options, file, item);
        }
    }
    data.items = items;

    // write
    file = getDest(options, asm.name, 'libs.json');
    plainWrite(options, file, data);
};
const getConfigs = (options, asm) => {
    // ./docs/config.info
    let content = getContent(options, asm.src, 'docs', 'config.info');
    let data = getAnnotations(options, asm, null, content, getString(options, 'configs'), kinds.configs);

    // static items definition is supported in this info
    // should be written as:
    // @item <name> - <desc>
    // @group <group name>

    // add to search
    addToSearch(options, data);  

    // return
    return data;
};
const writeConfigs = (options, asm, asmData) => {
    // data
    let data = asmData.configs,
        items = [],
        file = '';
    delete asmData.configs;

    if (data.items.length > 0) { // some config items are defined
        // asm items
        addToItems(options, asmData.items, data, getString(options, 'members'));        

        // process each config item
        for(let item of data.items) {
            // configs' items
            addToItems(options, items, item, item.group); // config items can be grouped using @group

            // write
            file = getDest(options, asm.name, 'configs', `${item.name}.json`);
            plainWrite(options, file, item);
        }
    }
    data.items = items;

    // write
    file = getDest(options, asm.name, 'configs.json');
    plainWrite(options, file, data);
};
const getSettings = (options, asm) => {
    // ./docs/settings.info
    let content = getContent(options, asm.src, 'docs', 'settings.info');
    let data = getAnnotations(options, asm, null, content, getString(options, 'settings'), kinds.settings);
        
    // static items definition is supported in this info
    // should be written as:
    // @item <name> - <desc>
    // @group <group name>

    // add to search
    addToSearch(options, data);  

    // return
    return data;
};
const writeSettings = (options, asm, asmData) => {
    // data
    let data = asmData.settings,
        items = [],
        file = '';
    delete asmData.settings;

    if (data.items.length > 0) { // some setting items are defined
        // asm items
        addToItems(options, asmData.items, data, getString(options, 'members'));        

        // process each setting item
        for(let item of data.items) {
            // settings' items
            addToItems(options, items, item, item.group); // setting items can be grouped using @group

            // write
            file = getDest(options, asm.name, 'settings', `${item.name}.json`);
            plainWrite(options, file, item);
        }
    }
    data.items = items;

    // write
    file = getDest(options, asm.name, 'settings.json');
    plainWrite(options, file, data);
};
