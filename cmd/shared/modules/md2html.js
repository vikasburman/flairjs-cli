const showdown = require('showdown');
const replaceAll = require('./replace_all');

// hyperlink fixing
// its converting <? href="linkText">?</?> ---> <? :href="dl('linkText')">?</?>
// so this becomes a vuejs v-bind link and 'dl' is a function that will return
// the dynamic link at UI
const hl = (text) => {
    // href
    let rx = new RegExp(/href="(.+?)"/g); 
    let matches = text.match(rx) || [];  
    for(let m of matches) {
        text = replaceAll(text, m, `:href="dl('${m.substring(6, m.length -1)}')"`);
    }

    // src
    rx = new RegExp(/src="(.+?)"/g); 
    matches = text.match(rx) || []; 
    for(let m of matches) {
        text = replaceAll(text, m, `:src="dl('${m.substring(5, m.length -1)}')"`);
    }

    return text;
};

// md2html (no sanitization of html, since content is not user-input)
const converter = new showdown.Converter();
const setOptions = () => {
    // options (https://www.npmjs.com/package/showdown)
    showdown.setFlavor('github');                               // start set as GFM - with some custom options
    converter.setOption('omitExtraWLInCodeBlocks', true);
    converter.setOption('noHeaderId', true);                    // no hyperlinks for sections;     because we don't want # tags added to url - because client url will break
    converter.setOption('headerLevelStart', 4);                 // # will be treated as <h4>;   because we theme revser top 3 levels
    converter.setOption('literalMidWordUnderscores', true);
    converter.setOption('literalMidWordAsterisks', true);
    converter.setOption('strikethrough', true);
    converter.setOption('tables', true);
    converter.setOption('ghCodeBlocks', true);
    converter.setOption('tasklists', true);
    converter.setOption('smartIndentationFix', true);
    converter.setOption('disableForced4SpacesIndentedSublists', true);
    converter.setOption('simpleLineBreaks', true);
    converter.setOption('requireSpaceBeforeHeadingText', true);
    converter.setOption('openLinksInNewWindow', false);
    converter.setOption('backslashEscapesHTMLTags', true);
    converter.setOption('emoji', true);                         // https://github.com/showdownjs/showdown/wiki/Emojis
    converter.setOption('underline', true);
    converter.setOption('completeHTMLDocument', false);
    converter.setOption('metadata', false);
    converter.setOption('splitAdjacentBlockquotes', false);
};
setOptions(); // set it once

const fragment2html = function(text) {
    if (text) { return hl(converter.makeHtml(text)); }
    return text;
};
const page2html = function(text) {
    // reset some options for page cases
    converter.setOption('headerLevelStart', 1);                 // for pages, allow top level headings

    // convert
    text = fragment2html(text);

    // reset changed options
    setOptions();

    // return
    return text;
};

exports.fragment = fragment2html;
exports.page = page2html;
