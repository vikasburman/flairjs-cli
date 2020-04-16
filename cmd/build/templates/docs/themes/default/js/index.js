// any custom functions can be defined as:
//  flairDocs.themeFunc('name', fn);
//  these will be available as: theme.func.<name> on bounded data

$(document).ready(function () {
    // $("#left").mCustomScrollbar({
    //     theme: "minimal"
    // });

    // navbar open/close
    const ensureCollapsed = () => {
        let $left = $('#left');
        if (!$left.hasClass('collapsed')) { $left.addClass('collapsed'); }
    };
    const ensureOpen = () => {
        let $left = $('#left');
        if ($left.hasClass('collapsed')) { $left.removeClass('collapsed'); }
    };

    // leftbar initial state
    if (window.matchMedia('(max-width: 768px)').matches) { // the viewport is 768px wide or less
        ensureCollapsed();
    } else { // the viewport is more than than 768px wide 
        ensureOpen();
    }        

    // leftbar show/hide on screen width change
    var mql = window.matchMedia('(max-width: 768px)');
    mql.addEventListener('change', (e) => {
        if (e.matches) { // the viewport is 768px wide or less
            ensureCollapsed();
        } else { // the viewport is more than than 768px wide 
            ensureOpen();
        }
    }); 

    // NOTE: instead of direct attaching like -> $('#leftCollapse').on('click', function () { 
    // using indirect attaching (like below) because when this file is loaded, DOM might still be adding 
    // fragments and elements but since DOM was earlier ready, this code still runs
    $('body').on('click', '#leftCollapse', () => {
        // open or close leftbar
        $('#left').toggleClass('collapsed');

        // // close dropdowns
        // $('.collapse.in').toggleClass('in');
        
        // // and also adjust aria-expanded attributes we use for the open/closed arrows
        // // in our CSS
        // $('a[aria-expanded=true]').attr('aria-expanded', 'false');
    });
});


