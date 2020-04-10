const open = require('open');
const child_process = require('child_process');

module.exports = async (options) => {
    const getUrl = () => {
        // build url
        let url = `http://localhost:${options.tests.port}/index.html`;

        // add full OR quick OR group OR types OR nothing
        if (options.session.test.full) { url += '?q=full'; }
        else if (options.session.test.quick) { url += '?q=quick'; }
        else if (options.session.test.group) { url += '?q=group&n=' + options.session.test.group; }
        else if (options.session.test.types) { url += '?q=types&n=' + options.session.test.types; }

        // add config values
        if (options.tests.config.stopSpecOnExpectationFailure) {
            if (url.indexOf('?') !== -1) {
                url += '&throwFailures=true';
            } else {
                url += '?throwFailures=true';
            }
        }
        if (options.tests.config.stopOnSpecFailure) {
            if (url.indexOf('?') !== -1) {
                url += '&failFast=true';
            } else {
                url += '?failFast=true';
            }
        }
        if (options.tests.config.random) {
            if (url.indexOf('?') !== -1) {
                url += '&random=true';
            } else {
                url += '?random=true';
            }
            if (options.tests.config.seed) {
                url += `&seed=${options.tests.config.seed}`;
            }         
        }

        // return
        return url;
    }    

    // open server
    let proc = child_process.execFile('http-server', [options.tests.dest, `-p${options.tests.port}`]);

    // open required browser
    // NOTE: this await will resolve when browser is closed (not just tab where index.html was opened)
    let url = getUrl(),
        browser = options.general.browsers[options.session.test.browser || options.tests.browser || '']; // args given or configured or default
    if (browser) {
        await open(url, { app: browser.cmd, wait: true });
    } else { // use default
        await open(url, { wait: true });
    }

    // kill server
    proc.kill();
};