const escapeRegExp = (string) => {
    return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");  // eslint-disable-line no-useless-escape
};

// replace all instances of given string in other string
module.exports = function(string, find, replace) {
    return string.replace(new RegExp(escapeRegExp(find), 'g'), replace);
};