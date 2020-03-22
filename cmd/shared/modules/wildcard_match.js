const matcher = require('matcher');

// https://www.npmjs.com/package/matcher
exports.matcher = matcher;
exports.isMatch = matcher.isMatch;

// returns true, if matched any of the patterns
// input: string, array
// patterns: array
exports.isMatchAny = (input, patterns, options = {}) => {
    let result = false;
    if (input && patterns && patterns.length > 0) {
        if (typeof input === 'string') {
            for(let pattern of patterns) {
                if (matcher.isMatch(input, pattern, options)) { result = true; break; }
            }
        } else {
            for(let value of input) {
                for(let pattern of patterns) {
                    if (matcher.isMatch(value, pattern, options)) { result = true; break; }
                }
                if (result) { break; }
            }
        }
    }
    return result;
}
// returns true, if matched all of the patterns
// input: string, patterns: array
exports.isMatchAll = (input, patterns, options = {}) => {
    let result = false;
    if (input && patterns && patterns.length > 0) {
        result = true;
        for(let pattern of patterns) {
            if (!matcher.isMatch(input, pattern, options)) { result = false; break; }
        }
    }
    return result;
}