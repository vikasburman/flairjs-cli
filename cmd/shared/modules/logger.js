// logger 
exports.level = 0;

let indent = 2,
    col1Length = 15;
const logger = (num, col1, col2, col3, col4, col5) => {
    let msg = '';
    if (col1) { msg += '- ' + col1; }
    if (col2) { msg += (msg ? ': ' : '') + col2; }
    if (col3) { msg += ' (' + col3 + ')'; }
    if (col4) { msg += ' [' + col4 + ']'; }
    if (col5) { msg += ' ' + col5; }
    msg = ' '.repeat((exports.level > 0 ? exports.level : 0) * indent) + msg;
    if (msg.trim()) { console.log( msg); } // eslint-disable-line no-console
    exports.level += num;
};
exports.logger = logger;
