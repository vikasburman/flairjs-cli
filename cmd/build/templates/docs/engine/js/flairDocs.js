(() => {
    const FlairDocs = function() {
        const kinds = {
            package: 'package',
            api: 'api',
            guides: 'guides',
            guide: 'guide',
            examples: 'examples',
            example: 'example',
            pages: 'pages',
            page: 'page',
            assembly: 'assembly',
            globals: 'globals',
            global: 'global',
            components: 'components',
            component: 'component',
            annotation: 'annotation',
            namespaces: 'namespaces',
            namespace: 'namespace',
            types: 'types',
            class: 'class',
            struct: 'struct',
            enum: 'enum',
            mixin: 'mixin',
            interface: 'interface',
            property: 'property',
            constant: 'constant',
            method: 'method',
            constructor: 'constructor',
            destructor: 'destructor',
            event: 'event',
            routes: 'routes',
            route: 'route',
            resources: 'resources',
            resource: 'resource',
            assets: 'assets',
            asset: 'asset',
            libs: 'libs',
            lib: 'lib',
            configs: 'configs',
            config: 'config',
            settings: 'settings',
            setting: 'setting'
        };
        let data = {},
            vueApp = null,
            func = {},
            isStarted = false;
        
        const getData = (url) => {
            // note: data is purposoly not cached and itstead it relies on browser cache etc.
            return new Promise((resolve, reject) => {
                $.ajax({
                    dataType: 'json',
                    url: url,
                    success: resolve,
                    error: (err) => {
                        console.error(err);
                        resolve(null); // still resolve
                    }
                });
            });
        };
        const render = async () => {
            if (!data.content) { // 404
                // hide all top level fragments
                data.flags.showHeader = false;
                data.flags.showFooter = false;
                data.flags.showSidebar = false;
                data.flags.showContent = false;
                data.flags.showHighlights = false;

                // show 404
                data.flags.show404 = true;
            } else {
                // hide 404
                data.flags.show404 = false;

                // show header, footer
                data.flags.showHeader = true;
                data.flags.showFooter = true;

                // highlights
                // TODO: will come in home package always - from options settings
                
                // kind specifc fragments visibility
                switch(data.content.kind) {
                    case kinds.package:
                    case kinds.examples:
                    case kinds.example:
                    case kinds.guides:
                    case kinds.guide:
                    case kinds.pages:
                    case kinds.page:
                    case kinds.api:
                    case kinds.assembly:
                    case kinds.globals:
                    case kinds.global:                        
                    case kinds.components:
                    case kinds.component:
                    case kinds.annotation:
                    case kinds.namespaces:
                    case kinds.namespace:
                    case kinds.types:
                    case kinds.class:
                    case kinds.struct:
                    case kinds.enum:
                    case kinds.mixin:
                    case kinds.interface: 
                    case kinds.routes:
                    case kinds.route:
                    case kinds.resources:
                    case kinds.resource:
                    case kinds.assets:
                    case kinds.asset:
                    case kinds.libs:
                    case kinds.lib:
                    case kinds.configs:
                    case kinds.config:
                    case kinds.settings:
                    case kinds.setting:
                    case kinds.constant:
                    case kinds.property:
                    case kinds.method:
                    case kinds.event:
                    default:
                }
            }

            // destroy previous app, if any
            if (vueApp) {
                vueApp.$destroy();
                vueApp = null;
            }        

            // bind with a new app
            vueApp = new Vue({
                el: `#root`,
                data: data
            });

            // update title
            if (!data.content) { // 404
                document.title = `${data.info.title}`;
            } else {
                document.title = `${data.info.title} - ${data.content.docs.parent.name ? data.content.docs.parent.name + ' - ' : ''}${data.content.name}`;
            }
        };
        const loadLocation = async () => {
            const getPackage = (name) => {
                if (!name) { name =  (data.current.package ? data.current.package.name : '') || data.packages.default; }
                let pkg = data.packages.list.find((a) => a.name === name);
                if (!pkg) { // default
                    pkg = data.packages.list.find((a) => a.name === data.packages.default);
                    if (!pkg) { data.packages[0]; } // first at the end
                }
                return pkg;
            };
            const getVersion = (pkg, name) => {
                if (!name) { name = (data.current.version ? data.current.version.name : '') || pkg.versions.default; }
                let ver = pkg.versions.list.find((a) => a.name === name);
                if (!ver) { // default
                    ver = pkg.versions.list.find((a) => a.name === pkg.versions.default);
                    if (!ver) { pkg.versions[0]; } // first at the end
                }
                return ver;
            };
            const getLocale = (ver, name) => {
                if (!name) { name = (data.current.locale ? data.current.locale.name : '') || ver.locales.default; }
                let loc = ver.locales.list.find((a) => a.name === name);
                if (!loc) { // default
                    loc = ver.locales.list.find((a) => a.name === ver.locales.default);
                    if (!loc) { ver.locales[0]; } // first at the end
                }
                return loc;
            };         
            const loadSearch = async (file) => {
                // load
                let searchJson = await getData(file);
                if (searchJson) {
                    return MiniSearch.loadJSON(JSON.stringify(searchJson.index,), searchJson.options);
                } else {
                    return null;
                }
            };
            const groupContentItems = () => {
                if (data.content && data.content.items) {
                    let items = {
                        all: data.content.items,        // { link, name, group, desc }
                        grouped: []                     // { group,  items: { link, name, desc } }
                    };
                    let groups = [],
                        groupedItem = null;
                    for(let item of items.all) {
                        groupedItem = items.grouped.filter(i => i.group === item.group)[0];
                        if(!groupedItem) {
                            groupedItem = {
                                group: item.group,
                                items: []
                            };
                            items.grouped.push(groupedItem);
                        }
                        groupedItem.items.push({ link: item.link, name: item.name, desc: item.desc });
                    }
                    data.content.items = items;
                }
            };

            // ----------------------------------------------------------------------------------------------------------------------------
            // possible url patterns                                                    Examples
            // ----------------------------------------------------------------------------------------------------------------------------
            // [0]/[1]/[2]/[3]/[4]/[5]/[6]
            // [0]: empty | <collection>
            // [1]: empty | <version>
            // [2]: empty | <locale>
            // [3]: empty | api | examples | guides | pages | <asm>
            // [4]: empty | <example> | <guide> | <page> | components | globals | namespaces | types | routes | resources | assets | libs | 
            //      configs | settings
            // [5]: empty | <component> | <global> | <namespace> | <type? | <route> | <resource> | <asset> | <lib> | 
            //      <config> | <setting>
            // [6]: empty | <member>
            // ----------------------------------------------------------------------------------------------------------------------------
            // /                                                                        ./flairjs/v1/en/index.json
            // <collection>/                                                            ./flairjs/v1/en/index.json
            // <collection>/<version>/                                                  ./flairjs/v1/en/index.json
            // <collection>/<version>/<locale>/                                         ./flairjs/v1/en/index.json
            // <collection>/<version>/<locale>/api/                                     ./flairjs/v1/en/api.json
            // <collection>/<version>/<locale>/examples/                                ./flairjs/v1/en/examples.json
            // <collection>/<version>/<locale>/examples/<example>                       ./flairjs/v1/en/examples/class.json
            // <collection>/<version>/<locale>/guides/                                  ./flairjs/v1/en/guides.json
            // <collection>/<version>/<locale>/guides/<guide>                           ./flairjs/v1/en/guides/getting-started
            // <collection>/<version>/<locale>/pages/                                   ./flairjs/v1/en/pages.json
            // <collection>/<version>/<locale>/pages/<page>                             ./flairjs/v1/en/pages/changelog.html
            // <collection>/<version>/<locale>/<asm>/                                   ./flairjs/v1/en/flair/index.json
            // <collection>/<version>/<locale>/<asm>/components/                        ./flairjs/v1/en/flair/components.json
            // <collection>/<version>/<locale>/<asm>/components/<component>/            ./flairjs/v1/en/flair/components/Host.json
            // <collection>/<version>/<locale>/<asm>/components/<component>/<member>/   ./flairjs/v1/en/flair/components/Host/fileName.json
            // <collection>/<version>/<locale>/<asm>/globals/                           ./flairjs/v1/en/flair/globals.json
            // <collection>/<version>/<locale>/<asm>/globals/<global>/                  ./flairjs/v1/en/flair/globals/Component.json
            // <collection>/<version>/<locale>/<asm>/globals/<global>/<member>/         ./flairjs/v1/en/flair/globals/Component/get~1.json
            // <collection>/<version>/<locale>/<asm>/namespaces/                        ./flairjs/v1/en/flair/namespaces.json
            // <collection>/<version>/<locale>/<asm>/namespaces/<namespace>/            ./flairjs/v1/en/flair/namespaces/(root).json
            // <collection>/<version>/<locale>/<asm>/types/                             ./flairjs/v1/en/flair/types.json
            // <collection>/<version>/<locale>/<asm>/types/ns/<ns>                      ./flairjs/v1/en/flair/types.json [section: <ns>]
            // <collection>/<version>/<locale>/<asm>/types/<type>/                      ./flairjs/v1/en/flair/types/Attribute.json
            // <collection>/<version>/<locale>/<asm>/types/<type>/<member>/             ./flairjs/v1/en/flair/types/Attribute/validate.json
            // <collection>/<version>/<locale>/<asm>/routes/                            ./flairjs/v1/en/flair/routes.json
            // <collection>/<version>/<locale>/<asm>/routes/<route>/                    ./flairjs/v1/en/flair/routes/home.json
            // <collection>/<version>/<locale>/<asm>/resources/                         ./flairjs/v1/en/flair/resources.json
            // <collection>/<version>/<locale>/<asm>/resources/<resource>/              ./flairjs/v1/en/flair/resources/logo.json
            // <collection>/<version>/<locale>/<asm>/assets/                            ./flairjs/v1/en/flair/assets.json
            // <collection>/<version>/<locale>/<asm>/assets/<asset>/                    ./flairjs/v1/en/flair/assets/license.json
            // <collection>/<version>/<locale>/<asm>/libs/                              ./flairjs/v1/en/flair/libs.json
            // <collection>/<version>/<locale>/<asm>/libs/<lib>/                        ./flairjs/v1/en/flair/libs/firebase.json
            // <collection>/<version>/<locale>/<asm>/configs/                            ./flairjs/v1/en/flair/configs.json
            // <collection>/<version>/<locale>/<asm>/configs/<config>/                  ./flairjs/v1/en/flair/configs/bootEngine.json
            // <collection>/<version>/<locale>/<asm>/settings/                          ./flairjs/v1/en/flair/settings.json
            // <collection>/<version>/<locale>/<asm>/settings/<setting>/                ./flairjs/v1/en/flair/settings/bootstrapper.json
            // ----------------------------------------------------------------------------------------------------------------------------

            // clear previous (404 scenario)
            data.content = null;
            data.section = '';

            // read location from hash
            let hash = location.hash.replace('#/', ''),
                length = 0,
                items = '',
                parts = {
                    package: null,
                    version: null,
                    locale: null,
                    file: '',
                    section: ''
                };
            if (hash) {
                items = hash.split('/').map(item => item.trim());
                length = items.length;
            }

            // load parts
            if (length === 0) {
                // nothing - pick all defaults
                parts.package = getPackage();
                parts.version = getVersion(parts.package);
                parts.locale = getLocale(parts.version);
            } else if (length > 0) {
                // only 1
                // <collection>/ 
                parts.package = getPackage(items[0]);
                parts.version = getVersion(parts.package);
                parts.locale = getLocale(parts.version);
            
                if (length > 1) {
                    // only 2
                    // <collection>/<version>/
                    parts.version = getVersion(parts.package, items[1]);
                    parts.locale = getLocale(parts.version);                    

                    if (length > 2) {
                        // only 3
                        // <collection>/<version>/<locale>/
                        parts.locale = getLocale(parts.version, items[2]);       
                    
                        if (length > 3) {
                            // only 4
                            // <collection>/<version>/<locale>/api/ 
                            // <collection>/<version>/<locale>/examples/
                            // <collection>/<version>/<locale>/guides/
                            // <collection>/<version>/<locale>/pages/
                            // <collection>/<version>/<locale>/<asm>/
                            if ([kinds.api, kinds.examples, kinds.guides, kinds.pages].indexOf(items[3]) !== -1) {
                                parts.file = `${items[3]}.json`;

                                if (length > 4) {
                                    // only 5
                                    // <collection>/<version>/<locale>/examples/<example>
                                    // <collection>/<version>/<locale>/guides/<guide>
                                    // <collection>/<version>/<locale>/pages/<page>
                                    parts.section = items[4];
                                }
                            } else { // <asm>
                                parts.file = `${items[3]}/index.json`;

                                if (length > 4) {
                                    // only 5
                                    // <collection>/<version>/<locale>/<asm>/components/
                                    // <collection>/<version>/<locale>/<asm>/globals/
                                    // <collection>/<version>/<locale>/<asm>/namespaces/
                                    // <collection>/<version>/<locale>/<asm>/types/
                                    // <collection>/<version>/<locale>/<asm>/routes/
                                    // <collection>/<version>/<locale>/<asm>/resources/
                                    // <collection>/<version>/<locale>/<asm>/assets/
                                    // <collection>/<version>/<locale>/<asm>/libs/
                                    // <collection>/<version>/<locale>/<asm>/configs/
                                    // <collection>/<version>/<locale>/<asm>/settings/
                                    parts.file = `${items[3]}/${items[4]}.json`;

                                    if (length > 5) {
                                        // only 6
                                        // <collection>/<version>/<locale>/<asm>/components/<component>/
                                        // <collection>/<version>/<locale>/<asm>/globals/<global>/
                                        // <collection>/<version>/<locale>/<asm>/namespaces/<namespace>/
                                        // <collection>/<version>/<locale>/<asm>/types/<type>/
                                        // <collection>/<version>/<locale>/<asm>/routes/<route>/
                                        // <collection>/<version>/<locale>/<asm>/resources/<resource>/
                                        // <collection>/<version>/<locale>/<asm>/assets/<asset>/
                                        // <collection>/<version>/<locale>/<asm>/libs/<lib>/
                                        // <collection>/<version>/<locale>/<asm>/configs/<config>/ 
                                        // <collection>/<version>/<locale>/<asm>/settings/<setting>/
                                        parts.file = `${items[3]}/${items[4]}/${items[5]}.json`;

                                        if (length > 6) {
                                            // only 7
                                            // <collection>/<version>/<locale>/<asm>/components/<component>/<member>/
                                            // <collection>/<version>/<locale>/<asm>/globals/<global>/<member>/
                                            // <collection>/<version>/<locale>/<asm>/types/<type>/<member>/
                                            // <collection>/<version>/<locale>/<asm>/types/ns/<ns>/
                                            if (items[4].toLowerCase() === 'types' && items[5].toLowerCase() === 'ns') {
                                                parts.file = `${items[3]}/${items[4]}.json`;
                                                parts.section = items[6];
                                            } else {
                                                parts.file = `${items[3]}/${items[4]}/${items[5]}/${items[6]}.json`;
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
            
            // load one-time-loading data, if package, version or locale is changed
            let isError = false;
            if (!data.current.package || 
                !data.current.version || 
                !data.current.locale ||
                parts.package.name !== data.current.package.name ||
                parts.version.name !== data.current.version.name ||
                parts.locale.name !== data.current.locale.name) {
                    let json = await getData(`${parts.locale.root}/${parts.locale.file}`);
                    if (json) {
                        // load search data, if available
                        if (json.search) { await loadSearch(`${parts.locale.root}/${json.search}`); }
                        
                        // load strings
                        if (json.strings) { data.strings = await getData(`${parts.locale.root}/${json.strings}`) || {}; }

                        // set new current
                        data.current.package = parts.package;
                        data.current.version = parts.version;
                        data.current.locale = parts.locale;

                        // info
                        data.info = json.info;

                        // set locale and direction to html
                        $('html').attr('lang', data.current.locale.name);
                        if (data.current.locale.rtl) {
                            $('html').attr('dir', 'rtl');
                        } else {
                            $('html').removeAttr('dir');
                        }

                        // clean home
                        delete json.info;
                        delete json.search;
                        delete json.strings;

                        // keep this package home json handy, it may be needed when 
                        // coming again to home page of this package
                        data.home = json;
                    } else {
                        isError = true;
                    }
            }

            // load url specific content
            if (!isError) {
                if (!parts.file) { // this is home page
                    // ensure url still has all parts to represents home
                    location.replace(`${location.href.split('#')[0]}#/${data.current.package.name}/${data.current.version.name}/${data.current.locale.name}`);

                    // set content
                    if (data.home) { 
                        data.content = data.home; 
                    }
                } else {
                    data.content = await getData(`${data.current.locale.root}/${parts.file}`);
                }
                data.section = (data.content ? parts.section : '');
                groupContentItems();
            }

            // render to refresh
            await render();
        };
        const loadTheme = async (theme) => {
            const getTemplate = (file) => {
                return new Promise((resolve, reject) => {
                    if (file.startsWith('./')) { file = file.substr(2); }  // remove ./
                    if (file.startsWith('/')) { file = file.substr(1); }  // remove /
                    
                    $.ajax({
                        dataType: "text",
                        url: file,
                        success: (text) => {
                            resolve(text);
                        },
                        error: (err) => {
                            console.error(err);
                            resolve(null); // still resolve
                        }
                    });
                   
                });
            };
            const loadJS = (url) => {
                return new Promise((resolve, reject) => {
                    $.ajax({
                        dataType: "script",
                        url: url,
                        success: () => {
                            resolve();
                        },
                        error: (err) => {
                            console.error(err);
                            resolve(null); // still resolve
                        }
                    });
                });
            };
            const loadCSS = (url) => {
                return new Promise((resolve, reject) => {
                    var $e = $('<link>', { rel: 'stylesheet', type: 'text/css', href: url })[0];
                    $e.onload = () => {
                        resolve();
                    };
                    $e.onerror = (err) => {
                        console.error(err);
                        resolve(null); // still resolve
                    };
                    $('head').append($e);
                });
            };
            const loadFragments = async ($elements) => {
                let selector = 'div[fragment]';
                // if not given, load from root
                if (!$elements) { $elements = $(selector); }

                // load
                let $childElements = null,
                    $$el = null;
                for(let $el of $elements) {
                    $$el = $($el);
                    $$el.html(await getTemplate(`${theme.fragments}/${$$el.attr('fragment')}.html`));
 
                    // find fragments in this newly loaded area (recursive call)
                    $childElements = $$el.find(selector);
                    if ($childElements.length > 0) { await loadFragments($childElements); }
                }
            };

            // activate material design
            $('body').bootstrapMaterialDesign();

            // load theme js, css
            for(let file of theme.files.js) { await loadJS(file); }
            for(let file of theme.files.css) { await loadCSS(file); }

            // load theme's structural content (index.html)
            let result = false;
            let templateContent = await getTemplate(theme.template);
            if (templateContent) {
                // load template content 
                $('#root').html(templateContent);

                // find defined fragments in template and load them all
                await loadFragments();

                // done
                result = true;
            }

            // return
            return result;
        };
        const initData = async (json) => {
            const dl = (linkText) => {
                // inbuilt support functions
                // dl(linkText): dynamic-link processor
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
                //          - can be 'globals', 'components', 'namespaces', 'types', 'settings', 'configs', 'resources', 'routes', 'assets', 'libs', 
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
                let link = '',
                    items = [],
                    colName = '',
                    asmName = '',
                    asmMemberType = '',
                    asmMemberName = '',
                    memberName = '',
                    overloadNumber = '',
                    knownAsmMemberTypes = [kinds.globals, kinds.components, kinds.namespaces, kinds.types, kinds.settings, kinds.configs, kinds.resources, kinds.routes, kinds.assets, kinds.libs],
                    knownColMemberTypes = [kinds.api, kinds.guides, kinds.examples, kinds.pages];
                if (linkText.startsWith('http')) { // http://, https:// 
                    return linkText; // return as is
                } else {
                    // possible ways:
                    //  ~overloadNumber                                 - another overload of current memberName (method)
                    //  ::memberName                                    - another member of current asmMemberName
                    //  ::memberName~overloadNumber                     - specific overload of another memberName (method) of current asmMemberName
                    //  asmMemberName                                   - asmMemberName of 'types' asmMemberType
                    //  asmMemberName::memberName                       - asmMemberName with specific memberName
                    //  asmMemberName::memberName~overloadNumber        - asmMemberName with specific memberName and overload
                    //  asmMemberType                                   - list page of specified asmMemberType
                    //  asmMemberType/asmMemberName                     - asmMemberName of specified asmMemberType
                    //  asmMemberType/asmMemberName::memberName         - asmMemberName of specified asmMemberType with specific memberName
                    //  asmName://asmMemberType/asmMemberName::memberName~overloadNumber            -- for specified assembly in current collection
                    //  asmName@colName://asmMemberType/asmMemberName::memberName~overloadNumber    -- for specified assembly in specified collection
                    let current = data.content,
                        root = data.current.locale.root;
                    if (linkText.startsWith('~')) { // another overload to current memberName
                        link = `${root}/${current.docs.parent.members}/${current.name}${linkText}`;
                    } else if (linkText.startsWith('::')) { // another memberName of current asmMemberName
                        link = `${root}/${current.docs.parent.link}/${linkText.substr(2)}`; // removing ::
                    } else {
                        // asmName@colName://asmMemberType/asmMemberName::memberName~overloadNumber
                        if (linkText.indexOf('://') !== -1) {
                            items = linkText.split('://');
                            linkText = items[1].trim(); // asmMemberType/asmMemberName::memberName~overloadNumber
                            if (items[0].indexOf('@') !== -1) {
                                items = items[0].split('@');
                                asmName = items[0].trim(); // asmName
                                colName = items[1].trim(); // colName
                            } else {
                                asmName = items[0].trim();  // asmName
                            }
                        } else {
                            asmName = vueData.current.asm.name || '';
                            colName = vueData.current.collection; 
                        }

                        // asmMemberType/asmMemberName::memberName~overloadNumber
                        if (linkText.indexOf('::') !== -1) {
                            items = linkText.split('::');
                            linkText = items[0].trim(); // asmMemberType/asmMemberName
                            if (items[1].indexOf('~') !== -1) {
                                items = items[1].split('~');
                                memberName = items[0].trim(); // memberName
                                overloadNumber = items[1].trim(); // overloadNumber
                            } else {
                                memberName = items[1].trim(); // memberName
                            }
                        } 

                        // asmMemberType/asmMemberName
                        if (linkText.indexOf('/') !== -1) {
                            items = linkText.split('/');
                            asmMemberType = items[0].trim(); // asmMemberType
                            asmMemberName = items[1].trim(); // asmMemberName                        
                        } else {
                            if (knownAsmMemberTypes.indexOf(linkText) !== -1) { // known asmMemberTypes
                                asmMemberType = linkText;
                            } else if (knownColMemberTypes.indexOf(linkText) !== -1) {
                                asmMemberType = linkText;   // treat it as asmMemberType for the context of url making
                                asmName = '';               // and make asmName empty, since this is collection level memberType
                            } else {
                                asmMemberType = kinds.types; // when not given, assume it is 'types'
                                asmMemberName = linkText;
                            }
                        }
                        
                        // link
                        link = (asmName ? `${asmName}/` : '') + asmMemberType + (asmMemberName ? `/${asmMemberName}` : '' ) + (memberName ? `/${memberName}` : '') + (overloadNumber ? `~${overloadNumber}` : '');
                        if (colName) {
                            link = `${root.replace(data.current.package.name, colName)}/${link}`; // replace current collection with given collection -- keeping version and locale same
                        } else {
                            link = `${root}/${link}`;
                        }
                    }
                }

                // return
                return link;
     
            };           

            // one time per-refresh loaded data
            data = {};
            data.packages = json.packages;
            data.builder = json.builder;
            data.dl = dl;
            data.go = (url) => { location.hash = url; };
            data.home = () => { location.hash = ''; };
            data.back = () => { window.history.back(); };

            // one time per-package/version/locale loaded data
            data.current = {};
            data.current.package = null;
            data.current.version = null;
            data.current.locale = null;            
            data.home = {};
            data.info = {};
            data.search = null;
            data.strings = {};

            // per url-change loaded data
            data.content = null; // null means 404
            data.section = ''; 

            // ui rendering data

            // visibility flags
            data.flags = {
                showHeader: false,
                showFooter: false,
                showSidebar: false,
                showHighlights: false,
                showContent: false,
                show404: false,
                showSearch: false,
                showPackageSelector: false,
                showVersionSelector: false,
                showLocaleSelector: false
            };

            // specific areas
            data.areas = {};
            data.areas.header = {};
            data.areas.sidebar = {};
            data.areas.content = {};
            data.areas.highlights = {};
            data.areas.footer = {};
        };
        const init = async () => {
            let result = false;
            let json = await getData('./index.json');
            if (json) {
                // initialize base data
                // this becomes base for vueData
                // when content is loaded
                await initData(json);

                // load theme
                if (await loadTheme(json.theme)) {
                    // setup location change handler
                    addEventListener('hashchange', loadLocation, false);

                    // done
                    result = true;
                }
            }

            // return
            return result;
        };

        // expose
        let obj = {
            // start 
            start: async () => {
                if (!isStarted) {
                    isStarted = await init();
                    if (isStarted) { await loadLocation(); }
                }
            },

            // define custom function
            // for use by themes
            func: (name, fn) => { func[name] = func[name] || fn; } // cannot overwrite a predefined function
        };

        // return
        return obj;
    };

    // register to start after load
    $(document).ready(() => {
        window.flairDocs = new FlairDocs();
        window.flairDocs.start();
    });
})();