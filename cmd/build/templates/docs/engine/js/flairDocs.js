(() => {
    const FlairDocs = function() {
        const kinds = {
            package: 'package',
            api: 'api',
            guides: 'guides',
            guide: 'guide',
            examples: 'examples',
            example: 'example',
            objects: 'objects',
            object: 'object',
            objectItem: 'objectItem',
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
            pages = {
                home: null,
                '404': null
            },
            customizableAreas = [],
            vueApp = null,
            isStarted = false,
            isPackageVersionLocaleChanged = false;
            
        const escapeRegExp = (string) => {
            return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");  // eslint-disable-line no-useless-escape
        };
        const replaceAll = function(string, find, replace) { // replace all instances of given string in other string
            return string.replace(new RegExp(escapeRegExp(find), 'g'), replace);
        };            
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
        const getTemplate = (file) => {
            // note: template is purposoly not cached and itstead it relies on browser cache etc.
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
        const loadFragments = async (fragmentsRoot, $$root, includeSelf, includeCustomFragments, isAddCustomFragmentToList) => {
            const loadPageAsFragment = async (pageLink) => {
                let pageName = replaceAll(replaceAll(pageLink, '/', '_'), '.', '_');
                let json = await getData(`${data.rootUrl}/${pageLink}`);
                if (json && json.html) {
                    // delete old js/css elements, if any
                    let jsId = `_${pageName}_js`,
                        cssId = `_${pageName}_css`;
                    $('head').find('#' + jsId).remove();
                    $('head').find('#' + cssId).remove();
                    
                    // load custom fragment's js and css
                    if (json.js) { $(`<script id="${jsId}" type="text/javascript"> ${json.js} </script>`).appendTo('head'); }
                    if (json.css) { $(`<style id="${cssId}" type="text/css"> ${json.css} </style>`).appendTo('head'); }
                    
                    // return
                    return json.html;
                }
                return '';
            };

            let selector = '[fragment]',
                $items = (includeSelf ? [$$root, ...$$root.find(selector)] : $$root.find(selector)),
                $$el = null,
                fragmentName = '',
                fragmentFile = '',
                fragmentHtml = '';
            for(let $el of $items) {
                $$el = $($el);
                fragmentName = $$el.attr('fragment');
                if (!fragmentName) { continue; }

                // default fragment
                fragmentFile = `${fragmentsRoot}/${fragmentName}.html`; 

                if (typeof $$el.attr('customizable') !== 'undefined') { // custom
                    if (isAddCustomFragmentToList) { customizableAreas.push($$el); }
                    if (!includeCustomFragments) { continue; }

                    // check if closed for this user (cookie based)
                    // a cookie can be set with the same name as of customizable area with required expiry date
                    // using setCookie function
                    // here before loading the fragment, presence of cookie will be checked, if found, the area
                    // will not be loaded
                    if (data.func.cookie.get($$el.attr('id'))) { continue; }

                    // try to get given custom (as page)
                    if (data.branding.fragments[fragmentName]) {
                        fragmentHtml = await loadPageAsFragment(data.branding.fragments[fragmentName]);
                        if (fragmentHtml) { fragmentFile = ''; } // so it does not load it as default now
                    } 
                }

                // get default template, if not already got from custom (or there was no custom)
                if (fragmentFile) { fragmentHtml = await getTemplate(fragmentFile); }
     
                // load fragment
                $$el.html(fragmentHtml);

                 // load child fragments (recursively)
                if (fragmentHtml) { await loadFragments(fragmentsRoot, $$el, false, includeCustomFragments, isAddCustomFragmentToList); }
            }
        };
        const render = async () => {
            let kind = (data.content ? data.content.kind : ''),
                fragment = '',
                $head = $('head'),
                $pages = $('#pages'),
                $content = $('#content');

            const getPage = () => {
                let page = null;
                if (!kind) { // no content, 404
                    if (pages['404']) { page = pages['404']; }
                } else if (kind === kinds.package) { // package home
                    if (pages.home) { page = pages.home; }
                } else if (kind === kinds.page) {
                    page = data.content;
                };  
                return page;
            };                
            const getFragment = () => {
                let frag = '';
                if (!kind) { // no content, 404
                    frag = '404';
                } else if (kind === kinds.package) {
                    frag = 'package';
                } else if ([kinds.examples, kinds.guides, kinds.objects, kinds.pages, kinds.api].indexOf(kind) !== -1) {
                    frag = 'list-package-member';
                } else if (kind === kinds.object) {
                    frag = 'package-member-code';
                } else if (kind === kinds.guide) {
                    frag = 'package-member-nocode-guide';
                } else if (kind === kinds.example) {
                    frag = 'package-member-nocode-example';
                } else if (kind === kinds.assembly) {
                    frag = 'package-member-nocode-assembly';
                } else if ([kinds.globals, kinds.components, kinds.namespaces, kinds.namespace, kinds.types].indexOf(kind) !== -1) {
                    frag = 'list-assembly-member-code';
                } else if ([kind.resources, kinds.routes, kinds.assets, kinds.libs, kinds.configs, kinds.settings].indexOf(kind) !== -1) {
                    frag = 'list-assembly-member-nocode';
                } else if ([kinds.global, kinds.component, kinds.annotation, kinds.class, kinds.struct, kind.enum, kinds.mixin, kinds.interface].indexOf(kind) !== -1) {
                    frag = 'assembly-member-code';
                } else if ([kinds.route, kinds.resource, kinds.asset, kinds.lib, kinds.config, kinds.setting, kinds.property, kinds.constant, kinds.method, kinds.event].indexOf(kind) !== -1) {
                    frag = 'assembly-member-nocode';
                } else if ([kinds.property, kinds.constant, kinds.method, kinds.event].indexOf(kind) !== -1) {
                    frag = 'code-member';
                }
                return frag;
            };    
            const getList = async () => {
                let list = [];
                if (!data.page && ['', kinds.pages].indexOf(kind) !== -1) { // when not a page and these kinds
                    switch(kind) {
                        // NOTES - TEMP: any level that is introduced here for clarity, which does not
                        //               have its own page, will open first item's page
                        // so that group opens, if closed
                        case kinds.package: 
                            // Guide                    
                            // API                      
                            // Examples
                            break;
                        case kinds.guides:
                            // Guide
                            //  Group 1
                            //   Topic 1
                            //   ...
                            //  Group 2
                            //  ...
                            break;
                        case kinds.guide:
                            // Guide
                            //  Group 1
                            //   Topic 1    
                            //     Heading 1
                            //     Heading 2
                            //     ...
                            //   Topic 2
                            //   ...
                            //  Group 2
                            //  ...
                            break;                            
                        case kinds.api:
                            // Guide
                            // API
                            //  Assemblies
                            //   Group 1
                            //    Asm 1
                            //    ...
                            //   Group 2
                            //    ...
                            //  Objects
                            // Examples
                            break;
                        case kinds.objects:
                            // Guide
                            // API
                            //  Assemblies
                            //  Objects
                            //   Group 1
                            //    Obj 1
                            //    ...
                            //   Group 2
                            //   ...
                            // Examples
                            break;
                        case kinds.examples:
                            // Guide
                            // API
                            // Examples
                            //  Group 1
                            //   Example 1
                            //   ...
                            //  Group 2
                            //  ...
                            break;
                        case kinds.assembly:
                            // Guide
                            // API
                            //  Assemblies
                            //   Group 1
                            //    Asm 1
                            //    Asm 2  
                            //    ...
                            //   Group 2
                            //   ...
                            //  Objects
                            // Examples
                            break;
                        case kinds.example:
                           // Guide
                            // API
                            // Examples
                            //  Group 1
                            //   Example 1
                            //   ...
                            //  Group 2
                            //  ...
                            break;      
                        case kinds.object:
                            // Objects
                            //  Group 1
                            //   Example 1
                            //   ...
                            //  Group 2
                            //  ...
                            break;                                                    

                    }
                    } else if (kind === kinds.object) {
                        // package-member-code
                        // package-member-nocode-guide
                    } else if (kind === kinds.example) {
                        // package-member-nocode-example
                    } else if (kind === ) {
                        // package-member-nocode-assembly
                    } else if ([kinds.globals, kinds.components, kinds.namespaces, kinds.namespace, kinds.types].indexOf(kind) !== -1) {
                        // list-assembly-member-code
                    } else if ([kind.resources, kinds.routes, kinds.assets, kinds.libs, kinds.configs, kinds.settings].indexOf(kind) !== -1) {
                        // list-assembly-member-nocode
                    } else if ([kinds.global, kinds.component, kinds.annotation, kinds.class, kinds.struct, kind.enum, kinds.mixin, kinds.interface].indexOf(kind) !== -1) {
                        // assembly-member-code
                    } else if ([kinds.route, kinds.resource, kinds.asset, kinds.lib, kinds.config, kinds.setting, kinds.property, kinds.constant, kinds.method, kinds.event].indexOf(kind) !== -1) {
                        // assembly-member-nocode
                    } else if ([kinds.property, kinds.constant, kinds.method, kinds.event].indexOf(kind) !== -1) {
                        // code-member
                    }                   
                }
                return list;
            };
            const refreshBranding = async () => {
                if (isPackageVersionLocaleChanged) {
                    isPackageVersionLocaleChanged = false;
    
                    // refresh each of the re/brandable areas
                    let fragmentsRoot = data.theme.fragments;
                    for (let $$el of customizableAreas) {
                        await loadFragments(fragmentsRoot, $$el, true, true); 
                    }
                }
            };
            const loadPage = async () => {
                let jsId = `_page_js`,
                    cssId = `_page_css`,
                    json = data.page;
                   
                // delete old page js/css elements, if any
                $head.find('#' + jsId).remove();
                $head.find('#' + cssId).remove();
    
                // load page, if available
                if (json && json.html) {
                    // load page's css
                    if (json.css) { $(`<style id="${cssId}" type="text/css"> ${json.css} </style>`).appendTo($head); }
    
                     // load page's html
                     $pages.html(json.html);
    
                    // load page's fragments
                    let fragmentsRoot = `${data.rootUrl}/${json.fragments}`;
                    await loadFragments(fragmentsRoot, $pages);
    
                    // load page's js and css
                    if (json.js) { $(`<script id="${jsId}" type="text/javascript"> ${json.js} </script>`).appendTo($head); }
                } else {
                    // else, delete page html, if any
                    $pages.html('');
                }        
            };            
            const loadFragment = async () => {
                // update fragment value
                $content.attr('fragment', fragment);

                // load fragment
                await loadFragments(data.theme.fragments, $content, true, false);
                
                // reset fragment value 
                $content.attr('fragment', '');
            };
            const loadVue = () => {
                if (!vueApp) {
                    vueApp = new Vue({
                        el: `#root`,
                        data: data
                    });
                }
            };
            const getTitle = () => {
                if (!kind) { // 404
                    return `${data.info.title}`;
                } else {
                    return `${data.content.name}${data.content.docs.parent.name ? ' - ' + data.content.docs.parent.name : ''} - ${data.info.title}`;
                }
            };

            // define page or fragment to load
            data.page = getPage();
            if (!data.page) { fragment = getFragment(); }
            if (!fragment) { throw new Error(`Unexpected kind ${kind}`); }

            // define list items as per context
            data.list = await getList();

            // refresh theme branding, if need be
            await refreshBranding();

            // load page or fragment
            if (data.page) {
                await loadPage();
            } else {
                await loadFragment();
            }

            // bind with a new app, if not already bounded
            loadVue();

            // update title
            document.title = getTitle();
        };
        const parseUrl = async (hash) => {
            const getPackage = (name) => {
                if (!name) { name =  (data.package ? data.package.name : '') || data.packages.default; }
                let pkg = data.packages.list.find((a) => a.name === name);
                if (!pkg) { // default
                    pkg = data.packages.list.find((a) => a.name === data.packages.default);
                    if (!pkg) { data.packages[0]; } // first at the end
                }
                return pkg;
            };
            const getVersion = (pkg, name) => {
                if (!name) { name = (data.version ? data.version.name : '') || pkg.versions.default; }
                let ver = pkg.versions.list.find((a) => a.name === name);
                if (!ver) { // default
                    ver = pkg.versions.list.find((a) => a.name === pkg.versions.default);
                    if (!ver) { pkg.versions[0]; } // first at the end
                }
                return ver;
            };
            const getLocale = (ver, name) => {
                if (!name) { name = (data.locale ? data.locale.name : '') || ver.locales.default; }
                let loc = ver.locales.list.find((a) => a.name === name);
                if (!loc) { // default
                    loc = ver.locales.list.find((a) => a.name === ver.locales.default);
                    if (!loc) { ver.locales[0]; } // first at the end
                }
                return loc;
            };         

            // ----------------------------------------------------------------------------------------------------------------------------
            // possible url patterns                                                    Examples
            // ----------------------------------------------------------------------------------------------------------------------------
            // [0]/[1]/[2]/[3]/[4]/[5]/[6]
            // [0]: empty | <collection>
            // [1]: empty | <version>
            // [2]: empty | <locale>
            // [3]: empty | api | examples | guides | pages | objects | <asm>
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
            // <collection>/<version>/<locale>/objects/                                 ./flairjs/v1/en/objects.json
            // <collection>/<version>/<locale>/objects/<object>                         ./flairjs/v1/en/objects/something.json
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
            // <collection>/<version>/<locale>/<asm>/configs/                           ./flairjs/v1/en/flair/configs.json
            // <collection>/<version>/<locale>/<asm>/configs/<config>/                  ./flairjs/v1/en/flair/configs/bootEngine.json
            // <collection>/<version>/<locale>/<asm>/settings/                          ./flairjs/v1/en/flair/settings.json
            // <collection>/<version>/<locale>/<asm>/settings/<setting>/                ./flairjs/v1/en/flair/settings/bootstrapper.json
            // ----------------------------------------------------------------------------------------------------------------------------


            // read location from hash
            let length = 0,
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
                            // <collection>/<version>/<locale>/objects/
                            // <collection>/<version>/<locale>/<asm>/
                            if ([kinds.api, kinds.examples, kinds.guides, kinds.pages, kinds.objects].indexOf(items[3]) !== -1) {
                                parts.file = `${items[3]}.json`;

                                if (length > 4) {
                                    // only 5
                                    // <collection>/<version>/<locale>/examples/<example>
                                    // <collection>/<version>/<locale>/guides/<guide>
                                    // <collection>/<version>/<locale>/pages/<page>
                                    // <collection>/<version>/<locale>/objects/<object>
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
            
            // return
            return parts;
        };
        const go = async () => {
            let parts = null;
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
                if (data.content && Array.isArray(data.content.items)) {
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
            const packageVersionLocale = async () => {
                let isSuccess = true;
                if (!data.package || 
                    !data.version || 
                    !data.locale ||
                    parts.package.name !== data.package.name ||
                    parts.version.name !== data.version.name ||
                    parts.locale.name !== data.locale.name) {
                    
                    let json = await getData(`${parts.locale.root}/${parts.locale.file}`);
                    if (json) {
                        // load search data, if available
                        if (json.search) { await loadSearch(`${parts.locale.root}/${json.search}`); }
                        
                        // load strings
                        if (json.strings) { data.strings = await getData(`${parts.locale.root}/${json.strings}`) || {}; }

                        // set new current
                        data.package = parts.package;
                        data.version = parts.version;
                        data.locale = parts.locale;
                        data.rootUrl = parts.locale.root;

                        // info
                        data.info = json.info;

                        // branding
                        data.branding = json.branding;

                        // set locale and direction to html
                        $('html').attr('lang', data.locale.name);
                        if (data.locale.rtl) {
                            $('html').attr('dir', 'rtl');
                        } else {
                            $('html').removeAttr('dir');
                        }

                        // clean home
                        delete json.info;
                        delete json.branding;
                        delete json.search;
                        delete json.strings;

                        // keep this package home json handy, it may be needed when 
                        // coming again to home page of this package
                        data.home = json;

                        // further load home/404 pages
                        pages.home = null;
                        pages['404'] = null;
                        if (data.branding.pages.home) {
                            let pageJson = await getData(`${data.rootUrl}/${data.branding.pages.home}`);
                            if (pageJson) { pages.home = pageJson; }
                        }
                        if (data.branding.pages['404']) {
                            let pageJson = await getData(`${data.rootUrl}/${data.branding.pages['404']}`);
                            if (pageJson) { pages['404'] = pageJson; }
                        }

                        // set flag, so on next refresh re/load branding specific customizable 
                        // areas can be loaded/changed
                        isPackageVersionLocaleChanged = true;
                    } else {
                        isSuccess = false;
                    }
                }

                // return
                return isSuccess;
            };

            // clear previous
            data.content = null;
            data.section = '';

            // load location from current hash
            parts = await parseUrl(location.hash.replace('#/', ''));

            // load one-time-loading data, if package, version or locale is changed or not loaded as yet
            if (await packageVersionLocale()) {
                // load url specific content
                if (!parts.file) { // this is home page
                    // ensure url still has all parts to represents home
                    location.replace(`${location.href.split('#')[0]}#/${data.package.name}/${data.version.name}/${data.locale.name}`);

                    // set content
                    if (data.home) { 
                        data.content = data.home; 
                    }
                } else {
                    data.content = await getData(`${data.locale.root}/${parts.file}`);
                }
                data.section = (data.content ? parts.section : '');
                groupContentItems();
            }

            // render
            await render();            
        };
        const loadTheme = async () => {
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
                        resolve($e);
                    };
                    $e.onerror = (err) => {
                        console.error(err);
                        resolve($e); // still resolve
                    };
                    $('head').append($e);
                });
            };    

            // activate material design
            $('body').bootstrapMaterialDesign();            

            // load theme's structural content (index.html)
            let templateContent = await getTemplate(data.theme.index);
            if (templateContent) {
                // load theme css
                for(let file of data.theme.files.css) { await loadCSS(file); }

                // load template content 
                let $root = $(`#root`);
                $root.html(templateContent);

                // find defined fragments in template and load them all
                // this is a recursive call and will load all fragments 
                // defined inside loaded fragments too
                // leaving custom fragments, which will be added later
                customizableAreas = [];
                await loadFragments(data.theme.fragments, $root, false, false, true);

                // load theme js
                for(let file of data.theme.files.js) { await loadJS(file); }

                // done
                return true;
            }

            // otherwise
            return false;
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
                        root = data.locale.root;
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
                            // TODO: fix this - as per new area specific data approach
                            // there is no vueData
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
                            link = `${root.replace(data.package.name, colName)}/${link}`; // replace current collection with given collection -- keeping version and locale same
                        } else {
                            link = `${root}/${link}`;
                        }
                    }
                }

                // return
                return link;
     
            };  
            const setCookie = (name, value, expires, path, domain, secure) => {
                let theValue = JSON.stringify({ value: value });
                document.cookie = name + '=' + escape(theValue) +
                    ((expires) ? '; expires=' + expires : '') +
                    ((path) ? '; path=' + path : '') +
                    ((domain) ? '; domain=' + domain : '') +
                    ((secure) ? '; secure' : '');
            };
            const getCookie = (name) => {
                let cookie = ' ' + document.cookie,
                    search = ' ' + name + '=',
                    offset = 0,
                    end = 0,
                    theValue = null,
                    value = null;
                if (cookie.length > 0) {
                    offset = cookie.indexOf(search);
                    if (offset !== -1) {
                        offset += search.length;
                        end = cookie.indexOf(';', offset);
                        if (end === -1) { end = cookie.length; }
                        theValue = unescape(cookie.substring(offset, end));
                    }
                }
                if (theValue) {
                    try {
                        value = JSON.parse(theValue).value;
                    } catch (err) {
                        // ignore
                    }
                } 
                return value;
            };
            const resetCookie = (name) => {
                document.cookie = name + '=; Max-Age=-99999999;';
            };
            const closeArea = (name, days) => {
                // check area validity
                let isValid = false;
                for(let $a of customizableAreas) { if ($a.attr('id') === name) { isValid = true; break; } }
                
                if (isValid) {
                    // clear the area html
                    $$el = $(`#${name}`);
                    $$el.html(''); // this should hide it because of ':empty' css rule

                    // set cookie for number of days for the area (it will remain close for these number of days)
                    let date = new Date();
                    date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
                    setCookie(name, true, date.toUTCString(), '/');
                }
            };

            // one time per-refresh loaded data
            data = {};
            data.packages = json.packages;
            data.builder = json.builder;
            data.theme = json.theme;

            // inbuilt funcs
            data.func = {
                dl: dl,
                go: (url) => { location.hash = url; },
                back: () => { window.history.back(); },
                cookie: {
                    get: getCookie,
                    set: setCookie,
                    reset: resetCookie
                },
                closeArea: closeArea,
                hasRightBarContent: () => { return $(`#c2a`).html() || $(`#adv`).html(); },
                hasLeftBarContent: () => { return data.list.length > 0; },
                isShowingPage: () => { return data.page !== null; },
                isShowingDocs: () => { return data.page === null; }
            };

            // one time per-package/version/locale loaded data
            data.package = null;
            data.version = null;
            data.locale = null;    
            data.rootUrl = '';   
            data.branding = {};
            data.home = null;
            data.page = null;
            data.info = {};
            data.search = null;
            data.strings = {};

            // per url-change loaded data
            data.list = [];
            data.content = null; // null means 404
            data.section = ''; 
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
                if (await loadTheme()) {
                    // setup location change handler
                    addEventListener('hashchange', go, false);

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
                    if (isStarted) { await go(); }
                }
            },

            data: () => { return data; },

            // define theme function
            themeFunc: (name, fn) => { data.theme.func[name] = fn; },

            // define page function
            pageFunc: (name, fn) => { data.page.func[name] = fn; }
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