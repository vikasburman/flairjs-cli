/**
 * @name IProgressReporter
 * @description IProgressReporter interface.
 */
$$('ns', '(auto)');
Interface('(auto)', function() {
    
    // progress report
    this.progress = this.event(this.noop);
    
});